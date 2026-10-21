/**
 * Sub-agents and hooks.
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { parseAgentDefinition, readAgentDefinitions, toolsFor } from "../../../src/agents/definitions.js";
import { buildPrompt } from "../../../src/agents/subagent.js";
import { hookApplies, parseHookOutput, readHooks, runHook } from "../../../src/hooks/runner.js";
import { ToolRegistry } from "../../../src/tools/registry.js";
import type { ToolDefinition } from "../../../src/tools/types.js";

const echoTool: ToolDefinition<{ text: string }> = {
  name: "echo",
  description: "Echo the text back.",
  schema: z.object({ text: z.string() }),
  category: "read",
  subjectKind: "text",
  concurrencySafe: true,
  async execute(args) {
    return { ok: true, output: args.text };
  },
};

describe("sub-agent definitions", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "flowcode-agents-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("reads a definition with its frontmatter", () => {
    const definition = parseAgentDefinition(
      "reviewer.md",
      [
        "---",
        "name: reviewer",
        "description: Reviews code for quality",
        "tools: read_file, grep_files",
        "max_turns: 12",
        "---",
        "You review code.",
      ].join("\n"),
    );

    expect(definition?.name).toBe("reviewer");
    expect(definition?.description).toBe("Reviews code for quality");
    expect(definition?.tools).toEqual(["read_file", "grep_files"]);
    expect(definition?.maxTurns).toBe(12);
    expect(definition?.body).toBe("You review code.");
  });

  it("ignores a file with no frontmatter", () => {
    expect(parseAgentDefinition("x.md", "Just a body")).toBeUndefined();
  });

  it("reads the definitions a project defines", async () => {
    await mkdir(join(workspace, ".flowcode", "agents"), { recursive: true });
    await writeFile(
      join(workspace, ".flowcode", "agents", "reviewer.md"),
      "---\nname: reviewer\ndescription: Reviews code\n---\nReview things.\n",
      "utf8",
    );

    const definitions = await readAgentDefinitions(workspace);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.name).toBe("reviewer");
  });

  it("finds nothing in a project with no agents", async () => {
    expect(await readAgentDefinitions(workspace)).toEqual([]);
  });

  it("restricts the tools when the definition says so", () => {
    const definition = parseAgentDefinition(
      "x.md",
      "---\nname: x\ndescription: d\ntools: read_file\n---\nBody\n",
    );
    expect(definition).toBeDefined();
    if (definition !== undefined) {
      expect(toolsFor(definition, ["read_file", "write_file"])).toEqual(["read_file"]);
    }
  });

  it("inherits the tools when the definition does not say", () => {
    const definition = parseAgentDefinition("x.md", "---\nname: x\ndescription: d\n---\nBody\n");
    expect(definition).toBeDefined();
    if (definition !== undefined) {
      expect(toolsFor(definition, ["read_file", "write_file"])).toEqual([
        "read_file",
        "write_file",
      ]);
    }
  });

  it("builds the prompt from the instructions and the task", () => {
    const definition = parseAgentDefinition(
      "x.md",
      "---\nname: x\ndescription: d\n---\nYou review code.\n",
    );
    expect(definition).toBeDefined();
    if (definition !== undefined) {
      const prompt = buildPrompt(definition, "Review src/index.ts");
      expect(prompt).toContain("You review code.");
      expect(prompt).toContain("Task: Review src/index.ts");
    }
  });
});

describe("the tool registry", () => {
  it("offers the tools a sub-agent is allowed", () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    expect(registry.list().map((tool) => tool.name)).toEqual(["echo"]);
  });
});

describe("hooks", () => {
  let workspace: string;
  let home: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "flowcode-hooks-"));
    home = await mkdtemp(join(tmpdir(), "flowcode-hooks-home-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it("reads the configured hooks", async () => {
    await mkdir(join(workspace, ".flowcode"), { recursive: true });
    await writeFile(
      join(workspace, ".flowcode", "hooks.json"),
      JSON.stringify({
        hooks: {
          pre_tool_use: [{ matcher: "edit_file", command: "npm run lint" }],
          session_end: [{ command: "echo done" }],
        },
      }),
      "utf8",
    );

    const result = await readHooks({ cwd: workspace, home });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]?.event).toBe("pre_tool_use");
      expect(result.value[0]?.matcher).toBe("edit_file");
    }
  });

  it("ignores an event it does not know", async () => {
    await mkdir(join(workspace, ".flowcode"), { recursive: true });
    await writeFile(
      join(workspace, ".flowcode", "hooks.json"),
      JSON.stringify({ hooks: { not_an_event: [{ command: "x" }] } }),
      "utf8",
    );

    const result = await readHooks({ cwd: workspace, home });
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it("matches a tool by its name", () => {
    expect(hookApplies({ event: "pre_tool_use", command: "x", matcher: "edit_file" }, "edit_file")).toBe(true);
    expect(hookApplies({ event: "pre_tool_use", command: "x", matcher: "edit_file" }, "read_file")).toBe(false);
    expect(hookApplies({ event: "pre_tool_use", command: "x" }, "anything")).toBe(true);
    expect(hookApplies({ event: "pre_tool_use", command: "x", matcher: "*" }, "anything")).toBe(true);
  });

  it("lets a hook through when it exits cleanly", async () => {
    const outcome = await runHook(
      { event: "pre_tool_use", command: "echo hello" },
      { tool: "read_file" },
      { cwd: workspace },
    );
    expect(outcome.ok).toBe(true);
  });

  it("blocks the action when a hook exits with two", async () => {
    // The hook is a script rather than a quoted command line, because the two
    // shells disagree about what quotes mean. The exit code is set rather than
    // forced, so the message on standard error is flushed before the process
    // goes.
    await writeFile(
      join(workspace, "block.mjs"),
      'process.stderr.write("the hook said no");\nprocess.exitCode = 2;\n',
      "utf8",
    );

    const outcome = await runHook(
      { event: "pre_tool_use", command: "node block.mjs" },
      { tool: "read_file" },
      { cwd: workspace },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain("the hook said no");
    }
  });

  it("reads the context a hook asked for", async () => {
    await writeFile(
      join(workspace, "context.mjs"),
      'process.stdout.write(JSON.stringify({additional_context:"remember this"}));\n',
      "utf8",
    );

    const outcome = await runHook(
      { event: "post_tool_use", command: "node context.mjs" },
      { tool: "read_file" },
      { cwd: workspace },
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.context).toBe("remember this");
    }
  });

  it("blocks the action when the hook cannot be run at all", async () => {
    // A hook that cannot be run has not approved anything. It has to block,
    // rather than quietly allow what it was meant to stop.
    const outcome = await runHook(
      { event: "pre_tool_use", command: "a-command-that-does-not-exist" },
      { tool: "read_file" },
      { cwd: workspace },
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toMatch(/failed|could not be run/i);
    }
  });

  it("reads the extra context a hook asked for", () => {
    expect(parseHookOutput('{"additional_context":"remember this"}')).toEqual({
      context: "remember this",
    });
    expect(parseHookOutput("not json")).toEqual({});
  });
});
