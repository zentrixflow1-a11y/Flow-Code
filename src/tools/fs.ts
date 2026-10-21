/**
 * The filesystem tools.
 *
 * Every one of them resolves its path through the sandbox first, so a tool
 * can never reach outside the workspace, and every write refuses the
 * protected paths.
 */
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { flowError, type FlowError } from "../errors.js";
import {
  isProtectedPath,
  isSensitivePath,
  resolveWithinRoots,
  toPosix,
} from "../util/paths.js";
import { ok, type Result } from "../util/result.js";
import { withLineNumbers } from "../util/text.js";
import { applyGuard } from "./guard.js";
import { refuseSensitivePath } from "./sensitive.js";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.js";

/** The largest file the tools will read as text. */
const MAX_READ_BYTES = 1_000_000;

/**
 * Resolve a path for a tool, refusing anything outside the workspace.
 *
 * @param candidate - The path the model asked for.
 * @param context - The tool's host context.
 */
export const resolveToolPath = async (
  candidate: string,
  context: ToolContext,
): Promise<Result<string, FlowError>> => {
  const resolved = await resolveWithinRoots(candidate, {
    roots: [context.workspaceRoot, ...context.additionalDirectories],
    cwd: context.cwd,
    caseInsensitive: context.caseInsensitivePaths,
  });

  if (!resolved.ok) {
    return resolved;
  }

  const path = resolved.value;
  if (context.caseInsensitivePaths) {
    return ok(path);
  }
  return ok(path);
};

/** Whether a file looks like binary content. */
const looksBinary = (buffer: Buffer): boolean =>
  buffer.subarray(0, 8000).includes(0);

/** Refuse a write to a protected path. */
const refuseProtectedWrite = (path: string): FlowError =>
  flowError(
    "permission_denied",
    `'${path}' is a protected path and will not be written to.`,
    {
      retryable: false,
      remediation:
        "Choose a different location, or change the file by hand outside Flow Code.",
    },
  );

/** The arguments of {@link readFileTool}. */
const readFileArgs = z.object({
  path: z.string().min(1).describe("The file to read, absolute or relative to the workspace."),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("The line to start from, counting from 1."),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("How many lines to read."),
});

/** Read a text file. */
export const readFileTool: ToolDefinition<z.infer<typeof readFileArgs>> = {
  name: "read_file",
  description:
    "Read a text file from the workspace. Returns the contents with line numbers. Use offset and limit to read part of a large file.",
  schema: readFileArgs,
  category: "read",
  subjectKind: "path",
  concurrencySafe: true,
  subject(args) {
    return args.path;
  },
  async execute(args, context): Promise<ToolResult> {
    const resolved = await resolveToolPath(args.path, context);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }

    const path = resolved.value;
    const info = await stat(path).catch(() => undefined);
    if (info === undefined) {
      return {
        ok: false,
        error: flowError("not_found", `There is no file at '${args.path}'.`, {
          retryable: false,
          remediation: "Check the path, or list the directory to see what is there.",
        }),
      };
    }
    if (info.isDirectory()) {
      return {
        ok: false,
        error: flowError("invalid_request", `'${args.path}' is a directory.`, {
          retryable: false,
          remediation: "Use list_dir to see what is inside it.",
        }),
      };
    }

    // A file that holds a credential is not read, whichever tool asked for
    // it. The rule is about the path, not about the caller.
    if (isSensitivePath(path)) {
      return { ok: false, error: refuseSensitivePath(path) };
    }
    if (info.size > MAX_READ_BYTES) {
      return {
        ok: false,
        error: flowError(
          "resource_constraint",
          `'${args.path}' is ${info.size} bytes, which is larger than the ${MAX_READ_BYTES}-byte limit.`,
          {
            retryable: false,
            remediation: "Read it in parts with offset and limit, or search it with grep_files.",
          },
        ),
      };
    }

    const buffer = await readFile(path);
    if (looksBinary(buffer)) {
      return {
        ok: false,
        error: flowError("invalid_request", `'${args.path}' looks like a binary file.`, {
          retryable: false,
          remediation: "Use grep_files to search it, or a tool that understands its format.",
        }),
      };
    }

    const allLines = buffer.toString("utf8").split("\n");
    const start = (args.offset ?? 1) - 1;
    const end = args.limit === undefined ? allLines.length : start + args.limit;
    const selected = allLines.slice(start, end);

    const header =
      args.offset === undefined && args.limit === undefined
        ? ""
        : `(lines ${start + 1}-${Math.min(end, allLines.length)} of ${allLines.length})\n`;

    return {
      ok: true,
      output: `${header}${withLineNumbers(selected.join("\n"), start + 1)}`,
      data: { path, lines: allLines.length },
    };
  },
};

