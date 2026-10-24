/**
 * The append-only session log.
 *
 * Every event is one line of JSON. The log is never rewritten, so a crash
 * can only ever lose the last line — and a lost line is detected and
 * discarded when the log is read back.
 *
 * A session log holds everything that happened, which means it may hold
 * something that should not be kept. Two things protect it: the file is
 * written for its owner alone, and everything written into it is redacted
 * first.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { flowError, type FlowError } from "../errors.js";
import { restrictToOwner } from "../util/paths.js";
import { err, ok, type Result } from "../util/result.js";
import { identityRedactor, type Redactor } from "../util/redact.js";
import {
  SESSION_FORMAT_VERSION,
  type SessionEvent,
  type SessionHeader,
  type StoredEvent,
} from "./types.js";

/** The mode a session log is created with: its owner, and nobody else. */
export const SESSION_LOG_MODE = 0o600;

/** The mode a session log's directory is created with. */
export const SESSION_DIRECTORY_MODE = 0o700;

/** How a session log is protected. */
export interface SessionLogOptions {
  /**
   * Removes secrets from what is written.
   *
   * Without one, the log keeps whatever it is given.
   */
  readonly redact?: Redactor;
}

/** A session log that is open for writing. */
export class SessionLog {
  readonly #path: string;
  readonly #header: SessionHeader;
  readonly #redact: Redactor;
  readonly #events: SessionEvent[] = [];
  #seq = 0;
  #closed = false;
  #queue: Promise<void> = Promise.resolve();
  #failedWrites = 0;

  private constructor(
    path: string,
    header: SessionHeader,
    redact: Redactor,
  ) {
    this.#path = path;
    this.#header = header;
    this.#redact = redact;
  }

  /** How many writes failed since the log was opened. */
  get failedWrites(): number {
    return this.#failedWrites;
  }

  /**
   * Create a new session log and write its header.
   *
   * @param path - Where the log lives.
   * @param header - The header to write.
   * @param options - How the log is protected.
   */
  static async create(
    path: string,
    header: Omit<SessionHeader, "type" | "version">,
    options: SessionLogOptions = {},
  ): Promise<SessionLog> {
    const full: SessionHeader = {
      ...header,
      type: "session",
      version: SESSION_FORMAT_VERSION,
    };

    await mkdir(dirname(path), {
      recursive: true,
      mode: SESSION_DIRECTORY_MODE,
    });
    await writeFile(path, `${JSON.stringify(full)}\n`, {
      encoding: "utf8",
      mode: SESSION_LOG_MODE,
    });
    // The mode of a file is only set when it is created, so it is set again
    // for a log that was already there.
    await restrictToOwner(dirname(path), SESSION_DIRECTORY_MODE);
    await restrictToOwner(path, SESSION_LOG_MODE);

    const log = new SessionLog(path, full, options.redact ?? identityRedactor);
    log.#events.push({ type: "session.start", data: full });
    log.#seq = 1;
    return log;
  }

  /**
   * Open an existing session log for appending.
   *
   * @param path - Where the log lives.
   * @param options - How the log is protected from now on.
   */
  static async open(
    path: string,
    options: SessionLogOptions = {},
  ): Promise<Result<SessionLog, FlowError>> {
    const read = await readSessionFile(path);
    if (!read.ok) {
      return read;
    }

    const log = new SessionLog(
      path,
      read.value.header,
      options.redact ?? identityRedactor,
    );
    log.#events.push(...read.value.events);
    log.#seq = read.value.events.length;

    // A log written by an earlier build may have a wider mode. It is
    // narrowed again, so resuming a session does not leave a readable file
    // behind.
    await restrictToOwner(dirname(path), SESSION_DIRECTORY_MODE);
    await restrictToOwner(path, SESSION_LOG_MODE);

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
   * Writes are queued so that concurrent appends cannot interleave. What is
   * written is redacted first, so a secret that reached the conversation
   * does not reach the disk.
   */
  append(event: SessionEvent): Promise<void> {
    if (this.#closed) {
      return Promise.resolve();
    }

    const data = redactValue(event.data, this.#redact);
    const stored: StoredEvent = {
      type: event.type,
      seq: this.#seq,
      time: Date.now(),
      data,
    };
    this.#seq += 1;
    this.#events.push({ type: event.type, data } as SessionEvent);

    this.#queue = this.#queue.then(async () => {
      try {
        await appendFile(this.#path, `${JSON.stringify(stored)}\n`, {
          encoding: "utf8",
          mode: SESSION_LOG_MODE,
        });
      } catch {
        // A write that fails must not poison the queue: later events still
        // need to reach the disk, and the failure is counted.
        this.#failedWrites += 1;
      }
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
 * @param options - How the log is protected.
 */
export const writeSessionFile = async (
  path: string,
  header: SessionHeader,
  events: readonly SessionEvent[],
  options: SessionLogOptions = {},
): Promise<void> => {
  await mkdir(dirname(path), {
    recursive: true,
    mode: SESSION_DIRECTORY_MODE,
  });

  const redact = options.redact ?? identityRedactor;

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
        data: redactValue(event.data, redact),
      } satisfies StoredEvent),
    );
  });

  await writeFile(path, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: SESSION_LOG_MODE,
  });
  await restrictToOwner(dirname(path), SESSION_DIRECTORY_MODE);
  await restrictToOwner(path, SESSION_LOG_MODE);
};

/**
 * Redact every string in a value, however deeply it is nested.
 *
 * @param value - The value to redact.
 * @param redact - The redactor to use.
 */
export const redactValue = (value: unknown, redact: Redactor): unknown => {
  if (typeof value === "string") {
    return redact(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, redact));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactValue(entry, redact);
    }
    return out;
  }
  return value;
};

/** The default place a session log lives. */
export const sessionLogPath = (
  sessionsRoot: string,
  projectSlug: string,
  sessionId: string,
): string => join(sessionsRoot, projectSlug, `${sessionId}.jsonl`);
