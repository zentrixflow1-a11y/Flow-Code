/**
 * What each permission mode allows.
 *
 * Two modes — `plan` and `safe` — impose a hard ceiling. No rule can lift
 * them, because they are a promise about what the harness will never do.
 * The other three modes set a *default* that the user's own rules may
 * tighten but never loosen.
 */
import type { PermissionMode, ToolCategory } from "./types.js";
import { isSensitivePath } from "../util/paths.js";
import { commandWords } from "../util/text.js";

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
 * This is an allowlist, and it fails closed: a command that is not on the
 * list is not read-only, and a command on the list is only read-only when
 * every one of its arguments is harmless too.
 *
 * It exists so that `ls` and `git status` do not interrupt the user. It is a
 * prompt-avoidance gate, not a sandbox — which is why it is strict rather
 * than clever.
 */
export const READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  "ls",
  "dir",
  "pwd",
  "cat",
  "type",
  "head",
  "tail",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "find",
  "fd",
  "wc",
  "stat",
  "file",
  "tree",
  "diff",
  "echo",
]);

/**
 * The commands that are treated as read-only in PowerShell.
 *
 * The shell on Windows is PowerShell, where `cat` and `type` are aliases for
 * `Get-Content` and `find` is a different program altogether. Rather than
 * guess what each alias does, only a handful of commands that mean the same
 * thing everywhere is allowed.
 */
export const POWERSHELL_READ_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  "pwd",
  "ls",
  "dir",
  "echo",
]);

/**
 * The read-only forms of `git`.
 *
 * `git` can write, so only the inspection subcommands are read-only. The
 * subcommand must come first: a global option before it, such as `-c`, is
 * how a configuration is injected, and that is not read-only.
 */
export const READ_ONLY_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "status",
  "log",
  "diff",
  "show",
  "rev-parse",
  "ls-files",
  "blame",
]);

/**
 * The git options that change what the command does.
 *
 * `-c` sets a configuration, which can point git at another program;
 * `--output` writes a file; `--ext-diff` and `--textconv` run an external
 * command; `--exec-path` changes where git looks for its subcommands.
 */
export const UNSAFE_GIT_ARGUMENTS: readonly string[] = [
  "-c",
  "--config-env",
  "--output",
  "--ext-diff",
  "--textconv",
  "--exec-path",
  "--git-dir",
  "--work-tree",
  "--namespace",
];

/**
 * The `find` options that write a file or run a command.
 *
 * `fd` spells the same idea with two dashes, so both are listed.
 */
export const UNSAFE_FIND_ARGUMENTS: readonly string[] = [
  "-fprint",
  "-fprintf",
  "-fls",
  "-ok",
  "-okdir",
  "-exec",
  "-execdir",
  "-delete",
  "--exec",
  "--exec-batch",
  "--delete",
];

/**
 * The environment variables that may be set before a read-only command.
 *
 * Anything else — `PATH` above all — decides which program runs, so it is
 * not allowed.
 */
export const SAFE_ENVIRONMENT_VARIABLES: ReadonlySet<string> = new Set([
  "CI",
  "COLUMNS",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LINES",
  "NO_COLOR",
  "NODE_ENV",
  "TERM",
  "TZ",
]);

/**
 * The pieces of a command that make it impossible to reason about safely.
 *
 * A command substitution, a backtick, a process substitution, a redirect, a
 * newline and a backslash all let a command do something other than what its
 * first word suggests.
 */
const UNSAFE_FRAGMENTS: readonly string[] = [
  "$(",
  ")",
  "`",
  "<",
  ">",
  "\n",
  "\r",
  "\\",
];

/**
 * Whether a command only reads.
 *
 * The check is deliberately strict. It looks at the first word of each
 * segment of a compound command, and treats a chain of read-only commands as
 * read-only. Anything it does not understand is not read-only.
 *
 * @param command - The command text.
 * @param platform - The host platform; the shell differs on Windows.
 */
