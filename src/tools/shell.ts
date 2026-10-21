/**
 * The shell tool.
 *
 * Commands run in a fresh shell, so nothing carries over between calls except
 * what the tool passes explicitly. Output is captured separately for stdout
 * and stderr, and capped; the full output is written to a file whose path is
 * reported so nothing is silently lost.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { flowError } from "../errors.js";
import { capOutput } from "../util/text.js";
import { resolveToolPath } from "./fs.js";
import { applyGuard } from "./guard.js";
import { refuseSensitiveCommand, sensitiveWords } from "./sensitive.js";
import { wrapCommand } from "../security/sandbox.js";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.js";

/** The default time a command may run for. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** The longest a command may run for. */
const MAX_TIMEOUT_MS = 600_000;

/** The most output kept in memory per stream. */
const MAX_STREAM_BYTES = 200_000;

/** How a shell is invoked. */
export interface ShellInvocation {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Choose the shell to run a command in.
 *
 * The `shell` setting names the shell: `powershell`, `cmd` or `bash`. Without
 * it, the platform's own shell is used.
 *
 * @param platform - The host platform.
 * @param shell - The shell the user asked for, if any.
 */
export const shellFor = (
  platform: NodeJS.Platform,
  shell?: string,
): ShellInvocation => {
  switch (shell?.trim().toLowerCase()) {
    case "powershell":
    case "pwsh":
      return {
        command: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-Command"],
      };
    case "cmd":
      return {
        command: "cmd.exe",
        args: ["/d", "/s", "/c"],
      };
    case "bash":
      return { command: "bash", args: ["-c"] };
    default:
      break;
  }

  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command"],
    };
  }
  return { command: "/bin/sh", args: ["-c"] };
};

/** A command that is still running. */
interface BackgroundJob {
  readonly id: string;
  readonly child: ChildProcess;
  readonly startedAt: number;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stopped: boolean;
}

/** The background jobs this process is running. */
const jobs = new Map<string, BackgroundJob>();

/** A counter used to give each background job a short, unique id. */
let jobCounter = 0;

/** The arguments of {@link runCommandTool}. */
const runCommandArgs = z.object({
  command: z.string().min(1).describe("The command to run, in the platform's shell syntax."),
  cwd: z
    .string()
    .min(1)
    .optional()
    .describe("The directory to run in. Defaults to the current directory."),
  timeout_ms: z
    .number()
    .int()
    .min(1)
    .max(MAX_TIMEOUT_MS)
    .optional()
    .describe(`How long to allow, in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}.`),
  background: z
    .boolean()
    .optional()
    .describe("Run the command in the background and return immediately."),
});

/** Run a shell command. */
export const runCommandTool: ToolDefinition<z.infer<typeof runCommandArgs>> = {
  name: "run_command",
  description:
    "Run a shell command. Each call starts a fresh shell, so nothing persists between calls; use cwd rather than cd. Returns the exit code, stdout and stderr.",
  schema: runCommandArgs,
  category: "execute",
  subjectKind: "text",
  concurrencySafe: false,
  subject(args) {
    return args.command;
  },
  async execute(args, context): Promise<ToolResult> {
    const guard = applyGuard(context, "execute");
    if (!guard.ok) {
      return { ok: false, error: guard.error };
    }

    // A command that names a credential file is refused, whatever the
    // permission rules say. This is best effort — it reads the words of the
    // command, not what the shell will make of them.
    const secrets = sensitiveWords(args.command);
    if (secrets.length > 0) {
      return { ok: false, error: refuseSensitiveCommand(secrets) };
    }

    const resolved = await resolveToolPath(args.cwd ?? ".", context);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }

    const shell = shellFor(context.platform, context.shell);
    const timeout = Math.min(args.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

    // When the sandbox is in use, the command runs inside it.
    const sandboxed =
      context.sandbox === undefined
        ? undefined
        : wrapCommand(
            context.sandbox.kind,
            context.sandbox.roots,
            args.command,
            resolved.value,
          );

    const invocation = sandboxed ?? {
      command: shell.command,
      args: [...shell.args, args.command],
    };

    if (args.background === true) {
      return startBackground(resolved.value, invocation, context, timeout);
    }

    const outcome = await runToCompletion(
      args.command,
      resolved.value,
      invocation,
      context,
      timeout,
    );

    const output = formatOutcome(outcome);
    return {
      ok: true,
      output,
      data: {
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        durationMs: outcome.durationMs,
        timedOut: outcome.timedOut,
      },
    };
  },
};

