/**
 * The provider's failure behaviour, and the exit statuses the CLI reports.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHeadless } from "../../src/cli/headless.js";
import { createOpenAiCompatibleProvider } from "../../src/providers/openai-compatible.js";
import { startMockServer, type MockServer } from "../support/mock-server.js";

describe("provider failures", () => {
  let server: MockServer;

  beforeEach(async () => {
    server = await startMockServer({ MOCK_STATUS: "401" });
  });

  afterEach(async () => {
    await server.stop();
  });

  it("does not retry an authentication failure", async () => {
    const provider = createOpenAiCompatibleProvider({
      id: "mock",
      label: "Mock",
      baseUrl: server.baseUrl,
    });

    const events = [];
    for await (const event of provider.streamChat({
      model: "mock-model",
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }

    const failure = events.find((event) => event.type === "error");
    expect(failure?.type).toBe("error");
    if (failure?.type === "error") {
      expect(failure.error.code).toBe("unauthorized");
      expect(failure.error.retryable).toBe(false);
    }

    // The mock counts the requests it served: exactly one means no retry.
    const health = await fetch(`${server.baseUrl.replace("/v1", "")}/health`);
    const body = (await health.json()) as { requests: number };
    expect(body.requests).toBe(1);
  });

  it("names the setting to fix", async () => {
    const provider = createOpenAiCompatibleProvider({
      id: "mock",
      label: "Mock",
      baseUrl: server.baseUrl,
    });

    for await (const event of provider.streamChat({
      model: "mock-model",
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (event.type === "error") {
        expect(event.error.remediation).toContain("apiKeyEnv");
      }
    }
  });
});

describe("the headless exit statuses", () => {
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "flowcode-status-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-status-work-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  it("fails when the provider cannot be reached", async () => {
    const status = await runHeadless({
      task: "hello",
      cwd: workspace,
      home,
      env: {},
      stdout: () => undefined,
      stderr: () => undefined,
      outputFormat: "text",
      provider: "custom",
      baseUrl: "http://127.0.0.1:1/v1",
      model: "mock-model",
    });

    expect(status).toBe(1);
  });

  it("reports an unknown provider", async () => {
    const messages: string[] = [];
    const status = await runHeadless({
      task: "hello",
      cwd: workspace,
      home,
      env: {},
      stdout: () => undefined,
      stderr: (text) => void messages.push(text),
      outputFormat: "text",
      provider: "not-a-provider",
    });

    expect(status).toBe(1);
    expect(messages.join("\n")).toContain("not a provider Flow Code knows about");
  });

  it("carries out a task and exits with zero", async () => {
    const server = await startMockServer({ MOCK_SCENARIO: "text" });
    try {
      await writeFile(join(workspace, "README.md"), "# hi\n", "utf8");
      const out: string[] = [];
      const status = await runHeadless({
        task: "say hello",
        cwd: workspace,
        home,
        env: {},
        stdout: (text) => void out.push(text),
        stderr: () => undefined,
        outputFormat: "text",
        provider: "custom",
        baseUrl: server.baseUrl,
        model: "mock-model",
      });

      expect(status).toBe(0);
      expect(out.join("")).toContain("Mock answer");
    } finally {
      await server.stop();
    }
  });
});
