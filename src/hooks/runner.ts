/**
 * Hooks.
 *
 * A hook is a command that Flow Code runs at a point in the session. It
 * receives the event on standard input and answers on standard output. It is
 * a small, deliberate design: six events and two outcomes, which is all that
 * earns its keep.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { flowError, type FlowError } from "../errors.js";
import type { ProjectScope } from "../security/trust.js";
import { err, ok, type Result } from "../util/result.js";

/** The points in a session a hook can run at. */
export type HookEvent =
  /** The session started. */
  | "session_start"
  /** The user sent a message. */
  | "user_prompt_submit"
  /** A tool is about to run. */
  | "pre_tool_use"
  /** A tool finished successfully. */
  | "post_tool_use"
  /** A tool failed. */
  | "post_tool_use_failure"
  /** The session ended. */
  | "session_end";

/** The events a hook may be registered for. */
export const HOOK_EVENTS: readonly HookEvent[] = [
  "session_start",
  "user_prompt_submit",
  "pre_tool_use",
  "post_tool_use",
  "post_tool_use_failure",
  "session_end",
];

/** One configured hook. */
export interface HookDefinition {
  /** The event it runs at. */
  readonly event: HookEvent;
  /**
   * Which calls it applies to.
   *
   * For a tool event, the tool's name, matched as a regular expression.
   */
  readonly matcher?: string;
  /** The command to run. */
  readonly command: string;
  /** How long it may take, in milliseconds. */
  readonly timeoutMs?: number;
}

/** The file the hooks are configured in. */
export const HOOKS_FILE = "hooks.json";

/** Where the global hooks are configured. */
export const globalHooksPath = (home: string): string =>
  join(home, ".flowcode", HOOKS_FILE);

/** Where the project's hooks are configured. */
export const projectHooksPath = (cwd: string): string =>
  join(cwd, ".flowcode", HOOKS_FILE);

/**
 * Read the configured hooks.
 *
 * The project's file is only read when the directory has been trusted,
 * because a hook is a command that Flow Code runs.
 *
 * @param options - Where to look.
 */
export const readHooks = async (
  options: {
    readonly cwd: string;
    readonly home?: string;
    /** Whether the project's own file may be read. */
    readonly project?: ProjectScope;
  },
): Promise<Result<readonly HookDefinition[], FlowError>> => {
  const home = options.home ?? homedir();
  const paths =
    (options.project ?? "untrusted") === "trusted"
      ? [globalHooksPath(home), projectHooksPath(options.cwd)]
      : [globalHooksPath(home)];

  const hooks: HookDefinition[] = [];

  for (const path of paths) {
    const read = await readHooksFile(path);
    if (!read.ok) {
      return read;
    }
    hooks.push(...read.value);
  }

  return ok(hooks);
};

/** Read one hooks file. */
const readHooksFile = async (
  path: string,
): Promise<Result<readonly HookDefinition[], FlowError>> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return ok([]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return err(
      flowError("invalid_request", `The hook configuration '${path}' is not valid JSON.`, {
        retryable: false,
        cause: error,
      }),
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    return err(
      flowError("invalid_request", `The hook configuration '${path}' is not an object.`, {
        retryable: false,
      }),
    );
  }

  const record = parsed as Record<string, unknown>;
  const entries = record["hooks"];
  if (typeof entries !== "object" || entries === null) {
    return ok([]);
  }

  const hooks: HookDefinition[] = [];

  for (const [event, value] of Object.entries(entries as Record<string, unknown>)) {
    if (!(HOOK_EVENTS as readonly string[]).includes(event)) {
      continue;
    }
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const hook = entry as Record<string, unknown>;
      if (typeof hook["command"] !== "string" || hook["command"] === "") {
        continue;
      }
      hooks.push({
        event: event as HookEvent,
        ...(typeof hook["matcher"] === "string" ? { matcher: hook["matcher"] } : {}),
        command: hook["command"],
        ...(typeof hook["timeoutMs"] === "number" ? { timeoutMs: hook["timeoutMs"] } : {}),
      });
    }
  }

  return ok(hooks);
};

/**
 * Whether a hook applies to a tool call.
 *
 * @param hook - The hook.
 * @param toolName - The tool being called.
 */
export const hookApplies = (hook: HookDefinition, toolName: string): boolean => {
  if (hook.matcher === undefined || hook.matcher === "" || hook.matcher === "*") {
    return true;
  }
  try {
    return new RegExp(hook.matcher).test(toolName);
  } catch {
    return false;
  }
};

/**
 * The events whose hooks can stop what is happening.
 *
 * A hook that fails at one of these has not approved anything, so it
 * blocks: the session does not start, the prompt is not accepted, or the
 * tool does not run.
 */
export const BLOCKING_HOOK_EVENTS: ReadonlySet<HookEvent> = new Set([
  "session_start",
  "user_prompt_submit",
  "pre_tool_use",
]);

