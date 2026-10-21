/**
 * The OpenAI-compatible provider adapter.
 *
 * One adapter covers every server that speaks the OpenAI chat completions
 * API: Ollama, LM Studio, llama.cpp, vLLM, DeepSeek, OpenRouter, Groq,
 * Together, Cerebras, Mistral, OpenAI itself, and every gateway in between.
 * Per-provider differences are expressed as {@link CompatFlags} rather than
 * as separate code paths.
 */
import { flowError, type FlowError } from "../errors.js";
import { ok, type Result } from "../util/result.js";
import { resolveCompat, type CompatFlags } from "./compat.js";
import { listModels, trimTrailingSlash } from "./discovery.js";
import { errorForStatus, httpRequest, JSON_HEADERS } from "./http.js";
import { SseDecoder } from "./sse.js";
import { ToolCallAssembler, type ToolCallDelta } from "./tool-calls.js";
import type {
  ChatMessage,
  ChatRequest,
  FinishReason,
  ModelInfo,
  ModelProvider,
  ProviderEvent,
  ToolDefinition,
} from "./types.js";

/** How to reach an OpenAI-compatible provider. */
export interface OpenAiCompatibleOptions {
  /** A stable identifier for this provider. */
  readonly id: string;
  /** A human-readable name. */
  readonly label: string;
  /** The base URL, including any `/v1` prefix the server expects. */
  readonly baseUrl: string;
  /** The API key, if there is one. */
  readonly apiKey?: string;
  /** Extra headers to send with every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Request-shaping overrides. */
  readonly compat?: Partial<CompatFlags>;
}

/** Create a provider that speaks the OpenAI chat completions API. */
export const createOpenAiCompatibleProvider = (
  options: OpenAiCompatibleOptions,
): ModelProvider => {
  const compat = resolveCompat(options.compat);
  const headers = buildHeaders(options);

  return {
    id: options.id,
    label: options.label,
    listModels: (signal) => listModels(options.baseUrl, headers, signal),
    streamChat: (request, signal) =>
      streamChat(options, compat, headers, request, signal),
  };
};

/** Build the headers sent with every request. */
const buildHeaders = (
  options: OpenAiCompatibleOptions,
): Record<string, string> => ({
  ...JSON_HEADERS,
  ...(options.apiKey === undefined || options.apiKey === ""
    ? {}
    : { authorization: `Bearer ${options.apiKey}` }),
  ...options.headers,
});

/** Build the JSON body of a chat completions request. */
export const buildRequestBody = (
  request: ChatRequest,
  compat: CompatFlags,
): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: buildMessages(request.messages, compat),
    stream: true,
  };

  if (request.tools !== undefined && request.tools.length > 0) {
    body["tools"] = buildTools(request.tools, compat);
    if (compat.parallelToolCalls) {
      body["parallel_tool_calls"] = true;
    }
  }
  if (request.temperature !== undefined) {
    body["temperature"] = request.temperature;
  }
  if (request.maxTokens !== undefined) {
    body[compat.maxTokensField] = request.maxTokens;
  }
  if (request.stop !== undefined && request.stop.length > 0) {
    body["stop"] = request.stop;
  }

  return body;
};

/** Translate the conversation into OpenAI-shaped messages. */
export const buildMessages = (
  messages: readonly ChatMessage[],
  compat: CompatFlags,
): unknown[] => {
  const out: unknown[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "system":
        out.push({
          role: compat.developerRole ? "developer" : "system",
          content: message.content,
        });
        break;

      case "user":
        out.push({ role: "user", content: message.content });
        break;

      case "assistant": {
        const entry: Record<string, unknown> = {
          role: "assistant",
          content: message.content === "" ? null : message.content,
        };
        if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
          entry["tool_calls"] = message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(call.args ?? {}),
            },
          }));
        }
        out.push(entry);
        break;
      }

      case "tool":
        if (compat.toolResultRole === "user") {
          const label = message.name ?? message.toolCallId;
          out.push({
            role: "user",
            content: `[tool result: ${label}]\n${message.content}`,
          });
        } else {
          out.push({
            role: "tool",
            tool_call_id: message.toolCallId,
            content: message.content,
          });
        }
        break;
    }
  }

  return out;
};

