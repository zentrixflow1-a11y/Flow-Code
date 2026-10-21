/**
 * The filesystem tools, against a real workspace on disk.
 */
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editFileTool, listDirTool, readFileTool, writeFileTool } from "../../../src/tools/fs.js";
import { executeTool } from "../../../src/tools/executor.js";
import { createWorkspace, type Workspace } from "../../support/workspace.js";

describe("the filesystem tools", () => {
  let workspace: Workspace;

  beforeEach(async () => {
    workspace = await createWorkspace({
      "src/index.ts": "export const answer = 42;\n",
      "src/util.ts": "export const helper = () => 1;\n",
      "README.md": "# Project\n",
      "config/.env": "SECRET=1\n",
    });
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  describe("read_file", () => {
    it("reads a file with line numbers", async () => {
      const result = await executeTool(
        readFileTool,
        { path: "src/index.ts" },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toContain("export const answer = 42;");
        expect(result.output).toContain("1\t");
      }
    });

    it("reads part of a file", async () => {
      const result = await executeTool(
        readFileTool,
        { path: "src/index.ts", offset: 1, limit: 1 },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toContain("lines 1-1");
      }
    });

    it("refuses a file outside the workspace", async () => {
      const result = await executeTool(
        readFileTool,
        { path: join(workspace.root, "..", "outside.txt") },
        workspace.context,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("permission_denied");
      }
    });

    it("refuses a file that does not exist", async () => {
      const result = await executeTool(
        readFileTool,
        { path: "nope.ts" },
        workspace.context,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("not_found");
      }
    });

    it("reports invalid arguments without crashing", async () => {
      const result = await executeTool(readFileTool, { path: 42 }, workspace.context);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_request");
      }
    });
  });

  describe("write_file", () => {
    it("creates a file", async () => {
      const result = await executeTool(
        writeFileTool,
        { path: "new/file.txt", content: "hello" },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      expect(await readFile(join(workspace.root, "new/file.txt"), "utf8")).toBe("hello");
    });

    it("replaces an existing file", async () => {
      await executeTool(
        writeFileTool,
        { path: "README.md", content: "# New" },
        workspace.context,
      );
      expect(await readFile(join(workspace.root, "README.md"), "utf8")).toBe("# New");
    });

    it("refuses to write to a protected path", async () => {
      const result = await executeTool(
        writeFileTool,
        { path: "config/.env", content: "SECRET=2" },
        workspace.context,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("permission_denied");
      }
      expect(await readFile(join(workspace.root, "config/.env"), "utf8")).toBe("SECRET=1\n");
    });

    it("refuses to write inside a git directory", async () => {
      const result = await executeTool(
        writeFileTool,
        { path: ".git/config", content: "nope" },
        workspace.context,
      );
      expect(result.ok).toBe(false);
    });
  });

  describe("edit_file", () => {
    it("replaces an exact piece of text", async () => {
      const result = await executeTool(
        editFileTool,
        { path: "src/index.ts", old_text: "42", new_text: "43" },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      expect(await readFile(join(workspace.root, "src/index.ts"), "utf8")).toContain(
        "answer = 43",
      );
    });

    it("refuses to replace text that appears more than once", async () => {
      await workspace.write("dupes.txt", "one\ntwo\none\n");
      const result = await executeTool(
        editFileTool,
        { path: "dupes.txt", old_text: "one", new_text: "three" },
        workspace.context,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("appears 2 times");
        expect(result.error.remediation).toContain("unique");
      }
    });

    it("replaces every occurrence when asked to", async () => {
      await workspace.write("dupes.txt", "one\ntwo\none\n");
      const result = await executeTool(
        editFileTool,
        { path: "dupes.txt", old_text: "one", new_text: "three", replace_all: true },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      expect(await readFile(join(workspace.root, "dupes.txt"), "utf8")).toBe("three\ntwo\nthree\n");
    });

    it("reports text that is not there", async () => {
      const result = await executeTool(
        editFileTool,
        { path: "src/index.ts", old_text: "nowhere", new_text: "x" },
        workspace.context,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("not_found");
      }
    });
  });

  describe("list_dir", () => {
    it("lists a directory", async () => {
      const result = await executeTool(listDirTool, { path: "." }, workspace.context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toContain("src");
        expect(result.output).toContain("README.md");
      }
    });

    it("descends when asked", async () => {
      const result = await executeTool(
        listDirTool,
        { path: ".", depth: 2 },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toContain("index.ts");
      }
    });
  });

  describe("symlink escapes", () => {
    it("refuses to follow a symlink that points outside the workspace", async () => {      const outside = join(workspace.root, "..", `outside-${Date.now()}.txt`);
      await writeFile(outside, "secret", "utf8");
      const link = join(workspace.root, "link.txt");

      try {
        await symlink(outside, link, "file");
      } catch {
        // Creating a symlink needs a privilege Windows does not grant by
        // default. The check itself is covered by the path unit tests.
        return;
      }

      const result = await executeTool(readFileTool, { path: "link.txt" }, workspace.context);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("permission_denied");
      }
    });

    it("refuses to write through a symlink that points outside the workspace", async () => {
      const outside = join(workspace.root, "..", `outside-${Date.now()}-write.txt`);
      await writeFile(outside, "original", "utf8");
      const link = join(workspace.root, "link-write.txt");

      try {
        await symlink(outside, link, "file");
      } catch {
        return;
      }

      const result = await executeTool(
        writeFileTool,
        { path: "link-write.txt", content: "changed" },
        workspace.context,
      );
      expect(result.ok).toBe(false);
      expect(await readFile(outside, "utf8")).toBe("original");
    });
  });

  describe("a workspace root that is itself a symlink", () => {
    it("still allows the files inside it", async () => {
      // On macOS a temporary directory is reached through `/var`, which is a
      // symlink to `/private/var`. The sandbox has to compare resolved paths
      // on both sides, or every file in the workspace is refused.
      const real = await mkdtemp(join(tmpdir(), "flowcode-real-"));
      const link = join(tmpdir(), `flowcode-link-${Date.now()}`);

      try {
        await symlink(real, link, "dir");
      } catch {
        // Creating a symlink needs a privilege Windows does not grant by
        // default.
        return;
      }

      const context = {
        ...workspace.context,
        cwd: link,
        workspaceRoot: link,
      };

      const written = await executeTool(
        writeFileTool,
        { path: "inside.txt", content: "hello" },
        context,
      );
      expect(written.ok).toBe(true);
      expect(await readFile(join(real, "inside.txt"), "utf8")).toBe("hello");

      const read = await executeTool(readFileTool, { path: "inside.txt" }, context);
      expect(read.ok).toBe(true);
    });
  });
});
