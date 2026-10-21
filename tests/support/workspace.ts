/**
 * Test support for a throwaway workspace on disk.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRedactor } from "../../src/util/redact.js";
import type { ToolContext } from "../../src/tools/types.js";

/** A temporary workspace. */
export interface Workspace {
  /** The workspace root. */
  readonly root: string;
  /** A tool context pointed at the workspace. */
  readonly context: ToolContext;
  /** Write a file inside the workspace and return its absolute path. */
  write: (relativePath: string, content: string) => Promise<string>;
  /** Remove the workspace. */
  cleanup: () => Promise<void>;
}

/**
 * Create a temporary workspace holding the given files.
 *
 * @param files - Paths relative to the workspace root, and their contents.
 */
export const createWorkspace = async (
  files: Readonly<Record<string, string>> = {},
): Promise<Workspace> => {
  const root = await mkdtemp(join(tmpdir(), "flowcode-workspace-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }

  const context: ToolContext = {
    cwd: root,
    workspaceRoot: root,
    additionalDirectories: [],
    env: { ...process.env },
    redact: createRedactor(),
    platform: process.platform,
    caseInsensitivePaths: process.platform === "win32",
  };

  return {
    root,
    context,
    write: async (relativePath, content) => {
      const path = join(root, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
      return path;
    },
    cleanup: async () => {
      // A child process may still hold the directory open briefly, so the
      // removal is retried before it is given up on.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          await rm(root, { recursive: true, force: true, maxRetries: 3 });
          return;
        } catch (error) {
          if (attempt === 9) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    },
  };
};
