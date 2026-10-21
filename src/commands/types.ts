/**
 * The command system's vocabulary.
 */
import type { FlowCodeConfig } from "../config/types.js";
import type { FlowError } from "../errors.js";
import type { PermissionMode } from "../permissions/types.js";
import type { ModelInfo, ModelProvider } from "../providers/types.js";
import type { Result } from "../util/result.js";
import type { ToolRegistry } from "../tools/registry.js";

/** One selectable flag of a subcommand. */
export interface OptionDefinition {
  /** The long flag name, without the leading dashes. */
  readonly name: string;
  /** A one-line explanation shown in help output. */
  readonly summary: string;
  /** A short placeholder such as `<model>`, when the option takes a value. */
  readonly value?: string;
}

/** What a command can do. */
export interface CommandServices {
  /** The resolved configuration. */
  readonly config: FlowCodeConfig;
  /** The provider in use. */
  readonly provider: ModelProvider;
  /** The tools the model may call. */
  readonly registry: ToolRegistry;
  /** List the models the provider serves. */
  readonly listModels: () => Promise<ModelInfo[]>;
  /** Change the model. */
  readonly setModel: (
    provider: string,
    model: string,
  ) => Promise<Result<void, FlowError>>;
  /** Change the permission mode. */
  readonly setPermissionMode: (mode: PermissionMode) => void;
  /** Start a new conversation, keeping the project instructions. */
  readonly clear: () => Promise<void>;
  /** Compact the conversation now. */
  readonly compact: () => Promise<string>;
  /** Leave the session. */
  readonly exit: () => void;
  /** The current working directory. */
  readonly cwd: string;
  /** The MCP servers, and whether they answered. */
  readonly mcpServers?: readonly {
    readonly name: string;
    readonly connected: boolean;
    readonly tools: readonly string[];
    readonly error?: string;
  }[];
  /** The sub-agents the project defines. */
  readonly subAgents?: readonly { readonly name: string; readonly description: string }[];
  /**
   * Write a file in the workspace.
   *
   * Only the commands that create a file use it, and only inside the
   * workspace.
   */
  readonly writeWorkspaceFile?: (
    relativePath: string,
    content: string,
  ) => Promise<Result<string, FlowError>>;
}

/** What a command produced. */
export interface CommandOutcome {
  /** Text to show the user. */
  readonly output?: string;
  /** Something the host should do. */
  readonly action?: "none" | "clear" | "exit" | "compact";
}

/** A command's context. */
export interface CommandContext {
  /** The arguments the user typed after the command. */
  readonly args: string;
  /** What the command can do. */
  readonly services: CommandServices;
}

/** A Flow Code command. */
export interface CommandDefinition {
  /** The word the user types, without a leading slash. */
  readonly name: string;
  /** A one-line description shown in help output. */
  readonly summary: string;
  /** A usage line, e.g. `flowcode model [provider] [model]`. */
  readonly usage: string;
  /** Options accepted by this command. */
  readonly options?: readonly OptionDefinition[];
  /** Run the command. */
  run(context: CommandContext): Promise<CommandOutcome>;
}
