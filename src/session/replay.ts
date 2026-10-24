/**
 * Replaying a session log.
 *
 * The model view of a session is always derived from the log, never kept
 * alongside it. That is what makes resume, fork and compaction consistent
 * with each other.
 */
import type { FlowError } from "../errors.js";
import { buildSummaryMessage } from "../context/compactor.js";
import type { ChatMessage, ToolCall } from "../providers/types.js";
import { err, ok, type Result } from "../util/result.js";
import { readSessionFile, writeSessionFile } from "./log.js";
import type { SessionEvent, SessionHeader } from "./types.js";

/** The message used when a tool call's outcome is not known. */
export const UNKNOWN_OUTCOME_TEXT =
  "This tool call did not finish, so its outcome is unknown.";

/**
 * Derive the model messages from a session's events.
 *
 * A tool call with no result — because the session was interrupted — becomes
 * an explicit "unknown" result rather than being silently dropped. The model
 * is told the outcome is unknown instead of being shown a false success.
 *
 * @param events - The session's events.
 */
export const deriveMessages = (events: readonly SessionEvent[]): ChatMessage[] => {
  const answered = new Set<string>();
  for (const event of events) {
    if (event.type === "tool.result") {
      answered.add(event.data.id);
    }
  }

  const messages: ChatMessage[] = [];

  for (const event of events) {
    switch (event.type) {
      case "user.message":
        if (typeof event.data?.text === "string") {
          messages.push({ role: "user", content: event.data.text });
        }
        break;

      case "assistant.message": {
        const text = typeof event.data?.text === "string" ? event.data.text : "";
        const toolCalls = Array.isArray(event.data?.toolCalls)
          ? (event.data.toolCalls as ToolCall[])
          : [];
        messages.push({
          role: "assistant",
          content: text,
          ...(toolCalls.length === 0 ? {} : { toolCalls }),
        });

        for (const call of toolCalls) {
          if (answered.has(call.id)) {
            continue;
          }
          messages.push({
            role: "tool",
            content: UNKNOWN_OUTCOME_TEXT,
            toolCallId: call.id,
            name: call.name,
          });
        }
        break;
      }

      case "tool.result":
        if (typeof event.data?.id === "string") {
          messages.push({
            role: "tool",
            content: typeof event.data.output === "string" ? event.data.output : "",
            toolCallId: event.data.id,
            ...(typeof (event.data as unknown as { name?: unknown }).name === "string"
              ? { name: (event.data as unknown as { name: string }).name }
              : {}),
          });
        }
        break;

      case "compaction.end": {
        // A compaction that dropped nothing must not wipe the conversation:
        // the summary replaces everything before it, and an empty summary
        // would leave the model with nothing.
        const summary = event.data.summary;
        if (typeof summary !== "string" || summary.trim() === "") {
          break;
        }
        messages.length = 0;
        messages.push(buildSummaryMessage(summary));
        break;
      }

      default:
        break;
    }
  }

  return messages;
};

/**
 * The tool calls a session made, in order.
 *
 * @param events - The session's events.
 */
export const toolCallsIn = (events: readonly SessionEvent[]): ToolCall[] => {
  const calls: ToolCall[] = [];
  for (const event of events) {
    if (event.type === "tool.call") {
      calls.push({ id: event.data.id, name: event.data.name, args: event.data.args });
    }
  }
  return calls;
};

/**
 * The files a session read, most recently read first.
 *
 * After a compaction the model can be pointed back at these, so it does not
 * have to rediscover what it already looked at.
 *
 * @param events - The session's events.
 * @param limit - How many paths to return.
 */
export const filesReadIn = (
  events: readonly SessionEvent[],
  limit = 5,
): readonly string[] => {
  const paths: string[] = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "file.read" && !paths.includes(event.data.path)) {
      paths.push(event.data.path);
      if (paths.length >= limit) {
        break;
      }
    }
  }
  return paths;
};

/**
 * Copy a session up to a boundary, into a new log.
 *
 * The prefix must end outside an open turn, so the child never starts in the
 * middle of a tool call.
 *
 * @param sourcePath - The session to copy.
 * @param targetPath - Where the child log goes.
 * @param options - How many events to copy, and what to call the child.
 */
export const forkSession = async (
  sourcePath: string,
  targetPath: string,
  options: {
    readonly eventCount?: number;
    readonly sessionId: string;
    readonly model: string;
    readonly provider: string;
  },
): Promise<Result<{ readonly header: SessionHeader; readonly events: readonly SessionEvent[] }, FlowError>> => {
  const loaded = await readSessionFile(sourcePath);
  if (!loaded.ok) {
    return loaded;
  }

  // The count is of the events after the header, which is always first.
  const inherited = options.eventCount ?? loaded.value.events.length - 1;
  const prefix = loaded.value.events.slice(0, 1 + inherited);

  // The copy must not end in the middle of a turn.
  const endsInOpenTurn = (() => {
    let open = false;
    for (const event of prefix) {
      if (event.type === "turn.start") {
        open = true;
      }
      if (event.type === "turn.end") {
        open = false;
      }
    }
    return open;
  })();

  if (endsInOpenTurn) {
    return err({
      code: "invalid_request",
      message: "A session cannot be forked in the middle of a turn.",
      retryable: false,
      remediation: "Fork at a point where a turn has finished.",
    });
  }

  const header: SessionHeader = {
    ...loaded.value.header,
    id: options.sessionId,
    startedAt: Date.now(),
    provider: options.provider,
    model: options.model,
    parentSession: loaded.value.header.id,
    inheritedEventCount: prefix.length - 1,
  };

  const events: SessionEvent[] = [
    { type: "session.start", data: header },
    ...prefix.filter((event) => event.type !== "session.start"),
  ];

  await writeSessionFile(targetPath, header, events);
  return ok({ header, events });
};
