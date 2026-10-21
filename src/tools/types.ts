/**
 * The tool system's vocabulary.
 */
import type { ZodType } from "zod";
import type { FlowError } from "../errors.js";
import type { SubjectKind, ToolCategory } from "../permissions/types.js";
import type { JsonSchema } from "../providers/types.js";
import type { Result } from "../util/result.js";
import type { ToolRegistry } from "./registry.js";
import type { SandboxKind } from "../security/sandbox.js";

/** A question the model wants to put to the user. */
export interface ToolQuestion {
  /** The question itself. */
  readonly question: string;
  /** A short label for the question. */
  readonly header?: string;
  /** The answers the user can pick from. */
  readonly options: readonly {
    readonly label: string;
    readonly description?: string;
  }[];
  /** Whether the user may pick more than one answer. */
  readonly multiSelect?: boolean;
}

/** What a tool needs from its host. */
export interface ToolContext {
  /** The directory the session is in. */
  readonly cwd: string;
  /** The root of the workspace. */
  readonly workspaceRoot: string;
  /** Extra directories the user has opened up. */
  readonly additionalDirectories: readonly string[];
  /** The environment child processes inherit. */
  readonly env: NodeJS.ProcessEnv;
  /** Cancels a long-running tool. */
  readonly signal?: AbortSignal;
  /** Removes secrets from text before it is shown or sent to the model. */
  readonly redact: (text: string) => string;
  /** The host platform. */
  readonly platform: NodeJS.Platform;
  /**
   * The shell commands run in, when the user asked for one.
   *
   * `powershell`, `cmd` or `bash`; without it, the platform's own shell is
   * used.
   */
  readonly shell?: string;
  /** Whether path comparison ignores case. */
  readonly caseInsensitivePaths: boolean;
  /** Put a question to the user and wait for the answer. */
  readonly askUser?: (
    question: ToolQuestion,
  ) => Promise<readonly string[]>;
  /**
   * A check the host applies before the tool does anything.
   *
   * This is the second of the two enforcement layers. The permission engine
   * decides whether a call may proceed; this guard makes sure the tool
   * itself refuses to act even if something upstream got the decision wrong.
   * The `safe` and `plan` ceilings are enforced here as well as there.
   *
   * It is required: a tool that has no guard is a tool that acts whatever
   * the permission engine decided.
   */
  readonly guard: (category: ToolCategory) => FlowError | undefined;
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

/** The outcome of a tool call. */
export type ToolResult =
  /** The tool succeeded. */
  | { readonly ok: true; readonly output: string; readonly data?: unknown }
  /** The tool failed. */
  | { readonly ok: false; readonly error: FlowError };

/** A tool the model can call. */
export interface ToolDefinition<A = unknown> {
  /** The name the model uses to call the tool. */
  readonly name: string;
  /** What the tool does, in the model's terms. */
  readonly description: string;
  /**
   * The argument schema, for the tools Flow Code validates itself.
   *
   * A tool that validates on its own side — an MCP tool, for instance — has
   * no schema here and supplies {@link ToolDefinition.parameters} instead.
   */
  readonly schema?: ZodType<A, unknown>;
  /** The JSON Schema for the arguments, when the tool brings its own. */
  readonly parameters?: JsonSchema;
  /** What kind of tool this is, which the permission engine uses. */
  readonly category: ToolCategory;
  /** How the tool's subject is shaped, for permission matching. */
  readonly subjectKind: SubjectKind;
  /**
   * Whether the tool may run alongside its siblings.
   *
   * A tool that is not concurrency-safe is exclusive: it forms a barrier, and
   * the whole batch around it runs in order.
   */
  readonly concurrencySafe: boolean;
  /**
   * The thing the tool acts on, which permission rules match against.
   */
  subject?(args: A): string | undefined;
  /** Run the tool. */
  execute(args: A, context: ToolContext): Promise<ToolResult>;
}
