/**
 * The built CLI, as a user runs it.
 */
import { exec, execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockServer, type MockServer } from "../support/mock-server.js";

const run = promisify(execFile);
// A shell is used for the build, because `npm` is a script on Windows and an
// executable elsewhere.
const shell = promisify(exec);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliPath = join(projectRoot, "dist", "cli.js");

/** Run the built CLI and capture what it printed. */
const cli = async (
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
): Promise<{ readonly stdout: string; readonly stderr: string }> => {
  const result = await run(process.execPath, [cliPath, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });
  return { stdout: result.stdout, stderr: result.stderr };
};

describe("the built CLI", () => {
  let home: string;
  let workspace: string;
  let server: MockServer;

  beforeAll(async () => {
    // The compiled CLI is what users run, so it is what is tested.
    await shell("npm run build", { cwd: projectRoot, timeout: 180_000 });

    home = await mkdtemp(join(tmpdir(), "flowcode-pkg-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-pkg-work-"));
    await writeFile(join(workspace, "README.md"), "# The project\n", "utf8");
    server = await startMockServer({ MOCK_SCENARIO: "tour" });
  }, 240_000);

  afterAll(async () => {
    await server.stop();
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  it("prints its version", async () => {
    const { stdout } = await cli(["--version"], { cwd: workspace });
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints its help", async () => {
    const { stdout } = await cli(["--help"], { cwd: workspace });
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("--print");
  });

  it("lists the commands in the help output", async () => {
    const { stdout } = await cli(["--help"], { cwd: workspace });
    expect(stdout).toContain("/model");
    expect(stdout).toContain("/compact");
  });

  it("carries out a task against a local model server", async () => {
    const { stdout } = await cli(
      [
        "-p",
        "read the readme",
        "--provider",
        "custom",
        "--base-url",
        server.baseUrl,
        "--model",
        "mock-model",
      ],
      { cwd: workspace, env: { HOME: home, USERPROFILE: home } },
    );

    expect(stdout).toContain("Mock answer");
  });

  it("exits with a non-zero status for an unknown command", async () => {
    await expect(cli(["nope"], { cwd: workspace })).rejects.toThrow();
  });
});
