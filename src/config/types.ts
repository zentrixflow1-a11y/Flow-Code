/**
 * The configuration's shape.
 */
import type { PermissionMode } from "../permissions/types.js";

/** How the tool and context settings are tuned. */
export interface ToolSettings {
  /**
   * The largest the offered tool schemas may be, in bytes.
   *
   * Tool schemas are a real cost in the model's context, so they are
   * measured and capped.
   */
  readonly maxToolSchemaBytes: number;
  /**
   * Whether a batch that contains a tool that is not concurrency-safe runs
   * entirely in order.
   */
  readonly serialiseMixedBatches: boolean;
  /** The longest a shell command may run for, in milliseconds. */
  readonly commandTimeoutMs: number;
}

/** How the context window is managed. */
export interface ContextSettings {
  /**
   * The share of the model's context window to fill before compacting.
   */
  readonly autoCompactRatio: number;
  /** How many of the most recent turns a compaction keeps. */
  readonly keepTurns: number;
  /** The context window to assume, in tokens, when the model does not say. */
  readonly defaultContextWindow: number;
}

/** The permission settings. */
export interface PermissionSettings {
  /** The mode a session starts in. */
  readonly mode: PermissionMode;
  /** Rules that let a call through without asking. */
  readonly allow: readonly string[];
  /** Rules that always prompt. */
  readonly ask: readonly string[];
  /** Rules that block a call outright. */
  readonly deny: readonly string[];
  /** Extra directories the session may read and write. */
  readonly additionalDirectories: readonly string[];
}

/** The provider settings. */
export interface ProviderSettings {
  /** The provider preset to use, such as `ollama` or `custom`. */
  readonly provider: string;
  /** The base URL, when the provider is not a known preset. */
  readonly baseUrl?: string;
  /** The model to talk to. */
  readonly model?: string;
  /** The environment variable that holds the API key. */
  readonly apiKeyEnv?: string;
}

/** How the tools are kept inside the machine. */
export interface SecuritySettings {
  /**
   * Whether to run shell commands inside an operating-system sandbox.
   *
   * `"auto"` uses the platform's own sandbox when it is available; `"off"`
   * never does. There is no sandbox for native Windows.
   */
  readonly sandbox: "auto" | "off";
}

/** The whole configuration. */
export interface FlowCodeConfig {
  /** The provider settings. */
  readonly provider: ProviderSettings;
  /** The permission settings. */
  readonly permissions: PermissionSettings;
  /** The tool settings. */
  readonly tools: ToolSettings;
  /** The context settings. */
  readonly context: ContextSettings;
  /** The security settings. */
  readonly security: SecuritySettings;
  /** Whether the web tools are allowed. */
  readonly webEnabled: boolean;
  /** The shell to run commands in, when it is not the platform default. */
  readonly shell?: string;
}

/** The default configuration. */
export const DEFAULT_CONFIG: FlowCodeConfig = {
  provider: { provider: "ollama" },
  permissions: {
    mode: "ask",
    allow: [],
    ask: [],
    deny: [],
    additionalDirectories: [],
  },
  tools: {
    maxToolSchemaBytes: 24_000,
    serialiseMixedBatches: true,
    commandTimeoutMs: 120_000,
  },
  context: {
    autoCompactRatio: 0.8,
    keepTurns: 6,
    defaultContextWindow: 32_000,
  },
  security: { sandbox: "off" },
  webEnabled: false,
};
