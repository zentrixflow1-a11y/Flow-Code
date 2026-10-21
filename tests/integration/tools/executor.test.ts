/**
 * The executor: validation, redaction, and output capping.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { executeTool } from "../../../src/tools/executor.js";
import { toJsonSchema } from "../../../src/tools/schemas.js";
import { ToolRegistry } from "../../../src/tools/registry.js";
import { createRedactor } from "../../../src/util/redact.js";
import { capOutput, MAX_TOOL_OUTPUT_BYTES } from "../../../src/util/text.js";
import type { ToolContext, ToolDefinition } from "../../../src/tools/types.js";

const context = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  cwd: process.cwd(),
  workspaceRoot: process.cwd(),
  additionalDirectories: [],
  env: process.env,
  redact: createRedactor(),
  platform: process.platform,
  caseInsensitivePaths: process.platform === "win32",
  ...overrides,
});

const echoTool: ToolDefinition<{ text: string }> = {
  name: "echo",
  description: "Echo the text back.",
  schema: z.object({ text: z.string() }),
  category: "read",
  subjectKind: "text",
  concurrencySafe: true,
  async execute(args) {
    return { ok: true, output: args.text };
  },
};

describe("executeTool", () => {
  it("runs a tool with valid arguments", async () => {
    const result = await executeTool(echoTool, { text: "hello" }, context());
    expect(result).toEqual({ ok: true, output: "hello" });
  });

  it("rejects arguments that do not match the schema", async () => {
    const result = await executeTool(echoTool, { text: 42 }, context());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_request");
      expect(result.error.remediation).toContain("text");
    }
  });

  it("turns a thrown error into a result the model can read", async () => {
    const throwing: ToolDefinition<Record<string, never>> = {
      name: "boom",
      description: "Always fails.",
      schema: z.object({}),
      category: "read",
      subjectKind: "text",
      concurrencySafe: true,
      async execute() {
        throw new Error("it exploded");
      },
    };

    const result = await executeTool(throwing, {}, context());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("tool_failed");
      expect(result.error.message).toContain("it exploded");
    }
  });

  it("redacts secrets from the output", async () => {
    const result = await executeTool(
      echoTool,
      { text: "the key is AKIAIOSFODNN7EXAMPLE" },
      context(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(result.output).toContain("[redacted]");
    }
  });

  it("redacts secrets from an error message", async () => {
    const failing: ToolDefinition<Record<string, never>> = {
      name: "boom",
      description: "Always fails.",
      schema: z.object({}),
      category: "read",
      subjectKind: "text",
      concurrencySafe: true,
      async execute() {
        return {
          ok: false,
          error: {
            code: "tool_failed",
            message: "failed with AKIAIOSFODNN7EXAMPLE",
            retryable: false,
          },
        };
      },
    };

    const result = await executeTool(failing, {}, context());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain("AKIAIOSFODNN7EXAMPLE");
    }
  });

  it("caps a very long output", async () => {
    const result = await executeTool(
      echoTool,
      { text: "x".repeat(MAX_TOOL_OUTPUT_BYTES * 2) },
      context(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.length).toBeLessThan(MAX_TOOL_OUTPUT_BYTES * 2);
      expect(result.output).toContain("bytes omitted");
    }
  });
});

describe("toJsonSchema", () => {
  it("produces a schema with the properties", () => {
    const schema = toJsonSchema(z.object({ path: z.string() }) as never);
    expect(schema["type"]).toBe("object");
    expect((schema["properties"] as Record<string, unknown>)["path"]).toBeDefined();
  });

  it("closes the object so models cannot invent arguments", () => {
    const schema = toJsonSchema(z.object({ path: z.string() }) as never);
    expect(schema["additionalProperties"]).toBe(false);
  });
});

describe("ToolRegistry", () => {
  it("registers and finds tools", () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    expect(registry.has("echo")).toBe(true);
    expect(registry.get("echo")?.name).toBe("echo");
    expect(registry.size).toBe(1);
  });

  it("leaves out a denied tool entirely", () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    expect(registry.advertised(new Set(["echo"]))).toEqual([]);
    expect(registry.toProviderTools(new Set(["echo"]))).toEqual([]);
  });

  it("measures the size of the offered schemas", () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    expect(registry.schemaBytes(new Set())).toBeGreaterThan(0);
    expect(registry.schemaBytes(new Set(["echo"]))).toBe(0);
  });
});

describe("capOutput", () => {
  it("leaves short text alone", () => {
    const capped = capOutput("hello", 100);
    expect(capped.text).toBe("hello");
    expect(capped.truncated).toBe(false);
  });

  it("keeps the beginning and the end of long text", () => {
    const capped = capOutput(`${"a".repeat(200)}END`, 100);
    expect(capped.truncated).toBe(true);
    expect(capped.text).toContain("END");
    expect(capped.text).toContain("bytes omitted");
  });
});
