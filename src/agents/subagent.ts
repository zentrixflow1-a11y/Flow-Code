/**
 * Running a sub-agent.
 *
 * A sub-agent gets its own context window and its own session log. The
 * parent sees only its final answer, which is what makes it useful for
 * anything long: the intermediate steps do not fill the parent's context.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../agent/loop.js";
import { VERSION } from "../version.js";
import type { AgentOptions, AgentUi } from "../agent/types.js";
import { type FlowError } from "../errors.js";
import type { FlowCodeConfig } from "../config/types.js";
import type { PermissionContext, PermissionRules } from "../permissions/types.js";
import type { ModelProvider } from "../providers/types.js";
import { SessionLog } from "../session/log.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import { err, ok, type Result } from "../util/result.js";
import type { AgentDefinition } from "./definitions.js";

/** How to run a sub-agent. */
export interface SubAgentOptions {
  /** The sub-agent to run. */
  readonly definition: AgentDefinition;
  /** The task to give it. */
  readonly prompt: string;
  /** The provider to use. */
  readonly provider: ModelProvider;
  /** The tools it may use. */
  readonly allowedTools: readonly string[];
  /** The configuration to run under. */
  readonly config: FlowCodeConfig;
  /** The permission rules in force. */
  readonly rules: PermissionRules;
  /** The paths rules resolve against. */
  readonly permissionContext: PermissionContext;
  /** What the tools need from the host. */
  readonly toolContext: ToolContext;
  /** The interface, for progress. */
  readonly ui: AgentUi;
  /** Where to write the sub-agent's session log. */
  readonly sessionsRoot?: string;
}

/**
 * Run a sub-agent and return its final answer.
 *
 * @param options - How to run it.
 */
export const runSubAgent = async (
  options: SubAgentOptions,
): Promise<Result<string, FlowError>> => {
  const { definition } = options;

  const registry = new ToolRegistry();
  for (const name of options.allowedTools) {
    const tool = options.toolContext.registry?.get(name);
    if (tool !== undefined) {
      registry.register(tool);
    }
  }

  const directory = await mkdtemp(join(tmpdir(), "flowcode-subagent-"));
  const log = await SessionLog.create(
    join(directory, "session.jsonl"),
    {
      id: `subagent-${definition.name}`,
      cwd: options.toolContext.cwd,
      startedAt: Date.now(),
      flowCodeVersion: VERSION,
      provider: options.provider.id,
      model: options.config.provider.model ?? "",
    },
    // The sub-agent's log is redacted with the same redactor as its tools.
    { redact: options.toolContext.redact },
  );

  const agentOptions: AgentOptions = {
    provider: options.provider,
    registry,
    session: log,
    config: options.config,
    rules: options.rules,
    permissionContext: options.permissionContext,
    toolContext: options.toolContext,
    ui: options.ui,
    ...(definition.maxTurns === undefined ? {} : { maxTurns: definition.maxTurns }),
  };

  try {
    const result = await runAgent(agentOptions, buildPrompt(definition, options.prompt));
    if (result.reason === "error" && result.error !== undefined) {
      return err(result.error);
    }
    return ok(result.text);
  } finally {
    await log.close();
    await rm(directory, { recursive: true, force: true });
  }
};

/**
 * Build the prompt a sub-agent receives.
 *
 * @param definition - The sub-agent.
 * @param task - The task.
 */
export const buildPrompt = (definition: AgentDefinition, task: string): string => {
  const parts: string[] = [];
  if (definition.body !== "") {
    parts.push(definition.body);
  }
  parts.push(`Task: ${task}`);
  return parts.join("\n\n");
};
