/**
 * The MCP client, against a real MCP server.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bridgeTools, normaliseSchema } from "../../../src/mcp/bridge.js";
import { callMcpTool, connectAll, connectServer } from "../../../src/mcp/client.js";
import { mcpToolName, readMcpConfig } from "../../../src/mcp/config.js";

const SERVER = fileURLToPath(new URL("../../../scripts/mock-mcp-server.mjs", import.meta.url));

describe("the MCP client", () => {
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "flowcode-mcp-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-mcp-work-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  it("connects to a server and lists its tools", async () => {
    const result = await connectServer(
      {
        name: "mock",
        type: "stdio",
        command: process.execPath,
        args: [SERVER],
      },
      { cwd: workspace },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.tools.map((tool) => tool.name)).toContain("echo");
    expect(result.value.instructions).toContain("mock MCP server");
    await result.value.close();
  });

  it("calls a tool", async () => {
    const result = await connectServer(
      {
        name: "mock",
        type: "stdio",
        command: process.execPath,
        args: [SERVER],
      },
      { cwd: workspace },
    );

    if (!result.ok) {
      throw new Error("the server should have connected");
    }

    const called = await callMcpTool(result.value, "echo", { text: "hello" });
    expect(called.ok).toBe(true);
    if (called.ok) {
      expect(called.value.text).toContain("hello");
    }

    await result.value.close();
  });

  it("names the tools Flow Code's own way", async () => {
    const result = await connectServer(
      {
        name: "mock",
        type: "stdio",
        command: process.execPath,
        args: [SERVER],
      },
      { cwd: workspace },
    );

    if (!result.ok) {
      throw new Error("the server should have connected");
    }

    const tools = bridgeTools(result.value);
    expect(tools.map((tool) => tool.name)).toContain("mcp:mock:echo");
    expect(mcpToolName("mock", "echo")).toBe("mcp:mock:echo");

    await result.value.close();
  });

  it("keeps the session alive when a server fails", async () => {
    const connections = await connectAll(
      [
        {
          name: "broken",
          type: "stdio",
          command: process.execPath,
          args: [SERVER],
          env: { MOCK_MCP_FAIL: "1" },
        },
        {
          name: "working",
          type: "stdio",
          command: process.execPath,
          args: [SERVER],
        },
      ],
      { cwd: workspace },
    );

    expect(connections.failures.map((failure) => failure.server)).toEqual(["broken"]);
    expect(connections.connections.map((connection) => connection.server)).toEqual([
      "working",
    ]);

    await connections.close();
  });
});

describe("the MCP configuration", () => {
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "flowcode-mcp-cfg-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-mcp-cfg-work-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  const writeConfig = async (path: string, document: unknown): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(document, null, 2), "utf8");
  };

  it("reads the servers from both scopes", async () => {
    await writeConfig(join(home, ".flowcode", "mcp.json"), {
      mcpServers: { global: { command: "global-server" } },
    });
    await writeConfig(join(workspace, ".flowcode", "mcp.json"), {
      mcpServers: { project: { command: "project-server" } },
    });

    const result = await readMcpConfig({ cwd: workspace, home });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((server) => server.name).sort()).toEqual([
        "global",
        "project",
      ]);
    }
  });

  it("lets the project override a server of the same name", async () => {
    await writeConfig(join(home, ".flowcode", "mcp.json"), {
      mcpServers: { shared: { command: "global-server" } },
    });
    await writeConfig(join(workspace, ".flowcode", "mcp.json"), {
      mcpServers: { shared: { command: "project-server" } },
    });

    const result = await readMcpConfig({ cwd: workspace, home });
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.command).toBe("project-server");
    }
  });

  it("reads an HTTP server", async () => {
    await writeConfig(join(workspace, ".flowcode", "mcp.json"), {
      mcpServers: { remote: { url: "https://mcp.example.com/mcp" } },
    });

    const result = await readMcpConfig({ cwd: workspace, home });
    if (result.ok) {
      expect(result.value[0]?.type).toBe("http");
      expect(result.value[0]?.url).toBe("https://mcp.example.com/mcp");
    }
  });

  it("reports a file that is not valid JSON", async () => {
    await mkdir(join(workspace, ".flowcode"), { recursive: true });
    await writeFile(join(workspace, ".flowcode", "mcp.json"), "{ not json", "utf8");

    const result = await readMcpConfig({ cwd: workspace, home });
    expect(result.ok).toBe(false);
  });
});

describe("normaliseSchema", () => {
  it("keeps a usable schema", () => {
    const schema = normaliseSchema({
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    });
    expect(schema["type"]).toBe("object");
    expect(schema["required"]).toEqual(["text"]);
  });

  it("turns an unusable schema into an empty object", () => {
    expect(normaliseSchema(undefined)).toEqual({ type: "object", properties: {} });
  });
});
