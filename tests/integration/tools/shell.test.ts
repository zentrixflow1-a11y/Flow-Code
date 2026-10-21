/**
 * The shell tool, against a real process.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { executeTool } from "../../../src/tools/executor.js";
import { runCommandTool, readCommandOutputTool, shellFor, stopCommandTool } from "../../../src/tools/shell.js";
import { createWorkspace, type Workspace } from "../../support/workspace.js";

describe("the shell tool", () => {
  let workspace: Workspace;

  beforeAll(async () => {
    // The first shell launch on a machine can take several seconds, so the
    // shell is warmed up before the timed assertions run.
    const warmup = await createWorkspace();
    try {
      await executeTool(
        runCommandTool,
        { command: "echo warmup" },
        warmup.context,
      );
    } finally {
      await warmup.cleanup();
    }
  }, 60_000);

  beforeEach(async () => {
    workspace = await createWorkspace({ "hello.txt": "hello\n" });
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it("runs a command and reports its output", async () => {
    const result = await executeTool(
      runCommandTool,
      { command: "echo hello-from-flowcode" },
      workspace.context,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("hello-from-flowcode");
      expect(result.output).toContain("exit code 0");
    }
  }, 30_000);

  it("reports a non-zero exit code", async () => {
    const result = await executeTool(
      runCommandTool,
      { command: "exit 3" },
      workspace.context,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("exit code 3");
    }
  });

  it("runs in the requested directory", async () => {
    await workspace.write("sub/marker.txt", "x");
    const result = await executeTool(
      runCommandTool,
      { command: "ls", cwd: "sub" },
      workspace.context,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("marker.txt");
    }
  });

  it("refuses to run outside the workspace", async () => {
    const result = await executeTool(
      runCommandTool,
      { command: "echo hi", cwd: ".." },
      workspace.context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("permission_denied");
    }
  });

  it("refuses a command that names a file that holds a credential", async () => {
    await workspace.write(".env", "SECRET_TOKEN=hunter2\n");

    const result = await executeTool(
      runCommandTool,
      { command: "cat .env" },
      workspace.context,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("permission_denied");
      expect(result.error.message).toContain("credential");
    }
    if (result.ok) {
      expect(result.output).not.toContain("hunter2");
    }
  });

  it("refuses a command that hides the credential behind a separator", async () => {
    await workspace.write(".env", "SECRET_TOKEN=hunter2\n");

    for (const command of [
      "cat .env;id",
      "cat .env&&id",
      "cat .env|id",
      "cat .env>/tmp/out",
    ]) {
      const result = await executeTool(
        runCommandTool,
        { command },
        workspace.context,
      );

      expect(result.ok, command).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("permission_denied");
      }
    }
  });

  it("refuses a command that hides the credential behind a wildcard", async () => {
    await workspace.write(".env", "SECRET_TOKEN=hunter2\n");

    for (const command of ["cat .e*", "cat .env*", "cat $HOME/.e*"]) {
      const result = await executeTool(
        runCommandTool,
        { command },
        workspace.context,
      );

      expect(result.ok, command).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("permission_denied");
      }
    }
  });

  it("stops a command that runs too long", async () => {
    const result = await executeTool(
      runCommandTool,
      { command: "sleep 30", timeout_ms: 600 },
      workspace.context,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("timed out");
    }
  }, 20_000);

  it("runs a command in the background and reports its output", async () => {
    const result = await executeTool(
      runCommandTool,
      { command: "echo backgrounded", background: true },
      workspace.context,
    );
    expect(result.ok).toBe(true);

    if (result.ok) {
      const data = result.data as { id: string };
      expect(result.output).toContain("Started in the background");

      // The shell may take a while to start, so the output is polled for
      // rather than read once.
      let output = "";
      for (let attempt = 0; attempt < 40 && !output.includes("backgrounded"); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const read = await executeTool(
          readCommandOutputTool,
          { id: data.id },
          workspace.context,
        );
        if (read.ok) {
          output = read.output;
        }
      }
      expect(output).toContain("backgrounded");

      await executeTool(stopCommandTool, { id: data.id }, workspace.context);
    }
  }, 60_000);
});

describe("shellFor", () => {
  it("uses PowerShell on Windows", () => {
    expect(shellFor("win32").command).toContain("powershell");
  });

  it("uses a POSIX shell elsewhere", () => {
    expect(shellFor("linux").command).toBe("/bin/sh");
    expect(shellFor("darwin").command).toBe("/bin/sh");
  });
});
