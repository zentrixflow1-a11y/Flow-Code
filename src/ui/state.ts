/**
 * The terminal UI's state.
 *
 * This is a plain observable store rather than React state, for two reasons.
 * The model's text arrives far faster than a terminal can draw it, so the
 * streaming buffer is mutated in place and the view is refreshed at a fixed
 * rate. And the agent loop, which runs outside React, needs a way to push
 * updates into the interface.
 */
import type { ApprovalDecision, ApprovalRequest } from "../agent/types.js";
import type { ToolCall } from "../providers/types.js";
import type { ToolResult } from "../tools/types.js";
import type { PlanStep } from "./types.js";

/** One entry in the permanent transcript. */
export interface TranscriptItem {
  /** A stable identifier, so the transcript can be rendered incrementally. */
  readonly id: number;
  /** What kind of entry this is. */
  readonly kind: "user" | "assistant" | "tool" | "error" | "notice";
  /** The text to show. */
  readonly text: string;
  /** The tool this entry is about, when it is about a tool. */
  readonly tool?: { readonly name: string; readonly status: string };
}

/** What the status line shows. */
export interface StatusInfo {
  /** The provider in use. */
  readonly provider: string;
  /** The model in use. */
  readonly model: string;
  /** The directory the session is in. */
  readonly cwd: string;
  /** The active permission mode. */
  readonly mode: string;
  /** The estimated size of the context, in tokens. */
  readonly tokens: number;
  /** Whether the model is working. */
  readonly busy: boolean;
}

/** A permission request waiting for an answer. */
export interface PendingApproval {
  /** The request. */
  readonly request: ApprovalRequest;
  /** Answer it. */
  readonly resolve: (decision: ApprovalDecision) => void;
}

/** A question the model asked, waiting for an answer. */
export interface PendingQuestion {
  /** The question. */
  readonly question: string;
  /** The answers the user can pick from. */
  readonly options: readonly string[];
  /** Answer it. */
  readonly resolve: (answer: readonly string[]) => void;
}

/** How often the streaming region is refreshed, in milliseconds. */
const STREAM_REFRESH_MS = 50;

/**
 * The terminal UI's state.
 */
export class UiState {
  #listeners = new Set<() => void>();
  #version = 0;
  #nextId = 1;

  /** The permanent transcript. */
  readonly transcript: TranscriptItem[] = [];

  /** The text the model is producing right now. */
  streaming = "";

  /** The reasoning the model is producing right now. */
  reasoning = "";

  /** The permission request waiting for an answer. */
  approval?: PendingApproval;

  /** The question the model asked, waiting for an answer. */
  question?: PendingQuestion;

  /** The current plan. */
  plan?: readonly PlanStep[];

  /** What the status line shows. */
  status: StatusInfo = {
    provider: "",
    model: "",
    cwd: "",
    mode: "ask",
    tokens: 0,
    busy: false,
  };

  /** The tool call currently running. */
  runningTool?: { readonly name: string };

  #streamTimer: ReturnType<typeof setTimeout> | undefined;
  #streamDirty = false;

  /** Subscribe to changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** The current version, for `useSyncExternalStore`. */
  get version(): number {
    return this.#version;
  }

  /** Tell the view something changed. */
  #notify(): void {
    this.#version += 1;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  /** Add an entry to the permanent transcript. */
  push(item: Omit<TranscriptItem, "id">): void {
    this.transcript.push({ ...item, id: this.#nextId });
    this.#nextId += 1;
    this.#notify();
  }

  /** The user said something. */
  addUserMessage(text: string): void {
    this.push({ kind: "user", text });
  }

  /** The model produced some text. */
  appendStream(text: string): void {
    this.streaming += text;
    this.#scheduleStreamRefresh();
  }

  /** The model produced some reasoning. */
  appendReasoning(text: string): void {
    this.reasoning += text;
    this.#scheduleStreamRefresh();
  }

  /** Move the streamed text into the transcript. */
  commitStream(): void {
    if (this.streaming.trim() === "") {
      this.streaming = "";
      this.reasoning = "";
      this.#notify();
      return;
    }
    this.push({ kind: "assistant", text: this.streaming });
    this.streaming = "";
    this.reasoning = "";
  }

  /** Refresh the streaming region, at most every {@link STREAM_REFRESH_MS}. */
  #scheduleStreamRefresh(): void {
    if (this.#streamTimer !== undefined) {
      this.#streamDirty = true;
      return;
    }
    this.#streamTimer = setTimeout(() => {
      this.#streamTimer = undefined;
      this.#notify();
      if (this.#streamDirty) {
        this.#streamDirty = false;
        this.#scheduleStreamRefresh();
      }
    }, STREAM_REFRESH_MS);
  }

  /** A tool is about to run. */
  startTool(call: ToolCall): void {
    this.runningTool = { name: call.name };
    this.#notify();
  }

  /** A tool has finished. */
  endTool(call: ToolCall, result: ToolResult): void {
    this.runningTool = undefined;
    this.push({
      kind: "tool",
      text: result.ok ? result.output : result.error.message,
      tool: {
        name: call.name,
        status: result.ok ? "done" : "failed",
      },
    });
    this.#notify();
  }

  /** Ask the user to approve a tool call. */
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      this.approval = { request, resolve };
      this.#notify();
    });
  }

  /** Answer a pending approval request. */
  answerApproval(decision: ApprovalDecision): void {
    const pending = this.approval;
    this.approval = undefined;
    this.#notify();
    pending?.resolve(decision);
  }

  /** Put a question to the user and wait for the answer. */
  requestQuestion(
    question: string,
    options: readonly string[],
  ): Promise<readonly string[]> {
    return new Promise<readonly string[]>((resolve) => {
      this.question = { question, options, resolve };
      this.#notify();
    });
  }

  /** Answer a pending question. */
  answerQuestion(answer: string): void {
    const pending = this.question;
    this.question = undefined;
    this.#notify();
    pending?.resolve([answer]);
  }

  /** Set the plan. */
  setPlan(plan: readonly PlanStep[] | undefined): void {
    this.plan = plan;
    this.#notify();
  }

  /** Update the status line. */
  setStatus(status: Partial<StatusInfo>): void {
    this.status = { ...this.status, ...status };
    this.#notify();
  }

  /** Say something that is not part of the conversation. */
  notify(text: string): void {
    this.push({ kind: "notice", text });
  }

  /** Say something went wrong. */
  reportError(text: string): void {
    this.push({ kind: "error", text });
  }
}
