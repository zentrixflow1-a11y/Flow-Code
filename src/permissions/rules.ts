/**
 * Matching permission rules against tool calls.
 *
 * This module is pure: it reads strings and returns booleans. It never touches
 * the filesystem, so the rule semantics can be tested exhaustively.
 */
import { posix } from "node:path";
import { matchGlob } from "../util/glob.js";
import { toPosix } from "../util/paths.js";
import type { PermissionContext, PermissionRules, SubjectKind } from "./types.js";

/** A rule split into its tool part and its specifier. */
export interface ParsedRule {
  /** The tool the rule applies to. */
  readonly tool: string;
  /** The specifier, or `undefined` when the rule has none. */
  readonly spec?: string;
}

/**
 * Split a rule into its tool part and its specifier.
 *
 * The split happens at the first colon, so the tool part is never ambiguous.
 */
export const parseRule = (rule: string): ParsedRule => {
  const trimmed = rule.trim();
  const colon = trimmed.indexOf(":");
  if (colon === -1) {
    return { tool: trimmed };
  }
  return { tool: trimmed.slice(0, colon), spec: trimmed.slice(colon + 1) };
};

/**
 * Whether a rule's tool part applies to a tool name.
 *
 * A tool part matches when it equals the tool name, or when the tool name
 * continues past it with a colon — so `mcp` matches every MCP tool and
 * `mcp:github` matches every tool of that server.
 */
export const toolPartMatches = (ruleTool: string, toolName: string): boolean => {
  if (ruleTool === "") {
    return false;
  }
  if (ruleTool === "*") {
    return true;
  }
  if (ruleTool === toolName) {
    return true;
  }
  return toolName.startsWith(`${ruleTool}:`);
};

/**
 * The subject a rule specifier is compared against, and how.
 *
 * A path subject is an absolute path, an MCP subject is `server:tool`, and
 * everything else is plain text.
 */
export type { SubjectKind };

/**
 * Decide whether a rule's specifier matches a subject.
 *
 * @param spec - The rule's specifier.
 * @param subject - The subject to test.
 * @param kind - How the subject is shaped.
 */
export const specMatches = (
  spec: string,
  subject: string | undefined,
  kind: SubjectKind,
): boolean => {
  if (subject === undefined) {
    return false;
  }
  if (spec === "") {
    return true;
  }
  return matchGlob(spec, subject, kind === "path" ? "/" : ":");
};

/**
 * Whether a path is absolute, on any platform.
 *
 * Rule syntax is platform-neutral, so a Windows path is recognised as
 * absolute too, however the harness happens to be running.
 */
const isAbsolutePath = (path: string): boolean => {
  const posixPath = toPosix(path);
  return posixPath.startsWith("/") || /^[A-Za-z]:\//.test(posixPath);
};

/**
 * Convert a path into the form rules are compared in.
 *
 * A path inside the workspace becomes relative to the workspace root, so a
 * rule keeps working no matter how the model spelled the path. A path
 * outside the workspace keeps its absolute form, which still matches an
 * absolute specifier.
 *
 * @param path - The path to convert.
 * @param context - The paths to convert against.
 */
export const toRootRelative = (
  path: string,
  context: PermissionContext,
): string => {
  const posixPath = toPosix(path);
  const absolute = isAbsolutePath(posixPath)
    ? posix.normalize(posixPath)
    : posix.resolve(toPosix(context.cwd), posixPath);
  const root = posix.normalize(toPosix(context.workspaceRoot));

  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (absolute === root) {
    return "";
  }
  if (absolute.startsWith(prefix)) {
    return absolute.slice(prefix.length);
  }
  return absolute;
};

/**
 * Resolve a rule's path specifier into the same form.
 *
 * | Form | Meaning |
 * | --- | --- |
 * | `secrets/**` | relative to the current directory |
 * | `/secrets/**` | relative to the workspace root |
 * | a leading `**` | at any depth under the workspace root |
 * | `~/secrets/**` | relative to the home directory |
 * | `//etc/**`, `C:/x/**` | an absolute path |
 *
 * @param spec - The specifier.
 * @param context - The paths to resolve against.
 */
