/**
 * Project instructions.
 *
 * Flow Code reads `FLOWCODE.md` if it is there, and otherwise falls back to
 * `AGENTS.md`, which is an open convention several agent tools already use.
 * A project that has either file works with Flow Code without being changed.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { matchPath } from "../util/glob.js";
import { toPosix } from "../util/paths.js";

/** The file Flow Code prefers for project instructions. */
export const PRIMARY_INSTRUCTION_FILE = "FLOWCODE.md";

/** The file Flow Code falls back to. */
export const FALLBACK_INSTRUCTION_FILE = "AGENTS.md";

/** The directory path-scoped rules live in. */
export const RULES_DIRECTORY = ".flowcode/rules";

/** What the project asked the agent to know. */
export interface ProjectInstructions {
  /** The instructions, ready to put in the system prompt. */
  readonly text: string;
  /** Where the instructions came from. */
  readonly sources: readonly string[];
  /** The rules that were skipped because their paths were not touched. */
  readonly skippedRules: readonly string[];
}

/**
 * Read the project's instructions.
 *
 * @param cwd - The project's directory.
 * @param touchedFiles - The files the session has read or written, used to
 *   decide which path-scoped rules apply.
 */
export const readProjectInstructions = async (
  cwd: string,
  touchedFiles: readonly string[] = [],
): Promise<ProjectInstructions> => {
  const parts: string[] = [];
  const sources: string[] = [];
  const skippedRules: string[] = [];

  const primary = await readInstructionFile(cwd, PRIMARY_INSTRUCTION_FILE);
  if (primary !== undefined) {
    parts.push(primary);
    sources.push(PRIMARY_INSTRUCTION_FILE);
  } else {
    const fallback = await readInstructionFile(cwd, FALLBACK_INSTRUCTION_FILE);
    if (fallback !== undefined) {
      parts.push(fallback);
      sources.push(FALLBACK_INSTRUCTION_FILE);
    }
  }

  const rules = await readRules(cwd);
  for (const rule of rules) {
    if (rule.paths === undefined) {
      parts.push(rule.body);
      sources.push(rule.name);
      continue;
    }
    if (rule.paths.some((pattern) => touchedFiles.some((file) => matchPath(pattern, file)))) {
      parts.push(rule.body);
      sources.push(rule.name);
    } else {
      skippedRules.push(rule.name);
    }
  }

  return {
    text: parts.join("\n\n"),
    sources,
    skippedRules,
  };
};

/** Read one instruction file, returning undefined when it is not there. */
const readInstructionFile = async (
  cwd: string,
  name: string,
): Promise<string | undefined> => {
  try {
    const text = await readFile(join(cwd, name), "utf8");
    return text.trim() === "" ? undefined : text.trim();
  } catch {
    return undefined;
  }
};

/** One rule file. */
interface Rule {
  /** The file's name. */
  readonly name: string;
  /** The rule's body. */
  readonly body: string;
  /** The paths the rule applies to, when it says. */
  readonly paths?: readonly string[];
};

/** Read the path-scoped rules. */
const readRules = async (cwd: string): Promise<Rule[]> => {
  const directory = join(cwd, ...RULES_DIRECTORY.split("/"));

  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const rules: Rule[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) {
      continue;
    }
    let text: string;
    try {
      text = await readFile(join(directory, entry), "utf8");
    } catch {
      continue;
    }
    const parsed = parseFrontmatter(text);
    rules.push({
      name: entry,
      body: parsed.body,
      ...(parsed.paths === undefined ? {} : { paths: parsed.paths }),
    });
  }

  return rules;
};

/**
 * Parse a markdown file's frontmatter.
 *
 * Only the `paths` key is understood, and only as a list of glob patterns.
 * A full YAML parser is not worth a dependency for one key.
 */
export const parseFrontmatter = (
  text: string,
): { readonly body: string; readonly paths?: readonly string[] } => {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { body: normalized.trim() };
  }

  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return { body: normalized.trim() };
  }

  const front = normalized.slice(4, end);
  const body = normalized.slice(end + 4).trim();

  const pathsLine = front
    .split("\n")
    .find((line) => line.trim().toLowerCase().startsWith("paths:"));

  if (pathsLine === undefined) {
    return { body };
  }

  const raw = pathsLine.slice(pathsLine.indexOf(":") + 1).trim();
  const patterns = raw
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((pattern) => pattern.trim().replace(/^["']|["']$/g, ""))
    .filter((pattern) => pattern !== "")
    .map((pattern) => toPosix(pattern));

  return patterns.length === 0 ? { body } : { body, paths: patterns };
};
