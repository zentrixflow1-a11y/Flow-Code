/**
 * The built-in tools.
 */
import { ToolRegistry } from "./registry.js";
import type { ToolDefinition } from "./types.js";
import {
  editFileTool,
  listDirTool,
  readFileTool,
  writeFileTool,
} from "./fs.js";
import { globFilesTool, grepFilesTool } from "./search.js";
import {
  readCommandOutputTool,
  runCommandTool,
  stopCommandTool,
} from "./shell.js";
import { webFetchTool } from "./web.js";
import { askUserTool, submitPlanTool, updatePlanTool } from "./plan.js";
import { spawnAgentTool } from "./subagent.js";

export * from "./types.js";
export { ToolRegistry } from "./registry.js";
export { toJsonSchema, describeIssues } from "./schemas.js";
export { executeTool } from "./executor.js";
export {
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  resolveToolPath,
  countOccurrences,
  writeFileAtomically,
} from "./fs.js";
export { globFilesTool, grepFilesTool } from "./search.js";
export {
  runCommandTool,
  readCommandOutputTool,
  stopCommandTool,
  shellFor,
  activeJobs,
} from "./shell.js";
export { webFetchTool, htmlToText, domainOf } from "./web.js";
export { spawnAgentTool } from "./subagent.js";
export {
  updatePlanTool,
  submitPlanTool,
  askUserTool,
  activePlan,
} from "./plan.js";

/** Every built-in tool, in the order they are offered to the model. */
export const BUILT_IN_TOOLS: readonly ToolDefinition<unknown>[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  globFilesTool,
  grepFilesTool,
  runCommandTool,
  readCommandOutputTool,
  stopCommandTool,
  webFetchTool,
  updatePlanTool,
  submitPlanTool,
  askUserTool,
  spawnAgentTool,
];

/**
 * Build a registry holding every built-in tool.
 *
 * The registry is created fresh each time, so a session can add or replace
 * tools without affecting another.
 */
export const createDefaultRegistry = (): ToolRegistry => {
  const registry = new ToolRegistry();
  for (const tool of BUILT_IN_TOOLS) {
    registry.register(tool);
  }
  return registry;
};
