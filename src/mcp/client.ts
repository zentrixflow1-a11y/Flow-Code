/**
 * The MCP client.
 *
 * A server that fails to start does not end the session: it is reported and
 * the rest of the session carries on without it. An agent with a broken tool
 * server should still be able to read files.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { flowError, type FlowError } from "../errors.js";
import { err, ok, type Result } from "../util/result.js";
import type { McpServerConfig } from "./config.js";

/** How long a tool call may take by default. */
export const DEFAULT_TOOL_TIMEOUT_MS = 60_000;

/** A tool an MCP server offers. */
export interface McpToolInfo {
  /** The tool's name, as the server calls it. */
  readonly name: string;
  /** What the tool does. */
  readonly description: string;
  /** The tool's input schema. */
  readonly inputSchema: unknown;
}

/** A connected MCP server. */
export interface McpConnection {
  /** The server's name. */
  readonly server: string;
  /** The client, for calling its tools. */
  readonly client: Client;
  /** The instructions the server sent, if it sent any. */
  readonly instructions?: string;
  /** The tools the server offers. */
  readonly tools: readonly McpToolInfo[];
  /** Close the connection. */
  close: () => Promise<void>;
}

/**
 * Connect to one MCP server.
 *
 * @param config - How to reach the server.
 * @param options - Where to run it, and what to call it.
 */
export const connectServer = async (
  config: McpServerConfig,
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
  },
): Promise<Result<McpConnection, FlowError>> => {
  const client = new Client(
    { name: "flow-code", version: "0.1.0" },
    { versionNegotiation: { mode: "auto" } },
  );

  try {
    if (config.type === "http") {
      if (config.url === undefined) {
        return err(
          flowError("invalid_request", `The MCP server '${config.name}' has no URL.`, {
            retryable: false,
          }),
        );
      }
      await client.connect(
        new StreamableHTTPClientTransport(new URL(config.url), {
          ...(config.headers === undefined ? {} : { requestInit: { headers: config.headers } }),
        }),
      );
    } else {
      if (config.command === undefined) {
        return err(
          flowError("invalid_request", `The MCP server '${config.name}' has no command.`, {
            retryable: false,
          }),
        );
      }
      await client.connect(
        new StdioClientTransport({
          command: config.command,
          ...(config.args === undefined ? {} : { args: [...config.args] }),
          env: Object.assign(
            {},
            ...Object.keys(process.env).map((key) => ({ [key]: process.env[key] ?? "" })),
            options.env ?? {},
            config.env ?? {},
          ),
          cwd: config.cwd ?? options.cwd,
        }),
      );
    }

    const listed = await client.listTools();
    const tools: McpToolInfo[] = listed.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
    }));

    const instructions = client.getInstructions();

    return ok({
      server: config.name,
      client,
      ...(instructions === undefined || instructions === ""
        ? {}
        : { instructions }),
      tools,
      close: async () => {
        await client.close();
      },
    });
  } catch (error) {
    await client.close().catch(() => undefined);
    return err(
      flowError(
        "network_error",
        `The MCP server '${config.name}' could not be reached: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          retryable: false,
          remediation:
            "Check the command, the arguments and the environment in .flowcode/mcp.json.",
          cause: error,
        },
      ),
    );
  }
};

/** The result of connecting to every server. */
export interface McpConnections {
  /** The servers that answered. */
  readonly connections: readonly McpConnection[];
  /** The servers that did not, and why. */
  readonly failures: readonly { readonly server: string; readonly error: FlowError }[];
  /** Close every connection. */
  close: () => Promise<void>;
}

/**
 * Connect to every configured server.
 *
 * @param servers - The servers to connect to.
 * @param options - Where to run them, and what to call them.
 */
export const connectAll = async (
  servers: readonly McpServerConfig[],
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
  },
): Promise<McpConnections> => {
  const connections: McpConnection[] = [];
  const failures: { server: string; error: FlowError }[] = [];

  for (const server of servers) {
    const result = await connectServer(server, options);
    if (result.ok) {
      connections.push(result.value);
    } else {
      failures.push({ server: server.name, error: result.error });
    }
  }

  return {
    connections,
    failures,
    close: async () => {
      await Promise.all(connections.map((connection) => connection.close()));
    },
  };
};

/**
 * The result of calling an MCP tool.
 */
export interface McpCallResult {
  /** Whether the call succeeded. */
  readonly ok: boolean;
  /** The text to show the model. */
  readonly text: string;
  /** The structured content, when the server sent any. */
  readonly structured?: unknown;
}

/**
 * Call a tool on an MCP server.
 *
 * @param connection - The server.
 * @param tool - The tool's name, as the server calls it.
 * @param args - The arguments.
 * @param timeoutMs - How long to allow.
 */
export const callMcpTool = async (
  connection: McpConnection,
  tool: string,
  args: unknown,
  timeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
): Promise<Result<McpCallResult, FlowError>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await connection.client.callTool(
      { name: tool, arguments: (args ?? {}) as Record<string, unknown> },
      { signal: controller.signal },
    );

    const text = result.content
      .map((block) => {
        if (block.type === "text") {
          return block.text;
        }
        if (block.type === "resource") {
          return `[resource ${block.resource.uri}]`;
        }
        return `[${block.type}]`;
      })
      .join("\n");

    return ok({
      ok: !result.isError,
      text: text === "" ? "(the tool returned nothing)" : text,
      ...(result.structuredContent === undefined
        ? {}
        : { structured: result.structuredContent }),
    });
  } catch (error) {
    return err(
      flowError(
        "network_error",
        `The MCP tool '${tool}' failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { retryable: true, cause: error },
      ),
    );
  } finally {
    clearTimeout(timer);
  }
};
