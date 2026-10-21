import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSessionFile, SessionLog } from "./log.js";
import { createRedactor } from "../util/redact.js";
import type { SessionEvent, SessionHeader } from "./types.js";

describe("the session log", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "flowcode-session-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const header = {
    id: "session-1",
    cwd: "/home/user/project",
    startedAt: 1_700_000_000_000,
    flowCodeVersion: "0.1.0",
    provider: "ollama",
    model: "mock-model",
  };

  it("writes a header as the first line", async () => {
    const path = join(directory, "session.jsonl");
    const log = await SessionLog.create(path, header);
    await log.close();

    const loaded = await readSessionFile(path);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.header.id).toBe("session-1");
      expect(loaded.value.header.version).toBe(1);
    }
  });

  it("appends events with contiguous sequence numbers", async () => {
    const path = join(directory, "session.jsonl");
    const log = await SessionLog.create(path, header);

    await log.append({ type: "user.message", data: { text: "hello" } });
    await log.append({ type: "assistant.message", data: { text: "hi", toolCalls: [] } });
    await log.close();

    const text = await (await import("node:fs/promises")).readFile(path, "utf8");
    const lines = text.trim().split("\n").map((line) => JSON.parse(line) as { seq?: number });
    expect(lines[1]?.seq).toBe(1);
    expect(lines[2]?.seq).toBe(2);
  });

  it("reads its own events back", async () => {
    const path = join(directory, "session.jsonl");
    const log = await SessionLog.create(path, header);
    await log.append({ type: "user.message", data: { text: "hello" } });
    await log.close();

    const loaded = await readSessionFile(path);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const messages = loaded.value.events.filter((event) => event.type === "user.message");
      expect(messages).toHaveLength(1);
    }
  });

  it("discards a torn final line", async () => {
    const path = join(directory, "session.jsonl");
    const log = await SessionLog.create(path, header);
    await log.append({ type: "user.message", data: { text: "hello" } });
    await log.close();

    // Simulate a write that was cut short.
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path, '{"type":"assistant.mess', "utf8");

    const loaded = await readSessionFile(path);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.events).toHaveLength(2);
      expect(loaded.value.skippedLines).toBe(1);
    }
  });

  it("reports a file with no header as malformed", async () => {
    const path = join(directory, "broken.jsonl");
    await writeFile(path, '{"type":"user.message","seq":0,"time":0,"data":{}}\n', "utf8");

    const loaded = await readSessionFile(path);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error.code).toBe("malformed_response");
    }
  });

  it("reports a missing file", async () => {
    const loaded = await readSessionFile(join(directory, "nope.jsonl"));
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error.code).toBe("not_found");
    }
  });

  it("reopens a log for appending", async () => {
    const path = join(directory, "session.jsonl");
    const first = await SessionLog.create(path, header);
    await first.append({ type: "user.message", data: { text: "one" } });
    await first.close();

    const second = await SessionLog.open(path);
    expect(second.ok).toBe(true);
    if (second.ok) {
      await second.value.append({ type: "user.message", data: { text: "two" } });
      await second.value.close();
    }

    const loaded = await readSessionFile(path);
    if (loaded.ok) {
      const messages = loaded.value.events.filter((event) => event.type === "user.message");
      expect(messages).toHaveLength(2);
    }
  });
});

describe("a session log on disk", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "flowcode-session-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const header = {
    id: "session-1",
    cwd: "/home/user/project",
    startedAt: 1_700_000_000_000,
    flowCodeVersion: "0.1.0",
    provider: "ollama",
    model: "mock-model",
  };

  it("is created for its owner alone", async () => {
    if (process.platform === "win32") {
      // Windows has no POSIX permissions; the file is still created, and the
      // user's own account is the only one that can read it.
      return;
    }

    const nested = join(directory, "sessions", "project");
    const path = join(nested, "session.jsonl");
    const log = await SessionLog.create(path, header);
    await log.close();

    const file = await stat(path);
    expect(file.mode & 0o777).toBe(0o600);

    const folder = await stat(nested);
    expect(folder.mode & 0o777).toBe(0o700);
  });

  it("keeps a secret out of what it writes", async () => {
    const path = join(directory, "session.jsonl");
    const log = await SessionLog.create(path, header, {
      redact: createRedactor({ secrets: ["a-plain-value-nobody-would-guess"] }),
    });

    await log.append({
      type: "user.message",
      data: { text: "the key is a-plain-value-nobody-would-guess" },
    });
    await log.close();

    const { readFile } = await import("node:fs/promises");
    const text = await readFile(path, "utf8");
    expect(text).not.toContain("a-plain-value-nobody-would-guess");
    expect(text).toContain("[redacted]");
  });

  it("keeps a secret out of a nested event", async () => {
    const path = join(directory, "session.jsonl");
    const log = await SessionLog.create(path, header, {
      redact: createRedactor({ secrets: ["a-plain-value-nobody-would-guess"] }),
    });

    await log.append({
      type: "tool.call",
      data: {
        id: "call-1",
        name: "run_command",
        args: { command: "echo a-plain-value-nobody-would-guess" },
      },
    });
    await log.close();

    const { readFile } = await import("node:fs/promises");
    const text = await readFile(path, "utf8");
    expect(text).not.toContain("a-plain-value-nobody-would-guess");
  });
});

describe("session events", () => {
  it("marks only the message-bearing events as surface events", async () => {
    const { SURFACE_EVENT_TYPES, isSurfaceEvent } = await import("./types.js");
    const surface: SessionEvent = { type: "user.message", data: { text: "hi" } };
    const logOnly: SessionEvent = { type: "note", data: { text: "hi" } };

    expect(isSurfaceEvent(surface)).toBe(true);
    expect(isSurfaceEvent(logOnly)).toBe(false);
    expect(SURFACE_EVENT_TYPES.has("tool.result")).toBe(true);
    expect(SURFACE_EVENT_TYPES.has("tool.call")).toBe(false);
  });
});

describe("SessionHeader", () => {
  it("carries the lineage of a forked session", () => {
    const header: SessionHeader = {
      type: "session",
      version: 1,
      id: "child",
      cwd: "/home/user/project",
      startedAt: 0,
      flowCodeVersion: "0.1.0",
      provider: "ollama",
      model: "mock-model",
      parentSession: "parent",
      inheritedEventCount: 12,
    };
    expect(header.parentSession).toBe("parent");
  });
});
