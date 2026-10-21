/**
 * The provider layer's public contract.
 *
 * Everything above this file — the agent loop, the tools, the UI — talks to a
 * model only through {@link ModelProvider}. Swapping OpenAI-compatible
 * responses for Anthropic responses is an implementation detail below the line.
 */
import type { FlowError } from "../errors.js";
import type { Result } from "../util/result.js";

/** A JSON Schema object, as sent to a provider. */
export type JsonSchema = Record<string, unknown>;

/** A tool the model is allowed to call. */
export interface ToolDefinition {
  /** The name the model uses to call the tool. */
  readonly name: string;
  /** What the tool does, in the model's terms. */
  readonly description: string;
  /** The JSON Schema for the tool's arguments. */
  readonly parameters: JsonSchema;
}

/** A tool call emitted by the model. */
export interface ToolCall {
  /** The provider's identifier for this call. */
  readonly id: string;
  /** The tool's name. */
  readonly name: string;
  /** The parsed arguments. */
  readonly args: unknown;
}

/** A message in the conversation. */
export type ChatMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string;
      readonly toolCalls?: readonly ToolCall[];
    }
  | {
      readonly role: "tool";
      readonly content: string;
      readonly toolCallId: string;
      readonly name?: string;
    };

/** A request for one assistant turn. */
export interface ChatRequest {
  /** The model to talk to. */
  readonly model: string;
  /** The conversation so far. */
  readonly messages: readonly ChatMessage[];
  /** The tools the model may call. */
  readonly tools?: readonly ToolDefinition[];
  /** Sampling temperature. */
  readonly temperature?: number;
  /** The maximum number of tokens to generate. */
  readonly maxTokens?: number;
  /** Stop sequences. */
  readonly stop?: readonly string[];
}

/** One model a provider can serve. */
export interface ModelInfo {
  /** The identifier sent on the wire. */
  readonly id: string;
  /** A human-readable name, when the provider supplies one. */
  readonly label?: string;
  /** The context window, in tokens, when the provider reports one. */
  readonly contextWindow?: number;
}

/** Why a model stopped generating. */
export type FinishReason = "stop" | "length" | "tool_calls" | "error" | "aborted";

/** An event emitted while a model is streaming its answer. */
export type ProviderEvent =
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "reasoning_delta"; readonly text: string }
  | { readonly type: "tool_call"; readonly call: ToolCall }
  | { readonly type: "usage"; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly type: "done"; readonly reason: FinishReason }
  | { readonly type: "error"; readonly error: FlowError };

/** A source of models and completions. */
export interface ModelProvider {
  /** A stable identifier, used in configuration and session logs. */
  readonly id: string;
  /** A human-readable name. */
  readonly label: string;
  /**
   * List the models this provider can serve.
   *
   * Discovery is a convenience, never a gate: a provider that cannot list its
   * models must still be usable with a model id the user typed by hand. A
   * failure is reported, not thrown, so callers can show it without treating
   * it as fatal.
   */
  listModels(signal?: AbortSignal): Promise<Result<ModelInfo[], FlowError>>;
  /**
   * Stream one assistant turn.
   *
   * The iterator ends when the model finishes. Failures are reported as an
   * `error` event rather than thrown, so the caller can render them.
   */
  streamChat(
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ProviderEvent>;
}
