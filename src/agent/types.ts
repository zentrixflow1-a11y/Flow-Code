/**
 * The agent's vocabulary.
 */
import type { FlowError } from "../errors.js";
import type { PermissionContext, PermissionRules } from "../permissions/types.js";
import type { ModelProvider, ToolCall } from "../providers/types.js";
import type { FlowCodeConfig } from "../config/types.js";
import type { HookDefinition } from "../hooks/runner.js";
import type { ToolContext, ToolResult } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { SessionLog } from "../session/log.js";

/** A request for the user to approve a tool call. */
export interface ApprovalRequest {
  /** The tool the model wants to call. */
  readonly tool: string;
  /** The arguments the model wants to call it with. */
  readonly args: unknown;
  /** Why the permission engine asked. */
  readonly reason: string;
  /** The rule that asked, when one did. */
  readonly rule?: string;
}

/** The user's answer to an approval request. */
export type ApprovalDecision =
  /** Run it this once. */
  | { readonly kind: "allow" }
  /** Run it this once, and remember the answer. */
  | { readonly kind: "allow_always" }
  /** Do not run it. */
  | { readonly kind: "deny"; readonly reason?: string }
  /** Do not run it, and remember the answer. */
  | { readonly kind: "deny_always"; readonly reason?: string };

/** How the agent talks to the user. */
export interface AgentUi {
  /** The model is producing text. */
  onText(text: string): void;
  /** The model is producing reasoning. */
  onReasoning(text: string): void;
  /** A tool call is about to run. */
  onToolStart(call: ToolCall): void;
  /** A tool call finished. */
  onToolEnd(call: ToolCall, result: ToolResult): void;
  /** The model asked the user a question. */
  onAsk?(question: string, options: readonly string[]): Promise<readonly string[]>;
  /**
   * Something worth telling the user that is not part of the conversation.
   */
  onNotice?(text: string): void;
  /**
   * Ask the user to approve a tool call.
   *
   * The returned decision says what to do. A refusal is a decision, not an
   * obstacle to route around, so the agent reports it and carries on.
   */
  approve(request: ApprovalRequest): Promise<ApprovalDecision>;
}

/** Everything the agent needs. */
export interface AgentOptions {
  /** The model to talk to. */
  readonly provider: ModelProvider;
  /** The tools the model may call. */
  readonly registry: ToolRegistry;
  /** Where the session is written. */
  readonly session: SessionLog;
  /** The resolved configuration. */
  readonly config: FlowCodeConfig;
  /** The permission rules in force. */
  readonly rules: PermissionRules;
  /** The paths rules resolve against. */
  readonly permissionContext: PermissionContext;
  /** What the tools need from the host. */
  readonly toolContext: ToolContext;
  /** How the agent talks to the user. */
  readonly ui: AgentUi;
  /** The hooks to run at the points in a turn. */
  readonly hooks?: readonly HookDefinition[];
  /** Extra instructions to add to the system prompt. */
  readonly extraInstructions?: string;
  /**
   * The largest the tool schemas may be, in bytes.
   *
   * Zero means no limit.
   */
  readonly toolSchemaBudget?: number;
  /** Cancels the run. */
  readonly signal?: AbortSignal;
  /**
   * Remember a permission rule, when the user asked for it to be remembered.
   *
   * The host provides this, because only it knows where to save the rule.
   */
  readonly rememberRule?: (
    rule: string,
    bucket: "allow" | "deny",
  ) => Promise<void>;
  /** The most turns to run before stopping. */
  readonly maxTurns?: number;
}

/** Why an agent run ended. */
export type AgentStopReason =
  /** The model finished its answer. */
  | "completed"
  /** The user interrupted the run. */
  | "aborted"
  /** The turn limit was reached. */
  | "max_turns"
  /** Something went wrong. */
  | "error";

/** What an agent run produced. */
export interface AgentResult {
  /** Why the run ended. */
  readonly reason: AgentStopReason;
  /** How many turns were run. */
  readonly turns: number;
  /** The model's last text. */
  readonly text: string;
  /** The failure, when the run ended in one. */
  readonly error?: FlowError;
}
