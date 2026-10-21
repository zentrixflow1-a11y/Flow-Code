import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  effectiveRules,
  fromEnvironmentOverrides,
  loadConfig,
  locateConfigFiles,
  mergeLayers,
  parseMode,
} from "./load.js";

describe("mergeLayers", () => {
  it("takes scalars from the last layer", () => {
    const config = mergeLayers([
      { provider: { provider: "ollama", model: "a" } },
      { provider: { provider: "deepseek" } },
    ]);
    expect(config.provider.provider).toBe("deepseek");
    expect(config.provider.model).toBe("a");
  });

  it("merges the rule lists rather than replacing them", () => {
    const config = mergeLayers([
      { permissions: { allow: ["a"], deny: ["d1"] } },
      { permissions: { allow: ["b"], deny: ["d2"] } },
    ]);
    expect(config.permissions.allow).toEqual(["a", "b"]);
    expect(config.permissions.deny).toEqual(["d1", "d2"]);
  });

  it("ignores a permission mode that is not one", () => {
    const config = mergeLayers([{ permissions: { mode: "nonsense" } }]);
    expect(config.permissions.mode).toBe("ask");
  });

  it("accepts a known permission mode", () => {
    const config = mergeLayers([{ permissions: { mode: "safe" } }]);
    expect(config.permissions.mode).toBe("safe");
  });
});

describe("parseMode", () => {
  it("reads the known modes", () => {
    expect(parseMode("plan")).toBe("plan");
    expect(parseMode("safe")).toBe("safe");
  });

  it("ignores anything else", () => {
    expect(parseMode("yolo")).toBeUndefined();
    expect(parseMode(undefined)).toBeUndefined();
  });
});

describe("fromEnvironmentOverrides", () => {
  it("reads the provider settings", () => {
    const overrides = fromEnvironmentOverrides({
      FLOWCODE_PROVIDER: "ollama",
      FLOWCODE_MODEL: "qwen2.5-coder",
      FLOWCODE_BASE_URL: "http://127.0.0.1:1234/v1",
    });
    expect(overrides.provider).toEqual({
      provider: "ollama",
      model: "qwen2.5-coder",
      baseUrl: "http://127.0.0.1:1234/v1",
    });
  });

  it("reads the permission mode", () => {
    expect(
      fromEnvironmentOverrides({ FLOWCODE_PERMISSION_MODE: "accept_edits" }).permissions?.mode,
    ).toBe("accept_edits");
  });

  it("returns nothing when the environment says nothing", () => {
    expect(fromEnvironmentOverrides({})).toEqual({});
  });
});

describe("loadConfig", () => {
  let home: string;
  let project: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "flowcode-home-"));
    project = await mkdtemp(join(tmpdir(), "flowcode-project-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  });

  it("falls back to the defaults", async () => {
    const result = await loadConfig({ home, cwd: project, env: {} });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.permissions.mode).toBe("ask");
      expect(result.value.provider.provider).toBe("ollama");
    }
  });

  it("reads the user's configuration", async () => {
    const sources = locateConfigFiles(home, project);
    await mkdir(join(home, ".flowcode"), { recursive: true });
    await writeFile(
      sources.user as string,
      JSON.stringify({ provider: { provider: "deepseek", model: "deepseek-chat" } }),
      "utf8",
    );

    const result = await loadConfig({ home, cwd: project, env: {} });
    if (result.ok) {
      expect(result.value.provider.provider).toBe("deepseek");
      expect(result.value.provider.model).toBe("deepseek-chat");
    }
  });

  it("lets the project override the user", async () => {
    const sources = locateConfigFiles(home, project);
    await mkdir(join(home, ".flowcode"), { recursive: true });
    await writeFile(
      sources.user as string,
      JSON.stringify({ provider: { provider: "deepseek" } }),
      "utf8",
    );
    await mkdir(join(project, ".flowcode"), { recursive: true });
    await writeFile(
      sources.project as string,
      JSON.stringify({ provider: { provider: "ollama" } }),
      "utf8",
    );

    const result = await loadConfig({ home, cwd: project, env: {} });
    if (result.ok) {
      expect(result.value.provider.provider).toBe("ollama");
    }
  });

  it("lets the environment override the files", async () => {
    const sources = locateConfigFiles(home, project);
    await mkdir(join(home, ".flowcode"), { recursive: true });
    await writeFile(
      sources.user as string,
      JSON.stringify({ provider: { provider: "deepseek" } }),
      "utf8",
    );

    const result = await loadConfig({
      home,
      cwd: project,
      env: { FLOWCODE_PROVIDER: "openrouter" },
    });
    if (result.ok) {
      expect(result.value.provider.provider).toBe("openrouter");
    }
  });

  it("lets the command line override everything", async () => {
    const result = await loadConfig({
      home,
      cwd: project,
      env: { FLOWCODE_PROVIDER: "openrouter" },
      overrides: { provider: { provider: "groq" } },
    });
    if (result.ok) {
      expect(result.value.provider.provider).toBe("groq");
    }
  });

  it("reports a configuration file that is not valid JSON", async () => {
    const sources = locateConfigFiles(home, project);
    await mkdir(join(home, ".flowcode"), { recursive: true });
    await writeFile(sources.user as string, "{ not json", "utf8");

    const result = await loadConfig({ home, cwd: project, env: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_request");
    }
  });
});

describe("effectiveRules", () => {
  it("includes the built-in deny rules", async () => {
    const config = mergeLayers([]);
    const rules = effectiveRules(config);
    expect(rules.deny.some((rule) => rule.includes(".env"))).toBe(true);
  });

  it("keeps the user's allow rules", async () => {
    const config = mergeLayers([{ permissions: { allow: ["run_command:ls *"] } }]);
    expect(effectiveRules(config).allow).toContain("run_command:ls *");
  });
});
