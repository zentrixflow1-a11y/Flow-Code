/**
 * Turning an MCP server's tools into Flow Code tools.
 *
 * The tools are offered under Flow Code's own naming convention, and they
 * are gated by the permission engine like any other tool: an MCP server
 * cannot reach past the user's permission rules.
 */
import type { JsonSchema } from "../providers/types.js";
import type { ToolDefinition, ToolResult } from "../tools/types.js";
import { callMcpTool, type McpConnection } from "./client.js";
import { mcpToolName } from "./config.js";

/**
 * Build the Flow Code tools for a connected server.
 *
 * @param connection - The server.
 * @param options - How long the server's tool calls may take.
 */
export const bridgeTools = (
  connection: McpConnection,
  options: { readonly timeoutMs?: number } = {},
): readonly ToolDefinition<never>[] =>
  connection.tools.map((tool) => {
    const name = mcpToolName(connection.server, tool.name);
    const subject = `${connection.server}:${tool.name}`;

    const definition: ToolDefinition<never> = {
      name,
      description: tool.description === "" ? `The ${tool.name} tool.` : tool.description,
      parameters: normaliseSchema(tool.inputSchema),
      category: "network",
      subjectKind: "mcp",
      concurrencySafe: false,
      subject: () => subject,
      execute: async (args: never): Promise<ToolResult> => {
        const result = await callMcpTool(
          connection,
          tool.name,
          args,
          options.timeoutMs,
        );

        if (!result.ok) {
          return { ok: false, error: result.error };
        }

        if (!result.value.ok) {
          return {
            ok: false,
            error: {
              code: "tool_failed",
              message: result.value.text,
              retryable: false,
            },
          };
        }

        return {
          ok: true,
          output: result.value.text,
          ...(result.value.structured === undefined
            ? {}
            : { data: result.value.structured }),
        };
      },
    };

    return definition;
  });

/**
 * Make a tool's schema usable.
 *
 * A server that sends an unusual schema should not break the session, so an
 * unreadable one becomes an empty object.
 */
export const normaliseSchema = (schema: unknown): JsonSchema => {
  if (typeof schema !== "object" || schema === null) {
    return { type: "object", properties: {} };
  }
  const record = schema as Record<string, unknown>;
  return {
    type: typeof record["type"] === "string" ? record["type"] : "object",
    ...(typeof record["properties"] === "object" && record["properties"] !== null
      ? { properties: record["properties"] }
      : { properties: {} }),
    ...(record["required"] === undefined ? {} : { required: record["required"] }),
    ...(record["description"] === undefined
      ? {}
      : { description: record["description"] }),
  };
};
