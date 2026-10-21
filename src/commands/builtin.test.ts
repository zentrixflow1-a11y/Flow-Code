import { describe, expect, it } from "vitest";
import { COMMANDS, runCommand } from "./builtin.js";
import type { CommandServices } from "./types.js";
import { DEFAULT_CONFIG } from "../config/types.js";
import { ok } from "../util/result.js";
import type { ModelInfo, ModelProvider } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";

const provider: ModelProvider = {
  id: "mock",
  label: "Mock",
  listModels: async () => ok<ModelInfo[]>([{ id: "mock-model" }]),
  streamChat: async function* () {
    yield { type: "done", reason: "stop" };
  },
};

const buildServices = (overrides: Partial<CommandServices> = {}): CommandServices => ({
  config: DEFAULT_CONFIG,
  provider,
  registry: new ToolRegistry(),
  listModels: async () => [{ id: "mock-model" }],
  setModel: async () => ok(undefined),
  setPermissionMode: () => undefined,
  clear: async () => undefined,
  compact: async () => "Compacted.",
  exit: () => undefined,
  cwd: "/project",
  ...overrides,
});

describe("the built-in commands", () => {
  it("lists the commands that exist", () => {
    const names = COMMANDS.map((command) => command.name);
    expect(names).toContain("help");
    expect(names).toContain("model");
    expect(names).toContain("clear");
    expect(names).toContain("compact");
    expect(names).toContain("plan");
    expect(names).toContain("exit");
  });

  it("does not return anything for a command it does not have", async () => {
    const outcome = await runCommand("nope", "", buildServices());
    expect(outcome).toBeUndefined();
  });

  it("shows the help", async () => {
    const outcome = await runCommand("help", "", buildServices());
    expect(outcome?.output).toContain("/model");
    expect(outcome?.output).toContain("/compact");
  });

  it("lists the providers and the models", async () => {
    const outcome = await runCommand("model", "", buildServices());
    expect(outcome?.output).toContain("ollama");
    expect(outcome?.output).toContain("mock-model");
  });

  it("switches the model", async () => {
    let switched: [string, string] | undefined;
    const outcome = await runCommand(
      "model",
      "ollama qwen2.5-coder",
      buildServices({
        setModel: async (providerName, model) => {
          switched = [providerName, model];
          return ok(undefined);
        },
      }),
    );

    expect(switched).toEqual(["ollama", "qwen2.5-coder"]);
    expect(outcome?.output).toContain("ollama");
  });

  it("reports a model it cannot switch to", async () => {
    const outcome = await runCommand(
      "model",
      "nope",
      buildServices({
        setModel: async () => ({
          ok: false,
          error: { code: "invalid_request", message: "unknown provider", retryable: false },
        }),
      }),
    );
    expect(outcome?.output).toContain("unknown provider");
  });

  it("clears the conversation", async () => {
    let cleared = false;
    const outcome = await runCommand(
      "clear",
      "",
      buildServices({
        clear: async () => {
          cleared = true;
        },
      }),
    );
    expect(cleared).toBe(true);
    expect(outcome?.action).toBe("clear");
  });

  it("compacts the conversation", async () => {
    const outcome = await runCommand("compact", "", buildServices());
    expect(outcome?.output).toBe("Compacted.");
    expect(outcome?.action).toBe("compact");
  });

  it("switches to plan mode and back", async () => {
    let current = DEFAULT_CONFIG;
    const services = { ...buildServices() };
    // The configuration is read live, the way a session exposes it.
    Object.defineProperty(services, "config", {
      get: () => current,
      enumerable: true,
    });
    services.setPermissionMode = (next) => {
      current = {
        ...current,
        permissions: { ...current.permissions, mode: next },
      };
    };

    const on = await runCommand("plan", "", services);
    expect(current.permissions.mode).toBe("plan");
    expect(on?.output).toContain("Plan mode is on");

    const off = await runCommand("plan", "off", services);
    expect(current.permissions.mode).toBe("ask");
    expect(off?.output).toContain("off");
  });

  it("shows the status", async () => {
    const outcome = await runCommand("status", "", buildServices());
    expect(outcome?.output).toContain("Mode:");
    expect(outcome?.output).toContain("/project");
  });

  it("shows the permission rules", async () => {
    const outcome = await runCommand("permissions", "", buildServices());
    expect(outcome?.output).toContain("Mode: ask");
    expect(outcome?.output).toContain("Allow:");
  });

  it("leaves the session", async () => {
    let exited = false;
    const outcome = await runCommand(
      "exit",
      "",
      buildServices({
        exit: () => {
          exited = true;
        },
      }),
    );
    expect(exited).toBe(true);
    expect(outcome?.action).toBe("exit");
  });
});
