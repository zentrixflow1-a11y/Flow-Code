/**
 * The search tools, against a real workspace on disk.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeTool } from "../../../src/tools/executor.js";
import { globFilesTool, grepFilesTool } from "../../../src/tools/search.js";
import { createWorkspace, type Workspace } from "../../support/workspace.js";

describe("the search tools", () => {
  let workspace: Workspace;

  beforeEach(async () => {
    workspace = await createWorkspace({
      "src/index.ts": "export const answer = 42;\n",
      "src/util.ts": "export const helper = () => 1;\n",
      "src/deep/nested.ts": "// nested\n",
      "README.md": "# Project\n\nA sample project.\n",
      "docs/guide.md": "The answer is 42.\n",
    });
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  describe("glob_files", () => {
    it("finds files by pattern", async () => {
      const result = await executeTool(
        globFilesTool,
        { pattern: "**/*.ts" },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toContain("src/index.ts");
        expect(result.output).toContain("src/deep/nested.ts");
        expect(result.output).not.toContain("README.md");
      }
    });

    it("finds files in one directory", async () => {
      const result = await executeTool(
        globFilesTool,
        { pattern: "src/*.ts" },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toContain("src/index.ts");
        expect(result.output).not.toContain("src/deep/nested.ts");
      }
    });

    it("reports when nothing matches", async () => {
      const result = await executeTool(
        globFilesTool,
        { pattern: "**/*.rs" },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toContain("No files match");
      }
    });

    it("skips the git and node_modules directories", async () => {
      await workspace.write("node_modules/pkg/index.js", "module.exports = 1;\n");
      const result = await executeTool(
        globFilesTool,
        { pattern: "**/*.js" },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).not.toContain("node_modules");
      }
    });
  });

  describe("grep_files", () => {
    it("finds matching lines with their location", async () => {
      const result = await executeTool(
        grepFilesTool,
        { pattern: "answer" },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toContain("src/index.ts:1:");
        expect(result.output).toContain("export const answer = 42;");
      }
    });

    it("ignores case by default", async () => {
      const result = await executeTool(
        grepFilesTool,
        { pattern: "ANSWER" },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toContain("src/index.ts");
      }
    });

    it("honours a case-sensitive search", async () => {
      const result = await executeTool(
        grepFilesTool,
        { pattern: "ANSWER", case_sensitive: true },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toContain("No matches");
      }
    });

    it("lists the files that matched", async () => {
      const result = await executeTool(
        grepFilesTool,
        { pattern: "answer", output_mode: "files_with_matches" },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toContain("src/index.ts");
        expect(result.output).not.toContain("export const");
      }
    });

    it("counts the matches per file", async () => {
      const result = await executeTool(
        grepFilesTool,
        { pattern: "answer", output_mode: "count" },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toMatch(/src\/index\.ts: 1/);
      }
    });

    it("filters by a glob", async () => {
      const result = await executeTool(
        grepFilesTool,
        { pattern: "answer", glob: "**/*.ts" },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toContain("src/index.ts");
        expect(result.output).not.toContain("docs/guide.md");
      }
    });

    it("reports an invalid regular expression", async () => {
      const result = await executeTool(
        grepFilesTool,
        { pattern: "([unclosed" },
        workspace.context,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_request");
      }
    });

    it("reports when nothing matches", async () => {
      const result = await executeTool(
        grepFilesTool,
        { pattern: "zzzznotfound" },
        workspace.context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toContain("No matches");
      }
    });
  });
});
