/**
 * The permission model's vocabulary.
 *
 * A permission rule is a single line of text:
 *
 * ```text
 * <tool>[:<specifier>]
 * ```
 *
 * The tool part is matched against the tool's name, and the specifier is
 * matched against the tool's *subject* — the thing the tool acts on.
 *
 * | Rule | Matches |
 * | --- | --- |
 * | `run_command:npm run *` | shell commands starting with `npm run` |
 * | `read_file:./secrets/**` | files under `./secrets` |
 * | `web_fetch:domain:example.com` | fetches of that host |
 * | `mcp` | every MCP tool |
 * | `mcp:github:*` | every tool of the `github` server |
 * | `mcp:github:create_issue` | one MCP tool |
 *
 * The tool part matches a tool name when it is equal to it, or when the tool
 * name continues past it with a colon. A specifier with no wildcard also
 * matches a subject that continues past it with a separator, so
 * `read_file:./secrets` covers the whole directory.
 */

/** How a tool affects the world. */
export type ToolCategory =
  /** Reads files or lists directories. */
  | "read"
  /** Creates or modifies files. */
  | "write"
  /** Runs a process. */
  | "execute"
  /** Talks to the network. */
  | "network"
  /** Affects only the session itself. */
  | "control";

/** How much the agent is allowed to do without asking. */
export type PermissionMode =
  /** Ask before every action that changes anything. */
  | "ask"
  /** Also accept file edits inside the workspace. */
  | "accept_edits"
  /** Read-only: explore and propose, change nothing. */
  | "plan"
  /** Read-only and offline: no writes, no processes, no network. */
  | "safe"
  /** Act freely inside the workspace. */
  | "trust";

/** The permission modes, in the order the setup wizard offers them. */
export const PERMISSION_MODES: readonly PermissionMode[] = [
  "ask",
  "accept_edits",
  "plan",
  "safe",
  "trust",
];

/** The rule lists that decide what happens to a tool call. */
export interface PermissionRules {
  /** Rules that let a call through without asking. */
  readonly allow: readonly string[];
  /** Rules that always prompt. */
  readonly ask: readonly string[];
  /** Rules that block a call outright. */
  readonly deny: readonly string[];
};

/** An empty rule set. */
export const EMPTY_RULES: PermissionRules = { allow: [], ask: [], deny: [] };

/** The paths the permission engine resolves rule specifiers against. */
export interface PermissionContext {
  /** The root of the workspace. */
  readonly workspaceRoot: string;
  /** The directory the session is currently in. */
  readonly cwd: string;
  /** The user's home directory. */
  readonly home: string;
}

/**
 * How a tool's subject is shaped.
 *
 * The kind decides how a rule's specifier is compared with the subject, and
 * it is declared by the tool rather than guessed from the specifier.
 */
export type SubjectKind =
  /** An absolute filesystem path. */
  | "path"
  /** An MCP tool, shaped as `server:tool`. */
  | "mcp"
  /** Plain text, such as a command or a domain. */
  | "text";

/** A tool call, as the permission engine sees it. */
export interface PermissionRequest {
  /** The tool's name, such as `read_file` or `mcp:github:create_issue`. */
  readonly tool: string;
  /** What kind of tool this is. */
  readonly category: ToolCategory;
  /** The thing the tool acts on, matched against rule specifiers. */
  readonly subject?: string;
  /** How the subject is shaped. */
  readonly subjectKind?: SubjectKind;
  /** The active permission mode. */
  readonly mode: PermissionMode;
  /** The merged rule lists. */
  readonly rules: PermissionRules;
  /** The paths rule specifiers resolve against. */
  readonly context: PermissionContext;
  /**
   * Whether the subject lies inside the workspace or an additional directory.
   *
   * Writes outside those roots are refused in every mode.
   */
  readonly withinWorkspace: boolean;
  /**
   * Whether the command, when there is one, only reads.
   *
   * Used to let `plan` mode run inspection commands and to avoid prompting
   * for harmless ones.
   */
  readonly readOnlyCommand?: boolean;
}

/** The outcome of a permission check. */
export type PermissionDecision =
  /** The call may proceed. */
  | { readonly kind: "allow"; readonly reason: string }
  /** The user must approve the call. */
  | { readonly kind: "ask"; readonly reason: string; readonly rule?: string }
  /** The call is refused. */
  | { readonly kind: "deny"; readonly reason: string; readonly rule?: string };
