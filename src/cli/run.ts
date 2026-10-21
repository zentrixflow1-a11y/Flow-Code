import { COMMANDS } from "../commands/registry.js";
import { BINARY_NAME, VERSION } from "../version.js";
import { booleanFlag, parseArgs, stringFlag, type ArgSpec } from "./args.js";
import { renderHelp } from "./help.js";
import { runHeadless } from "./headless.js";
import { runSetup } from "../setup/wizard.js";
import { runDoctor } from "../doctor.js";
import { FlowSession } from "../agent/session.js";
import { runInteractive } from "../ui/run.js";
import { PERMISSION_MODES, type PermissionMode } from "../permissions/types.js";

/**
 * The seams the CLI needs from its host process.
 *
 * Everything the CLI prints goes through these two functions, so a test can
 * capture output without touching the real streams.
 */
export interface CliDeps {
  /** Write a line of standard output. */
  readonly out: (text: string) => void;
  /** Write a line of standard error. */
  readonly err: (text: string) => void;
  /** Write to standard output without a trailing newline. */
  readonly write?: (text: string) => void;
  /** The working directory the session should start in. */
  readonly cwd: string;
  /** The environment the session should inherit. */
  readonly env: NodeJS.ProcessEnv;
  /** The user's home directory. */
  readonly home?: string;
  /** The terminal to draw the interactive interface on. */
  readonly stdout?: NodeJS.WriteStream;
  /** The terminal to read the interactive interface from. */
  readonly stdin?: NodeJS.ReadStream;
}

/** The default dependencies, wired to the real process. */
export const defaultDeps: CliDeps = {
  out: (text) => void process.stdout.write(`${text}\n`),
  err: (text) => void process.stderr.write(`${text}\n`),
  write: (text) => void process.stdout.write(text),
  cwd: process.cwd(),
  env: process.env,
  home: undefined,
};

/** Exit status codes, following the conventions the CLI documents. */
export const EXIT = {
  /** Everything worked. */
  ok: 0,
  /** The command failed. */
  failure: 1,
  /** The process was interrupted (SIGINT). */
  interrupted: 130,
  /** The process was terminated (SIGTERM). */
  terminated: 143,
  /** Standard output was closed before the process finished (EPIPE). */
  brokenPipe: 141,
} as const;

/** The argument spec for the top-level command. */
const TOP_LEVEL_SPEC: ArgSpec = {
  valueFlags: new Set([
    "print",
    "output-format",
    "model",
    "provider",
    "base-url",
    "permission-mode",
    "max-turns",
    "resume",
  ]),
  aliases: new Map([
    ["h", "help"],
    ["v", "version"],
    ["p", "print"],
    ["y", "yes"],
  ]),
};

/**
 * Run the Flow Code command line.
 *
 * @param argv - Arguments after the executable name.
 * @param deps - Host seams; see {@link CliDeps}.
 * @returns The process exit status.
 */
export const runCli = async (
  argv: readonly string[],
  deps: CliDeps = defaultDeps,
): Promise<number> => {
  const { positionals, flags } = parseArgs(argv, TOP_LEVEL_SPEC);

  if (booleanFlag(flags, "version")) {
    deps.out(VERSION);
    return EXIT.ok;
  }

  const command = positionals[0];

  if (booleanFlag(flags, "help") || command === "help") {
    deps.out(renderHelp(COMMANDS).trimEnd());
    return EXIT.ok;
  }

  const task = stringFlag(flags, "print");
  if (task !== undefined) {
    return runHeadlessTask(task, flags, deps);
  }

  if (command === "setup") {
    return runSetup({
      ...(deps.home === undefined ? {} : { home: deps.home }),
      ...(stringFlag(flags, "provider") === undefined
        ? {}
        : { provider: stringFlag(flags, "provider") as string }),
      ...(stringFlag(flags, "model") === undefined
        ? {}
        : { model: stringFlag(flags, "model") as string }),
      ...(stringFlag(flags, "base-url") === undefined
        ? {}
        : { baseUrl: stringFlag(flags, "base-url") as string }),
      yes: booleanFlag(flags, "yes"),
      out: (text) => deps.out(text),
      err: (text) => deps.err(text),
    });
  }

  if (command === "doctor") {
    return runDoctor({
      cwd: deps.cwd,
      ...(deps.home === undefined ? {} : { home: deps.home }),
      env: deps.env,
      out: (text) => deps.out(text),
    });
  }

  if (command !== undefined) {
    const known = COMMANDS.find((entry) => entry.name === command);
    if (known === undefined) {
      deps.err(`${BINARY_NAME}: unknown command '${command}'`);
      deps.err(`Run \`${BINARY_NAME} --help\` to see the available commands.`);
      return EXIT.failure;
    }
    deps.err(`${BINARY_NAME}: command '${command}' is not available in this build yet.`);
    return EXIT.failure;
  }

  return runInteractiveSession(flags, deps);
};

