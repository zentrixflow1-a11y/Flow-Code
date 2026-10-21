import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSessionFile, SessionLog } from "./log.js";
import { deriveMessages, filesReadIn, forkSession, UNKNOWN_OUTCOME_TEXT } from "./replay.js";
import type { SessionEvent } from "./types.js";

const header = {
  id: "session-1",
  cwd: "/home/user/project",
  startedAt: 1_700_000_000_000,
  flowCodeVersion: "0.1.0",
  provider: "ollama",
  model: "mock-model",
};

describe("deriveMessages", () => {
  it("turns the message events into model messages", () => {
    const events: SessionEvent[] = [
      { type: "user.message", data: { text: "hello" } },
      { type: "assistant.message", data: { text: "hi", toolCalls: [] } },
    ];

    expect(deriveMessages(events)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
  });

  it("carries the tool calls on an assistant message", () => {
    const events: SessionEvent[] = [
      {
        type: "assistant.message",
        data: {
          text: "",
          toolCalls: [{ id: "call_1", name: "read_file", args: { path: "a.ts" } }],
        },
      },
      { type: "tool.result", data: { id: "call_1", ok: true, output: "contents" } },
    ];

    const messages = deriveMessages(events);
    expect(messages[0]?.role).toBe("assistant");
    expect(messages[1]).toEqual({
      role: "tool",
      content: "contents",
      toolCallId: "call_1",
    });
  });

  it("reports a tool call with no result as an unknown outcome", () => {
    const events: SessionEvent[] = [
      {
        type: "assistant.message",
        data: {
          text: "",
          toolCalls: [{ id: "call_1", name: "read_file", args: {} }],
        },
      },
    ];

    const messages = deriveMessages(events);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.role).toBe("tool");
    expect(messages[1]?.content).toBe(UNKNOWN_OUTCOME_TEXT);
  });

  it("ignores events that are not messages", () => {
    const events: SessionEvent[] = [
      { type: "turn.start", data: { turn: 1 } },
      { type: "note", data: { text: "internal" } },
      { type: "user.message", data: { text: "hello" } },
      { type: "turn.end", data: { turn: 1, reason: "completed" } },
    ];

    expect(deriveMessages(events)).toEqual([{ role: "user", content: "hello" }]);
  });
});

describe("filesReadIn", () => {
  it("lists the files that were read, most recent first", () => {
    const events: SessionEvent[] = [
      { type: "file.read", data: { path: "a.ts", bytes: 10 } },
      { type: "file.read", data: { path: "b.ts", bytes: 10 } },
    ];
    expect(filesReadIn(events)).toEqual(["b.ts", "a.ts"]);
  });

  it("keeps a limit", () => {
    const events: SessionEvent[] = [
      { type: "file.read", data: { path: "a.ts", bytes: 10 } },
      { type: "file.read", data: { path: "b.ts", bytes: 10 } },
      { type: "file.read", data: { path: "c.ts", bytes: 10 } },
    ];
    expect(filesReadIn(events, 2)).toEqual(["c.ts", "b.ts"]);
  });
});

describe("forkSession", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "flowcode-fork-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("copies a prefix into a new log", async () => {
    const path = join(directory, "source.jsonl");
    const log = await SessionLog.create(path, header);
    await log.append({ type: "user.message", data: { text: "one" } });
    await log.append({ type: "turn.end", data: { turn: 1, reason: "completed" } });
    await log.append({ type: "user.message", data: { text: "two" } });
    await log.append({ type: "turn.end", data: { turn: 2, reason: "completed" } });
    await log.close();

    const target = join(directory, "child.jsonl");
    const forked = await forkSession(path, target, {
      eventCount: 2,
      sessionId: "child-1",
      model: "mock-model",
      provider: "ollama",
    });

    expect(forked.ok).toBe(true);
    if (forked.ok) {
      expect(forked.value.header.id).toBe("child-1");
      expect(forked.value.header.parentSession).toBe("session-1");
      expect(forked.value.header.inheritedEventCount).toBe(2);
    }

    const loaded = await readSessionFile(target);
    if (loaded.ok) {
      const messages = loaded.value.events.filter(
        (event) => event.type === "user.message",
      );
      expect(messages).toHaveLength(1);
    }
  });

  it("refuses to fork in the middle of a turn", async () => {
    const path = join(directory, "source.jsonl");
    const log = await SessionLog.create(path, header);
    await log.append({ type: "user.message", data: { text: "one" } });
    await log.append({ type: "turn.start", data: { turn: 1 } });
    await log.close();

    const forked = await forkSession(path, join(directory, "child.jsonl"), {
      eventCount: 2,
      sessionId: "child-1",
      model: "mock-model",
      provider: "ollama",
    });

    expect(forked.ok).toBe(false);
    if (!forked.ok) {
      expect(forked.error.code).toBe("invalid_request");
    }
  });
});
