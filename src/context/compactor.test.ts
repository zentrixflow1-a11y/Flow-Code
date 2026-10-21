import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../src/providers/types.js";
import {
  compactMessages,
  compactionBoundary,
  shouldCompact,
  SUMMARY_INSTRUCTION,
  transcriptOf,
} from "./compactor.js";
import {
  contextSize,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateTokens,
} from "./tokens.js";

describe("estimateTokens", () => {
  it("grows with the text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(360))).toBe(100);
  });
});

describe("estimateMessagesTokens", () => {
  it("counts the content and the overhead", () => {
    const message: ChatMessage = { role: "user", content: "a".repeat(360) };
    expect(estimateMessageTokens(message)).toBe(104);
  });

  it("counts the tool calls on an assistant message", () => {
    const message: ChatMessage = {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", name: "read_file", args: { path: "a.ts" } }],
    };
    expect(estimateMessageTokens(message)).toBeGreaterThan(4);
  });

  it("adds up across a conversation", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    expect(estimateMessagesTokens(messages)).toBeGreaterThan(0);
  });
});

describe("contextSize", () => {
  it("prefers the provider's own number", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "hello" }];
    expect(contextSize(messages, { inputTokens: 100, outputTokens: 20 })).toBe(120);
  });

  it("falls back to the estimate", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "hello" }];
    expect(contextSize(messages)).toBe(estimateMessagesTokens(messages));
  });
});

describe("shouldCompact", () => {
  it("is true once the window is full enough", () => {
    expect(shouldCompact(800, 1000, 0.8)).toBe(true);
    expect(shouldCompact(799, 1000, 0.8)).toBe(false);
  });

  it("is false when there is no window", () => {
    expect(shouldCompact(100, 0, 0.8)).toBe(false);
  });
});

describe("compactionBoundary", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "one" },
    { role: "assistant", content: "a" },
    { role: "user", content: "two" },
    { role: "assistant", content: "b" },
    { role: "user", content: "three" },
    { role: "assistant", content: "c" },
  ];

  it("keeps the most recent turns", () => {
    expect(compactionBoundary(messages, 2)).toBe(2);
  });

  it("keeps everything when there are fewer turns than asked for", () => {
    expect(compactionBoundary(messages, 10)).toBe(0);
  });

  it("keeps everything when asked for none", () => {
    expect(compactionBoundary(messages, 0)).toBe(messages.length);
  });
});

describe("compactMessages", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "first request" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "second request" },
    { role: "assistant", content: "second answer" },
  ];

  it("replaces the older turns with a summary", async () => {
    let asked = "";
    const result = await compactMessages(messages, {
      keepTurns: 1,
      summarize: async (transcript) => {
        asked = transcript;
        return "Goal — do the thing.";
      },
    });

    expect(asked).toContain("first request");
    expect(result.truncated).toBe(false);
    expect(result.droppedMessages).toBe(2);
    expect(result.messages[0]?.content).toContain("Goal — do the thing.");
    // The summary, plus the one turn that was kept.
    expect(result.messages).toHaveLength(3);
  });

  it("keeps the most recent turn verbatim", async () => {
    const result = await compactMessages(messages, {
      keepTurns: 1,
      summarize: async () => "summary",
    });
    expect(result.messages[1]).toEqual({ role: "user", content: "second request" });
    expect(result.messages[2]).toEqual({ role: "assistant", content: "second answer" });
  });

  it("truncates when the summary cannot be produced", async () => {
    const result = await compactMessages(messages, {
      keepTurns: 1,
      summarize: async () => {
        throw new Error("the model is too small");
      },
    });

    expect(result.truncated).toBe(true);
    expect(result.summary).toContain("could not be summarised");
    expect(result.summary).toContain("2 messages lost");
    expect(result.messages[1]?.content).toBe("second request");
  });

  it("truncates when the summary comes back empty", async () => {
    const result = await compactMessages(messages, {
      keepTurns: 1,
      summarize: async () => "   ",
    });
    expect(result.truncated).toBe(true);
  });

  it("does nothing when there is nothing to compact", async () => {
    const result = await compactMessages(messages, {
      keepTurns: 10,
      summarize: async () => "summary",
    });
    expect(result.droppedMessages).toBe(0);
    expect(result.messages).toHaveLength(messages.length);
  });
});

describe("transcriptOf", () => {
  it("marks each message with its role", () => {
    const transcript = transcriptOf([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi", toolCalls: [{ id: "c", name: "ls", args: {} }] },
      { role: "tool", content: "output", toolCallId: "c" },
    ]);

    expect(transcript).toContain("[user]");
    expect(transcript).toContain("[assistant]");
    expect(transcript).toContain("ls({})");
    expect(transcript).toContain("[tool result]");
  });
});

describe("SUMMARY_INSTRUCTION", () => {
  it("asks for a structured summary", () => {
    expect(SUMMARY_INSTRUCTION).toContain("Goal");
    expect(SUMMARY_INSTRUCTION).toContain("Files");
    expect(SUMMARY_INSTRUCTION).toContain("Next");
  });
});
