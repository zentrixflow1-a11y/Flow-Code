/**
 * The agent loop.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { runAgent, buildRequest } from "./loop.js";
import type { AgentOptions, AgentUi, ApprovalDecision } from "./types.js";
import { SessionLog } from "../session/log.js";
import { deriveMessages } from "../session/replay.js";
import { ToolRegistry } from "../tools/registry.js";
import { createDefaultRegistry } from "../tools/index.js";
import type { ToolDefinition, ToolResult } from "../tools/types.js";
import type { ModelInfo, ModelProvider, ProviderEvent } from "../providers/types.js";
import { ok, type Result } from "../util/result.js";
import { DEFAULT_CONFIG } from "../config/types.js";
import type { FlowError } from "../errors.js";

/** A provider that plays a scripted sequence of turns. */
const scriptedProvider = (turns: readonly (readonly ProviderEvent[])[]): ModelProvider => {
  let index = 0;
  return {
    id: "scripted",
    label: "Scripted",
    listModels: async (): Promise<Result<ModelInfo[], FlowError>> => ok<ModelInfo[]>([]),
    streamChat: async function* () {
      const turn = turns[index] ?? [];
      index += 1;
      for (const event of turn) {
        yield event;
      }
    },
  };
};

const echoTool: ToolDefinition<{ text: string }> = {
  name: "echo",
  description: "Echo the text back.",
  schema: z.object({ text: z.string() }),
  category: "read",
  subjectKind: "text",
  concurrencySafe: true,
  async execute(args) {
    return { ok: true, output: args.text };
  },
};

const writeTool: ToolDefinition<{ path: string }> = {
  name: "write_file",
  description: "Write a file.",
  schema: z.object({ path: z.string() }),
  category: "write",
  subjectKind: "path",
  concurrencySafe: false,
  subject(args) {
    return args.path;
  },
  async execute(args) {
    return { ok: true, output: `wrote ${args.path}` };
  },
};

