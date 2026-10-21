/**
 * Building the tool context.
 *
 * There is one way to build a {@link ToolContext}, so that a sub-agent cannot
 * end up with a weaker one than the agent that spawned it: the same
 * redactor, the same guard, the same directories, the same secrets.
 */
import type { FlowError } from "../errors.js";
import type { ToolCategory } from "../permissions/types.js";
import type { SandboxKind } from "../security/sandbox.js";
import { createRedactor } from "../util/redact.js";
import type { Result } from "../util/result.js";
import type { ToolRegistry } from "./registry.js";
import type { ToolContext, ToolQuestion } from "./types.js";

/** What a tool context is built from. */
export interface ToolContextOptions {
  /** The directory the session is in. */
  readonly cwd: string;
  /** The root of the workspace. */
  readonly workspaceRoot: string;
  /** Extra directories the user has opened up. */
  readonly additionalDirectories?: readonly string[];
  /** The environment child processes inherit. */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * The values that must never appear in the model's context.
   *
   * The redactor is built from them, so every tool that uses this context
   * removes them from what it returns.
   */
  readonly secrets?: readonly string[];
  /** Cancels a long-running tool. */
  readonly signal?: AbortSignal;
  /** The host platform. */
  readonly platform?: NodeJS.Platform;
  /** Whether path comparison ignores case. */
  readonly caseInsensitivePaths?: boolean;
  /**
   * The check the host applies before the tool does anything.
   *
   * It is not optional. A tool that has no guard is a tool that acts
   * whatever the permission engine decided, and that is exactly the mistake
   * a sub-agent used to make.
   */
  readonly guard: (category: ToolCategory) => FlowError | undefined;
  /** Put a question to the user and wait for the answer. */
  readonly askUser?: (
    question: ToolQuestion,
  ) => Promise<readonly string[]>;
  /** Report progress while the tool runs. */
  readonly onProgress?: (message: string) => void;
  /** The registry the tools live in, so a tool can offer a sub-agent a subset. */
  readonly registry?: ToolRegistry;
  /**
   * The operating-system sandbox to run commands in, when one is in use.
   *
   * It is opt-in, and it is never assumed to be available.
   */
  readonly sandbox?: {
    readonly kind: SandboxKind;
    readonly roots: readonly string[];
  };
  /**
   * Run a sub-agent.
   *
   * The host provides this, because only it knows the provider, the session
   * and the rules the sub-agent should run under.
   */
  readonly spawnAgent?: (
    name: string,
    prompt: string,
  ) => Promise<Result<string, FlowError>>;
}

/**
 * Build the context the tools run in.
 *
 * @param options - What the context is made of.
 */
export const createToolContext = (options: ToolContextOptions): ToolContext => ({
  cwd: options.cwd,
  workspaceRoot: options.workspaceRoot,
  additionalDirectories: options.additionalDirectories ?? [],
  env: options.env ?? {},
  redact: createRedactor({ secrets: options.secrets ?? [] }),
  platform: options.platform ?? process.platform,
  caseInsensitivePaths:
    options.caseInsensitivePaths ?? process.platform === "win32",
  guard: options.guard,
  ...(options.signal === undefined ? {} : { signal: options.signal }),
  ...(options.askUser === undefined ? {} : { askUser: options.askUser }),
  ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  ...(options.registry === undefined ? {} : { registry: options.registry }),
  ...(options.sandbox === undefined ? {} : { sandbox: options.sandbox }),
  ...(options.spawnAgent === undefined ? {} : { spawnAgent: options.spawnAgent }),
});
