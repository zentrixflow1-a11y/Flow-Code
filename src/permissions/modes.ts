/**
 * What each permission mode allows.
 *
 * Two modes — `plan` and `safe` — impose a hard ceiling. No rule can lift
 * them, because they are a promise about what the harness will never do.
 * The other three modes set a *default* that the user's own rules may
 * tighten but never loosen.
 */
import type { PermissionMode, ToolCategory } from "./types.js";

/** How a mode treats a tool category when no rule applies. */
export type CategoryOutcome = "allow" | "ask" | "deny";

/**
 * The default outcome for a tool category in a given mode.
 *
 * @param mode - The active mode.
 * @param category - The tool's category.
 */
export const categoryOutcome = (
  mode: PermissionMode,
  category: ToolCategory,
): CategoryOutcome => {
  switch (mode) {
    case "ask":
      // Reads and session control are free; anything that changes the world
      // is worth a prompt.
      return category === "read" || category === "control" ? "allow" : "ask";

    case "accept_edits":
      if (category === "read" || category === "control" || category === "write") {
        return "allow";
      }
      return "ask";

    case "plan":
      // Plan mode explores and proposes, but changes nothing.
      return category === "read" || category === "control" ? "allow" : "deny";

    case "safe":
      // Safe mode is read-only and offline.
      return category === "read" || category === "control" ? "allow" : "deny";

    case "trust":
      return "allow";
  }
};

/**
 * Whether a mode forbids a category outright.
 *
 * A hard ceiling cannot be lifted by an allow rule.
 */
export const isHardCeiling = (
  mode: PermissionMode,
  category: ToolCategory,
): boolean =>
  (mode === "plan" || mode === "safe") &&
  categoryOutcome(mode, category) === "deny";

/** A one-line description of a mode, for the UI and the setup wizard. */
export const describeMode = (mode: PermissionMode): string => {
  switch (mode) {
    case "ask":
      return "Ask before anything changes.";
    case "accept_edits":
      return "Accept file edits inside the workspace; ask for everything else.";
    case "plan":
      return "Read-only. Explore and propose a plan, change nothing.";
    case "safe":
      return "Read-only and offline. No writes, no commands, no network.";
    case "trust":
      return "Act freely inside the workspace.";
  }
};

/**
 * The commands that are treated as read-only.
 *
 * This list is a convenience, not a security boundary: a command can always
 * be disguised, and a shell tool that runs a command runs whatever it is
 * given. It exists so that `ls` and `git status` do not interrupt the user.
 */
export const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  "ls",
  "dir",
  "cat",
  "type",
  "head",
  "tail",
  "wc",
  "which",
  "where",
  "whoami",
  "pwd",
  "cd",
  "echo",
  "date",
  "env",
  "printenv",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "find",
  "fd",
  "diff",
  "stat",
  "du",
  "df",
  "file",
  "tree",
  "ps",
  "uname",
  "node",
  "python",
  "python3",
  "npm",
  "pnpm",
  "yarn",
  "pip",
  "pip3",
]);

/**
 * The read-only forms of `git`.
 *
 * `git` can write, so only the inspection subcommands are read-only.
 */
export const READ_ONLY_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "remote",
  "describe",
  "rev-parse",
  "blame",
  "shortlog",
  "ls-files",
  "ls-remote",
  "config",
  "stash",
  "tag",
  "whatchanged",
  "cat-file",
  "grep",
]);

/**
 * Whether a command only reads.
 *
 * The check is deliberately shallow: it looks at the first word of each
 * segment of a compound command, and treats a chain of read-only commands as
 * read-only. It is a prompt-avoidance heuristic, not a sandbox.
 *
 * @param command - The command text.
 */
export const isReadOnlyCommand = (command: string): boolean => {
  const segments = splitCommand(command);
  if (segments.length === 0) {
    return false;
  }
  return segments.every(isReadOnlySegment);
};

/** Split a command line into its top-level segments. */
const splitCommand = (command: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;

  for (const character of command) {
    if (quote !== undefined) {
      current += character;
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "|" || character === ";" || character === "&") {
      if (current.trim() !== "") {
        parts.push(current.trim());
      }
      current = "";
      continue;
    }
    current += character;
  }

  if (current.trim() !== "") {
    parts.push(current.trim());
  }

  return parts;
};

/** Whether one segment of a command only reads. */
const isReadOnlySegment = (segment: string): boolean => {
  const words = segment.split(/\s+/).filter((word) => word !== "");

  // Skip leading environment assignments such as `NODE_ENV=test`.
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] as string)) {
    index += 1;
  }

  const program = (words[index] ?? "").replace(/^.*[/\\]/, "");
  if (program === "") {
    return false;
  }

  if (program === "git") {
    const subcommand = words[index + 1];
    return subcommand !== undefined && READ_ONLY_GIT_SUBCOMMANDS.has(subcommand);
  }

  if (!READ_ONLY_COMMANDS.has(program)) {
    return false;
  }

  // Redirecting the output writes a file, so it is not read-only.
  if (hasFileRedirect(segment)) {
    return false;
  }

  // `find` and `rm` style programs can act; only allow them without an
  // action flag.
  if (program === "find") {
    return !words.some((word) => word === "-delete" || word === "-exec" || word === "-execdir");
  }
  if (program === "npm" || program === "pnpm" || program === "yarn") {
    const subcommand = words[index + 1];
    return subcommand === "view" || subcommand === "list" || subcommand === "ls";
  }
  if (program === "node" || program === "python" || program === "python3") {
    // Running a program is not read-only, even though the interpreter is.
    return false;
  }

  return true;
};

/**
 * Whether a command segment redirects its output to a file.
 *
 * A file-descriptor duplication such as `2>&1` is not a file redirect.
 */
const hasFileRedirect = (segment: string): boolean => /(^|[^&])>\s*[^&\s]/.test(segment);
