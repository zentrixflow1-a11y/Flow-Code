/**
 * Per-provider compatibility flags.
 *
 * Local model servers and API gateways disagree about small details of the
 * OpenAI request format. Rather than maintain a fork of the adapter per
 * provider, each provider declares how it wants to be talked to and the
 * adapter honours those flags.
 */

/** How a provider wants the request shaped. */
export interface CompatFlags {
  /**
   * Send the system prompt as a `developer` message instead of a `system`
   * message. Some servers only accept one of the two.
   */
  readonly developerRole: boolean;
  /** Which field carries the output-token limit. */
  readonly maxTokensField: "max_tokens" | "max_completion_tokens";
  /**
   * Whether the server accepts `strict: true` on a function definition. Some
   * servers reject the whole request when they see it, and the flag demands a
   * schema shape that Flow Code's tool schemas do not use, so it is off by
   * default.
   */
  readonly strictToolSchema: boolean;
  /** Whether the server accepts the `parallel_tool_calls` request flag. */
  readonly parallelToolCalls: boolean;
  /** Which role carries a tool result. */
  readonly toolResultRole: "tool" | "user";
}

/** The flags used for a generic OpenAI-compatible server. */
export const DEFAULT_COMPAT: CompatFlags = {
  developerRole: false,
  maxTokensField: "max_tokens",
  strictToolSchema: false,
  parallelToolCalls: true,
  toolResultRole: "tool",
};

/** Merge a partial set of flags over the defaults. */
export const resolveCompat = (
  overrides?: Partial<CompatFlags>,
): CompatFlags => ({ ...DEFAULT_COMPAT, ...overrides });
