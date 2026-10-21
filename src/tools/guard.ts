/**
 * The guard the host applies inside a tool.
 *
 * The permission engine decides whether a call may proceed. This guard is the
 * second of the two enforcement layers: the tool itself refuses to act even
 * if the decision upstream was wrong. The `safe` and `plan` ceilings are
 * enforced here as well as there.
 */
import type { FlowError } from "../errors.js";
import type { SubjectKind, ToolCategory } from "../permissions/types.js";
import type { ToolContext } from "./types.js";

/** The result of applying the guard. */
export type GuardOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: FlowError };

/**
 * Apply the host's guard for a category.
 *
 * @param context - The tool's host context.
 * @param category - What the tool is about to do.
 */
export const applyGuard = (
  context: ToolContext,
  category: ToolCategory,
): GuardOutcome => {
  const refusal = context.guard?.(category);
  return refusal === undefined ? { ok: true } : { ok: false, error: refusal };
};

/** A subject kind, re-exported so tools need only one import. */
export type { SubjectKind };
