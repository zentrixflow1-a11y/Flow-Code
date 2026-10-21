/**
 * Path resolution and confinement.
 *
 * Every filesystem tool goes through {@link resolveWithinRoots}. The check
 * covers both the path the model asked for and the path it actually resolves
 * to, so a symlink inside the workspace cannot be used to reach outside it.
 */
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { flowError, type FlowError } from "../errors.js";
import { err, ok, type Result } from "./result.js";

/** Where a path may be read from or written to. */
export interface PathPolicy {
  /** The allowed roots: the workspace plus any additional directories. */
  readonly roots: readonly string[];
  /** The directory relative paths are resolved against. */
  readonly cwd: string;
  /** Whether path comparison ignores case, as on Windows. */
  readonly caseInsensitive?: boolean;
}

/** Convert a path to forward slashes, so rules read the same everywhere. */
export const toPosix = (path: string): string => path.replace(/\\/g, "/");

/**
 * Whether a path lies inside a root.
 *
 * @param child - The path to test.
 * @param root - The root it must be inside.
 * @param caseInsensitive - Whether to ignore case when comparing.
 */
export const isInside = (
  child: string,
  root: string,
  caseInsensitive = false,
): boolean => {
  const normalizeForCompare = (value: string): string => {
    const posix = toPosix(normalize(value));
    return caseInsensitive ? posix.toLowerCase() : posix;
  };

  const target = normalizeForCompare(child);
  const base = normalizeForCompare(root);

  if (target === base) {
    return true;
  }
  return target.startsWith(base.endsWith("/") ? base : `${base}/`);
};

/**
 * Resolve a path as far as the filesystem allows.
 *
 * A path that does not exist yet — a file about to be created — is resolved
 * through its nearest existing ancestor, so the symlink check still applies
 * to the directory that will hold it.
 */
export const realpathBestEffort = async (
  path: string,
): Promise<string | undefined> => {
  try {
    return await realpath(path);
  } catch {
    // The path may simply not exist yet.
  }

  const parent = dirname(path);
  if (parent === path) {
    return undefined;
  }

  const resolvedParent = await realpathBestEffort(parent);
  if (resolvedParent === undefined) {
    return undefined;
  }

  return join(resolvedParent, basename(path));
};

/**
 * Resolve a path and confirm it stays inside the allowed roots.
 *
 * @param candidate - The path the model asked for.
 * @param policy - The allowed roots.
 */
export const resolveWithinRoots = async (
  candidate: string,
  policy: PathPolicy,
): Promise<Result<string, FlowError>> => {
  const absolute = isAbsolute(candidate)
    ? normalize(candidate)
    : resolve(policy.cwd, candidate);
  const requested = toPosix(absolute);

  const resolved = await realpathBestEffort(absolute);
  if (resolved === undefined) {
    return err(
      flowError("permission_denied", `The path '${candidate}' could not be resolved.`, {
        retryable: false,
        remediation:
          "The path may contain a symlink loop, or a directory on the way to it may not be readable.",
      }),
    );
  }

  const target = toPosix(resolved);
  const caseInsensitive = policy.caseInsensitive ?? false;

  const allowed = policy.roots.some(
    (root) =>
      isInside(target, root, caseInsensitive) &&
      isInside(requested, root, caseInsensitive),
  );

  if (!allowed) {
    return err(
      flowError("permission_denied", `The path '${candidate}' is outside the workspace.`, {
        retryable: false,
        remediation:
          "Only the workspace and its additional directories can be accessed. Add a directory with the `additionalDirectories` permission if this is intended.",
      }),
    );
  }

  return ok(target);
};

/** Directory names that are never written to. */
export const PROTECTED_DIRECTORIES: readonly string[] = [
  ".git",
  ".flowcode",
  ".ssh",
  ".aws",
  ".gnupg",
  ".azure",
  ".kube",
  ".docker",
];

/** File name patterns that are never written to. */
export const PROTECTED_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa/i,
  /^id_ecdsa/i,
  /^id_ed25519/i,
  /\.p12$/i,
  /\.pfx$/i,
];

/**
 * Whether a path is protected from writes.
 *
 * The check is on the path's own segments, so a directory called `.git`
 * anywhere on the path is enough to protect it.
 *
 * @param path - The path to check.
 */
export const isProtectedPath = (path: string): boolean => {
  const posix = toPosix(path);
  const segments = posix.split("/").filter((segment) => segment !== "");

  for (const segment of segments) {
    if (PROTECTED_DIRECTORIES.includes(segment)) {
      return true;
    }
  }

  const name = basename(posix);
  return PROTECTED_FILE_PATTERNS.some((pattern) => pattern.test(name));
};