describe("the agent loop", () => {
  let directory: string;
  let log: SessionLog;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "flowcode-agent-"));
    log = await SessionLog.create(join(directory, "session.jsonl"), {
      id: "s1",
      cwd: directory,
      startedAt: 0,
      flowCodeVersion: "0.1.0",
      provider: "scripted",
      model: "m",
    });
  });

  afterEach(async () => {
    await log.close();
    await rm(directory, { recursive: true, force: true });
  });

  const buildOptions = (
    provider: ModelProvider,
    ui: AgentUi,
    overrides: Partial<AgentOptions> = {},
  ): AgentOptions => ({
    provider,
    registry: new ToolRegistry(),
    session: log,
    config: DEFAULT_CONFIG,
    rules: { allow: [], ask: [], deny: [] },
    permissionContext: { workspaceRoot: directory, cwd: directory, home: directory },
    toolContext: {
      cwd: directory,
      workspaceRoot: directory,
      additionalDirectories: [],
      env: {},
      redact: (text) => text,
      platform: "linux",
      caseInsensitivePaths: false,
    },
    ui,
    ...overrides,
  });

  const quietUi = (approvals: ApprovalDecision[] = []): AgentUi => {
    const texts: string[] = [];
    return {
      onText: (text) => void texts.push(text),
      onReasoning: () => undefined,
      onToolStart: () => undefined,
      onToolEnd: () => undefined,
      approve: async () => approvals.shift() ?? { kind: "deny" },
    };
  };

  it("returns the model's answer when it asks for no tools", async () => {
    const provider = scriptedProvider([
      [
        { type: "text_delta", text: "Hello " },
        { type: "text_delta", text: "there." },
        { type: "done", reason: "stop" },
      ],
    ]);

    const result = await runAgent(buildOptions(provider, quietUi()), "hi");
    expect(result.reason).toBe("completed");
    expect(result.text).toBe("Hello there.");
    expect(result.turns).toBe(1);
  });

  it("records the user's message in the session", async () => {
    const provider = scriptedProvider([[{ type: "done", reason: "stop" }]]);
    await runAgent(buildOptions(provider, quietUi()), "do the thing");

    const messages = deriveMessages(log.events);
    expect(messages[0]).toEqual({ role: "user", content: "do the thing" });
  });

  it("runs a tool and feeds the result back to the model", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);

    const provider = scriptedProvider([
      [
        {
          type: "tool_call",
          call: { id: "call_1", name: "echo", args: { text: "hello" } },
        },
        { type: "done", reason: "tool_calls" },
      ],
      [{ type: "text_delta", text: "done" }, { type: "done", reason: "stop" }],
    ]);

    const result = await runAgent(
      buildOptions(provider, quietUi(), { registry }),
      "say hello",
    );

    expect(result.reason).toBe("completed");
    expect(result.text).toBe("done");

    const messages = deriveMessages(log.events);
    const toolMessage = messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toBe("hello");
  });

  it("asks the user before a tool that needs permission", async () => {
    const registry = new ToolRegistry();
    registry.register(writeTool);

    const provider = scriptedProvider([
      [
        {
          type: "tool_call",
          call: { id: "call_1", name: "write_file", args: { path: "a.txt" } },
        },
        { type: "done", reason: "tool_calls" },
      ],
      [{ type: "text_delta", text: "written" }, { type: "done", reason: "stop" }],
    ]);

    const approvals: ApprovalDecision[] = [{ kind: "allow" }];
    const result = await runAgent(
      buildOptions(provider, quietUi(approvals), { registry }),
      "write a file",
    );

    expect(result.text).toBe("written");
    const messages = deriveMessages(log.events);
    expect(messages.find((message) => message.role === "tool")?.content).toBe(
      "wrote a.txt",
    );
  });

  it("tells the model when the user refuses", async () => {
    const registry = new ToolRegistry();
    registry.register(writeTool);

    const provider = scriptedProvider([
      [
        {
          type: "tool_call",
          call: { id: "call_1", name: "write_file", args: { path: "a.txt" } },
        },
        { type: "done", reason: "tool_calls" },
      ],
      [{ type: "text_delta", text: "understood" }, { type: "done", reason: "stop" }],
    ]);

    const approvals: ApprovalDecision[] = [
      { kind: "deny", reason: "not this time" },
    ];
    await runAgent(
      buildOptions(provider, quietUi(approvals), { registry }),
      "write a file",
    );

    const messages = deriveMessages(log.events);
    const toolMessage = messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("not this time");
  });

  it("refuses a tool that a deny rule blocks, without asking", async () => {
    const registry = new ToolRegistry();
    registry.register(writeTool);

    const provider = scriptedProvider([
      [
        {
          type: "tool_call",
          call: { id: "call_1", name: "write_file", args: { path: "a.txt" } },
        },
        { type: "done", reason: "tool_calls" },
      ],
      [{ type: "text_delta", text: "ok" }, { type: "done", reason: "stop" }],
    ]);

    let asked = false;
    const ui: AgentUi = {
      ...quietUi(),
      approve: async () => {
        asked = true;
        return { kind: "allow" };
      },
    };

    await runAgent(
      buildOptions(provider, ui, {
        registry,
        rules: { allow: [], ask: [], deny: ["write_file"] },
      }),
      "write a file",
    );

    expect(asked).toBe(false);
    const messages = deriveMessages(log.events);
    expect(messages.find((message) => message.role === "tool")?.content).toContain(
      "Blocked by the deny rule",
    );
  });

  it("reports a tool it does not have", async () => {
    const provider = scriptedProvider([
      [
        {
          type: "tool_call",
          call: { id: "call_1", name: "nope", args: {} },
        },
        { type: "done", reason: "tool_calls" },
      ],
      [{ type: "text_delta", text: "sorry" }, { type: "done", reason: "stop" }],
    ]);

    await runAgent(buildOptions(provider, quietUi()), "do it");
    const messages = deriveMessages(log.events);
    expect(messages.find((message) => message.role === "tool")?.content).toContain(
      "no tool called 'nope'",
    );
  });

  it("offers every built-in tool, even when a rule names one of them", () => {
    // A deny rule with a specifier blocks that one call. It must not take
    // the whole tool out of the model's context.
    const registry = new ToolRegistry();
    for (const tool of createDefaultRegistry().list()) {
      registry.register(tool);
    }

    const provider = scriptedProvider([[{ type: "done", reason: "stop" }]]);
    const request = buildRequest(
      buildOptions(provider, quietUi(), {
        registry,
        rules: {
          allow: [],
          ask: [],
          deny: ["read_file:**/.env", "write_file:**/.env"],
        },
      }),
    );

    const names = (request.tools ?? []).map((tool) => tool.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("grep_files");
  });

  it("takes a tool out of the context when a bare deny rule names it", () => {
    const registry = new ToolRegistry();
    for (const tool of createDefaultRegistry().list()) {
      registry.register(tool);
    }

    const provider = scriptedProvider([[{ type: "done", reason: "stop" }]]);
    const request = buildRequest(
      buildOptions(provider, quietUi(), {
        registry,
        rules: { allow: [], ask: [], deny: ["read_file"] },
      }),
    );

    const names = (request.tools ?? []).map((tool) => tool.name);
    expect(names).not.toContain("read_file");
    expect(names).toContain("grep_files");
  });

  it("stops when the model reports a failure", async () => {
    const provider = scriptedProvider([
      [
        { type: "error", error: { code: "unauthorized", message: "no key", retryable: false } },
        { type: "done", reason: "error" },
      ],
    ]);

    const result = await runAgent(buildOptions(provider, quietUi()), "hi");
    expect(result.reason).toBe("error");
    expect(result.error?.code).toBe("unauthorized");
  });

  it("feeds a tool's crash back to the model rather than dying", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "boom",
      description: "Always fails.",
      schema: z.object({}),
      category: "read",
      subjectKind: "text",
      concurrencySafe: true,
      async execute(): Promise<ToolResult> {
        throw new Error("it exploded");
      },
    });

    const provider = scriptedProvider([
      [
        { type: "tool_call", call: { id: "call_1", name: "boom", args: {} } },
        { type: "done", reason: "tool_calls" },
      ],
      [{ type: "text_delta", text: "recovered" }, { type: "done", reason: "stop" }],
    ]);

    const result = await runAgent(
      buildOptions(provider, quietUi(), { registry }),
      "run it",
    );

    expect(result.reason).toBe("completed");
    expect(result.text).toBe("recovered");
    const messages = deriveMessages(log.events);
    expect(messages.find((message) => message.role === "tool")?.content).toContain(
      "it exploded",
    );
  });

  it("stops at the turn limit", async () => {
    const toolTurn = [
      {
        type: "tool_call" as const,
        call: { id: "call_1", name: "echo", args: { text: "again" } },
      },
      { type: "done" as const, reason: "tool_calls" as const },
    ];
    const provider = scriptedProvider([toolTurn, toolTurn, toolTurn]);

    const registry = new ToolRegistry();
    registry.register(echoTool);

    const result = await runAgent(
      buildOptions(provider, quietUi(), { registry, maxTurns: 2 }),
      "loop",
    );
    expect(result.reason).toBe("max_turns");
    expect(result.turns).toBe(2);
  });

  it("stops when the run is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = scriptedProvider([[{ type: "done", reason: "stop" }]]);
    const result = await runAgent(
      buildOptions(provider, quietUi(), { signal: controller.signal }),
      "hi",
    );
    expect(result.reason).toBe("aborted");
  });
});
