/**
 * Stream-shape tests: the awkward orders a provider can produce.
 */
import { describe, expect, it } from "vitest";
import { createOpenAiCompatibleProvider } from "../../../src/providers/openai-compatible.js";
import type { ProviderEvent } from "../../../src/providers/types.js";
import { sseChunk, startScriptedServer } from "../../support/scripted-server.js";

const collect = async (
  events: AsyncIterable<ProviderEvent>,
): Promise<ProviderEvent[]> => {
  const out: ProviderEvent[] = [];
  for await (const event of events) {
    out.push(event);
  }
  return out;
};

describe("stream shapes", () => {
  it("keeps text and tool calls apart when they interleave", async () => {
    const body = [
      sseChunk({ content: "Let me look. " }),
      sseChunk({
        tool_calls: [
          { index: 0, id: "call_1", type: "function", function: { name: "read_file", arguments: "" } },
        ],
      }),
      sseChunk({ content: "Reading." }),
      sseChunk({
        tool_calls: [{ index: 0, function: { arguments: '{"path":"a.ts"}' } }],
      }),
      sseChunk({}, "tool_calls"),
      "data: [DONE]\n\n",
    ].join("");

    const server = await startScriptedServer(body);
    try {
      const provider = createOpenAiCompatibleProvider({
        id: "test",
        label: "Test",
        baseUrl: server.baseUrl,
      });

      const events = await collect(
        provider.streamChat({ model: "m", messages: [{ role: "user", content: "hi" }] }),
      );

      const text = events
        .filter((event) => event.type === "text_delta")
        .map((event) => (event.type === "text_delta" ? event.text : ""))
        .join("");
      expect(text).toBe("Let me look. Reading.");

      const call = events.find((event) => event.type === "tool_call");
      expect(call?.type).toBe("tool_call");
      if (call?.type === "tool_call") {
        expect(call.call.args).toEqual({ path: "a.ts" });
      }
      expect(events.at(-1)).toEqual({ type: "done", reason: "tool_calls" });
    } finally {
      await server.stop();
    }
  });

  it("gives a tool call without an id a generated one", async () => {
    const body = [
      sseChunk({
        tool_calls: [{ index: 0, function: { name: "list_dir", arguments: "{}" } }],
      }),
      sseChunk({}, "tool_calls"),
      "data: [DONE]\n\n",
    ].join("");

    const server = await startScriptedServer(body);
    try {
      const provider = createOpenAiCompatibleProvider({
        id: "test",
        label: "Test",
        baseUrl: server.baseUrl,
      });

      const events = await collect(
        provider.streamChat({ model: "m", messages: [{ role: "user", content: "hi" }] }),
      );

      const call = events.find((event) => event.type === "tool_call");
      if (call?.type === "tool_call") {
        expect(call.call.id).toBe("call_0");
      }
    } finally {
      await server.stop();
    }
  });

  it("reports a tool call whose arguments are not valid JSON", async () => {
    const body = [
      sseChunk({
        tool_calls: [
          { index: 0, id: "call_1", function: { name: "read_file", arguments: "{oops" } },
        ],
      }),
      sseChunk({}, "tool_calls"),
      "data: [DONE]\n\n",
    ].join("");

    const server = await startScriptedServer(body);
    try {
      const provider = createOpenAiCompatibleProvider({
        id: "test",
        label: "Test",
        baseUrl: server.baseUrl,
      });

      const events = await collect(
        provider.streamChat({ model: "m", messages: [{ role: "user", content: "hi" }] }),
      );

      const failure = events.find((event) => event.type === "error");
      expect(failure?.type).toBe("error");
      if (failure?.type === "error") {
        expect(failure.error.code).toBe("malformed_response");
      }
    } finally {
      await server.stop();
    }
  });

  it("reports a provider-reported error", async () => {
    const body = `data: ${JSON.stringify({
      error: { message: "the model is overloaded" },
    })}\n\n`;

    const server = await startScriptedServer(body);
    try {
      const provider = createOpenAiCompatibleProvider({
        id: "test",
        label: "Test",
        baseUrl: server.baseUrl,
      });

      const events = await collect(
        provider.streamChat({ model: "m", messages: [{ role: "user", content: "hi" }] }),
      );

      const failure = events.find((event) => event.type === "error");
      if (failure?.type === "error") {
        expect(failure.error.message).toBe("the model is overloaded");
      }
    } finally {
      await server.stop();
    }
  });

  it("reports the token usage the provider sends", async () => {
    const body = [
      sseChunk({ content: "hello" }),
      sseChunk({}, "stop"),
      `data: ${JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion.chunk",
        created: 0,
        model: "test-model",
        choices: [],
        usage: { prompt_tokens: 120, completion_tokens: 8 },
      })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");

    const server = await startScriptedServer(body);
    try {
      const provider = createOpenAiCompatibleProvider({
        id: "test",
        label: "Test",
        baseUrl: server.baseUrl,
      });

      const events = await collect(
        provider.streamChat({ model: "m", messages: [{ role: "user", content: "hi" }] }),
      );

      const usage = events.find((event) => event.type === "usage");
      expect(usage?.type).toBe("usage");
      if (usage?.type === "usage") {
        expect(usage.inputTokens).toBe(120);
        expect(usage.outputTokens).toBe(8);
      }
    } finally {
      await server.stop();
    }
  });
});