/** What a set of hooks had to say. */
export interface HookReport {
  /** The reason a hook blocked the action. */
  readonly blocked?: string;
  /** The context a hook asked to pass to the model. */
  readonly context?: string;
  /** The hooks that failed, when the event could not be blocked. */
  readonly failures?: readonly string[];
}

/**
 * Run the hooks for an event.
 *
 * The first hook that blocks gives the reason, and the rest still run: a
 * hook that stops an action does not get to silence the others.
 *
 * A matcher names a tool, so it is only used for the events that have one.
 *
 * @param hooks - The configured hooks.
 * @param event - The event that happened.
 * @param payload - What the hook is told.
 * @param options - Where to run them.
 */
export const runEventHooks = async (
  hooks: readonly HookDefinition[],
  event: HookEvent,
  payload: Readonly<Record<string, unknown>>,
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
  },
): Promise<HookReport> => {
  let blocked: string | undefined;
  const contexts: string[] = [];
  const failures: string[] = [];

  for (const hook of hooks) {
    if (hook.event !== event) {
      continue;
    }

    const tool = payload["tool"];
    if (typeof tool === "string" && !hookApplies(hook, tool)) {
      continue;
    }

    const outcome = await runHook(
      hook,
      { event, ...payload },
      { cwd: options.cwd, env: options.env },
    );

    if (!outcome.ok) {
      if (BLOCKING_HOOK_EVENTS.has(event)) {
        blocked = outcome.reason;
        continue;
      }
      // The action has already happened, so a hook that failed afterwards is
      // reported rather than blocking anything.
      failures.push(outcome.reason);
      contexts.push(`A hook failed: ${outcome.reason}`);
      continue;
    }

    if (outcome.context !== undefined) {
      contexts.push(outcome.context);
    }
  }

  return {
    ...(blocked === undefined ? {} : { blocked }),
    ...(contexts.length === 0 ? {} : { context: contexts.join("\n") }),
    ...(failures.length === 0 ? {} : { failures }),
  };
};

/** What a hook said. */
export type HookOutcome =
  /** The hook did not object. */
  | { readonly ok: true; readonly context?: string }
  /** The hook blocked the action. */
  | { readonly ok: false; readonly reason: string };

/**
 * Run one hook.
 *
 * The hook receives the event as JSON on standard input. Exit code zero lets
 * the action proceed; exit code two blocks it, and the standard error
 * becomes the reason.
 *
 * @param hook - The hook to run.
 * @param payload - The event to send.
 * @param options - Where to run it.
 */
export const runHook = async (
  hook: HookDefinition,
  payload: unknown,
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
  },
): Promise<HookOutcome> => {
  const timeout = hook.timeoutMs ?? options.timeoutMs ?? 5000;

  return new Promise<HookOutcome>((resolve) => {
    const child = spawn(hook.command, {
      cwd: options.cwd,
      // The session's environment is layered over the process's own, so that a
      // session cannot accidentally take the PATH away from a hook.
      env: { ...process.env, ...options.env },
      shell: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (outcome: HookOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      child.kill();
      // A hook that runs out of time does not block the action, unless it
      // was the one that was meant to stop it.
      finish({ ok: true });
    }, timeout);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      stdout += text;
    });
    child.stderr.on("data", (text: string) => {
      stderr += text;
    });

    child.on("error", (error) => {
      // A hook that cannot be run at all has not approved anything. It
      // blocks, rather than quietly allowing what it was meant to stop.
      finish({
        ok: false,
        reason: `The hook could not be run: ${error instanceof Error ? error.message : String(error)}`,
      });
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish({ ok: true, ...parseHookOutput(stdout) });
        return;
      }

      if (code === 2) {
        // A hook that blocks says why. Its standard error is the reason, and
        // its standard output is the fallback, because a hook may well print
        // the reason on either.
        const reason = stderr.trim() === "" ? stdout.trim() : stderr.trim();
        finish({
          ok: false,
          reason: reason === "" ? "A hook refused this action." : reason,
        });
        return;
      }

      // A hook that failed has not approved anything either. It is treated
      // the same way as a refusal, so that a broken hook fails closed rather
      // than quietly allowing what it was meant to stop.
      const detail = stderr.trim() === "" ? stdout.trim() : stderr.trim();
      finish({
        ok: false,
        reason:
          detail === ""
            ? `The hook failed with exit code ${code}.`
            : `The hook failed with exit code ${code}: ${detail}`,
      });
    });

    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(payload));
  });
};

/**
 * Read the context a hook asked for.
 *
 * The JSON is found inside whatever the hook printed, so a hook may write a
 * line of its own before it.
 *
 * @param stdout - What the hook printed.
 */
export const parseHookOutput = (stdout: string): { context?: string } => {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    return {};
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const context =
      record["additional_context"] ?? record["additionalContext"];
    return typeof context === "string" && context !== "" ? { context } : {};
  } catch {
    return {};
  }
};
