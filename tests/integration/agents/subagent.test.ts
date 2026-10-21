/**
 * A sub-agent, and the context it runs in.
 *
 * A sub-agent is a second agent with its own tools. It must not be a weaker
 * one than the agent that spawned it: the same redactor, the same guard.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { runSubAgent } from "../../../src/agents/subagent.js";
import { createToolContext } from "../../../src/tools/context.js";
import { ToolRegistry } from "../../../src/tools/registry.js";
import type { ToolDefinition } from "../../../src/tools/types.js";
import { DEFAULT_CONFIG } from "../../../src/config/types.js";
import { ok, type Result } from "../../../src/util/result.js";
import type { FlowError } from "../../../src/errors.js";
import type {
  ChatRequest,
  ModelInfo,
  ModelProvider,
  ProviderEvent,
} from "../../../src/providers/types.js";
import type { AgentUi } from "../../../src/agent/types.js";

/** The secret the sub-agent stumbles across. */
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
          call: {
            id: "call_1",
            name: "echo",
            args: { text: SECRET },
          },
        };
        yield event;
        yield { type: "done", reason: "tool_calls" };
        return;
      }

      const last = request.messages[request.messages.length - 1];
      const content = last?.content ?? "";
      yield { type: "text_delta", text: content };
      yield { type: "done", reason: "stop" };
    },
  };
};

describe("a sub-agent", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "flowcode-subagent-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const quietUi: AgentUi = {
    onText: () => undefined,
    onReasoning: () => undefined,
    onToolStart: () => undefined,
    onToolEnd: () => undefined,
    approve: async () => ({ kind: "deny" }),
  };

  const runWith = async (
    secrets: readonly string[],
  ): Promise<{ readonly ok: boolean; readonly text: string }> => {
    const registry = new ToolRegistry();
    registry.register(echoTool);

    const result = await runSubAgent({
      definition: {
        name: "reader",
        description: "Reads things",
        body: "You read things and report them.",
      },
      prompt: "read the key",
      provider: echoingProvider(),
      allowedTools: ["echo"],
      config: DEFAULT_CONFIG,
      rules: { allow: [], ask: [], deny: [] },
      permissionContext: {
        workspaceRoot: directory,
        cwd: directory,
        home: directory,
      },
      toolContext: createToolContext({
        cwd: directory,
        workspaceRoot: directory,
        env: {},
        secrets,
        platform: "linux",
        caseInsensitivePaths: false,
        guard: () => undefined,
        registry,
      }),
      ui: quietUi,
    });

    return result.ok
      ? { ok: true, text: result.value }
      : { ok: false, text: result.error.message };
  };

  it("does not hand a secret back to the parent", async () => {
    const result = await runWith([SECRET]);

    expect(result.ok).toBe(true);
    expect(result.text).not.toContain(SECRET);
    expect(result.text).toContain("[redacted]");
  });

  it("hands back what it read when there is no secret", async () => {
    const result = await runWith([]);

    expect(result.ok).toBe(true);
    expect(result.text).toContain(SECRET);
  });
});