/** The arguments of {@link writeFileTool}. */
const writeFileArgs = z.object({
  path: z.string().min(1).describe("The file to write, absolute or relative to the workspace."),
  content: z.string().describe("The full content of the file."),
});

/** Write a text file, replacing it entirely. */
export const writeFileTool: ToolDefinition<z.infer<typeof writeFileArgs>> = {
  name: "write_file",
  description:
    "Create a file or replace its entire contents. The file is written atomically. Prefer edit_file when changing part of an existing file.",
  schema: writeFileArgs,
  category: "write",
  subjectKind: "path",
  concurrencySafe: false,
  subject(args) {
    return args.path;
  },
  async execute(args, context): Promise<ToolResult> {
    const guard = applyGuard(context, "write");
    if (!guard.ok) {
      return { ok: false, error: guard.error };
    }

    const resolved = await resolveToolPath(args.path, context);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }

    const path = resolved.value;
    if (isProtectedPath(path) || isSensitivePath(path)) {
      return { ok: false, error: refuseProtectedWrite(path) };
    }

    const previous = await readFile(path, "utf8").catch(() => undefined);

    await mkdir(dirname(path), { recursive: true });
    await writeFileAtomically(path, args.content);

    const created = previous === undefined;
    return {
      ok: true,
      output: created
        ? `Created ${args.path} (${args.content.length} characters).`
        : `Replaced ${args.path} (${args.content.length} characters, was ${previous.length}).`,
      data: { path, created, previousLength: previous?.length },
    };
  },
};

/** The arguments of {@link editFileTool}. */
const editFileArgs = z.object({
  path: z.string().min(1).describe("The file to edit."),
  old_text: z
    .string()
    .min(1)
    .describe(
      "The exact text to replace. It must appear exactly once, unless replace_all is set.",
    ),
  new_text: z.string().describe("The text to put in its place."),
  replace_all: z
    .boolean()
    .optional()
    .describe("Replace every occurrence instead of requiring a unique one."),
});

/** Replace part of a text file. */
export const editFileTool: ToolDefinition<z.infer<typeof editFileArgs>> = {
  name: "edit_file",
  description:
    "Replace an exact piece of text in a file. The text to replace must appear exactly once, unless replace_all is set. Use this instead of write_file for small changes.",
  schema: editFileArgs,
  category: "write",
  subjectKind: "path",
  concurrencySafe: false,
  subject(args) {
    return args.path;
  },
  async execute(args, context): Promise<ToolResult> {
    const guard = applyGuard(context, "write");
    if (!guard.ok) {
      return { ok: false, error: guard.error };
    }

    const resolved = await resolveToolPath(args.path, context);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }

    const path = resolved.value;
    if (isProtectedPath(path) || isSensitivePath(path)) {
      return { ok: false, error: refuseProtectedWrite(path) };
    }

    const original = await readFile(path, "utf8").catch(() => undefined);
    if (original === undefined) {
      return {
        ok: false,
        error: flowError("not_found", `There is no file at '${args.path}'.`, {
          retryable: false,
          remediation: "Create it with write_file, or check the path.",
        }),
      };
    }

    const occurrences = countOccurrences(original, args.old_text);
    if (occurrences === 0) {
      return {
        ok: false,
        error: flowError(
          "not_found",
          `The text to replace was not found in '${args.path}'.`,
          {
            retryable: false,
            remediation:
              "Read the file again and copy the exact text to replace, including its indentation.",
          },
        ),
      };
    }

    if (occurrences > 1 && args.replace_all !== true) {
      const lines = linesOfOccurrences(original, args.old_text);
      return {
        ok: false,
        error: flowError(
          "invalid_request",
          `The text to replace appears ${occurrences} times in '${args.path}' (on lines ${lines.join(", ")}).`,
          {
            retryable: false,
            remediation:
              "Include more surrounding context so the text is unique, or set replace_all to true.",
          },
        ),
      };
    }

    const updated =
      args.replace_all === true
        ? original.split(args.old_text).join(args.new_text)
        : original.replace(args.old_text, args.new_text);

    await writeFileAtomically(path, updated);

    const changed = countOccurrences(original, args.old_text);
    return {
      ok: true,
      output: `Replaced ${changed === 1 ? "1 occurrence" : `${changed} occurrences`} in ${args.path}.`,
      data: { path, occurrences: changed },
    };
  },
};