/** Translate the tool definitions into OpenAI-shaped function definitions. */
export const buildTools = (
  tools: readonly ToolDefinition[],
  compat: CompatFlags,
): unknown[] =>
  tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      ...(compat.strictToolSchema ? { strict: true } : {}),
    },
  }));

/** Mutable state threaded through the streaming loop. */
interface StreamState {
  readonly assembler: ToolCallAssembler;
  finishReason: FinishReason;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Stream one assistant turn.
 *
 * The iterator never throws: transport and protocol failures are reported as
 * `error` events so the caller can render them and decide what to do.
 */
const streamChat = async function* (
  options: OpenAiCompatibleOptions,
  compat: CompatFlags,
  headers: Readonly<Record<string, string>>,
  request: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<ProviderEvent> {
  const url = `${trimTrailingSlash(options.baseUrl)}/chat/completions`;
  const body = buildRequestBody(request, compat);

  const outcome = await httpRequest(
    url,
    { method: "POST", headers, body: JSON.stringify(body) },
    signal,
  );

  if (!outcome.ok) {
    yield { type: "error", error: outcome.error };
    return;
  }

  const response = outcome.value;
  if (!response.ok) {
    yield { type: "error", error: errorForStatus(response.status, await response.text()) };
    return;
  }

  if (response.body === null) {
    yield {
      type: "error",
      error: flowError("malformed_response", "The provider returned an empty response body.", {
        retryable: true,
      }),
    };
    return;
  }

  const state: StreamState = { assembler: new ToolCallAssembler(), finishReason: "stop" };
  const decoder = new SseDecoder();

  try {
    for await (const text of readTextStream(response.body)) {
      for (const record of decoder.push(text)) {
        for (const event of handleRecord(record.data, state)) {
          yield event;
        }
      }
    }
    for (const record of decoder.flush()) {
      for (const event of handleRecord(record.data, state)) {
        yield event;
      }
    }
  } catch (error) {
    yield {
      type: "error",
      error: flowError("network_error", `The stream ended unexpectedly: ${errorText(error)}`, {
        retryable: true,
        cause: error,
      }),
    };
    return;
  }

  const calls = state.assembler.complete();
  if (calls.length > 0) {
    const malformed = state.assembler.malformed();
    if (malformed.length > 0) {
      yield { type: "error", error: (malformed[0] as { error: FlowError }).error };
      return;
    }
    for (const [index, call] of calls.entries()) {
      // Some servers omit the call id entirely.
      yield {
        type: "tool_call",
        call: call.id === "" ? { ...call, id: `call_${index}` } : call,
      };
    }
    state.finishReason = "tool_calls";
  }

  if (state.inputTokens !== undefined || state.outputTokens !== undefined) {
    yield {
      type: "usage",
      inputTokens: state.inputTokens ?? 0,
      outputTokens: state.outputTokens ?? 0,
    };
  }

  yield { type: "done", reason: state.finishReason };
};

/**
 * Handle one SSE record.
 *
 * @param data - The record's `data:` payload.
 * @param state - The streaming state, updated in place.
 */
const handleRecord = (
  data: string,
  state: StreamState,
): ProviderEvent[] => {
  if (data === "" || data === "[DONE]") {
    return [];
  }

  let payload: unknown;
  try {
    payload = JSON.parse(data) as unknown;
  } catch {
    return [
      {
        type: "error",
        error: flowError("malformed_response", "The provider sent a chunk that was not JSON.", {
          retryable: false,
        }),
      },
    ];
  }

  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const events: ProviderEvent[] = [];

  const providerError = record["error"];
  if (typeof providerError === "object" && providerError !== null) {
    const message =
      (providerError as Record<string, unknown>)["message"];
    events.push({
      type: "error",
      error: flowError("server_error", typeof message === "string" ? message : "The provider reported an error.", {
        retryable: false,
      }),
    });
    return events;
  }

  const choices = record["choices"];
  const choice = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined;
  const delta =
    choice !== undefined && typeof choice["delta"] === "object" && choice["delta"] !== null
      ? (choice["delta"] as Record<string, unknown>)
      : undefined;

  if (delta !== undefined) {
    const content = delta["content"];
    if (typeof content === "string" && content !== "") {
      events.push({ type: "text_delta", text: content });
    }

    // Reasoning traces appear under different names depending on the server.
    for (const field of ["reasoning_content", "reasoning"]) {
      const reasoning = delta[field];
      if (typeof reasoning === "string" && reasoning !== "") {
        events.push({ type: "reasoning_delta", text: reasoning });
        break;
      }
    }

    const toolCalls = delta["tool_calls"];
    if (Array.isArray(toolCalls)) {
      for (const entry of toolCalls) {
        if (typeof entry !== "object" || entry === null) {
          continue;
        }
        const call = entry as Record<string, unknown>;
        const fn =
          typeof call["function"] === "object" && call["function"] !== null
            ? (call["function"] as Record<string, unknown>)
            : undefined;
        const index = typeof call["index"] === "number" ? call["index"] : 0;
        const deltaCall: ToolCallDelta = {
          index,
          ...(typeof call["id"] === "string" ? { id: call["id"] } : {}),
          ...(fn !== undefined && typeof fn["name"] === "string" ? { name: fn["name"] } : {}),
          ...(fn !== undefined && typeof fn["arguments"] === "string"
            ? { argumentsDelta: fn["arguments"] }
            : {}),
        };
        state.assembler.add(deltaCall);
      }
    }
  }

  const finish = choice?.["finish_reason"];
  if (typeof finish === "string") {
    state.finishReason = mapFinishReason(finish);
  }

  const usage = record["usage"];
  if (typeof usage === "object" && usage !== null) {
    const usageRecord = usage as Record<string, unknown>;
    const input = usageRecord["prompt_tokens"];
    const output = usageRecord["completion_tokens"];
    if (typeof input === "number") {
      state.inputTokens = input;
    }
    if (typeof output === "number") {
      state.outputTokens = output;
    }
  }

  // Ollama reports token counts under its own names.
  const ollamaInput = record["prompt_eval_count"];
  const ollamaOutput = record["eval_count"];
  if (typeof ollamaInput === "number") {
    state.inputTokens = ollamaInput;
  }
  if (typeof ollamaOutput === "number") {
    state.outputTokens = ollamaOutput;
  }

  return events;
};

/** Map a provider finish reason onto Flow Code's. */
export const mapFinishReason = (reason: string): FinishReason => {
  switch (reason) {
    case "stop":
    case "end_turn":
      return "stop";
    case "length":
    case "max_tokens":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "content_filter":
      return "error";
    default:
      return "stop";
  }
};

/**
 * Read a response body as text chunks.
 *
 * The decoder is used in streaming mode so a multi-byte character split across
 * a chunk boundary is still decoded correctly.
 */
export const readTextStream = async function* (
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value !== undefined) {
        const text = decoder.decode(value, { stream: true });
        if (text !== "") {
          yield text;
        }
      }
    }
    const tail = decoder.decode();
    if (tail !== "") {
      yield tail;
    }
  } finally {
    reader.releaseLock();
  }
};

/** Extract a message from an unknown thrown value. */
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Discover the models a provider serves, discarding the failure detail. */
export const safeListModels = async (
  provider: ModelProvider,
  signal?: AbortSignal,
): Promise<Result<ModelInfo[], FlowError>> => {
  try {
    return await provider.listModels(signal);
  } catch (error) {
    return {
      ok: false,
      error: flowError("network_error", `Could not list models: ${errorText(error)}`, {
        retryable: true,
        cause: error,
      }),
    };
  }
};

/** A provider that always reports the same models, for offline use. */
export const createStaticProvider = (
  id: string,
  label: string,
  models: readonly ModelInfo[],
): ModelProvider => ({
  id,
  label,
  listModels: () => Promise.resolve(ok([...models])),
  streamChat: async function* () {
    yield {
      type: "error",
      error: flowError("unsupported", "This provider cannot stream responses.", {
        retryable: false,
      }),
    };
  },
});
