/**
 * `/init`: writing a starting set of project instructions.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "../../../src/commands/builtin.js";
import { renderInstructions, readRepositoryFacts } from "../../../src/context/init.js";
import type { CommandServices } from "../../../src/commands/types.js";
import { DEFAULT_CONFIG } from "../../../src/config/types.js";
import { ok } from "../../../src/util/result.js";
import type { ModelInfo, ModelProvider } from "../../../src/providers/types.js";
import { ToolRegistry } from "../../../src/tools/registry.js";

const provider: ModelProvider = {
  id: "mock",
  label: "Mock",
  listModels: async () => ok<ModelInfo[]>([{ id: "mock-model" }]),
  streamChat: async function* () {
    yield { type: "done", reason: "stop" };
  },
};

describe("/init", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "flowcode-init-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  const services = (
    overrides: Partial<CommandServices> = {},
  ): CommandServices => ({
    config: DEFAULT_CONFIG,
    provider,
    registry: new ToolRegistry(),
    listModels: async () => [{ id: "mock-model" }],
    setModel: async () => ok(undefined),
    setPermissionMode: () => undefined,
    clear: async () => undefined,
    compact: async () => "Compacted.",
    exit: () => undefined,
    cwd: workspace,
    ...overrides,
  });

  it("writes a FLOWCODE.md from what the repository says", async () => {
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({
        name: "the-project",
        scripts: { test: "vitest run", build: "tsc" },
      }),
      "utf8",
    );
    await writeFile(join(workspace, "pnpm-lock.yaml"), "", "utf8");

    const written: { readonly path: string; readonly content: string }[] = [];
    const outcome = await runCommand(
      "init",
      "",
      services({
        writeWorkspaceFile: async (path, content) => {
          written.push({ path, content });
          return ok(path);
        },
      }),
    );

    expect(outcome?.output).toContain("FLOWCODE.md");
    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe("FLOWCODE.md");
    expect(written[0]?.content).toContain("the-project");
    expect(written[0]?.content).toContain("pnpm");
    expect(written[0]?.content).toContain("npm run test");
  });

  it("refuses to overwrite an instructions file that is already there", async () => {
    await writeFile(join(workspace, "FLOWCODE.md"), "# Already here\n", "utf8");

    const outcome = await runCommand("init", "", services());

    expect(outcome?.output).toContain("already");
  });

  it("says what it worked out", async () => {
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ name: "the-project" }),
      "utf8",
    );
    await writeFile(join(workspace, "package-lock.json"), "{}", "utf8");

    const outcome = await runCommand(
      "init",
      "",
      services({
        writeWorkspaceFile: async (path) => ok(path),
      }),
    );

    expect(outcome?.output).toContain("the-project");
    expect(outcome?.output).toContain("npm");
  });
});

describe("the repository facts", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "flowcode-facts-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("are empty for a directory with nothing in it", async () => {
    const facts = await readRepositoryFacts(workspace);
    expect(facts.name).toBeUndefined();
    expect(facts.language).toBeUndefined();
  });

  it("name the language from what is there", async () => {
    await writeFile(join(workspace, "tsconfig.json"), "{}", "utf8");
    const facts = await readRepositoryFacts(workspace);
    expect(facts.language).toBe("TypeScript");
  });

  it("name the package manager from the lockfile", async () => {
    await writeFile(join(workspace, "yarn.lock"), "", "utf8");
    const facts = await readRepositoryFacts(workspace);
    expect(facts.packageManager).toBe("yarn");
  });
});

describe("the rendered instructions", () => {
  it("ask the questions a repository cannot answer", () => {
    const content = renderInstructions({ scripts: [] });
    expect(content).toContain("# How we work");
    expect(content).toContain("The conventions");
    expect(content).toContain("The traps");
  });
});