export const isReadOnlyCommand = (
  command: string,
  platform: NodeJS.Platform = process.platform,
): boolean => {
  if (command.trim() === "") {
    return false;
  }

  if (UNSAFE_FRAGMENTS.some((fragment) => command.includes(fragment))) {
    return false;
  }

  const segments = splitCommand(command);
  if (segments.length === 0) {
    return false;
  }

  return segments.every((segment) => isReadOnlySegment(segment, platform));
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

/**
 * Split a segment into its words, taking the quotes into account.
 *
 * A quoted word is one word, whatever is inside it.
 */
const tokenize = (segment: string): string[] => commandWords(segment);

/** Whether one segment of a command only reads. */
const isReadOnlySegment = (
  segment: string,
  platform: NodeJS.Platform,
): boolean => {
  const words = tokenize(segment);
  if (words.length === 0) {
    return false;
  }

  // Skip leading environment assignments such as `NODE_ENV=test`, but only
  // the ones that cannot change which program runs.
  let index = 0;
  while (index < words.length && isAssignment(words[index] as string)) {
    const name = assignmentName(words[index] as string);
    if (!SAFE_ENVIRONMENT_VARIABLES.has(name)) {
      return false;
    }
    index += 1;
  }

  const raw = words[index];
  if (raw === undefined) {
    return false;
  }

  const program = platform === "win32" ? raw.toLowerCase() : raw;
  const name = program.replace(/^.*[/\\]/, "");

  if (name === "git") {
    return isReadOnlyGit(words.slice(index + 1));
  }

  const allowed =
    platform === "win32" ? POWERSHELL_READ_ONLY_COMMANDS : READ_ONLY_COMMANDS;
  if (!allowed.has(name)) {
    return false;
  }

  const arguments_ = words.slice(index + 1);

  if (arguments_.some((argument) => writesAFile(argument))) {
    return false;
  }

  if (name === "find" || name === "fd") {
    if (arguments_.some((argument) => UNSAFE_FIND_ARGUMENTS.includes(argument))) {
      return false;
    }
  }

  return !arguments_.some((argument) => touchesASecret(argument));
};

/** Whether a word is an environment assignment. */
const isAssignment = (word: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);

/** The name of an environment assignment. */
const assignmentName = (word: string): string =>
  word.slice(0, word.indexOf("="));

/**
 * Whether an argument makes the command write a file.
 *
 * `--output` is the one that matters: `diff`, `git` and `grep` all have
 * variants of it, and all of them write.
 */
const writesAFile = (argument: string): boolean =>
  argument === "--output" || argument.startsWith("--output=");

/**
 * Whether an argument points at a file that holds a secret.
 *
 * The check is on the path, so `cat .env`, `grep -r key .env` and
 * `git show HEAD:.env` are all refused.
 */
const touchesASecret = (argument: string): boolean => {
  if (isSensitivePath(argument)) {
    return true;
  }

  // A revision may be written in front of the path: `HEAD:secrets.json`.
  const colon = argument.indexOf(":");
  if (colon !== -1) {
    return isSensitivePath(argument.slice(colon + 1));
  }

  return false;
};

/**
 * Whether a set of git arguments only reads.
 *
 * @param words - The words after `git`.
 */
const isReadOnlyGit = (words: readonly string[]): boolean => {
  if (words.length === 0) {
    return false;
  }

  // Only `--no-pager` may come before the subcommand. Anything else — `-c`
  // above all — is a way of changing what git does.
  let index = 0;
  while (index < words.length && words[index] === "--no-pager") {
    index += 1;
  }

  const subcommand = words[index];
  if (subcommand === undefined || !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    return false;
  }

  const arguments_ = words.slice(index + 1);

  for (const argument of arguments_) {
    if (UNSAFE_GIT_ARGUMENTS.some((flag) => isGitFlag(argument, flag))) {
      return false;
    }
  }

  return !arguments_.some((argument) => touchesASecret(argument));
};

/**
 * Whether an argument is a git flag.
 *
 * `-c` is matched with anything after it, because `-cfoo=bar` is the same
 * thing written tightly.
 */
const isGitFlag = (argument: string, flag: string): boolean => {
  if (flag.startsWith("--")) {
    return argument === flag || argument.startsWith(`${flag}=`);
  }
  return argument === flag || (argument.startsWith(flag) && !argument.startsWith("--"));
};
