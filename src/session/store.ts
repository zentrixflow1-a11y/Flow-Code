/**
 * Where sessions live, and how they are found.
 */
import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { toPosix } from "../util/paths.js";
import type { SessionHeader } from "./types.js";

/** The directory sessions are stored in, under the user's home. */
export const sessionsRoot = (home: string): string => join(home, ".flowcode", "sessions");

/**
 * A stable, readable name for a project directory.
 *
 * Two checkouts of the same project on different machines get different
 * names, which is what keeps their sessions apart.
 *
 * @param cwd - The project's directory.
 */
export const projectSlug = (cwd: string): string => {
  const absolute = resolve(cwd);
  const name =
    basename(absolute)
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "project";
  const hash = createHash("sha256").update(toPosix(absolute)).digest("hex").slice(0, 8);
  return `${name}-${hash}`;
};

/** A fresh session identifier. */
export const createSessionId = (now = new Date()): string => {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
};

/** What is known about a session without reading all of it. */
export interface SessionSummary {
  /** The session's identifier. */
  readonly id: string;
  /** The directory the session ran in. */
  readonly cwd: string;
  /** When the session started. */
  readonly startedAt: number;
  /** The provider the session used. */
  readonly provider: string;
  /** The model the session used. */
  readonly model: string;
  /** Where the log lives. */
  readonly path: string;
}

/**
 * List the sessions recorded for a project, newest first.
 *
 * @param root - The sessions root.
 * @param slug - The project's slug.
 */
export const listSessions = async (
  root: string,
  slug: string,
): Promise<SessionSummary[]> => {
  const directory = join(root, slug);

  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) {
      continue;
    }
    const path = join(directory, entry);
    try {
      const text = await readFile(path, "utf8");
      const firstLine = text.split("\n", 1)[0] ?? "";
      const header = JSON.parse(firstLine) as SessionHeader;
      if (header.type !== "session") {
        continue;
      }
      summaries.push({
        id: header.id,
        cwd: header.cwd,
        startedAt: header.startedAt,
        provider: header.provider,
        model: header.model,
        path,
      });
    } catch {
      // A log that will not parse is not worth listing.
    }
  }

  return summaries.sort((left, right) => right.startedAt - left.startedAt);
};

/** Whether a path exists. */
export const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );
