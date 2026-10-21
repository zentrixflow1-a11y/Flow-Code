/**
 * The Anthropic Messages provider adapter.
 *
 * This is a second wire format, not a variation on the first: the message
 * shape, the tool shape, and the streaming events all differ from the
 * OpenAI-compatible API. Everything above the adapter sees the same
 * {@link ModelProvider} contract.
 */
import { flowError, type FlowError } from "../errors.js";
import { ok, type Result } from "../util/result.js";
import { trimTrailingSlash } from "./discovery.js";
import { errorForStatus, httpRequest } from "./http.js";
import { SseDecoder } from "./sse.js";
import type {
  ChatMessage,
  ChatRequest,
  FinishReason,
  ModelInfo,
  ModelProvider,
  ProviderEvent,
  ToolCall,
  ToolDefinition,
} from "./types.js";

/** The Anthropic API version this adapter speaks. */
export const ANTHROPIC_VERSION = "2023-06-01";

/** The output-token limit used when the caller does not specify one. */
const DEFAULT_MAX_TOKENS = 4096;

/** How to reach an Anthropic provider. */
export interface AnthropicOptions {
  /** A stable identifier for this provider. */
  readonly id: string;
  /** A human-readable name. */
  readonly label: string;
  /** The base URL, without the `/v1/messages` suffix. */
  readonly baseUrl: string;
  /** The API key. */
  readonly apiKey?: string;
  /** Extra headers to send with every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Create a provider that speaks the Anthropic Messages API. */
export const createAnthropicProvider = (options: AnthropicOptions): ModelProvider => {
  const headers = buildHeaders(options);

  return {
    id: options.id,
    label: options.label,
    listModels: (signal) => listAnthropicModels(options, headers, signal),
    streamChat: (request, signal) =>
      streamChat(options, headers, request, signal),
  };
};

/** Build the headers sent with every request. */
const buildHeaders = (options: AnthropicOptions): Record<string, string> => ({
  "content-type": "application/json",
  accept: "text/event-stream",
  "anthropic-version": ANTHROPIC_VERSION,
  ...(options.apiKey === undefined || options.apiKey === ""
    ? {}
    : { "x-api-key": options.apiKey }),
  ...options.headers,
});

/**
 * Translate the conversation into Anthropic-shaped messages.
 *
 * Anthropic keeps the system prompt out of the message list, and carries tool
 * results as `tool_result` blocks inside a user message.
 */
export const buildAnthropicMessages = (
  messages: readonly ChatMessage[],
): { readonly system: string; readonly messages: unknown[] } => {
  const systemParts: string[] = [];
  const out: unknown[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "system":
        systemParts.push(message.content);
        break;

      case "user":
        out.push({ role: "user", content: message.content });
        break;

      case "assistant": {
        const blocks: unknown[] = [];
        if (message.content !== "") {
          blocks.push({ type: "text", text: message.content });
        }
        for (const call of message.toolCalls ?? []) {
          blocks.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.args ?? {},
          });
        }
        out.push({ role: "assistant", content: blocks });
        break;
      }

      case "tool":
        out.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.toolCallId,
              content: message.content,
            },
          ],
        });
        break;
    }
  }

  return { system: systemParts.join("\n\n"), messages: out };
};

/** Translate the tool definitions into Anthropic-shaped tools. */
export const buildAnthropicTools = (tools: readonly ToolDefinition[]): unknown[] =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));

/** List the models an Anthropic endpoint offers. */
const listAnthropicModels = async (
  options: AnthropicOptions,
  headers: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<Result<ModelInfo[], FlowError>> => {
  const url = `${trimTrailingSlash(options.baseUrl)}/v1/models?limit=1000`;
  const outcome = await httpRequest(url, { method: "GET", headers }, signal);

  if (!outcome.ok) {
    return outcome;
  }

  const response = outcome.value;
  if (!response.ok) {
    return { ok: false, error: errorForStatus(response.status, await response.text()) };
  }

  const body = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch (error) {
    return {
      ok: false,
      error: flowError("malformed_response", "The model list was not valid JSON.", {
        retryable: false,
        cause: error,
      }),
    };
  }

  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return {
      ok: false,
      error: flowError("malformed_response", "The model list was not in the expected shape.", {
        retryable: false,
      }),
    };
  }

  const models: ModelInfo[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record["id"] === "string") {
      const label = record["display_name"];
      models.push({
        id: record["id"],
        ...(typeof label === "string" ? { label } : {}),
      });
    }
  }

  return ok(models);
};

/** The state threaded through the Anthropic streaming loop. */
interface AnthropicStreamState {
  readonly calls: Map<number, ToolCall>;
  readonly argumentBuffers: Map<number, string>;
  finishReason: FinishReason;
  inputTokens?: number;
  outputTokens?: number;
}

