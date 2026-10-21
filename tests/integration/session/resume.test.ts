/**
 * Resuming a session.
 *
 * The model view is always derived from the log, so a session that is closed
 * and reopened must produce exactly the same messages.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSessionFile, SessionLog } from "../../../src/session/log.js";
import { deriveMessages } from "../../../src/session/replay.js";
import { createSessionId, projectSlug, sessionsRoot } from "../../../src/session/store.js";

describe("resuming a session", () => {
  let home: string;
  let directory: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "flowcode-home-"));
    directory = join(sessionsRoot(home), projectSlug("/home/user/project"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("produces the same messages after the session is reopened", async () => {
    const path = join(directory, `${createSessionId()}.jsonl`);

    const log = await SessionLog.create(path, {
      id: "session-1",
      cwd: "/home/user/project",
      startedAt: 1_700_000_000_000,
      flowCodeVersion: "0.1.0",
      provider: "ollama",
      model: "mock-model",
    });

    await log.append({ type: "user.message", data: { text: "read the file" } });
    await log.append({
      type: "assistant.message",
      data: {
        text: "",
        toolCalls: [{ id: "call_1", name: "read_file", args: { path: "a.ts" } }],
      },
    });
    await log.append({ type: "tool.call", data: { id: "call_1", name: "read_file", args: { path: "a.ts" } } });
    await log.append({ type: "tool.result", data: { id: "call_1", ok: true, output: "contents" } });
    await log.append({ type: "user.message", data: { text: "now change it" } });
    await log.close();

    const before = deriveMessages(log.events);

    const loaded = await readSessionFile(path);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const after = deriveMessages(loaded.value.events);
    expect(after).toEqual(before);
  });

  it("reopens the log and keeps appending to it", async () => {
    const path = join(directory, "resumed.jsonl");

    const first = await SessionLog.create(path, {
      id: "session-1",
      cwd: "/home/user/project",
      startedAt: 1_700_000_000_000,
      flowCodeVersion: "0.1.0",
      provider: "ollama",
      model: "mock-model",
    });
    await first.append({ type: "user.message", data: { text: "one" } });
    await first.close();

    const reopened = await SessionLog.open(path);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) {
      return;
    }
    await reopened.value.append({ type: "user.message", data: { text: "two" } });
    await reopened.value.close();

    const loaded = await readSessionFile(path);
    if (loaded.ok) {
      const messages = loaded.value.events.filter(
        (event) => event.type === "user.message",
      );
      expect(messages).toHaveLength(2);
    }
  });

  it("keeps the whole conversation when a tool call did not finish", async () => {
    const path = join(directory, "interrupted.jsonl");

    const log = await SessionLog.create(path, {
      id: "session-1",
      cwd: "/home/user/project",
      startedAt: 1_700_000_000_000,
      flowCodeVersion: "0.1.0",
      provider: "ollama",
      model: "mock-model",
    });
    await log.append({ type: "user.message", data: { text: "run it" } });
    await log.append({
      type: "assistant.message",
      data: {
        text: "",
        toolCalls: [{ id: "call_1", name: "run_command", args: { command: "ls" } }],
      },
    });
    // No tool.result: the session was interrupted.
    await log.close();

    const messages = deriveMessages(log.events);
    expect(messages).toHaveLength(3);
    expect(messages[2]?.role).toBe("tool");
    expect(messages[2]?.content).toContain("outcome is unknown");
  });
});
