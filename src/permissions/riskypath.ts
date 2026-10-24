/**
 * Whether a read-only command references a path that is risky.
 *
 * A read-only command is auto-approved, so any path it names has to be
 * safe: not a credential file, not outside the workspace, and not reached
 * through a symlink. The check resolves every path-like argument with
 * `realpath` and compares the result against the workspace roots.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { isInside, isSensitivePath } from "../util/paths.js";
import { commandWords } from "../util/text.js";

/** What the check needs. */
export interface RiskyPathContext {
  readonly cwd: string;
  readonly home: string;
  readonly roots: readonly string[];
  readonly caseInsensitive: boolean;
  readonly runCwd?: string;
}

/**
 * Whether a command references a path that is risky.
 *
 * @param command - The command line.
 * @param context - Where it runs and what the roots are.
 */
export const commandReferencesRiskyPath = (
  command: string,
  context: RiskyPathContext,
): boolean => {
  const effectiveCwd = context.runCwd ?? context.cwd;
  const resolvedRoots = context.roots.map((root) => {
    try {
      return realpathSync(root);
    } catch {
      return root;
    }
  });

  for (const word of commandWords(command)) {
    if (word === "") continue;
    if (word.startsWith("-")) continue;

    let candidate = word.replace(/^['"]|['"]$/g, "");
    if (candidate === "") continue;

    // Expand ~ to home.
    if (candidate === "~") {
      candidate = context.home;
    } else if (candidate.startsWith("~/")) {
      candidate = join(context.home, candidate.slice(2));
    }

    // Relative paths are resolved against the run_command cwd, which is
    // itself resolved inside the workspace.
    const absolute = isAbsolute(candidate)
      ? candidate
      : join(effectiveCwd, candidate);

    let resolved: string;
    try {
      resolved = realpathSync(absolute);
    } catch {
      // The file does not exist; nothing to resolve.
      continue;
    }

    if (isSensitivePath(resolved)) {
      return true;
    }

    const inside = resolvedRoots.some((root) =>
      isInside(resolved, root, context.caseInsensitive),
    );
    if (!inside) {
      return true;
    }
  }

  return false;
};
