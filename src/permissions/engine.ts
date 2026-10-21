/**
 * The permission engine.
 *
 * This is the single place that decides whether a tool call may proceed. It
 * is pure — no filesystem, no clock, no randomness — so the whole decision
 * table can be tested exhaustively.
 *
 * The order of the checks is the security contract:
 *
 * 1. **Hard ceilings.** `plan` and `safe` modes cap what any rule can grant.
 * 2. **Deny rules.** The first match wins. An allow can never carve out of a
 *    deny.
 * 3. **Ask rules.** The first match wins.
 * 4. **Allow rules.** The first match wins.
 * 5. **The mode's default.**
 *
 * Rules can therefore always *tighten* the outcome, and only ever loosen it
 * up to the ceiling the mode imposes.
 */
import { firstMatchingRule, subjectKindFor } from "./rules.js";
import { categoryOutcome, isHardCeiling } from "./modes.js";
import type { PermissionDecision, PermissionRequest } from "./types.js";

/**
 * Decide whether a tool call may proceed.
 *
 * @param request - The call, as the engine sees it.
 */
export const decidePermission = (
  request: PermissionRequest,
): PermissionDecision => {
  const { tool, category, mode, rules, context } = request;
  const subject = request.subject;
  const subjectKind = request.subjectKind ?? subjectKindFor(tool);

  // 0. Confinement. A write outside the workspace is refused in every mode,
  //    including `trust`. Modes relax prompting; they never relax
  //    confinement.
  if (category === "write" && !request.withinWorkspace) {
    return {
      kind: "deny",
      reason:
        "Writes are confined to the workspace and its additional directories.",
    };
  }

  // 1. Hard ceilings.
  if (isHardCeiling(mode, category)) {
    return {
      kind: "deny",
      reason:
        mode === "safe"
          ? `Safe mode does not allow ${describeCategory(category)} tools.`
          : `Plan mode does not allow ${describeCategory(category)} tools. Write the plan instead and ask for it to be approved.`,
    };
  }

  // 2. Deny rules.
  const denied = firstMatchingRule(rules.deny, tool, subject, subjectKind, context);
  if (denied !== undefined) {
    return {
      kind: "deny",
      reason: `Blocked by the deny rule '${denied}'.`,
      rule: denied,
    };
  }

  // 3. Ask rules.
  const asked = firstMatchingRule(rules.ask, tool, subject, subjectKind, context);
  if (asked !== undefined) {
    return {
      kind: "ask",
      reason: `The rule '${asked}' asks for confirmation.`,
      rule: asked,
    };
  }

  // 4. Allow rules.
  const allowed = firstMatchingRule(
    rules.allow,
    tool,
    subject,
    subjectKind,
    context,
  );
  if (allowed !== undefined) {
    return { kind: "allow", reason: `Allowed by the rule '${allowed}'.` };
  }

  // 5. The mode's default.
  const outcome = categoryOutcome(mode, category);

  if (outcome === "allow") {
    return { kind: "allow", reason: `Allowed in ${mode} mode.` };
  }

  if (outcome === "deny") {
    return {
      kind: "deny",
      reason: `${describeCategory(category)} tools are not allowed in ${mode} mode.`,
    };
  }

  // A command that only reads does not need a prompt.
  if (request.readOnlyCommand === true) {
    return { kind: "allow", reason: "The command only reads." };
  }

  return {
    kind: "ask",
    reason: `${describeCategory(category)} tools need confirmation in ${mode} mode.`,
  };
};

/**
 * Whether a write is allowed outside the workspace.
 *
 * Writes are confined to the workspace in every mode, including `trust`.
 * `trust` relaxes prompting, never confinement.
 */
export const isWriteConfined = (
  request: PermissionRequest,
): boolean => request.category !== "write" || request.withinWorkspace;/** A readable name for a tool category. */
const describeCategory = (category: string): string => {
  switch (category) {
    case "read":
      return "read-only";
    case "write":
      return "file-modifying";
    case "execute":
      return "process-running";
    case "network":
      return "network";
    case "control":
      return "session";
    default:
      return category;
  }
};
