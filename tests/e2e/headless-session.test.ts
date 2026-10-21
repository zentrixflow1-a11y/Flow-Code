/**
 * The end-to-end journey.
 *
 * The real CLI, the real provider adapter, the real agent loop and the real
 * tools, against the mock model server. No model and no API key are needed.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/run.js";
import { startMockServer, type MockServer } from "../support/mock-server.js";

/** The exact text the mock finishes with. */
const EXPECTED = "Mock answer: read the file, listed the directory, and finished.";

describe("a headless session", () => {
  let server: MockServer;
  let home: string;
  let workspace: string;

  beforeAll(async () => {
    server = await startMockServer({ MOCK_SCENARIO: "tour" });
    home = await mkdtemp(join(tmpdir(), "flowcode-e2e-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-e2e-work-"));
    await writeFile(join(workspace, "README.md"), "# The project\n", "utf8");
  });

  afterAll(async () => {
    await server.stop();
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  const run = async (
    argv: readonly string[],
  ): Promise<{ readonly status: number; readonly out: string; readonly err: string }> => {
    const out: string[] = [];
    const err: string[] = [];
    const status = await runCli(argv, {
      out: (text) => void out.push(text),
      err: (text) => void err.push(text),
      write: (text) => void out.push(text),
      cwd: workspace,
      env: {},
      home,
    });
    return { status, out: out.join(""), err: err.join("\n") };
  };

  it("carries out a task and prints the answer", async () => {
    const result = await run([
      "-p",
      "read the readme and tell me what is there",
      "--provider",
      "custom",
      "--base-url",
      server.baseUrl,
      "--model",
      "mock-model",
    ]);

    expect(result.status).toBe(0);
    expect(result.out).toContain(EXPECTED);
  });

  it("reports the journey on stderr", async () => {
    const result = await run([
      "-p",
      "read the readme",
      "--provider",
      "custom",
      "--base-url",
      server.baseUrl,
      "--model",
      "mock-model",
    ]);

    expect(result.err).toContain("read_file");
    expect(result.err).toContain("list_dir");
  });

  it("prints a machine-readable envelope", async () => {
    const result = await run([
      "-p",
      "read the readme",
      "--provider",
      "custom",
      "--base-url",
      server.baseUrl,
      "--model",
      "mock-model",
      "--output-format",
      "json",
    ]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.out) as {
      ok: boolean;
      reason: string;
      turns: number;
      text: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.reason).toBe("completed");
    expect(payload.turns).toBe(3);
    expect(payload.text).toContain(EXPECTED);
  });

  it("writes a session log that can be resumed", async () => {
    const result = await run([
      "-p",
      "read the readme",
      "--provider",
      "custom",
      "--base-url",
      server.baseUrl,
      "--model",
      "mock-model",
    ]);
    expect(result.status).toBe(0);

    const { readdir } = await import("node:fs/promises");
    const { join: joinPath } = await import("node:path");
    const sessionsRoot = joinPath(home, ".flowcode", "sessions");
    const projects = await readdir(sessionsRoot);
    expect(projects.length).toBe(1);

    const files = await readdir(joinPath(sessionsRoot, projects[0] as string));
    expect(files.some((file) => file.endsWith(".jsonl"))).toBe(true);
  });

  it("refuses an unknown output format", async () => {
    const result = await run(["-p", "hello", "--output-format", "yaml"]);
    expect(result.status).toBe(1);
    expect(result.err).toContain("unknown output format");
  });

  it("refuses an unknown permission mode", async () => {
    const result = await run(["-p", "hello", "--permission-mode", "yolo"]);
    expect(result.status).toBe(1);
    expect(result.err).toContain("unknown permission mode");
  });
});
