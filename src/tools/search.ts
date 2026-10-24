/**
 * The search tools: finding files by name, and finding text inside them.
 *
 * Both walk the tree themselves rather than shelling out to `rg` or `find`.
 * That keeps the tool surface small, works the same on every platform, and
 * means the harness does not depend on a search binary being installed.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import { flowError } from "../errors.js";
import { matchPath } from "../util/glob.js";
import { isInside, isSensitivePath, toPosix } from "../util/paths.js";
import { resolveToolPath } from "./fs.js";
import { refuseSensitivePath } from "./sensitive.js";
import type { ToolDefinition, ToolResult } from "./types.js";

/** Directories that are never searched. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git",
  ".flowcode",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
]);

/** The largest file the search tools will read. */
const MAX_SEARCHABLE_BYTES = 2_000_000;

/** How many matches the search tools return by default. */
const DEFAULT_MAX_RESULTS = 100;

/** Walk a directory, yielding every file path. */
const walkFiles = async (
  root: string,
  options: { readonly maxDepth: number; readonly skip: ReadonlySet<string> },
): Promise<string[]> => {
  const found: string[] = [];

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > options.maxDepth) {
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (options.skip.has(entry.name)) {
          continue;
        }
        await walk(join(directory, entry.name), depth + 1);
        continue;
      }
      if (entry.isFile()) {
        found.push(join(directory, entry.name));
      }
    }
  };

  await walk(root, 0);
  return found;
};

/**
 * The literal directory prefix of a glob pattern.
 *
 * `src/**\/*.ts` starts at `src`, so the walk does not have to visit the whole
 * tree to answer it.
 */
const literalPrefix = (pattern: string): string => {
  const segments = toPosix(pattern).split("/");
  const literal: string[] = [];
  for (const segment of segments) {
    if (segment.includes("*") || segment.includes("?")) {
      break;
    }
    literal.push(segment);
  }
  if (literal.length === segments.length) {
    // The whole pattern is literal, so the last segment is the file name.
    literal.pop();
  }
  return literal.join("/");
};

/** The arguments of {@link globFilesTool}. */
const globFilesArgs = z.object({
  pattern: z
    .string()
    .min(1)
    .describe(
      "The pattern to match, such as `**/*.ts` or `src/**/index.ts`. `*` matches within a directory, `**` matches across directories.",
    ),
  path: z
    .string()
    .min(1)
    .optional()
    .describe("The directory to search in. Defaults to the current directory."),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("How many paths to return. Defaults to 100."),
});

/** Find files by name pattern. */
export const globFilesTool: ToolDefinition<z.infer<typeof globFilesArgs>> = {
  name: "glob_files",
  description:
    "Find files whose path matches a pattern, such as `**/*.ts`. Returns the matching paths, sorted.",
  schema: globFilesArgs,
  category: "read",
  subjectKind: "path",
  concurrencySafe: true,
  subject(args) {
    return args.path ?? ".";
  },
  async execute(args, context): Promise<ToolResult> {
    const resolved = await resolveToolPath(args.path ?? ".", context);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }

    const root = resolved.value;
    const limit = args.max_results ?? DEFAULT_MAX_RESULTS;

    // The pattern must not be able to leave the workspace: a prefix such as
    // `../` or an absolute path would walk somewhere the user did not open.
    const prefix = literalPrefix(args.pattern);
    if (prefix.includes("..") || prefix.startsWith("/") || /^[A-Za-z]:/.test(prefix)) {
      return {
        ok: false,
        error: flowError("permission_denied", "The pattern leaves the workspace.", {
          retryable: false,
          remediation: "Use a pattern that stays inside the workspace.",
        }),
      };
    }

    const searchRoot = prefix === "" ? root : join(root, prefix);

    // The derived root is checked again, so a pattern that slips past the
    // prefix check cannot walk out either.
    if (!isInside(searchRoot, root, context.caseInsensitivePaths)) {
      return {
        ok: false,
        error: flowError("permission_denied", "The pattern leaves the workspace.", {
          retryable: false,
          remediation: "Use a pattern that stays inside the workspace.",
        }),
      };
    }

    const files = await walkFiles(searchRoot, { maxDepth: 20, skip: SKIPPED_DIRECTORIES });
    const matches = files
      .map((file) => ({
        absolute: file,
        relative: toPosix(relative(root, file)),
      }))
      // A credential file is not offered to the model, even as a name.
      .filter((entry) => !isSensitivePath(entry.absolute))
      .filter((entry) => matchPath(args.pattern, entry.relative))
      .sort((left, right) => left.relative.localeCompare(right.relative));

    if (matches.length === 0) {
      return {
        ok: true,
        output: `No files match '${args.pattern}'.`,
        data: { count: 0, pattern: args.pattern },
      };
    }

    const shown = matches.slice(0, limit);
    const suffix =
      matches.length > shown.length
        ? `\n… and ${matches.length - shown.length} more (${matches.length} total).`
        : `\n(${matches.length} ${matches.length === 1 ? "file" : "files"})`;

    return {
      ok: true,
      output: shown.map((entry) => entry.relative).join("\n") + suffix,
      data: { count: matches.length, pattern: args.pattern },
    };
  },
};

