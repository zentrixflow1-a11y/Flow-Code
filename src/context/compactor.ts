/**
 * Compacting a conversation that has outgrown the context window.
 *
 * The summary is *structured* rather than prose, because a prose summary
 * loses the list of files that were touched, and the model then reads them
 * all again. When the summary cannot be produced — which happens with a
 * small local model more often than you would like — the conversation is
 * truncated instead, and the model is told exactly how much was lost.
 */
import type { ChatMessage } from "../providers/types.js";
import { estimateMessagesTokens } from "./tokens.js";

/** How a compaction ended. */
export interface CompactionResult {
  /** The messages to carry forward. */
  readonly messages: ChatMessage[];
  /** The summary, or a note that the history was truncated. */
  readonly summary: string;
  /** How many messages were replaced by the summary. */
  readonly droppedMessages: number;
  /** Whether the summary failed and the history was truncated instead. */
  readonly truncated: boolean;
}

/** How a compaction behaves. */
export interface CompactionOptions {
  /**
   * How many of the most recent turns to keep verbatim.
   *
   * A turn starts at each user message.
   */
  readonly keepTurns: number;
  /**
   * Produce the summary.
   *
   * The summariser is injected so the compactor stays testable, and so the
   * caller decides which model does the summarising.
   */
  readonly summarize: (transcript: string) => Promise<string>;
}

/** The instruction used to produce a structured summary. */
export const SUMMARY_INSTRUCTION = [
  "Summarise the work so far so that another agent can continue without the transcript.",
  "",
  "Write these sections, in this order, and keep each one short:",
  "Goal — what the user asked for.",
  "Done — what has been completed, and the result of any checks that were run.",
  "Files — every file that was read or changed, one per line.",
  "Findings — what was learned, including anything surprising.",
  "Next — what still has to happen.",
  "Open — anything that is still undecided.",
  "",
  "Do not invent anything that is not in the transcript.",
].join("\n");

/**
 * Whether a conversation should be compacted.
 *
 * @param estimatedTokens - How much of the window the conversation uses.
 * @param contextWindow - The model's context window.
 * @param ratio - The share of the window to fill before compacting.
 */
export const shouldCompact = (
  estimatedTokens: number,
  contextWindow: number,
  ratio: number,
): boolean => {
  if (contextWindow <= 0) {
    return false;
  }
  return estimatedTokens >= contextWindow * ratio;
};

/**
 * The index of the first message to keep.
 *
 * A turn begins at each user message, so the boundary is placed at the start
 * of the turn that is `keepTurns` from the end.
 *
 * @param messages - The conversation.
 * @param keepTurns - How many turns to keep.
 */
export const compactionBoundary = (
  messages: readonly ChatMessage[],
  keepTurns: number,
): number => {
  if (keepTurns <= 0) {
    return messages.length;
  }

  const userIndices: number[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "user") {
      userIndices.push(index);
    }
  }

  if (userIndices.length <= keepTurns) {
    return 0;
  }

  return userIndices[userIndices.length - keepTurns] ?? 0;
};

/**
 * Compact a conversation.
 *
 * @param messages - The conversation.
 * @param options - How to compact it.
 */
export const compactMessages = async (
  messages: readonly ChatMessage[],
  options: CompactionOptions,
): Promise<CompactionResult> => {
  const boundary = compactionBoundary(messages, options.keepTurns);
  const kept = messages.slice(boundary);
  const dropped = messages.slice(0, boundary);

  if (dropped.length === 0) {
    return {
      messages: [...kept],
      summary: "",
      droppedMessages: 0,
      truncated: false,
    };
  }

  let summary: string;
  let truncated = false;

  try {
    summary = await options.summarize(transcriptOf(dropped));
    if (summary.trim() === "") {
      throw new Error("The summary was empty.");
    }
  } catch {
    truncated = true;
    summary = [
      `The earlier part of this conversation was dropped because the context window filled up,`,
      `and it could not be summarised (${dropped.length} messages lost).`,
      `The messages that follow are the most recent ones.`,
      `Re-read any file you need before relying on what happened earlier.`,
    ].join(" ");
  }

  const summaryMessage = buildSummaryMessage(summary);

  return {
    messages: [summaryMessage, ...kept],
    summary,
    droppedMessages: dropped.length,
    truncated,
  };
};

/**
 * The message that carries a compaction summary.
 *
 * It is a user message, so that every provider understands it wherever it
 * appears in the conversation.
 *
 * @param summary - The summary text.
 */
export const buildSummaryMessage = (summary: string): ChatMessage => ({
  role: "user",
  content: [
    "[Summary of the earlier conversation]",
    "",
    summary,
    "",
    "Continue from here.",
  ].join("\n"),
});

/**
 * Render messages as a transcript for the summariser.
 *
 * @param messages - The messages to render.
 */
export const transcriptOf = (messages: readonly ChatMessage[]): string =>
  messages
    .map((message) => {
      switch (message.role) {
        case "system":
          return `[system]\n${message.content}`;
        case "user":
          return `[user]\n${message.content}`;
        case "assistant": {
          const calls =
            message.toolCalls === undefined || message.toolCalls.length === 0
              ? ""
              : `\n[tool calls]\n${message.toolCalls
                  .map((call) => `- ${call.name}(${JSON.stringify(call.args ?? {})})`)
                  .join("\n")}`;
          return `[assistant]\n${message.content}${calls}`;
        }
        case "tool":
          return `[tool result]\n${message.content}`;
      }
    })
    .join("\n\n");

/**
 * How many tokens a compacted conversation is expected to use.
 *
 * @param messages - The conversation after compaction.
 */
export const compactedTokens = (messages: readonly ChatMessage[]): number =>
  estimateMessagesTokens(messages);
