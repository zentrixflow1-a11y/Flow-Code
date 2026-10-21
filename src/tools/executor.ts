/**
 * Running a tool call.
 *
 * The executor is the single place where a tool's arguments are validated,
 * where its output is redacted and capped, and where a thrown error becomes a
 * result the model can read. Nothing a tool does should be able to end the
 * agent loop.
 */
import { flowError } from "../errors.js";
import { capOutput } from "../util/text.js";
import { describeIssues } from "./schemas.js";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.js";

/**
 * Validate and run a tool call.
 *
 * @param definition - The tool to run.
 * @param rawArgs - The arguments the model sent, unvalidated.
 * @param context - What the tool needs from its host.
 */
export const executeTool = async <A>(
  definition: ToolDefinition<A>,
  rawArgs: unknown,
  context: ToolContext,
): Promise<ToolResult> => {
  // A tool that brings its own schema validates on its own side.
  if (definition.schema !== undefined) {
    const parsed = definition.schema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        ok: false,
        error: flowError(
          "invalid_request",
          `The arguments for '${definition.name}' were not valid.`,
          {
            retryable: false,
            remediation: `Fix the arguments and call the tool again. ${describeIssues(parsed.error.issues)}`,
          },
        ),
      };
    }
    rawArgs = parsed.data;
  }

  let result: ToolResult;
  try {
    result = await definition.execute(rawArgs as A, context);
  } catch (error) {
    return {
      ok: false,
      error: flowError(
        "tool_failed",
        `The tool '${definition.name}' failed: ${error instanceof Error ? error.message : String(error)}`,
        { retryable: false, cause: error },
      ),
    };
  }

  if (!result.ok) {
    return {
      ok: false,
      error: {
        ...result.error,
        message: context.redact(result.error.message),
        ...(result.error.remediation === undefined
          ? {}
          : { remediation: context.redact(result.error.remediation) }),
      },
    };
  }

  const capped = capOutput(context.redact(result.output));
  return {
    ok: true,
    output: capped.text,
    ...(result.data === undefined ? {} : { data: result.data }),
  };
};
