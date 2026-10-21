/**
 * The sub-agent tool.
 */
import { z } from "zod";
import { flowError } from "../errors.js";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.js";

/** The arguments of {@link spawnAgentTool}. */
const spawnAgentArgs = z.object({
  agent: z.string().min(1).describe("The name of the sub-agent to run."),
  prompt: z
    .string()
    .min(1)
    .describe("The task to give it. It should be self-contained."),
});

/**
 * Run a sub-agent.
 *
 * The sub-agent works in its own context and returns only its final answer,
 * so a long job does not fill the caller's context.
 */
export const spawnAgentTool: ToolDefinition<z.infer<typeof spawnAgentArgs>> = {
  name: "spawn_agent",
  description:
    "Run a sub-agent: it works in its own context with its own tools and returns only its final answer. Use it for a self-contained job that would otherwise fill your context.",
  schema: spawnAgentArgs,
  category: "execute",
  subjectKind: "text",
  concurrencySafe: false,
  subject(args) {
    return args.agent;
  },
  async execute(args, context: ToolContext): Promise<ToolResult> {
    if (context.spawnAgent === undefined) {
      return {
        ok: false,
        error: flowError(
          "unsupported",
          "This session cannot run sub-agents.",
          { retryable: false },
        ),
      };
    }

    const result = await context.spawnAgent(args.agent, args.prompt);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    return {
      ok: true,
      output: result.value === "" ? "(the sub-agent said nothing)" : result.value,
    };
  },
};
