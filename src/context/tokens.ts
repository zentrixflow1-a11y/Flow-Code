/**
 * Estimating how much of the model's context a conversation uses.
 *
 * When a provider reports its usage, that number is used. This estimator is
 * the fallback, for providers that do not report it — which is most local
 * model servers.
 */
import type { ChatMessage } from "../providers/types.js";

/**
 * How many characters of typical text make one token.
 *
 * English prose averages a little over four characters per token; code is
 * denser, so the divisor is lower.
 */
export const CHARS_PER_TOKEN = 3.6;

/** The overhead each message adds, in tokens. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * Estimate the tokens in a piece of text.
 *
 * @param text - The text to measure.
 */
export const estimateTokens = (text: string): number =>
  text.length === 0 ? 0 : Math.ceil(text.length / CHARS_PER_TOKEN);

/**
 * Estimate the tokens one message occupies.
 *
 * @param message - The message to measure.
 */
export const estimateMessageTokens = (message: ChatMessage): number => {
  let tokens = MESSAGE_OVERHEAD_TOKENS + estimateTokens(message.content);

  if (message.role === "assistant" && message.toolCalls !== undefined) {
    for (const call of message.toolCalls) {
      tokens += estimateTokens(call.name) + estimateTokens(JSON.stringify(call.args ?? {}));
    }
  }

  return tokens;
};

/**
 * Estimate the tokens a conversation occupies.
 *
 * @param messages - The conversation to measure.
 */
export const estimateMessagesTokens = (messages: readonly ChatMessage[]): number =>
  messages.reduce((total, message) => total + estimateMessageTokens(message), 0);

/**
 * The token usage a provider reported, if it reported any.
 */
export interface ReportedUsage {
  /** The tokens the prompt used. */
  readonly inputTokens: number;
  /** The tokens the answer used. */
  readonly outputTokens: number;
}

/**
 * The context size of a conversation.
 *
 * The provider's own number wins when there is one, because it is the only
 * exact measurement available.
 */
export const contextSize = (
  messages: readonly ChatMessage[],
  usage?: ReportedUsage,
): number =>
  usage === undefined
    ? estimateMessagesTokens(messages)
    : usage.inputTokens + usage.outputTokens;
