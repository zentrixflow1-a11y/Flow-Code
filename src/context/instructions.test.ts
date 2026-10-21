import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  readProjectInstructions,
} from "./instructions.js";
import { assembleRequest, combineSystemPrompt } from "./assembler.js";
import { buildSystemPrompt } from "./system-prompt.js";

describe("readProjectInstructions", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "flowcode-instructions-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reads FLOWCODE.md when it is there", async () => {
    await writeFile(join(directory, "FLOWCODE.md"), "Use pnpm.\n", "utf8");
    const instructions = await readProjectInstructions(directory);
    expect(instructions.text).toContain("Use pnpm.");
    expect(instructions.sources).toEqual(["FLOWCODE.md"]);
  });

  it("falls back to AGENTS.md", async () => {
    await writeFile(join(directory, "AGENTS.md"), "Use yarn.\n", "utf8");
    const instructions = await readProjectInstructions(directory);
    expect(instructions.text).toContain("Use yarn.");
    expect(instructions.sources).toEqual(["AGENTS.md"]);
  });

  it("prefers FLOWCODE.md over AGENTS.md", async () => {
    await writeFile(join(directory, "FLOWCODE.md"), "Use pnpm.\n", "utf8");
    await writeFile(join(directory, "AGENTS.md"), "Use yarn.\n", "utf8");
    const instructions = await readProjectInstructions(directory);
    expect(instructions.text).toContain("Use pnpm.");
    expect(instructions.text).not.toContain("Use yarn.");
  });

  it("returns nothing when there is no instruction file", async () => {
    const instructions = await readProjectInstructions(directory);
    expect(instructions.text).toBe("");
    expect(instructions.sources).toEqual([]);
  });

  it("includes a rule with no path scope", async () => {
    await mkdir(join(directory, ".flowcode", "rules"), { recursive: true });
    await writeFile(
      join(directory, ".flowcode", "rules", "style.md"),
      "Always use tabs.\n",
      "utf8",
    );
    const instructions = await readProjectInstructions(directory);
    expect(instructions.text).toContain("Always use tabs.");
  });

  it("includes a path-scoped rule only when its paths were touched", async () => {
    await mkdir(join(directory, ".flowcode", "rules"), { recursive: true });
    await writeFile(
      join(directory, ".flowcode", "rules", "ts.md"),
      "---\npaths: [\"src/**/*.ts\"]\n---\nNo semicolons.\n",
      "utf8",
    );

    const untouched = await readProjectInstructions(directory);
    expect(untouched.text).not.toContain("No semicolons.");
    expect(untouched.skippedRules).toEqual(["ts.md"]);

    const touched = await readProjectInstructions(directory, ["src/app/main.ts"]);
    expect(touched.text).toContain("No semicolons.");
  });
});

describe("parseFrontmatter", () => {
  it("reads a path list", () => {
    const parsed = parseFrontmatter('---\npaths: ["a/**", "b/**"]\n---\nBody\n');
    expect(parsed.paths).toEqual(["a/**", "b/**"]);
    expect(parsed.body).toBe("Body");
  });

  it("handles a file with no frontmatter", () => {
    const parsed = parseFrontmatter("Just a body\n");
    expect(parsed.paths).toBeUndefined();
    expect(parsed.body).toBe("Just a body");
  });

  it("handles frontmatter with no paths", () => {
    const parsed = parseFrontmatter("---\nname: x\n---\nBody\n");
    expect(parsed.paths).toBeUndefined();
    expect(parsed.body).toBe("Body");
  });
});

describe("assembleRequest", () => {
  it("puts the system prompt first", () => {
    const request = assembleRequest({
      model: "mock-model",
      messages: [{ role: "user", content: "hello" }],
      systemPrompt: "You are Flow Code.",
    });

    expect(request.messages[0]).toEqual({ role: "system", content: "You are Flow Code." });
    expect(request.messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("adds the project instructions to the system prompt", () => {
    const request = assembleRequest({
      model: "mock-model",
      messages: [],
      systemPrompt: "You are Flow Code.",
      projectInstructions: "Use pnpm.",
    });

    expect(request.messages[0]?.content).toContain("Use pnpm.");
    expect(request.messages[0]?.content).toContain("Project instructions");
  });

  it("leaves the tools out when there are none", () => {
    const request = assembleRequest({
      model: "mock-model",
      messages: [],
      systemPrompt: "x",
    });
    expect(request.tools).toBeUndefined();
  });

  it("keeps the tools when there are some", () => {
    const request = assembleRequest({
      model: "mock-model",
      messages: [],
      systemPrompt: "x",
      tools: [
        {
          name: "read_file",
          description: "Read a file.",
          parameters: { type: "object" },
        },
      ],
    });
    expect(request.tools).toHaveLength(1);
  });
});

describe("combineSystemPrompt", () => {
  it("leaves the prompt alone when there are no project instructions", () => {
    expect(combineSystemPrompt("Base", "   ")).toBe("Base");
    expect(combineSystemPrompt("Base", undefined)).toBe("Base");
  });

  it("appends the project instructions", () => {
    expect(combineSystemPrompt("Base", "Extra")).toContain("Extra");
  });
});

describe("buildSystemPrompt", () => {
  it("describes the session", () => {
    const prompt = buildSystemPrompt({
      cwd: "/home/user/project",
      platform: "linux",
      mode: "ask",
      provider: "ollama",
      model: "qwen2.5-coder",
      tools: [],
      additionalDirectories: [],
    });

    expect(prompt).toContain("/home/user/project");
    expect(prompt).toContain("qwen2.5-coder");
    expect(prompt).toContain("ask");
  });

  it("lists the tools", () => {
    const prompt = buildSystemPrompt({
      cwd: "/project",
      platform: "linux",
      mode: "ask",
      provider: "ollama",
      model: "m",
      tools: [
        {
          name: "read_file",
          description: "Read a text file. Use offset to read part of it.",
          category: "read",
          subjectKind: "path",
          concurrencySafe: true,
          schema: undefined as never,
          execute: async () => ({ ok: true, output: "" }),
        },
      ],
      additionalDirectories: [],
    });

    expect(prompt).toContain("read_file");
  });

  it("says what each mode allows", () => {
    const prompt = buildSystemPrompt({
      cwd: "/project",
      platform: "linux",
      mode: "safe",
      provider: "ollama",
      model: "m",
      tools: [],
      additionalDirectories: [],
    });

    expect(prompt).toContain("may not write files");
  });
});
