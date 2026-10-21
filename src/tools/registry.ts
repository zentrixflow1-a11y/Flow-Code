/**
 * The registry of tools the model can call.
 */
import type { JsonSchema, ToolDefinition as ProviderToolDefinition } from "../providers/types.js";
import { toJsonSchema } from "./schemas.js";
import type { ToolDefinition } from "./types.js";

/**
 * The JSON Schema for a tool's arguments.
 *
 * A tool that brings its own schema — an MCP tool, for instance — uses it
 * as it is; the rest are generated from their Zod schema.
 */
export const parametersOf = (tool: ToolDefinition<unknown>): JsonSchema => {
  if (tool.parameters !== undefined) {
    return tool.parameters;
  }
  if (tool.schema === undefined) {
    return { type: "object", properties: {} };
  }
  return toJsonSchema(tool.schema as never) as JsonSchema;
};

/** A tool definition with its argument type erased, for storage. */
type StoredTool = ToolDefinition<never>;

/** The tool registry. */
export class ToolRegistry {
  readonly #tools = new Map<string, StoredTool>();

  /**
   * Add a tool.
   *
   * Registering the same name twice replaces the earlier definition, which
   * lets a plugin override a built-in.
   */
  register<A>(definition: ToolDefinition<A>): void {
    this.#tools.set(definition.name, definition as unknown as StoredTool);
  }

  /** Add several tools at once. */
  registerAll(definitions: readonly ToolDefinition<never>[]): void {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  /** Look a tool up by name. */
  get(name: string): ToolDefinition<unknown> | undefined {
    return this.#tools.get(name) as ToolDefinition<unknown> | undefined;
  }

  /** Whether a tool with this name exists. */
  has(name: string): boolean {
    return this.#tools.has(name);
  }

  /** Every registered tool, in registration order. */
  list(): readonly ToolDefinition<unknown>[] {
    return [...this.#tools.values()] as ToolDefinition<unknown>[];
  }

  /** How many tools are registered. */
  get size(): number {
    return this.#tools.size;
  }

  /**
   * The tools to offer the model.
   *
   * A tool named by a bare deny rule is left out entirely, so the model never
   * sees it and cannot ask for it.
   *
   * @param denied - The tool names to leave out.
   */
  advertised(denied: ReadonlySet<string>): readonly ToolDefinition<unknown>[] {
    return this.list().filter((tool) => !denied.has(tool.name));
  }

  /**
   * The provider-facing description of the offered tools.
   *
   * @param denied - The tool names to leave out.
   */
  toProviderTools(denied: ReadonlySet<string>): readonly ProviderToolDefinition[] {
    return this.advertised(denied).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: parametersOf(tool),
    }));
  }

  /**
   * The total size of the offered tool schemas, in bytes.
   *
   * Tool schemas are a real cost in the model's context, so this is measured
   * and reported rather than assumed.
   *
   * @param denied - The tool names to leave out.
   */
  schemaBytes(denied: ReadonlySet<string>): number {
    return this.toProviderTools(denied).reduce(
      (total, tool) => total + Buffer.byteLength(JSON.stringify(tool), "utf8"),
      0,
    );
  }
}
