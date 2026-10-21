/**
 * The setup wizard and the health check.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSetup } from "../../src/setup/wizard.js";
import { probeProviders } from "../../src/setup/probe.js";
import { runDoctor } from "../../src/doctor.js";
import { LOCAL_PRESETS } from "../../src/providers/presets.js";

describe("the setup wizard", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "flowcode-setup-home-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("reports when no server is running", async () => {
    const out: string[] = [];
    const err: string[] = [];

    const status = await runSetup({
      home,
      out: (text) => void out.push(text),
      err: (text) => void err.push(text),
    });

    // Nothing is running on this machine, so the wizard explains what to do.
    expect(status).toBe(1);
    expect(err.join("\n")).toContain("No model server was found");
    expect(err.join("\n")).toContain("Ollama");
  });

  it("writes the configuration for a provider it is told to use", async () => {
    const out: string[] = [];
    const err: string[] = [];

    const status = await runSetup({
      home,
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      out: (text) => void out.push(text),
      err: (text) => void err.push(text),
    });

    expect(status).toBe(0);

    const written = JSON.parse(
      await readFile(join(home, ".flowcode", "config.json"), "utf8"),
    ) as { provider: { provider: string; model: string } };

    expect(written.provider.provider).toBe("ollama");
    expect(written.provider.model).toBe("qwen2.5-coder:7b");
    expect(out.join("\n")).toContain("qwen2.5-coder:7b");
  });

  it("lists the servers it looked for", async () => {
    const out: string[] = [];
    await runSetup({
      home,
      provider: "ollama",
      model: "m",
      out: (text) => void out.push(text),
      err: () => undefined,
    });

    const text = out.join("\n");
    for (const preset of LOCAL_PRESETS) {
      expect(text).toContain(preset.label);
    }
  });
});

describe("the probe", () => {
  it("reports a server that is not running", async () => {
    const probes = await probeProviders([
      {
        id: "nothing",
        label: "Nothing",
        baseUrl: "http://127.0.0.1:1/v1",
        local: true,
      },
    ]);

    expect(probes[0]?.reachable).toBe(false);
    expect(probes[0]?.models).toEqual([]);
    expect(probes[0]?.error).toBeDefined();
  });
});

describe("the health check", () => {
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "flowcode-doctor-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-doctor-work-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  it("reports the configuration and the tools", async () => {
    const out: string[] = [];
    const status = await runDoctor({
      cwd: workspace,
      home,
      env: {},
      out: (text) => void out.push(text),
    });

    const text = out.join("\n");
    expect(text).toContain("Flow Code doctor");
    expect(text).toContain("Configuration");
    expect(text).toContain("Tools");
    expect(text).toContain("Permissions");
    // Nothing is running, so the connection check fails.
    expect(status).toBe(1);
  });

  it("writes nothing", async () => {
    const out: string[] = [];
    await runDoctor({
      cwd: workspace,
      home,
      env: {},
      out: (text) => void out.push(text),
    });

    await expect(readFile(join(home, ".flowcode", "config.json"), "utf8")).rejects.toThrow();
  });
});
