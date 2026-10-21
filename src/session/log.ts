/**
 * The append-only session log.
 *
 * Every event is one line of JSON. The log is never rewritten, so a crash
 * can only ever lose the last line — and a lost line is detected and
 * discarded when the log is read back.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { flowError, type FlowError } from "../errors.js";
import { err, ok, type Result } from "../util/result.js";
import {
  SESSION_FORMAT_VERSION,
  type SessionEvent,
  type SessionHeader,
  type StoredEvent,
} from "./types.js";

/** A session log that is open for writing. */
export class SessionLog {
  readonly #path: string;
  readonly #header: SessionHeader;
  readonly #events: SessionEvent[] = [];
  #seq = 0;
  #closed = false;
  #queue: Promise<void> = Promise.resolve();

  private constructor(path: string, header: SessionHeader) {
    this.#path = path;
    this.#header = header;
  }

  /**
   * Create a new session log and write its header.
   *
   * @param path - Where the log lives.
   * @param header - The header to write.
   */
  static async create(
    path: string,
    header: Omit<SessionHeader, "type" | "version">,
  ): Promise<SessionLog> {
    const full: SessionHeader = {
      ...header,
      type: "session",
      version: SESSION_FORMAT_VERSION,
    };

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(full)}\n`, "utf8");

    const log = new SessionLog(path, full);
    log.#events.push({ type: "session.start", data: full });
    log.#seq = 1;
    return log;
  }

  /**
   * Open an existing session log for appending.
   *
   * @param path - Where the log lives.
   */
  static async open(path: string): Promise<Result<SessionLog, FlowError>> {
    const read = await readSessionFile(path);
    if (!read.ok) {
      return read;
    }

    const log = new SessionLog(path, read.value.header);
    log.#events.push(...read.value.events);
    log.#seq = read.value.events.length;
    return ok(log);
  }

  /** Where the log lives. */
  get path(): string {
    return this.#path;
  }

  /** The session's header. */
  get header(): SessionHeader {
    return this.#header;
  }

  /** The events written so far. */
  get events(): readonly SessionEvent[] {
    return this.#events;
  }

  /**
   * Append an event.
   *
   * Writes are queued so that concurrent appends cannot interleave.
   */
  append(event: SessionEvent): Promise<void> {
    if (this.#closed) {
      return Promise.resolve();
    }

    const stored: StoredEvent = {
      type: event.type,
      seq: this.#seq,
      time: Date.now(),
      data: event.data,
    };
    this.#seq += 1;
    this.#events.push(event);

    this.#queue = this.#queue.then(async () => {
      await appendFile(this.#path, `${JSON.stringify(stored)}\n`, "utf8");
    });

    return this.#queue;
  }

  /** Wait for every queued write to finish. */
  async flush(): Promise<void> {
    await this.#queue;
  }

  /** Close the log. */
  async close(): Promise<void> {
    await this.flush();
    this.#closed = true;
  }
}

/** A session log read back from disk. */
export interface LoadedSession {
  /** The session's header. */
  readonly header: SessionHeader;
  /** The events, with any torn trailing line discarded. */
  readonly events: readonly SessionEvent[];
  /** How many lines could not be read. */
  readonly skippedLines: number;
}

/**
 * Read a session log from disk.
 *
 * A line that will not parse is skipped: it was either written by an
 * interrupted write or by a newer version of Flow Code.
 */
export const readSessionFile = async (
  path: string,
): Promise<Result<LoadedSession, FlowError>> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    return err(
      flowError("not_found", `The session log '${path}' could not be read.`, {
        retryable: false,
        cause: error,
      }),
    );
  }

  const lines = text.split("\n").filter((line) => line.trim() !== "");
  let skippedLines = 0;
  let header: SessionHeader | undefined;
  const events: SessionEvent[] = [];

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      skippedLines += 1;
      continue;
    }

    if (typeof parsed !== "object" || parsed === null) {
      skippedLines += 1;
      continue;
    }

    const record = parsed as Record<string, unknown>;

    if (header === undefined && record["type"] === "session") {
      header = record as unknown as SessionHeader;
      events.push({ type: "session.start", data: header });
      continue;
    }

    const type = record["type"];
    const data = record["data"];
    if (typeof type !== "string" || data === undefined) {
      skippedLines += 1;
      continue;
    }

    const event = { type, data } as unknown as SessionEvent;
    events.push(event);
  }

  if (header === undefined) {
    return err(
      flowError("malformed_response", `The session log '${path}' has no header.`, {
        retryable: false,
        remediation: "The log is not a Flow Code session, or it was truncated badly.",
      }),
    );
  }

  return ok({ header, events, skippedLines });
};

/**
 * Write a session log from scratch, replacing anything already there.
 *
 * @param path - Where the log lives.
 * @param header - The header to write.
 * @param events - The events to write, after the header.
 */
export const writeSessionFile = async (
  path: string,
  header: SessionHeader,
  events: readonly SessionEvent[],
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });

  const lines: string[] = [JSON.stringify(header)];
  events.forEach((event, index) => {
    if (event.type === "session.start") {
      return;
    }
    lines.push(
      JSON.stringify({
        type: event.type,
        seq: index,
        time: Date.now(),
        data: event.data,
      } satisfies StoredEvent),
    );
  });

  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
};

/** The default place a session log lives. */
export const sessionLogPath = (
  sessionsRoot: string,
  projectSlug: string,
  sessionId: string,
): string => join(sessionsRoot, projectSlug, `${sessionId}.jsonl`);
