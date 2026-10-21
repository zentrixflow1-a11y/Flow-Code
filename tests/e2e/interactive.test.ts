/**
 * The interactive session, driven through a stand-in terminal.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowSession } from "../../src/agent/session.js";
import { runInteractive } from "../../src/ui/run.js";
import { startMockServer, type MockServer } from "../support/mock-server.js";

/** A terminal that records what was written and can send keys. */
interface FakeTerminal {
  readonly stdout: NodeJS.WriteStream;
  readonly stdin: NodeJS.ReadStream;
  readonly text: () => string;
  readonly send: (keys: string) => void;
  readonly waitFor: (text: string, timeoutMs?: number) => Promise<boolean>;
}

const fakeTerminal = (): FakeTerminal => {
  let output = "";
  let pending: string | undefined;
  const readableHandlers: (() => void)[] = [];

  const stdout = {
    // The callback is called, because Ink uses it to know that a write has
    // been flushed — the exit promise is resolved from it.
    write: (text: string, callback?: () => void): boolean => {
      output += text;
      callback?.();
      return true;
    },
    columns: 100,
    rows: 40,
    isTTY: true,
    on: () => undefined,
    off: () => undefined,
    once: () => undefined,
    removeListener: () => undefined,
    listeners: () => [],
    setRawMode: () => undefined,
    ref: () => undefined,
    unref: () => undefined,
  };

  const stdin = {
    isTTY: true,
    setRawMode: () => stdin,
    setEncoding: () => stdin,
    pause: () => stdin,
    resume: () => stdin,
    read: (): string | null => {
      const chunk = pending;
      pending = undefined;
      return chunk ?? null;
    },
    on: (event: string, handler: () => void) => {
      if (event === "readable") {
        readableHandlers.push(handler);
      }
      return stdin;
    },
    addListener: (event: string, handler: () => void) => {
      if (event === "readable") {
        readableHandlers.push(handler);
      }
      return stdin;
    },
    off: () => stdin,
    once: () => stdin,
    removeListener: () => stdin,
    listeners: () => [],
    ref: () => stdin,
    unref: () => stdin,
  };

  return {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    text: () => output,
    send: (keys) => {
      pending = keys;
      for (const handler of [...readableHandlers]) {
        handler();
      }
    },
    waitFor: async (text, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (output.includes(text)) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    },
  };
};

describe("the interactive session", () => {
  let server: MockServer;
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    server = await startMockServer({ MOCK_SCENARIO: "tour" });
    home = await mkdtemp(join(tmpdir(), "flowcode-tui-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-tui-work-"));
    await writeFile(join(workspace, "README.md"), "# The project\n", "utf8");
  });

  afterEach(async () => {
    await server.stop();
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  it("accepts a slash command", async () => {
    const terminal = fakeTerminal();

    const session = await FlowSession.create({
      cwd: workspace,
      home,
      env: {},
      overrides: {
        provider: "custom",
        baseUrl: server.baseUrl,
        model: "mock-model",
      },
    });
    expect(session.ok).toBe(true);
    if (!session.ok) {
      return;
    }

    const running = runInteractive({
      session: session.value,
      stdout: terminal.stdout,
      stdin: terminal.stdin,
    });
    await terminal.waitFor("+---");
    terminal.send("/help");
    await terminal.waitFor("/help");
    terminal.send("\r");
    expect(await terminal.waitFor("/compact")).toBe(true);

    terminal.send("/exit");
    terminal.send("\r");
    await running;
  }, 30_000);
});