/** Stream one assistant turn from the Anthropic Messages API. */
const streamChat = async function* (
  options: AnthropicOptions,
  headers: Readonly<Record<string, string>>,
  request: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<ProviderEvent> {
  const url = `${trimTrailingSlash(options.baseUrl)}/v1/messages`;
  const { system, messages } = buildAnthropicMessages(request.messages);

  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages,
    stream: true,
  };
  if (system !== "") {
    body["system"] = system;
  }
  if (request.tools !== undefined && request.tools.length > 0) {
    body["tools"] = buildAnthropicTools(request.tools);
  }
  if (request.temperature !== undefined) {
    body["temperature"] = request.temperature;
  }
  if (request.stop !== undefined && request.stop.length > 0) {
    body["stop_sequences"] = request.stop;
  }

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

  const state: AnthropicStreamState = {
    calls: new Map(),
    argumentBuffers: new Map(),
    finishReason: "stop",
  };

  const decoder = new SseDecoder();
  const reader = response.body.getReader();
  const textDecoder = new TextDecoder();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }
      const text = textDecoder.decode(value, { stream: true });
      for (const record of decoder.push(text)) {
        for (const event of handleAnthropicRecord(record.data, state)) {
          yield event;
        }
      }
    }
    const tail = textDecoder.decode();
    if (tail !== "") {
      for (const record of decoder.push(tail)) {
        for (const event of handleAnthropicRecord(record.data, state)) {
          yield event;
        }
      }
    }
    for (const record of decoder.flush()) {
      for (const event of handleAnthropicRecord(record.data, state)) {
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
  } finally {
    reader.releaseLock();
  }

  if (state.calls.size > 0) {
    for (const call of state.calls.values()) {
      yield { type: "tool_call", call };
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

/** Handle one Anthropic SSE record. */
const handleAnthropicRecord = (
  data: string,
  state: AnthropicStreamState,
): ProviderEvent[] => {
  if (data === "") {
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
  const type = record["type"];
  const events: ProviderEvent[] = [];

  switch (type) {
    case "message_start": {
      const message = record["message"];
      if (typeof message === "object" && message !== null) {
        const usage = (message as Record<string, unknown>)["usage"];
        if (typeof usage === "object" && usage !== null) {
          const input = (usage as Record<string, unknown>)["input_tokens"];
          if (typeof input === "number") {
            state.inputTokens = input;
          }
        }
      }
      break;
    }

    case "content_block_start": {
      const index = typeof record["index"] === "number" ? record["index"] : 0;
      const block = record["content_block"];
      if (typeof block === "object" && block !== null) {
        const blockRecord = block as Record<string, unknown>;
        if (blockRecord["type"] === "tool_use") {
          const id = typeof blockRecord["id"] === "string" ? blockRecord["id"] : `call_${index}`;
          const name = typeof blockRecord["name"] === "string" ? blockRecord["name"] : "";
          state.calls.set(index, { id, name, args: {} });
          state.argumentBuffers.set(index, "");
        }
      }
      break;
    }

    case "content_block_delta": {
      const index = typeof record["index"] === "number" ? record["index"] : 0;
      const delta = record["delta"];
      if (typeof delta === "object" && delta !== null) {
        const deltaRecord = delta as Record<string, unknown>;
        if (deltaRecord["type"] === "text_delta") {
          const text = deltaRecord["text"];
          if (typeof text === "string" && text !== "") {
            events.push({ type: "text_delta", text });
          }
        } else if (deltaRecord["type"] === "input_json_delta") {
          const partial = deltaRecord["partial_json"];
          if (typeof partial === "string") {
            state.argumentBuffers.set(index, (state.argumentBuffers.get(index) ?? "") + partial);
          }
        } else if (deltaRecord["type"] === "thinking_delta") {
          const text = deltaRecord["thinking"];
          if (typeof text === "string" && text !== "") {
            events.push({ type: "reasoning_delta", text });
          }
        }
      }
      break;
    }

    case "message_delta": {
      const delta = record["delta"];
      if (typeof delta === "object" && delta !== null) {
        const stopReason = (delta as Record<string, unknown>)["stop_reason"];
        if (typeof stopReason === "string") {
          state.finishReason = mapAnthropicStopReason(stopReason);
        }
      }
      const usage = record["usage"];
      if (typeof usage === "object" && usage !== null) {
        const output = (usage as Record<string, unknown>)["output_tokens"];
        if (typeof output === "number") {
          state.outputTokens = output;
        }
      }
      break;
    }

    case "error": {
      const error = record["error"];
      const message =
        typeof error === "object" && error !== null
          ? (error as Record<string, unknown>)["message"]
          : undefined;
      events.push({
        type: "error",
        error: flowError(
          "server_error",
          typeof message === "string" ? message : "The provider reported an error.",
          { retryable: false },
        ),
      });
      break;
    }

    default:
      break;
  }

  // Tool arguments are complete once the block stops; parse them then.
  if (type === "content_block_stop") {
    const index = typeof record["index"] === "number" ? record["index"] : 0;
    const raw = state.argumentBuffers.get(index);
    const call = state.calls.get(index);
    if (call !== undefined && raw !== undefined) {
      const trimmed = raw.trim();
      if (trimmed === "") {
        state.calls.set(index, { ...call, args: {} });
      } else {
        try {
          state.calls.set(index, { ...call, args: JSON.parse(trimmed) as unknown });
        } catch {
          state.calls.set(index, { ...call, args: raw });
        }
      }
    }
  }

  return events;
};

/** Map an Anthropic stop reason onto Flow Code's finish reasons. */
export const mapAnthropicStopReason = (reason: string): FinishReason => {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return "stop";
  }
};

/** Extract a message from an unknown thrown value. */
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