/** Start the interactive terminal session. */
const runInteractiveSession = async (
  flags: Readonly<Record<string, string | boolean>>,
  deps: CliDeps,
): Promise<number> => {
  const mode = stringFlag(flags, "permission-mode");
  if (mode !== undefined && !(PERMISSION_MODES as readonly string[]).includes(mode)) {
    deps.err(`${BINARY_NAME}: unknown permission mode '${mode}'.`);
    deps.err(`Use one of: ${PERMISSION_MODES.join(", ")}.`);
    return EXIT.failure;
  }

  const session = await FlowSession.create({
    cwd: deps.cwd,
    ...(deps.home === undefined ? {} : { home: deps.home }),
    env: deps.env,
    overrides: {
      ...(stringFlag(flags, "provider") === undefined
        ? {}
        : { provider: stringFlag(flags, "provider") as string }),
      ...(stringFlag(flags, "model") === undefined
        ? {}
        : { model: stringFlag(flags, "model") as string }),
      ...(stringFlag(flags, "base-url") === undefined
        ? {}
        : { baseUrl: stringFlag(flags, "base-url") as string }),
      ...(mode === undefined ? {} : { permissionMode: mode as PermissionMode }),
    },
  });

  if (!session.ok) {
    deps.err(`${BINARY_NAME}: ${session.error.message}`);
    if (session.error.remediation !== undefined) {
      deps.err(`${BINARY_NAME}: ${session.error.remediation}`);
    }
    return EXIT.failure;
  }

  return runInteractive({
    session: session.value,
    ...(deps.stdout === undefined ? {} : { stdout: deps.stdout }),
    ...(deps.stdin === undefined ? {} : { stdin: deps.stdin }),
  });
};

/** Run one task without a terminal UI. */
const runHeadlessTask = async (
  task: string,
  flags: Readonly<Record<string, string | boolean>>,
  deps: CliDeps,
): Promise<number> => {
  const outputFormat = stringFlag(flags, "output-format") ?? "text";
  if (outputFormat !== "text" && outputFormat !== "json") {
    deps.err(`${BINARY_NAME}: unknown output format '${outputFormat}'.`);
    deps.err(`Use 'text' or 'json'.`);
    return EXIT.failure;
  }

  const mode = stringFlag(flags, "permission-mode");
  if (mode !== undefined && !(PERMISSION_MODES as readonly string[]).includes(mode)) {
    deps.err(`${BINARY_NAME}: unknown permission mode '${mode}'.`);
    deps.err(`Use one of: ${PERMISSION_MODES.join(", ")}.`);
    return EXIT.failure;
  }

  const maxTurns = stringFlag(flags, "max-turns");
  if (maxTurns !== undefined && !/^\d+$/.test(maxTurns)) {
    deps.err(`${BINARY_NAME}: --max-turns must be a number.`);
    return EXIT.failure;
  }

  return runHeadless({
    task,
    cwd: deps.cwd,
    ...(deps.home === undefined ? {} : { home: deps.home }),
    env: deps.env,
    stdout: (text) => {
      if (deps.write !== undefined) {
        deps.write(text);
        return;
      }
      deps.out(text);
    },
    stderr: (text) => deps.err(text),
    outputFormat,
    ...(stringFlag(flags, "provider") === undefined
      ? {}
      : { provider: stringFlag(flags, "provider") as string }),
    ...(stringFlag(flags, "model") === undefined
      ? {}
      : { model: stringFlag(flags, "model") as string }),
    ...(stringFlag(flags, "base-url") === undefined
      ? {}
      : { baseUrl: stringFlag(flags, "base-url") as string }),
    ...(mode === undefined ? {} : { permissionMode: mode as PermissionMode }),
    approveAll: booleanFlag(flags, "yes"),
    ...(maxTurns === undefined ? {} : { maxTurns: Number(maxTurns) }),
    ...(stringFlag(flags, "resume") === undefined
      ? {}
      : { resumePath: stringFlag(flags, "resume") as string }),
  });
};
