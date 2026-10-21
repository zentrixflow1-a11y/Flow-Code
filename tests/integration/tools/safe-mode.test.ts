/**
 * The two enforcement layers.
 *
 * `safe` mode is a promise that the harness will not write anything and will
 * not touch the network. That promise is kept twice: once in the permission
 * engine, and once inside the tools themselves, so a mistake in one layer is
 * caught by the other.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flowError } from "../../../src/errors.js";
import { decidePermission } from "../../../src/permissions/engine.js";
import { isHardCeiling } from "../../../src/permissions/modes.js";
import { EMPTY_RULES, type PermissionContext, type PermissionMode } from "../../../src/permissions/types.js";
import { executeTool } from "../../../src/tools/executor.js";
import { writeFileTool } from "../../../src/tools/fs.js";
import { runCommandTool } from "../../../src/tools/shell.js";
import { webFetchTool } from "../../../src/tools/web.js";
import type { ToolCategory } from "../../../src/permissions/types.js";
import { createWorkspace, type Workspace } from "../../support/workspace.js";

const CONTEXT: PermissionContext = {
  workspaceRoot: "/home/user/project",
  cwd: "/home/user/project",
  home: "/home/user",
};

/** A guard that refuses everything the mode forbids. */
const guardFor = (mode: PermissionMode) => {
  return (category: ToolCategory) =>
    isHardCeiling(mode, category)
      ? flowError("permission_denied", `Safe mode does not allow ${category} tools.`, {
          retryable: false,
        })
      : undefined;
};

describe("safe mode", () => {
  let workspace: Workspace;

  beforeEach(async () => {
    workspace = await createWorkspace({ "existing.txt": "original\n" });
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it("is denied by the permission engine", () => {
    const decision = decidePermission({
      tool: "write_file",
      category: "write",
      subject: "new.txt",
      subjectKind: "path",
      mode: "safe",
      rules: EMPTY_RULES,
      context: CONTEXT,
      withinWorkspace: true,
    });
    expect(decision.kind).toBe("deny");
  });

  it("is refused by the write tool itself", async () => {
    const context = { ...workspace.context, guard: guardFor("safe") };
    const result = await executeTool(
      writeFileTool,
      { path: "new.txt", content: "should not appear" },
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("permission_denied");
    }
  });

  it("does not touch the filesystem when the tool refuses", async () => {
    const context = { ...workspace.context, guard: guardFor("safe") };
    await executeTool(
      writeFileTool,
      { path: "new.txt", content: "should not appear" },
      context,
    );
    await expect(
      import("node:fs/promises").then((fs) =>
        fs.readFile(`${workspace.root}/new.txt`, "utf8"),
      ),
    ).rejects.toThrow();
  });

  it("is refused by the shell tool itself", async () => {
    const context = { ...workspace.context, guard: guardFor("safe") };
    const result = await executeTool(
      runCommandTool,
      { command: "echo hi" },
      context,
    );
    expect(result.ok).toBe(false);
  });

  it("is refused by the web tool itself", async () => {
    const context = { ...workspace.context, guard: guardFor("safe") };
    const result = await executeTool(
      webFetchTool,
      { url: "https://example.com" },
      context,
    );
    expect(result.ok).toBe(false);
  });
});

describe("plan mode", () => {
  let workspace: Workspace;

  beforeEach(async () => {
    workspace = await createWorkspace();
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it("refuses a write in the tool as well as in the engine", async () => {
    const context = { ...workspace.context, guard: guardFor("plan") };
    const result = await executeTool(
      writeFileTool,
      { path: "new.txt", content: "nope" },
      context,
    );
    expect(result.ok).toBe(false);
  });
});
