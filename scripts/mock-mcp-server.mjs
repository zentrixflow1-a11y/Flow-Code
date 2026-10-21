#!/usr/bin/env node
/**
 * A scriptable mock of an MCP server, over stdio.
 *
 * It speaks just enough of the Model Context Protocol to be useful: the
 * initialize handshake, `tools/list` and `tools/call`. Point Flow Code at it
 * to check a configuration without installing anything.
 *
 * Usage:
 *   node scripts/mock-mcp-server.mjs
 *
 * Environment:
 *   MOCK_MCP_NAME        The server's name (default "mock").
 *   MOCK_MCP_TOOLS       A comma-separated list of tool names (default "echo,add").
 *   MOCK_MCP_FAIL        Exit immediately, to test how a broken server is handled.
 */

import { createInterface } from "node:readline";

const NAME = process.env.MOCK_MCP_NAME ?? "mock";
const TOOL_NAMES = (process.env.MOCK_MCP_TOOLS ?? "echo,add")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name !== "");

if (process.env.MOCK_MCP_FAIL === "1") {
  process.stderr.write("[mock-mcp] exiting on purpose\n");
  process.exit(1);
}

/** The tools this server offers. */
const TOOLS = TOOL_NAMES.map((tool) => ({
  name: tool,
  description: `The ${tool} tool. It echoes what it is given.`,
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to echo back." },
      a: { type: "number", description: "The first number, for the add tool." },
      b: { type: "number", description: "The second number, for the add tool." },
    },
    required: ["text"],
  },
}));

/** Run one tool. */
const callTool = (name, args) => {
  if (name === "add") {
    const sum = Number(args?.a ?? 0) + Number(args?.b ?? 0);
    return `The sum is ${sum}.`;
  }
  return `Mock MCP echo: ${args?.text ?? ""}`;
};

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const reader = createInterface({ input: process.stdin });

reader.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed === "") {
    return;
  }

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    return;
  }

  const { id, method, params } = request;

  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          // The server accepts the version the client asked for.
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: NAME, version: "1.0.0" },
          instructions: `This is the mock MCP server. Its tools echo what they are given.`,
        },
      });
      break;

    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      break;

    case "tools/call":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: callTool(params?.name, params?.arguments) }],
        },
      });
      break;

    case "ping":
      send({ jsonrpc: "2.0", id, result: {} });
      break;

    default:
      if (id !== undefined) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown method: ${method}` },
        });
      }
      break;
  }
});

process.stderr.write(`[mock-mcp] ${NAME} ready with tools: ${TOOL_NAMES.join(", ")}\n`);
