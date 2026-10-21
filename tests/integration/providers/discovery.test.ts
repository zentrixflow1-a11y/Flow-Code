/**
 * Model discovery, against the real mock server.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listModels } from "../../../src/providers/discovery.js";
import { startMockServer, type MockServer } from "../../support/mock-server.js";

describe("model discovery", () => {
  let server: MockServer;

  beforeAll(async () => {
    server = await startMockServer();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("lists the models an OpenAI-shaped server reports", async () => {
    const result = await listModels(server.baseUrl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((model) => model.id)).toContain("mock-model");
    }
  });

  it("falls back to Ollama's native endpoint when /models is missing", async () => {
    const ollama = await startMockServer({ MOCK_NO_MODELS: "1" });
    try {
      const result = await listModels(ollama.baseUrl);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.map((model) => model.id)).toContain("mock-model");
      }
    } finally {
      await ollama.stop();
    }
  });

  it("reports a failure without throwing", async () => {
    const result = await listModels("http://127.0.0.1:1/v1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("network_error");
    }
  });
});
