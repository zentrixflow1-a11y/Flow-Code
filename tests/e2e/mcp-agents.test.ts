/**
 * MCP servers, sub-agents and hooks, in a real session.
 */
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/run.js";
import { startMockServer, type MockServer } from "../support/mock-server.js";

const MCP_SERVER = fileURLToPath(
  new URL("../../scripts/mock-mcp-server.mjs", import.meta.url),
);

describe("a session with an MCP server", () => {
  let server: MockServer;
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    server = await startMockServer({ MOCK_SCENARIO: "mcp" });
    home = await mkdtemp(join(tmpdir(), "flowcode-mcp-e2e-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-mcp-e2e-work-"));

    await mkdir(join(workspace, ".flowcode"), { recursive: true });
    await writeFile(
      join(workspace, ".flowcode", "mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            mock: {
              type: "stdio",
              command: process.execPath,
              args: [MCP_SERVER],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
  });

  afterEach(async () => {
    await server.stop();
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  it("calls a tool on the server", async () => {
    const out: string[] = [];
    const err: string[] = [];

    const status = await runCli(
      [
        "-p",
        "ask the MCP server",
        "--provider",
        "custom",
        "--base-url",
        server.baseUrl,
        "--model",
        "mock-model",
        // An MCP tool is a third party's code, so it is gated like any other
        // gated call. Headless mode approves it here.
        "--yes",
      ],
      {
        out: (text) => void out.push(text),
        err: (text) => void err.push(text),
        cwd: workspace,
        env: {},
        home,
      },
    );

    expect(status).toBe(0);
    expect(err.join("\n")).toContain("mcp:mock:echo");
    expect(out.join("")).toContain("The MCP server answered");
  });

  it("records the call in the session log", async () => {
    await runCli(
      [
        "-p",
        "ask the MCP server",
        "--provider",
        "custom",
        "--base-url",
        server.baseUrl,
        "--model",
        "mock-model",
        "--yes",
      ],
      {
        out: () => undefined,
        err: () => undefined,
        cwd: workspace,
        env: {},
        home,
      },
    );

    const { readdir } = await import("node:fs/promises");
    const sessionsRoot = join(home, ".flowcode", "sessions");
    const projects = await readdir(sessionsRoot);
    const files = await readdir(join(sessionsRoot, projects[0] as string));
    const log = await readFile(
      join(sessionsRoot, projects[0] as string, files[0] as string),
      "utf8",
    );

    expect(log).toContain("mcp:mock:echo");
  });
});

describe("a session with a hook", () => {
  let server: MockServer;
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    server = await startMockServer({ MOCK_SCENARIO: "tour" });
    home = await mkdtemp(join(tmpdir(), "flowcode-hook-e2e-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-hook-e2e-work-"));
    await writeFile(join(workspace, "README.md"), "# The project\n", "utf8");
  });

  afterEach(async () => {
    await server.stop();
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  it("blocks a tool when a hook refuses it", async () => {
    await mkdir(join(workspace, ".flowcode"), { recursive: true });
    await writeFile(
      join(workspace, ".flowcode", "hooks.json"),
      JSON.stringify(
        {
          hooks: {
            pre_tool_use: [
              {
                matcher: "read_file",
                command: `node -e "process.stderr.write('the hook said no'); process.exit(2)"`,
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const out: string[] = [];
    const err: string[] = [];

    const status = await runCli(
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
      {
        out: (text) => void out.push(text),
        err: (text) => void err.push(text),
        cwd: workspace,
        env: {},
        home,
      },
    );

    // The session still finishes; the tool was simply refused, and the
    // reason reached the model.
    expect(status).toBe(0);

    const log = await readSessionLog(home);
    expect(log).toContain("the hook said no");
  });

  it("passes a hook's extra context to the model", async () => {
    await mkdir(join(workspace, ".flowcode"), { recursive: true });
    await writeFile(
      join(workspace, ".flowcode", "hooks.json"),
      JSON.stringify(
        {
          hooks: {
            post_tool_use: [
              {
                matcher: "read_file",
                command: `node -e "process.stdout.write(JSON.stringify({additional_context:'the project uses tabs'}))"`,
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const status = await runCli(
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
      {
        out: () => undefined,
        err: () => undefined,
        cwd: workspace,
        env: {},
        home,
      },
    );

    expect(status).toBe(0);

    const log = await readSessionLog(home);
    expect(log).toContain("the project uses tabs");
  });
});

describe("a session with a sub-agent", () => {
  let server: MockServer;
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    server = await startMockServer({ MOCK_SCENARIO: "subagent" });
    home = await mkdtemp(join(tmpdir(), "flowcode-sub-e2e-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-sub-e2e-work-"));
    await writeFile(join(workspace, "README.md"), "# The project\n", "utf8");

    await mkdir(join(workspace, ".flowcode", "agents"), { recursive: true });
    await writeFile(
      join(workspace, ".flowcode", "agents", "reviewer.md"),
      [
        "---",
        "name: reviewer",
        "description: Reviews the project",
        "tools: read_file",
        "---",
        "You review a project and report what you find.",
      ].join("\n"),
      "utf8",
    );
  });

  afterEach(async () => {
    await server.stop();
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  it("runs the sub-agent and returns only its answer", async () => {
    const out: string[] = [];
    const err: string[] = [];

    const status = await runCli(
      [
        "-p",
        "have the reviewer look at it",
        "--provider",
        "custom",
        "--base-url",
        server.baseUrl,
        "--model",
        "mock-model",
        "--yes",
      ],
      {
        out: (text) => void out.push(text),
        err: (text) => void err.push(text),
        cwd: workspace,
        env: {},
        home,
      },
    );

    expect(status).toBe(0);
    expect(err.join("\n")).toContain("spawn_agent");
    expect(out.join("")).toContain("The sub-agent finished its review");
  });
});

/** Read the session log the run left behind. */
const readSessionLog = async (home: string): Promise<string> => {
  const { readdir } = await import("node:fs/promises");
  const sessionsRoot = join(home, ".flowcode", "sessions");
  const projects = await readdir(sessionsRoot);
  const files = await readdir(join(sessionsRoot, projects[0] as string));
  return readFile(
    join(sessionsRoot, projects[0] as string, files[0] as string),
    "utf8",
  );
};
