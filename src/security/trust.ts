/**
 * Workspace trust.
 *
 * A project's own files are not data: a hook is a command, an MCP server is a
 * program, a configuration file chooses where an API key is sent. None of them
 * may be read until the user has said that they trust the directory, because
 * a checkout of somebody else's repository is exactly the thing an attacker
 * hands to a victim.
 *
 * The decision is per directory. The trusted directories are remembered in
 * `~/.flowcode/trusted.json` as a list of resolved paths, so the question is
 * asked once rather than once per session.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { flowError, type FlowError } from "../errors.js";
import { realpathBestEffort, restrictToOwner } from "../util/paths.js";
import { err, ok, type Result } from "../util/result.js";

/** The file the trusted directories are kept in. */
export const TRUST_STORE_FILE = "trusted.json";

/** The version of the trust store this build writes. */
export const TRUST_STORE_VERSION = 2;

/** The files whose contents make a directory what it is. */
const FINGERPRINTED_FILES = [
  ".flowcode/hooks.json",
  ".flowcode/mcp.json",
  ".flowcode/config.json",
  ".flowcode/agents",
  "FLOWCODE.md",
  "AGENTS.md",
];

/**
 * Hash the project's executable configuration.
 *
 * A directory is trusted for what it contained when the user said yes. If
 * a later pull changes a hook or an MCP server, the hash changes and the
 * user is asked again.
 *
 * @param cwd - The directory to fingerprint.
 */
export const fingerprintDirectory = async (cwd: string): Promise<string> => {
  const hash = createHash("sha256");
  for (const relative of FINGERPRINTED_FILES) {
    const path = join(cwd, ...relative.split("/"));
    const info = await stat(path).catch(() => undefined);
    if (info === undefined) {
      hash.update(`${relative}:missing\n`);
      continue;
    }
    if (info.isDirectory()) {
      hash.update(`${relative}:dir\n`);
      continue;
    }
    try {
      const text = await readFile(path, "utf8");
      hash.update(`${relative}:${text}\n`);
    } catch {
      hash.update(`${relative}:unreadable\n`);
    }
  }
  return hash.digest("hex");
};

/**
 * Where the trusted directories are kept.
 *
 * @param home - The user's home directory.
 */
export const trustStorePath = (home: string): string =>
  join(home, ".flowcode", TRUST_STORE_FILE);

/**
 * Whether a project's own files may be read.
 *
 * `untrusted` means the project's configuration, hooks, MCP servers and
 * sub-agents are ignored entirely.
 */
export type ProjectScope = "trusted" | "untrusted";

/**
 * The project files that need a trusted directory before they are read.
 *
 * They are listed here so that the trust question is asked only when there is
 * something to ask about.
 */
export const PROJECT_FILES: readonly string[] = [
  ".flowcode/config.json",
  ".flowcode/config.local.json",
  ".flowcode/hooks.json",
  ".flowcode/mcp.json",
  ".flowcode/agents",
  ".flowcode/rules",
  "FLOWCODE.md",
  "AGENTS.md",
];

/** The trust store, as it is written to disk. */
export interface TrustStore {
  /** The version of the format. */
  readonly version: number;
  /** The resolved paths of the trusted directories. */
  readonly directories: readonly string[];
  /**
   * The fingerprint of each trusted directory's executable configuration,
   * keyed by its resolved path.
   */
  readonly fingerprints?: Readonly<Record<string, string>>;
}

/**
 * Read the trust store.
 *
 * A store that is missing, unreadable or malformed trusts nothing. That is
 * the safe direction: a corrupt file must never widen what is allowed.
 *
 * @param home - The user's home directory.
 */
export const readTrustStore = async (home: string): Promise<TrustStore> => {
  const empty: TrustStore = { version: TRUST_STORE_VERSION, directories: [] };

  let text: string;
  try {
    text = await readFile(trustStorePath(home), "utf8");
  } catch {
    return empty;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return empty;
    }
    const record = parsed as Record<string, unknown>;
    const directories = Array.isArray(record["directories"])
      ? record["directories"].filter(
          (entry): entry is string => typeof entry === "string" && entry !== "",
        )
      : [];
    const fingerprints =
      typeof record["fingerprints"] === "object" && record["fingerprints"] !== null
        ? (record["fingerprints"] as Record<string, string>)
        : {};
    return { version: TRUST_STORE_VERSION, directories, fingerprints };
  } catch {
    return empty;
  }
};

/**
 * Write the trust store.
 *
 * @param home - The user's home directory.
 * @param store - What to write.
 */
export const writeTrustStore = async (
  home: string,
  store: TrustStore,
): Promise<Result<void, FlowError>> => {
  const path = trustStorePath(home);
  const document = {
    version: TRUST_STORE_VERSION,
    directories: [...store.directories],
    fingerprints: store.fingerprints ?? {},
  };

  try {
    await mkdir(join(home, ".flowcode"), { recursive: true, mode: 0o700 });
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    // The mode of a file is only set when it is created, so it is set again
    // for a store that was already there.
    await restrictToOwner(join(home, ".flowcode"), 0o700);
    await restrictToOwner(path, 0o600);
    return ok(undefined);
  } catch (error) {
    return err(
      flowError(
        "invalid_request",
        `The trusted directories could not be saved to '${path}'.`,
        { retryable: false, cause: error },
      ),
    );
  }
};