/** What running a command produced. */
interface CommandOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null | undefined;
  readonly signal: NodeJS.Signals | null;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly outputFile?: string;
}

/** How a command is invoked. */
interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
}

/** Run a command until it finishes or times out. */
const runToCompletion = async (
  command: string,
  cwd: string,
  invocation: Invocation,
  context: ToolContext,
  timeoutMs: number,
): Promise<CommandOutcome> => {
  const startedAt = Date.now();
  const child = spawn(invocation.command, [...invocation.args], {
    cwd,
    env: { ...process.env, ...context.env },
    windowsHide: true,
    detached: context.platform !== "win32",
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (text: string) => {
    if (stdout.length < MAX_STREAM_BYTES) {
      stdout += text;
    }
  });
  child.stderr.on("data", (text: string) => {
    if (stderr.length < MAX_STREAM_BYTES) {
      stderr += text;
    }
  });

  const exit = await new Promise<{
    code: number | null | undefined;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, context.platform);
    }, timeoutMs);

    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ code: undefined, signal: null });
    });
  });

  const durationMs = Date.now() - startedAt;

  // Keep the whole output in a file so nothing is lost to the cap.
  let outputFile: string | undefined;
  if (stdout.length + stderr.length > MAX_STREAM_BYTES) {
    outputFile = await saveOutput(command, stdout, stderr);
  }

  return {
    stdout,
    stderr,
    exitCode: exit.code,
    signal: exit.signal,
    durationMs,
    timedOut,
    ...(outputFile === undefined ? {} : { outputFile }),
  };
};

/** Start a command in the background. */
const startBackground = async (
  cwd: string,
  invocation: Invocation,
  context: ToolContext,
  timeoutMs: number,
): Promise<ToolResult> => {
  const child = spawn(invocation.command, [...invocation.args], {
    cwd,
    env: { ...process.env, ...context.env },
    windowsHide: true,
    detached: context.platform !== "win32",
  });

  jobCounter += 1;
  const id = `job${jobCounter}`;
  const job: BackgroundJob = {
    id,
    child,
    startedAt: Date.now(),
    stdout: "",
    stderr: "",
    stopped: false,
  };
  jobs.set(id, job);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (text: string) => {
    if (job.stdout.length < MAX_STREAM_BYTES) {
      job.stdout += text;
    }
  });
  child.stderr.on("data", (text: string) => {
    if (job.stderr.length < MAX_STREAM_BYTES) {
      job.stderr += text;
    }
  });
  child.once("close", (code, signal) => {
    job.exitCode = code;
    job.signal = signal;
  });

  const timer = setTimeout(() => {
    job.stopped = true;
    killTree(child, context.platform);
  }, timeoutMs);
  child.once("close", () => clearTimeout(timer));

  return {
    ok: true,
    output: `Started in the background as ${id}. Use read_command_output to check on it.`,
    data: { id },
  };
};

/** Format a command's outcome for the model. */
const formatOutcome = (outcome: CommandOutcome): string => {
  const parts: string[] = [];

  if (outcome.timedOut) {
    parts.push("The command timed out and was stopped.");
  }

  if (outcome.stdout.trim() !== "") {
    parts.push(capOutput(outcome.stdout).text);
  }
  if (outcome.stderr.trim() !== "") {
    parts.push(`(stderr)\n${capOutput(outcome.stderr).text}`);
  }
  if (outcome.outputFile !== undefined) {
    parts.push(`(the full output was saved to ${outcome.outputFile})`);
  }

  const status =
    outcome.exitCode === undefined
      ? `signal ${outcome.signal ?? "unknown"}`
      : `exit code ${outcome.exitCode}`;
  parts.push(`[${status} in ${outcome.durationMs}ms]`);

  return parts.join("\n");
};

/** Write a command's full output to a temporary file. */
const saveOutput = async (
  command: string,
  stdout: string,
  stderr: string,
): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "flowcode-output-"));
  const path = join(directory, "output.txt");
  await writeFile(path, `$ ${command}\n\n--- stdout ---\n${stdout}\n\n--- stderr ---\n${stderr}`, "utf8");
  return path;
};

/** Kill a process and everything it started. */
const killTree = (child: ChildProcess, platform: NodeJS.Platform): void => {
  try {
    if (platform === "win32") {
      child.kill();
      // Windows needs taskkill to take the whole tree down.
      spawn("taskkill", ["/pid", String(child.pid ?? 0), "/T", "/F"], {
        windowsHide: true,
      });
      return;
    }
    if (child.pid !== undefined) {
      // The negative pid signals the whole process group.
      process.kill(-child.pid, "SIGTERM");
      return;
    }
    child.kill();
  } catch {
    // The process may already be gone.
  }
};

/** The arguments of {@link readCommandOutputTool}. */
const readCommandOutputArgs = z.object({
  id: z.string().min(1).describe("The id of the background job."),
});

/** Read the output of a background job. */
export const readCommandOutputTool: ToolDefinition<
  z.infer<typeof readCommandOutputArgs>
> = {
  name: "read_command_output",
  description: "Read the output of a command that is running in the background.",
  schema: readCommandOutputArgs,
  category: "execute",
  subjectKind: "text",
  concurrencySafe: true,
  subject(args) {
    return args.id;
  },
  async execute(args): Promise<ToolResult> {
    const job = jobs.get(args.id);
    if (job === undefined) {
      return {
        ok: false,
        error: flowError("not_found", `There is no background job called '${args.id}'.`, {
          retryable: false,
        }),
      };
    }

    const status =
      job.exitCode === undefined
        ? "still running"
        : `finished with exit code ${job.exitCode}`;

    const parts = [`[${status}]`];
    if (job.stdout.trim() !== "") {
      parts.push(capOutput(job.stdout).text);
    }
    if (job.stderr.trim() !== "") {
      parts.push(`(stderr)\n${capOutput(job.stderr).text}`);
    }

    return {
      ok: true,
      output: parts.join("\n"),
      data: { id: job.id, exitCode: job.exitCode, running: job.exitCode === undefined },
    };
  },
};

/** The arguments of {@link stopCommandTool}. */
const stopCommandArgs = z.object({
  id: z.string().min(1).describe("The id of the background job to stop."),
});

/** Stop a background job. */
export const stopCommandTool: ToolDefinition<z.infer<typeof stopCommandArgs>> = {
  name: "stop_command",
  description: "Stop a command that is running in the background.",
  schema: stopCommandArgs,
  category: "execute",
  subjectKind: "text",
  concurrencySafe: false,
  subject(args) {
    return args.id;
  },
  async execute(args, context): Promise<ToolResult> {
    const job = jobs.get(args.id);
    if (job === undefined) {
      return {
        ok: false,
        error: flowError("not_found", `There is no background job called '${args.id}'.`, {
          retryable: false,
        }),
      };
    }

    if (job.exitCode === undefined) {
      job.stopped = true;
      killTree(job.child, context.platform);
      return {
        ok: true,
        output: `Stopped ${job.id}.`,
        data: { id: job.id, stopped: true },
      };
    }

    return {
      ok: true,
      output: `${job.id} had already finished with exit code ${job.exitCode}.`,
      data: { id: job.id, stopped: false },
    };
  },
};

/** The ids of the background jobs that are still running. */
export const activeJobs = (): readonly string[] =>
  [...jobs.values()].filter((job) => job.exitCode === undefined).map((job) => job.id);
