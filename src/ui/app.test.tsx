import { render } from "ink";
import React from "react";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "../commands/registry.js";
import { App } from "./app.js";
import { UiState } from "./state.js";

/**
 * A stand-in for the terminal.
 *
 * Ink needs a stream it can write to and ask about, so the interface is
 * rendered into this instead of a real terminal.
 */
const fakeTerminal = (): {
  readonly stdout: NodeJS.WriteStream;
  readonly stdin: NodeJS.ReadStream;
  readonly text: () => string;
  readonly send: (keys: string) => void;
} => {
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
  };
};

const renderApp = async (
  state: UiState,
  overrides: Partial<React.ComponentProps<typeof App>> = {},
): Promise<string> => {
  const terminal = fakeTerminal();
  const app = render(
    <App
      state={state}
      commands={[]}
      onSubmit={() => undefined}
      onInterrupt={() => undefined}
      onExit={() => undefined}
      suggestFiles={async () => []}
      showBanner
      {...overrides}
    />,
    {
      stdout: terminal.stdout,
      stdin: terminal.stdin,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  // Give Ink a moment to lay the first frame out.
  await new Promise((resolve) => setTimeout(resolve, 50));
  app.unmount();

  return terminal.text();
};

/** Render the app and keep it alive so that keys can be sent to it. */
const renderLiveApp = async (
  state: UiState,
  overrides: Partial<React.ComponentProps<typeof App>> = {},
): Promise<{
  readonly send: (keys: string) => void;
  readonly text: () => string;
  readonly stop: () => void;
}> => {
  const terminal = fakeTerminal();
  const app = render(
    <App
      state={state}
      commands={[]}
      onSubmit={() => undefined}
      onInterrupt={() => undefined}
      onExit={() => undefined}
      suggestFiles={async () => []}
      showBanner
      {...overrides}
    />,
    {
      stdout: terminal.stdout,
      stdin: terminal.stdin,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    send: terminal.send,
    text: terminal.text,
    stop: () => app.unmount(),
  };
};

describe("the terminal interface", () => {
  it("shows the banner", async () => {
    const state = new UiState();
    const output = await renderApp(state);
    expect(output).toContain("+---");
    expect(output).toContain("~");
  });

  it("shows the status line", async () => {
    const state = new UiState();
    state.setStatus({
      provider: "ollama",
      model: "qwen2.5-coder",
      cwd: "/project",
      mode: "ask",
      tokens: 120,
      busy: false,
    });

    const output = await renderApp(state);
    expect(output).toContain("ollama");
    expect(output).toContain("qwen2.5-coder");
    expect(output).toContain("/project");
    expect(output).toContain("120 tokens");
  });

  it("shows the conversation", async () => {
    const state = new UiState();
    state.addUserMessage("read the readme");
    state.appendStream("Here is what it says.");
    state.commitStream();

    const output = await renderApp(state);
    expect(output).toContain("read the readme");
    expect(output).toContain("Here is what it says.");
  });

  it("shows the permission prompt when a tool needs approval", async () => {
    const state = new UiState();
    void state.requestApproval({
      tool: "run_command",
      args: { command: "npm test" },
      reason: "Running a command needs confirmation in ask mode.",
    });

    const output = await renderApp(state);
    expect(output).toContain("Allow run_command?");
    expect(output).toContain("allow once");
  });

  it("shows the plan", async () => {
    const state = new UiState();
    state.setPlan([
      { content: "Read the file", status: "completed" },
      { content: "Change it", status: "in_progress" },
    ]);

    const output = await renderApp(state);
    expect(output).toContain("Plan");
    expect(output).toContain("Read the file");
  });

  it("accepts typed input", async () => {
    const state = new UiState();
    const live = await renderLiveApp(state);

    live.send("hello");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(live.text()).toContain("hello");
    live.stop();
  });

  it("accepts typed input when there are commands to suggest", async () => {
    const state = new UiState();
    const live = await renderLiveApp(state, {
      commands: COMMANDS.map((command) => ({
        name: command.name,
        summary: command.summary,
      })),
    });

    live.send("hello");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(live.text()).toContain("hello");
    live.stop();
  });

  it("accepts a slash command", async () => {
    const state = new UiState();
    const submitted: string[] = [];
    const live = await renderLiveApp(state, {
      commands: COMMANDS.map((command) => ({
        name: command.name,
        summary: command.summary,
      })),
      onSubmit: (text) => void submitted.push(text),
    });

    live.send("/help");
    await new Promise((resolve) => setTimeout(resolve, 50));
    live.send("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(submitted).toEqual(["/help"]);
    live.stop();
  });

  it("suggests a command as it is typed", async () => {
    const state = new UiState();
    const live = await renderLiveApp(state, {
      commands: [
        { name: "help", summary: "Show the available commands." },
        { name: "model", summary: "List the available models." },
      ],
    });

    live.send("/mo");
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(live.text()).toContain("model");
    live.stop();
  });

  it("remembers what was submitted and offers it again", async () => {
    const state = new UiState();
    const submitted: string[] = [];
    const live = await renderLiveApp(state, {
      onSubmit: (text) => void submitted.push(text),
    });

    live.send("first");
    await new Promise((resolve) => setTimeout(resolve, 30));
    live.send("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The up arrow walks back through the history.
    live.send("[A");
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(live.text()).toContain("first");
    expect(submitted).toEqual(["first"]);
    live.stop();
  });

  it("submits what was typed", async () => {
    const state = new UiState();
    const submitted: string[] = [];
    const live = await renderLiveApp(state, { onSubmit: (text) => void submitted.push(text) });

    live.send("do it");
    await new Promise((resolve) => setTimeout(resolve, 30));
    live.send("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(submitted).toEqual(["do it"]);
    live.stop();
  });
});
