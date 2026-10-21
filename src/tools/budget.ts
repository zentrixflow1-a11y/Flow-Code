/**
 * Keeping the tool schemas within a budget.
 *
 * Every tool the model can see costs context, and the cost is paid on every
 * request. Flow Code measures the schemas it is about to send and, when they
 * are too large, drops the least important ones and says so.
 */
import type { ToolDefinition } from "./types.js";
import { parametersOf } from "./registry.js";

/** The result of fitting the tools to a budget. */
export interface BudgetResult {
  /** The tools to offer. */
  readonly tools: readonly ToolDefinition<unknown>[];
  /** The tools that were dropped, in the order they were dropped. */
  readonly trimmed: readonly string[];
  /** The size of the schemas that remain, in bytes. */
  readonly bytes: number;
  /** The size the schemas would have taken, in bytes. */
  readonly totalBytes: number;
}

/**
 * Fit the tools to a byte budget.
 *
 * The tools are dropped in order of how little they are worth: the MCP
 * servers that were connected last go first, because a server that was added
 * by hand is usually there for one particular job.
 *
 * @param tools - The tools that would be offered.
 * @param budget - The budget, in bytes. A budget of zero or less means no
 *   limit.
 */
export const fitToBudget = (
  tools: readonly ToolDefinition<unknown>[],
  budget: number,
): BudgetResult => {
  const sizeOf = (tool: ToolDefinition<unknown>): number =>
    Buffer.byteLength(
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        parameters: parametersOf(tool),
      }),
      "utf8",
    );

  const totalBytes = tools.reduce((total, tool) => total + sizeOf(tool), 0);

  if (budget <= 0 || totalBytes <= budget) {
    return { tools: [...tools], trimmed: [], bytes: totalBytes, totalBytes };
  }

  // The order matters: the built-in tools come first and are never dropped
  // while anything else is left.
  const keep = [...tools];
  const trimmed: string[] = [];

  while (keep.length > 0) {
    const bytes = keep.reduce((total, tool) => total + sizeOf(tool), 0);
    if (bytes <= budget) {
      break;
    }
    const last = keep.pop();
    if (last === undefined) {
      break;
    }
    trimmed.unshift(last.name);
  }

  const bytes = keep.reduce((total, tool) => total + sizeOf(tool), 0);
  return { tools: keep, trimmed, bytes, totalBytes };
};

/**
 * A sentence describing what was dropped.
 *
 * @param trimmed - The tools that were dropped.
 */
export const describeTrim = (trimmed: readonly string[]): string =>
  trimmed.length === 0
    ? ""
    : `The tool schemas were too large, so ${trimmed.length} tool${
        trimmed.length === 1 ? " was" : "s were"
      } left out: ${trimmed.join(", ")}. Add a permission rule to allow them, or raise 'tools.maxToolSchemaBytes'.`;
