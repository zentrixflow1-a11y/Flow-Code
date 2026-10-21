import { describe, expect, it } from "vitest";
import { providerOrigin, parseModelList, trimTrailingSlash } from "./discovery.js";

describe("trimTrailingSlash", () => {
  it("removes a single trailing slash", () => {
    expect(trimTrailingSlash("http://x/v1/")).toBe("http://x/v1");
    expect(trimTrailingSlash("http://x/v1")).toBe("http://x/v1");
  });
});

describe("providerOrigin", () => {
  it("strips the version suffix", () => {
    expect(providerOrigin("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434");
    expect(providerOrigin("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434");
  });

  it("leaves a URL without a version suffix alone", () => {
    expect(providerOrigin("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434");
  });
});

describe("parseModelList", () => {
  it("reads the OpenAI shape", () => {
    const result = parseModelList(
      JSON.stringify({ object: "list", data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((model) => model.id)).toEqual(["gpt-4o-mini", "gpt-4o"]);
    }
  });

  it("reads the Ollama shape", () => {
    const result = parseModelList(
      JSON.stringify({ models: [{ name: "qwen2.5-coder:7b" }, { model: "llama3" }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((model) => model.id)).toEqual(["qwen2.5-coder:7b", "llama3"]);
    }
  });

  it("reads the display name and context length when present", () => {
    const result = parseModelList(
      JSON.stringify({ models: [{ name: "m", display_name: "Model M", context_length: 32768 }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.label).toBe("Model M");
      expect(result.value[0]?.contextWindow).toBe(32768);
    }
  });

  it("reports a body that is not JSON", () => {
    const result = parseModelList("not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("malformed_response");
    }
  });

  it("reports an empty listing", () => {
    const result = parseModelList(JSON.stringify({ data: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.remediation).toContain("by hand");
    }
  });
});