export const resolvePathSpec = (
  spec: string,
  context: PermissionContext,
): string => {
  const normalized = toPosix(spec);

  if (normalized.startsWith("~/")) {
    return toRootRelative(`${toPosix(context.home)}${normalized.slice(1)}`, context);
  }
  if (normalized.startsWith("**/")) {
    // A floating pattern matches at any depth below the workspace root.
    return normalized;
  }
  if (normalized.startsWith("//")) {
    // A double leading slash means a filesystem-absolute path.
    return toRootRelative(`/${normalized.slice(2)}`, context);
  }
  if (normalized.startsWith("/")) {
    // A single leading slash anchors at the workspace root, which keeps the
    // rule portable between machines.
    return normalized.slice(1);
  }
  if (isAbsolutePath(normalized)) {
    return toRootRelative(normalized, context);
  }
  return toRootRelative(posix.resolve(toPosix(context.cwd), normalized), context);
};

/**
 * The default way a subject is interpreted, based on the tool's name.
 *
 * A tool normally declares its own kind; this is the fallback for tools that
 * do not.
 */
export const subjectKindFor = (toolName: string): SubjectKind =>
  toolName.startsWith("mcp:") ? "mcp" : "text";

/**
 * Whether a rule matches a tool call.
 *
 * @param rule - The rule to test.
 * @param toolName - The tool being called.
 * @param subject - The tool's subject, when it has one.
 * @param subjectKind - How the subject is shaped.
 * @param context - The paths used to resolve a path specifier.
 */
export const ruleMatches = (
  rule: string,
  toolName: string,
  subject: string | undefined,
  subjectKind: SubjectKind,
  context: PermissionContext,
): boolean => {
  const parsed = parseRule(rule);
  if (!toolPartMatches(parsed.tool, toolName)) {
    return false;
  }

  if (parsed.spec === undefined) {
    // A rule with no specifier applies to the whole tool.
    return true;
  }

  if (subjectKind === "path") {
    // Path specifiers are resolved against the session's directories before
    // they are compared, so `./secrets/**` keeps working when the session
    // moves into a subdirectory, and the model may spell the path however it
    // likes.
    const spec = resolvePathSpec(parsed.spec, context);
    const target =
      subject === undefined ? undefined : toRootRelative(subject, context);
    return specMatches(spec, target, "path");
  }

  return specMatches(parsed.spec, subject, subjectKind);
};

/**
 * The first rule in a list that matches a tool call.
 *
 * @param rules - The rules to search.
 * @param toolName - The tool being called.
 * @param subject - The tool's subject.
 * @param subjectKind - How the subject is shaped.
 * @param context - The paths used to resolve a path specifier.
 */
export const firstMatchingRule = (
  rules: readonly string[],
  toolName: string,
  subject: string | undefined,
  subjectKind: SubjectKind,
  context: PermissionContext,
): string | undefined =>
  rules.find((rule) =>
    ruleMatches(rule, toolName, subject, subjectKind, context),
  );

/**
 * The tool names that a deny rule removes from the model's context.
 *
 * A rule that names a tool and nothing else blocks the tool outright, rather
 * than blocking one call.
 */
export const deniedTools = (rules: PermissionRules): ReadonlySet<string> => {
  const denied = new Set<string>();
  for (const rule of rules.deny) {
    const parsed = parseRule(rule);
    if (parsed.spec === undefined && parsed.tool !== "" && parsed.tool !== "*") {
      denied.add(parsed.tool);
    }
  }
  return denied;
};

/**
 * Merge rule lists from several scopes.
 *
 * Lists merge rather than override, so a project can add a rule without
 * removing the user's own.
 */
export const mergeRules = (
  ...sets: readonly PermissionRules[]
): PermissionRules => {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  for (const set of sets) {
    allow.push(...set.allow);
    ask.push(...set.ask);
    deny.push(...set.deny);
  }

  return { allow, ask, deny };
};
