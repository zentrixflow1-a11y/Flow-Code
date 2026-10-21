/**
 * The MCP server configuration.
 *
 * Flow Code reads the same shape of file that the rest of the ecosystem
 * uses, so a server that is already configured for another tool needs no
 * changes: a `mcpServers` object, with a `command`/`args` for a stdio server
 * or a `url` for an HTTP one.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { flowError, type FlowError } from "../errors.js";
import { err, ok, type Result } from "../util/result.js";

/** One configured MCP server. */
export interface McpServerConfig {
  /** The server's name. It becomes part of the tool names. */
  readonly name: string;
  /** How to reach it. */
  readonly type: "stdio" | "http";
  /** The program to run, for a stdio server. */
  readonly command?: string;
  /** The arguments to run it with. */
  readonly args?: readonly string[];
  /** The environment to run it with. */
  readonly env?: Readonly<Record<string, string>>;
  /** The directory to run it in. */
  readonly cwd?: string;
  /** The endpoint, for an HTTP server. */
  readonly url?: string;
  /** The headers to send, for an HTTP server. */
  readonly headers?: Readonly<Record<string, string>>;
  /** How long a tool call may take, in milliseconds. */
  readonly timeoutMs?: number;
}

/** The file the servers are configured in. */
export const MCP_CONFIG_FILE = "mcp.json";

/** Where the global configuration lives. */
export const globalMcpConfigPath = (home: string): string =>
  join(home, ".flowcode", MCP_CONFIG_FILE);

/** Where the project's configuration lives. */
export const projectMcpConfigPath = (cwd: string): string =>
  join(cwd, ".flowcode", MCP_CONFIG_FILE);

/**
 * Read the configured servers.
 *
 * The project's file wins over the global one, per server.
 *
 * @param options - Where to look.
 */
export const readMcpConfig = async (
  options: {
    readonly cwd: string;
    readonly home?: string;
  },
): Promise<Result<readonly McpServerConfig[], FlowError>> => {
  const home = options.home ?? homedir();
  const paths = [globalMcpConfigPath(home), projectMcpConfigPath(options.cwd)];

  const servers = new Map<string, McpServerConfig>();

  for (const path of paths) {
    const read = await readMcpFile(path);
    if (!read.ok) {
      return read;
    }
    for (const server of read.value) {
      servers.set(server.name, server);
    }
  }

  return ok([...servers.values()]);
};

/** Read one MCP configuration file. */
const readMcpFile = async (
  path: string,
): Promise<Result<readonly McpServerConfig[], FlowError>> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    // A file that is not there is not a problem.
    return ok([]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return err(
      flowError("invalid_request", `The MCP configuration '${path}' is not valid JSON.`, {
        retryable: false,
        remediation: "Fix the JSON syntax, or delete the file.",
        cause: error,
      }),
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    return err(
      flowError("invalid_request", `The MCP configuration '${path}' is not an object.`, {
        retryable: false,
      }),
    );
  }

  const record = parsed as Record<string, unknown>;
  const servers = record["mcpServers"];
  if (servers === undefined) {
    return ok([]);
  }
  if (typeof servers !== "object" || servers === null) {
    return err(
      flowError("invalid_request", `'mcpServers' in '${path}' is not an object.`, {
        retryable: false,
      }),
    );
  }

  const out: McpServerConfig[] = [];
  for (const [name, value] of Object.entries(servers as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const entry = value as Record<string, unknown>;
    const url = typeof entry["url"] === "string" ? entry["url"] : undefined;
    const command = typeof entry["command"] === "string" ? entry["command"] : undefined;

    if (url === undefined && command === undefined) {
      continue;
    }

    out.push({
      name,
      type: url === undefined ? "stdio" : "http",
      ...(command === undefined ? {} : { command }),
      ...(Array.isArray(entry["args"])
        ? { args: entry["args"] as string[] }
        : {}),
      ...(typeof entry["env"] === "object" && entry["env"] !== null
        ? { env: entry["env"] as Record<string, string> }
        : {}),
      ...(typeof entry["cwd"] === "string" ? { cwd: entry["cwd"] } : {}),
      ...(url === undefined ? {} : { url }),
      ...(typeof entry["headers"] === "object" && entry["headers"] !== null
        ? { headers: entry["headers"] as Record<string, string> }
        : {}),
      ...(typeof entry["timeoutMs"] === "number" ? { timeoutMs: entry["timeoutMs"] } : {}),
    });
  }

  return ok(out);
};

/**
 * The name a server's tool is offered under.
 *
 * Flow Code's own convention, deliberately not the `mcp__server__tool` one
 * that other tools use, so that a session log says what Flow Code did.
 *
 * @param server - The server's name.
 * @param tool - The tool's name.
 */
export const mcpToolName = (server: string, tool: string): string =>
  `mcp:${server}:${tool}`;