/**
 * Resolve a directory to the path it is known by.
 *
 * Symlinks are resolved, so a directory reached through two paths is one
 * directory and is trusted once.
 *
 * @param directory - The directory to resolve.
 */
export const resolveDirectory = async (directory: string): Promise<string> =>
  (await realpathBestEffort(directory)) ?? resolve(directory);

/** Whether two paths name the same directory. */
const samePath = (left: string, right: string): boolean => {
  const normalize = (value: string): string => {
    const trimmed = value.replace(/[/\\]+$/, "");
    return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
  };
  return normalize(left) === normalize(right);
};

/**
 * Whether a directory has been trusted.
 *
 * @param options - The directory, and where the store lives.
 */
export const isTrustedDirectory = async (options: {
  readonly home: string;
  readonly directory: string;
}): Promise<boolean> => {
  const store = await readTrustStore(options.home);
  const resolved = await resolveDirectory(options.directory);
  const entry = store.directories.find((d) => samePath(d, resolved));
  if (entry === undefined) {
    return false;
  }
  // A directory is trusted for what it contained. If its executable
  // configuration changed, trust is revoked until the user says yes again.
  const fingerprint = await fingerprintDirectory(options.directory);
  const stored = (store.fingerprints ?? {})[entry];
  if (stored !== undefined && stored !== fingerprint) {
    return false;
  }
  return true;
};

/**
 * Remember a directory as trusted.
 *
 * @param options - The directory, and where the store lives.
 */
export const trustDirectory = async (options: {
  readonly home: string;
  readonly directory: string;
}): Promise<Result<void, FlowError>> => {
  const resolved = await resolveDirectory(options.directory);
  const store = await readTrustStore(options.home);

  if (store.directories.some((entry) => samePath(entry, resolved))) {
    return ok(undefined);
  }

  const fingerprint = await fingerprintDirectory(options.directory);

  return writeTrustStore(options.home, {
    version: TRUST_STORE_VERSION,
    directories: [...store.directories, resolved],
    fingerprints: { ...(store.fingerprints ?? {}), [resolved]: fingerprint },
  });
};

/**
 * The project files that are present in a directory.
 *
 * @param cwd - The directory to look in.
 */
export const listProjectFiles = async (cwd: string): Promise<string[]> => {
  const found: string[] = [];

  for (const relative of PROJECT_FILES) {
    const path = join(cwd, ...relative.split("/"));
    const info = await stat(path).catch(() => undefined);
    if (info !== undefined) {
      found.push(relative);
    }
  }

  return found;
};

/** What the trust decision was. */
export interface TrustDecision {
  /** Whether the project's own files may be read. */
  readonly trusted: boolean;
  /** The directory the decision was made about. */
  readonly directory: string;
  /** Why the directory was not trusted, when it was not. */
  readonly reason?: string;
  /** The project files that were ignored, when the directory was not trusted. */
  readonly ignored?: readonly string[];
}

/**
 * The question the user is asked about a directory.
 *
 * @param directory - The directory in question.
 */
export const trustQuestion = (directory: string): string =>
  `This directory has .flowcode files, which Flow Code reads as configuration, hooks, MCP servers and sub-agents — they can run commands on your machine. Trust '${directory}'?`;

/**
 * Work out whether a directory may be used.
 *
 * The order is deliberate: an explicit answer wins, then the store, then the
 * question. With no way to ask, the answer is no.
 *
 * @param options - The directory, the store, and how to ask.
 */
export const resolveTrust = async (options: {
  readonly home: string;
  readonly cwd: string;
  /** An answer that has already been given. */
  readonly trusted?: boolean;
  /** Asks the user. Without it, the directory is not trusted. */
  readonly confirm?: (question: string) => Promise<boolean>;
}): Promise<TrustDecision> => {
  const directory = await resolveDirectory(options.cwd);

  if (options.trusted !== undefined) {
    return options.trusted
      ? { trusted: true, directory }
      : {
          trusted: false,
          directory,
          reason: "This directory is not trusted.",
        };
  }

  if (await isTrustedDirectory({ home: options.home, directory })) {
    return { trusted: true, directory };
  }

  if (options.confirm === undefined) {
    return {
      trusted: false,
      directory,
      reason: "This directory is not trusted.",
    };
  }

  const answer = await options.confirm(trustQuestion(directory));
  if (!answer) {
    return {
      trusted: false,
      directory,
      reason: "This directory was not trusted.",
    };
  }

  const saved = await trustDirectory({ home: options.home, directory });
  if (!saved.ok) {
    return {
      trusted: false,
      directory,
      reason: "This directory could not be remembered as trusted.",
    };
  }

  return { trusted: true, directory };
};

/**
 * Work out whether a directory may be used, asking about its project files.
 *
 * A directory with no project files has nothing to ask about, so it is used
 * without a question.
 *
 * @param options - The directory, the store, and how to ask.
 */
export const resolveWorkspaceTrust = async (options: {
  readonly home: string;
  readonly cwd: string;
  /** An answer that has already been given. */
  readonly trusted?: boolean;
  /** Asks the user. Without it, the directory is not trusted. */
  readonly confirm?: (question: string) => Promise<boolean>;
}): Promise<TrustDecision> => {
  const files = await listProjectFiles(options.cwd);

  if (files.length === 0) {
    return { trusted: true, directory: await resolveDirectory(options.cwd) };
  }

  const decision = await resolveTrust(options);
  return decision.trusted ? decision : { ...decision, ignored: files };
};
