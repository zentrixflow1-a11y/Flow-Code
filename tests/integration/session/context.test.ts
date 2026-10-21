/**
 * The context the tools run in.
 *
 * There is one builder, so a sub-agent cannot end up with a weaker context
 * than the agent that spawned it.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { FlowSession } from "../../../src/agent/session.js";
import { runSubAgent } from "../../../src/agents/subagent.js";
import { ToolRegistry } from "../../../src/tools/registry.js";
import type { ToolDefinition } from "../../../src/tools/types.js";
import { ok, type Result } from "../../../src/util/result.js";
import type { FlowError } from "../../../src/errors.js";
import type {
  ChatRequest,
  ModelInfo,
  ModelProvider,
  ProviderEvent,
} from "../../../src/providers/types.js";
import type { AgentUi } from "../../../src/agent/types.js";
import { startMockServer, type MockServer } from "../../support/mock-server.js";

/** The key the session's environment holds. */
const SECRET = "a-plain-value-nobody-would-guess";

/** A tool that hands back whatever it is given. */
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

/**
 * A provider that calls the tool once and then repeats what it was told.
 *
 * The answer is what the model saw, so the test says what the parent would
 * have seen.
 */
const echoingProvider = (): ModelProvider => {
  let turn = 0;
  return {
    id: "scripted",
    label: "Scripted",
    listModels: async (): Promise<Result<ModelInfo[], FlowError>> => ok<ModelInfo[]>([]),
    streamChat: async function* (request: ChatRequest) {
      if (turn === 0) {
        turn += 1;
        const event: ProviderEvent = {
          type: "tool_call",
          call: { id: "call_1", name: "echo", args: { text: SECRET } },
        };
        yield event;
        yield { type: "done", reason: "tool_calls" };
        return;
      }

      const last = request.messages[request.messages.length - 1];
      yield { type: "text_delta", text: last?.content ?? "" };
      yield { type: "done", reason: "stop" };
    },
  };
};

describe("the session's tool context", () => {
  let server: MockServer;
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    server = await startMockServer({ MOCK_SCENARIO: "tour" });
    home = await mkdtemp(join(tmpdir(), "flowcode-context-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-context-work-"));
  });

  afterEach(async () => {
    await server.stop();
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  const createSession = async (): Promise<FlowSession> => {
    const session = await FlowSession.create({
      cwd: workspace,
      home,
      env: { FLOWCODE_API_KEY: SECRET },
      overrides: {
        provider: "custom",
        baseUrl: server.baseUrl,
        model: "mock-model",
      },
    });

    expect(session.ok).toBe(true);
    if (!session.ok) {
      throw new Error(session.error.message);
    }
    return session.value;
  };

  it("removes the key from what a tool returns", async () => {
    const session = await createSession();
    const context = await session.toolContext();

    expect(context.redact(SECRET)).not.toContain(SECRET);
    expect(context.redact(SECRET)).toContain("[redacted]");
    await session.close();
  });

  it("has a guard, because a tool without one is a tool that acts anyway", async () => {
    const session = await createSession();
    const context = await session.toolContext();

    expect(typeof context.guard).toBe("function");
    expect(context.guard("read")).toBeUndefined();
    await session.close();
  });

  it("keeps the key out of the session log", async () => {
    const session = await createSession();

    await session.log.append({
      type: "note",
      data: { text: `the key is ${SECRET}` },
    });
    await session.log.close();

    const { readFile } = await import("node:fs/promises");
    const text = await readFile(session.log.path, "utf8");
    expect(text).not.toContain(SECRET);
    expect(text).toContain("[redacted]");
    await session.close();
  });

  it("gives a sub-agent the same redactor", async () => {    const session = await createSession();
    const context = await session.toolContext();

    const registry = new ToolRegistry();
    registry.register(echoTool);

    const quietUi: AgentUi = {
      onText: () => undefined,
      onReasoning: () => undefined,
      onToolStart: () => undefined,
      onToolEnd: () => undefined,
      approve: async () => ({ kind: "deny" }),
    };

    const result = await runSubAgent({
      definition: {
        name: "reader",
        description: "Reads things",
        body: "You read things and report them.",
      },
      prompt: "read the key",
      provider: echoingProvider(),
      allowedTools: ["echo"],
      config: session.config,
      rules: session.rules,
      permissionContext: {
        workspaceRoot: workspace,
        cwd: workspace,
        home,
      },
      toolContext: { ...context, registry },
      ui: quietUi,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toContain(SECRET);
      expect(result.value).toContain("[redacted]");
    }
    await session.close();
  });
});