/** The arguments of {@link listDirTool}. */
const listDirArgs = z.object({
  path: z
    .string()
    .min(1)
    .optional()
    .describe("The directory to list. Defaults to the current directory."),
  depth: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("How many levels to descend. Defaults to 1."),
});

/** List a directory. */
export const listDirTool: ToolDefinition<z.infer<typeof listDirArgs>> = {
  name: "list_dir",
  description:
    "List the contents of a directory, with each entry's type and size. Use depth to look further down.",
  schema: listDirArgs,
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
    const depth = args.depth ?? 1;
    const entries: string[] = [];

    const walk = async (directory: string, level: number): Promise<void> => {
      const listing = await readdir(directory, { withFileTypes: true }).catch(() => []);
      const sorted = [...listing].sort((left, right) => left.name.localeCompare(right.name));

      for (const entry of sorted) {
        const full = join(directory, entry.name);
        // A credential file is not listed either: knowing that it is there
        // is the first half of finding it.
        if (isSensitivePath(full)) {
          continue;
        }
        const info = await stat(full).catch(() => undefined);
        const size = info?.isDirectory() === true ? "" : ` ${info?.size ?? 0} B`;
        entries.push(
          `${"  ".repeat(level)}${entry.isDirectory() ? "" : ""}${entry.name}${size}`,
        );
        if (entry.isDirectory() && level < depth) {
          await walk(full, level + 1);
        }
      }
    };

    await walk(root, 0);

    if (entries.length === 0) {
      return { ok: true, output: "(empty directory)", data: { path: root, count: 0 } };
    }

    return {
      ok: true,
      output: entries.join("\n"),
      data: { path: root, count: entries.length },
    };
  },
};

/** Write a file atomically, via a temporary file in the same directory. */
export const writeFileAtomically = async (
  path: string,
  content: string,
): Promise<void> => {
  const temporary = `${path}.flowcode-${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await import("node:fs/promises").then((fs) =>
      fs.unlink(temporary).catch(() => undefined),
    );
    throw error;
  }
};

/** Count how many times a piece of text appears. */
export const countOccurrences = (haystack: string, needle: string): number => {
  if (needle === "") {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
};

/** The line numbers where a piece of text appears. */
const linesOfOccurrences = (haystack: string, needle: string): number[] => {
  const lines = haystack.split("\n");
  const found: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if ((lines[index] ?? "").includes(needle)) {
      found.push(index + 1);
    }
  }
  return found;
};

/** Whether a path exists. */
export const pathExists = async (path: string): Promise<boolean> =>
  access(path, constants.F_OK).then(
    () => true,
    () => false,
  );

/** A path relative to the workspace root, for display. */
export const displayPath = (path: string, workspaceRoot: string): string => {
  const relativePath = relative(workspaceRoot, path);
  if (relativePath === "") {
    return ".";
  }
  return toPosix(relativePath);
};
