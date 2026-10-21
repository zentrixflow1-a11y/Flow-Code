/**
 * Integration tests for the provider layer, against the real mock server.
 *
 * These exercise the whole path — a real HTTP request, a real SSE stream, the
 * real adapter — without needing a model or an API key.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOpenAiCompatibleProvider } from "../../../src/providers/openai-compatible.js";
import type { ProviderEvent } from "../../../src/providers/types.js";
import { startMockServer, type MockServer } from "../../support/mock-server.js";

/** Collect every event a stream produces. */
const collect = async (
  events: AsyncIterable<ProviderEvent>,
): Promise<ProviderEvent[]> => {
  const out: ProviderEvent[] = [];
  for await (const event of events) {
    out.push(event);
  }
  return out;
};

describe("the mock provider", () => {
  let server: MockServer;

  beforeAll(async () => {
    server = await startMockServer({ MOCK_SCENARIO: "text" });
  });

  afterAll(async () => {
    await server.stop();
  });

  it("streams a text answer", async () => {
    const provider = createOpenAiCompatibleProvider({
      id: "mock",
      label: "Mock",
      baseUrl: server.baseUrl,
    });

    const events = await collect(
      provider.streamChat({ model: "mock-model", messages: [{ role: "user", content: "hi" }] }),
    );

    const text = events
      .filter((event) => event.type === "text_delta")
      .map((event) => (event.type === "text_delta" ? event.text : ""))
      .join("");

    expect(text).toContain("Mock answer");
    expect(events.at(-1)).toEqual({ type: "done", reason: "stop" });
  });

  it("lists the models the server reports", async () => {
    const provider = createOpenAiCompatibleProvider({
      id: "mock",
      label: "Mock",
      baseUrl: server.baseUrl,
    });

    const result = await provider.listModels();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((model) => model.id)).toContain("mock-model");
    }
  });
});

describe("the mock provider, tool-calling scenario", () => {
  let server: MockServer;

  beforeAll(async () => {
    server = await startMockServer({ MOCK_SCENARIO: "tour" });
  });

  afterAll(async () => {
    await server.stop();
  });

  it("emits a tool call and reports a tool_calls finish reason", async () => {
    const provider = createOpenAiCompatibleProvider({
      id: "mock",
      label: "Mock",
      baseUrl: server.baseUrl,
    });

    const events = await collect(
      provider.streamChat({ model: "mock-model", messages: [{ role: "user", content: "read it" }] }),
    );

    const call = events.find((event) => event.type === "tool_call");
    expect(call).toBeDefined();
    if (call?.type === "tool_call") {
      expect(call.call.name).toBe("read_file");
      expect(call.call.args).toEqual({ path: "README.md" });
      expect(call.call.id).toBe("call_read");
    }
    expect(events.at(-1)).toEqual({ type: "done", reason: "tool_calls" });
  });
});

describe("the mock provider, fragmented tool call scenario", () => {
  let server: MockServer;

  beforeAll(async () => {
    server = await startMockServer({ MOCK_SCENARIO: "split" });
  });

  afterAll(async () => {
    await server.stop();
  });

  it("reassembles a tool call whose arguments arrive in fragments", async () => {
    const provider = createOpenAiCompatibleProvider({
      id: "mock",
      label: "Mock",
      baseUrl: server.baseUrl,
    });

    const events = await collect(
      provider.streamChat({ model: "mock-model", messages: [{ role: "user", content: "read it" }] }),
    );

    const call = events.find((event) => event.type === "tool_call");
    expect(call?.type).toBe("tool_call");
    if (call?.type === "tool_call") {
      expect(call.call.name).toBe("read_file");
      expect(call.call.args).toEqual({
        path: "a/very/long/path/that/arrives/in/fragments.md",
      });
    }
  });
});

describe("provider error handling", () => {
  it("reports an authentication failure without retrying", async () => {
    const server = await startMockServer({ MOCK_STATUS: "401" });
    try {
      const provider = createOpenAiCompatibleProvider({
        id: "mock",
        label: "Mock",
        baseUrl: server.baseUrl,
      });

      const events = await collect(
        provider.streamChat({ model: "mock-model", messages: [{ role: "user", content: "hi" }] }),
      );

      const failure = events.find((event) => event.type === "error");
      expect(failure?.type).toBe("error");
      if (failure?.type === "error") {
        expect(failure.error.code).toBe("unauthorized");
        expect(failure.error.retryable).toBe(false);
        expect(failure.error.remediation).toBeDefined();
      }
    } finally {
      await server.stop();
    }
  });

  it("reports a server failure as retryable", async () => {
    const server = await startMockServer({ MOCK_STATUS: "500" });
    try {
      const provider = createOpenAiCompatibleProvider({
        id: "mock",
        label: "Mock",
        baseUrl: server.baseUrl,
      });

      const events = await collect(
        provider.streamChat({ model: "mock-model", messages: [{ role: "user", content: "hi" }] }),
      );

      const failure = events.find((event) => event.type === "error");
      if (failure?.type === "error") {
        expect(failure.error.code).toBe("server_error");
        expect(failure.error.retryable).toBe(true);
      }
    } finally {
      await server.stop();
    }
  });

  it("reports a malformed stream", async () => {
    const server = await startMockServer({ MOCK_SCENARIO: "malformed" });
    try {
      const provider = createOpenAiCompatibleProvider({
        id: "mock",
        label: "Mock",
        baseUrl: server.baseUrl,
      });

      const events = await collect(
        provider.streamChat({ model: "mock-model", messages: [{ role: "user", content: "hi" }] }),
      );

      const failure = events.find((event) => event.type === "error");
      if (failure?.type === "error") {
        expect(failure.error.code).toBe("malformed_response");
      }
    } finally {
      await server.stop();
    }
  });

  it("reports an unreachable provider as a network error", async () => {
    const provider = createOpenAiCompatibleProvider({
      id: "mock",
      label: "Mock",
      // Port 1 is reserved and refuses connections.
      baseUrl: "http://127.0.0.1:1/v1",
    });

    const events = await collect(
      provider.streamChat({ model: "mock-model", messages: [{ role: "user", content: "hi" }] }),
    );

    const failure = events.find((event) => event.type === "error");
    if (failure?.type === "error") {
      expect(failure.error.code).toBe("network_error");
      expect(failure.error.retryable).toBe(true);
    }
  });
});