/** The arguments of {@link grepFilesTool}. */
const grepFilesArgs = z.object({
  pattern: z
    .string()
    .min(1)
    .describe("The regular expression to search for."),
  path: z
    .string()
    .min(1)
    .optional()
    .describe("The directory or file to search in. Defaults to the current directory."),
  glob: z
    .string()
    .min(1)
    .optional()
    .describe("Only search files whose path matches this pattern, such as `**/*.ts`."),
  output_mode: z
    .enum(["content", "files_with_matches", "count"])
    .optional()
    .describe(
      "What to return: the matching lines, the files that matched, or a count per file. Defaults to content.",
    ),
  case_sensitive: z
    .boolean()
    .optional()
    .describe("Whether the search is case sensitive. Defaults to false."),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("How many matches to return. Defaults to 100."),
});

/** Search file contents. */
export const grepFilesTool: ToolDefinition<z.infer<typeof grepFilesArgs>> = {
  name: "grep_files",
  description:
    "Search file contents with a regular expression. Returns the matching lines with their file and line number.",
  schema: grepFilesArgs,
  category: "read",
  subjectKind: "text",
  concurrencySafe: true,
  subject(args) {
    return args.pattern;
  },
  async execute(args, context): Promise<ToolResult> {
    const resolved = await resolveToolPath(args.path ?? ".", context);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }

    let expression: RegExp;
    try {
      expression = new RegExp(args.pattern, args.case_sensitive === true ? "g" : "gi");
    } catch (error) {
      return {
        ok: false,
        error: flowError(
          "invalid_request",
          `'${args.pattern}' is not a valid regular expression: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { retryable: false, remediation: "Fix the pattern and try again." },
        ),
      };
    }

    const root = resolved.value;
    const limit = args.max_results ?? DEFAULT_MAX_RESULTS;
    const mode = args.output_mode ?? "content";

    // Searching a credential file is reading it.
    if (isSensitivePath(root)) {
      return { ok: false, error: refuseSensitivePath(root) };
    }

    const info = await stat(root).catch(() => undefined);
    if (info === undefined) {
      return {
        ok: false,
        error: flowError("not_found", `There is nothing at '${args.path ?? "."}'.`, {
          retryable: false,
        }),
      };
    }

    const files =
      info.isDirectory()
        ? await walkFiles(root, { maxDepth: 20, skip: SKIPPED_DIRECTORIES })
        : [root];

    const lines: string[] = [];
    const counts: string[] = [];
    const matchedFiles: string[] = [];
    let total = 0;
    let truncated = false;

    for (const file of files) {
      if (truncated) {
        break;
      }
      // A credential file is not searched, so its contents can never reach
      // the model through a search either.
      if (isSensitivePath(file)) {
        continue;
      }
      const fileInfo = await stat(file).catch(() => undefined);
      if (fileInfo === undefined || fileInfo.size > MAX_SEARCHABLE_BYTES) {
        continue;
      }

      const relativePath = toPosix(relative(root, file)) || relative(root, file);
      if (args.glob !== undefined && !matchPath(args.glob, relativePath)) {
        continue;
      }

      const buffer = await readFile(file).catch(() => undefined);
      if (buffer === undefined || buffer.subarray(0, 8000).includes(0)) {
        continue;
      }

      const content = buffer.toString("utf8");
      const fileLines = content.split("\n");
      let fileMatches = 0;

      for (let index = 0; index < fileLines.length; index += 1) {
        expression.lastIndex = 0;
        if (!expression.test(fileLines[index] ?? "")) {
          continue;
        }
        fileMatches += 1;
        total += 1;

        if (mode === "content") {
          if (lines.length >= limit) {
            truncated = true;
            break;
          }
          lines.push(`${relativePath}:${index + 1}: ${(fileLines[index] ?? "").trim()}`);
        }
      }

      if (fileMatches > 0) {
        matchedFiles.push(relativePath);
        if (mode === "count") {
          counts.push(`${relativePath}: ${fileMatches}`);
        }
      }
    }

    if (mode === "files_with_matches") {
      const shown = matchedFiles.slice(0, limit);
      return {
        ok: true,
        output:
          shown.length === 0
            ? `No matches for '${args.pattern}'.`
            : `${shown.join("\n")}\n(${total} ${total === 1 ? "match" : "matches"} in ${matchedFiles.length} ${
                matchedFiles.length === 1 ? "file" : "files"
              })${matchedFiles.length > shown.length ? `, ${matchedFiles.length - shown.length} more` : ""}`,
        data: { count: total, files: matchedFiles.length },
      };
    }

    if (mode === "count") {
      return {
        ok: true,
        output:
          counts.length === 0
            ? `No matches for '${args.pattern}'.`
            : `${counts.slice(0, limit).join("\n")}\n(${total} ${total === 1 ? "match" : "matches"})`,
        data: { count: total, files: matchedFiles.length },
      };
    }

    if (lines.length === 0) {
      return {
        ok: true,
        output: `No matches for '${args.pattern}'.`,
        data: { count: 0 },
      };
    }

    return {
      ok: true,
      output: `${lines.join("\n")}\n(${total} ${total === 1 ? "match" : "matches"}${
        truncated ? ", showing the first few" : ""
      })`,
      data: { count: total, truncated },
    };
  },
};

/** The separator used to build a path on the current platform. */
export const PATH_SEPARATOR = sep;
