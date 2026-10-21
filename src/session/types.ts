/**
 * The session log's vocabulary.
 *
 * A session is an append-only list of events. The log is the single source of
 * truth: the model view is always *derived* from it, never mutated
 * separately, which is what makes resume, fork and compaction fall out of one
 * mechanism.
 */
import type { ToolCall } from "../providers/types.js";

/** The version of the session log format. */
export const SESSION_FORMAT_VERSION = 1;

/** Why a turn ended. */
export type TurnEndReason =
  /** The model finished its answer. */
  | "completed"
  /** The user interrupted the turn. */
  | "aborted"
  /** Something went wrong. */
  | "error"
  /** The model ran out of output tokens. */
  | "max_tokens";

/** The header written as the first line of a session log. */
export interface SessionHeader {
  /** Marks the line as the session header. */
  readonly type: "session";
  /** The format version. */
  readonly version: number;
  /** The session's identifier. */
  readonly id: string;
  /** The directory the session started in. */
  readonly cwd: string;
  /** When the session started, in epoch milliseconds. */
  readonly startedAt: number;
  /** The version of Flow Code that wrote the log. */
  readonly flowCodeVersion: string;
  /** The provider the session started with. */
  readonly provider: string;
  /** The model the session started with. */
  readonly model: string;
  /** The session this one was forked from. */
  readonly parentSession?: string;
  /** How many events were inherited from the parent. */
  readonly inheritedEventCount?: number;
}

/** One event in a session log. */
export type SessionEvent =
  /** The session header. Always the first line. */
  | { readonly type: "session.start"; readonly data: SessionHeader }
  /** Something the user said. */
  | { readonly type: "user.message"; readonly data: { readonly text: string } }
  /** Something the model said. */
  | {
      readonly type: "assistant.message";
      readonly data: {
        readonly text: string;
        readonly toolCalls: readonly ToolCall[];
      };
    }
  /** The model asked for a tool to be called. */
  | {
      readonly type: "tool.call";
      readonly data: { readonly id: string; readonly name: string; readonly args: unknown };
    }
  /** A tool finished. */
  | {
      readonly type: "tool.result";
      readonly data: {
        readonly id: string;
        readonly ok: boolean;
        readonly output: string;
        readonly error?: string;
      };
    }
  /** A turn began. */
  | { readonly type: "turn.start"; readonly data: { readonly turn: number } }
  /** A turn ended. */
  | {
      readonly type: "turn.end";
      readonly data: { readonly turn: number; readonly reason: TurnEndReason };
    }
  /** The user allowed or refused a tool call. */
  | {
      readonly type: "approval.decided";
      readonly data: { readonly tool: string; readonly decision: string };
    }
  /** The conversation was compacted. */
  | {
      readonly type: "compaction.end";
      readonly data: {
        readonly summary: string;
        readonly droppedMessages: number;
        readonly filesToReread: readonly string[];
      };
    }
  /** The provider or model changed. */
  | {
      readonly type: "model.changed";
      readonly data: { readonly provider: string; readonly model: string };
    }
  /** A file was read, so it can be read again after a compaction. */
  | {
      readonly type: "file.read";
      readonly data: { readonly path: string; readonly bytes: number };
    }
  /** Anything worth remembering that the model does not need to see. */
  | { readonly type: "note"; readonly data: { readonly text: string } }
  /** Something went wrong. */
  | { readonly type: "error"; readonly data: { readonly message: string } }
  /** The session ended. */
  | { readonly type: "session.end"; readonly data: { readonly reason: string } };

/** The event types that become messages for the model. */
export const SURFACE_EVENT_TYPES: ReadonlySet<SessionEvent["type"]> = new Set([
  "user.message",
  "assistant.message",
  "tool.result",
]);

/** Whether an event becomes a message for the model. */
export const isSurfaceEvent = (event: SessionEvent): boolean =>
  SURFACE_EVENT_TYPES.has(event.type);

/** A session event as it is stored on disk. */
export interface StoredEvent {
  /** The event's kind. */
  readonly type: SessionEvent["type"];
  /** The event's position in the log, counting from zero. */
  readonly seq: number;
  /** When the event was written, in epoch milliseconds. */
  readonly time: number;
  /** The event's payload. */
  readonly data: unknown;
}
