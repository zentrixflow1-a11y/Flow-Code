import { describe, expect, it } from "vitest";
import { resolveCompat } from "./compat.js";
import {
  buildMessages,
  buildRequestBody,
  buildTools,
  createOpenAiCompatibleProvider,
  mapFinishReason,
} from "./openai-compatible.js";
import type { ChatMessage, ToolDefinition } from "./types.js";

const TOOL: ToolDefinition = {
  name: "read_file",
  description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } } },
};

describe("buildMessages", () => {
  it("sends the system prompt as a system message by default", () => {
    const messages = buildMessages([{ role: "system", content: "be good" }], resolveCompat());
    expect(messages[0]).toEqual({ role: "system", content: "be good" });
  });

  it("sends the system prompt as a developer message when the provider wants that", () => {
    const compat = resolveCompat({ developerRole: true });
    const messages = buildMessages([{ role: "system", content: "be good" }], compat);
    expect(messages[0]).toEqual({ role: "developer", content: "be good" });
  });

  it("renders an assistant tool call the way OpenAI expects", () => {
    const messages = buildMessages(
      [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "read_file", args: { path: "a.ts" } }],
        },
      ],
      resolveCompat(),
    );

    expect(messages[0]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"a.ts"}' },
        },
      ],
    });
  });

  it("renders a tool result as a tool message", () => {
    const messages = buildMessages(
      [{ role: "tool", content: "contents", toolCallId: "call_1" }],
      resolveCompat(),
    );
    expect(messages[0]).toEqual({ role: "tool", tool_call_id: "call_1", content: "contents" });
  });

  it("renders a tool result as a user message when the provider wants that", () => {
    const compat = resolveCompat({ toolResultRole: "user" });
    const messages = buildMessages(
      [{ role: "tool", content: "contents", toolCallId: "call_1", name: "read_file" }],
      compat,
    );
    expect(messages[0]).toEqual({
      role: "user",
      content: "[tool result: read_file]\ncontents",
    });
  });
});

describe("buildTools", () => {
  it("wraps each tool as a function definition", () => {
    const tools = buildTools([TOOL], resolveCompat());
    expect(tools[0]).toEqual({
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file",
        parameters: TOOL.parameters,
      },
    });
  });

  it("adds the strict flag only when the provider accepts it", () => {
    const strict = buildTools([TOOL], resolveCompat({ strictToolSchema: true }));
    expect((strict[0] as { function: { strict?: boolean } }).function.strict).toBe(true);
  });
});

describe("buildRequestBody", () => {
  it("always streams", () => {
    const body = buildRequestBody({ model: "m", messages: [] }, resolveCompat());
    expect(body["stream"]).toBe(true);
  });

  it("uses the configured max-token field", () => {
    const compat = resolveCompat({ maxTokensField: "max_completion_tokens" });
    const body = buildRequestBody({ model: "m", messages: [], maxTokens: 100 }, compat);
    expect(body["max_completion_tokens"]).toBe(100);
    expect(body["max_tokens"]).toBeUndefined();
  });

  it("omits the tools array when there are no tools", () => {
    const body = buildRequestBody({ model: "m", messages: [] }, resolveCompat());
    expect(body["tools"]).toBeUndefined();
  });

  it("sends the parallel tool calls flag only when supported", () => {
    const withFlag = buildRequestBody(
      { model: "m", messages: [], tools: [TOOL] },
      resolveCompat({ parallelToolCalls: true }),
    );
    expect(withFlag["parallel_tool_calls"]).toBe(true);

    const without = buildRequestBody(
      { model: "m", messages: [], tools: [TOOL] },
      resolveCompat({ parallelToolCalls: false }),
    );
    expect(without["parallel_tool_calls"]).toBeUndefined();
  });
});

describe("mapFinishReason", () => {
  it("maps the known reasons", () => {
    expect(mapFinishReason("stop")).toBe("stop");
    expect(mapFinishReason("length")).toBe("length");
    expect(mapFinishReason("tool_calls")).toBe("tool_calls");
  });

  it("falls back to stop for an unknown reason", () => {
    expect(mapFinishReason("something_new")).toBe("stop");
  });
});

describe("createOpenAiCompatibleProvider", () => {
  it("exposes the provider identity", () => {
    const provider = createOpenAiCompatibleProvider({
      id: "ollama",
      label: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
    });
    expect(provider.id).toBe("ollama");
    expect(provider.label).toBe("Ollama");
  });
});

describe("ChatMessage", () => {
  it("keeps the role union honest", () => {
    const message: ChatMessage = { role: "user", content: "hi" };
    expect(message.role).toBe("user");
  });
});
