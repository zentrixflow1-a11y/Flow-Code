import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isTrustedDirectory,
  listProjectFiles,
  readTrustStore,
  resolveTrust,
  resolveWorkspaceTrust,
  trustDirectory,
  trustStorePath,
  writeTrustStore,
} from "./trust.js";

describe("the trust store", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "flowcode-trust-home-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("is empty when it is not there", async () => {
    const store = await readTrustStore(home);
    expect(store.directories).toEqual([]);
  });

  it("round-trips the trusted directories", async () => {
    const saved = await writeTrustStore(home, {
      version: 1,
      directories: ["/one", "/two"],
    });
    expect(saved.ok).toBe(true);

    const store = await readTrustStore(home);
    expect(store.directories).toEqual(["/one", "/two"]);
  });

  it("trusts nothing when the file is not valid JSON", async () => {
    await mkdir(join(home, ".flowcode"), { recursive: true });
    await writeFile(trustStorePath(home), "{ not json", "utf8");

    const store = await readTrustStore(home);
    expect(store.directories).toEqual([]);
  });

  it("is kept in the user's own directory", () => {
    expect(trustStorePath(home)).toBe(join(home, ".flowcode", "trusted.json"));
  });
});

describe("trusting a directory", () => {
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "flowcode-trust-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-trust-work-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  it("remembers a directory", async () => {
    expect(await isTrustedDirectory({ home, directory: workspace })).toBe(false);

    const saved = await trustDirectory({ home, directory: workspace });
    expect(saved.ok).toBe(true);
    expect(await isTrustedDirectory({ home, directory: workspace })).toBe(true);
  });

  it("does not trust a directory that was never asked about", async () => {
    await trustDirectory({ home, directory: workspace });
    const other = await mkdtemp(join(tmpdir(), "flowcode-trust-other-"));
    try {
      expect(await isTrustedDirectory({ home, directory: other })).toBe(false);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("does not trust a directory without a way to ask", async () => {
    const decision = await resolveTrust({ home, cwd: workspace });
    expect(decision.trusted).toBe(false);
    expect(decision.reason).not.toBe("");
  });

  it("asks, and trusts the directory when the answer is yes", async () => {
    const questions: string[] = [];
    const decision = await resolveTrust({
      home,
      cwd: workspace,
      confirm: async (question) => {
        questions.push(question);
        return true;
      },
    });

    expect(decision.trusted).toBe(true);
    expect(questions.length).toBe(1);
    expect(questions[0]).toContain(workspace);
    expect(await isTrustedDirectory({ home, directory: workspace })).toBe(true);
  });

  it("does not trust the directory when the answer is no", async () => {
    const decision = await resolveTrust({
      home,
      cwd: workspace,
      confirm: async () => false,
    });

    expect(decision.trusted).toBe(false);
    expect(await isTrustedDirectory({ home, directory: workspace })).toBe(false);
  });

  it("trusts a directory that is already in the store without asking", async () => {
    await trustDirectory({ home, directory: workspace });

    let asked = false;
    const decision = await resolveTrust({
      home,
      cwd: workspace,
      confirm: async () => {
        asked = true;
        return false;
      },
    });

    expect(asked).toBe(false);
    expect(decision.trusted).toBe(true);
  });
});

describe("the project's own files", () => {
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "flowcode-trust-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-trust-work-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  it("finds none in an empty directory", async () => {
    expect(await listProjectFiles(workspace)).toEqual([]);
  });

  it("finds the configuration, the hooks and the servers", async () => {
    await mkdir(join(workspace, ".flowcode"), { recursive: true });
    await writeFile(join(workspace, ".flowcode", "config.json"), "{}", "utf8");
    await writeFile(join(workspace, ".flowcode", "hooks.json"), "{}", "utf8");
    await writeFile(join(workspace, ".flowcode", "mcp.json"), "{}", "utf8");

    const files = await listProjectFiles(workspace);
    expect(files).toContain(".flowcode/config.json");
    expect(files).toContain(".flowcode/hooks.json");
    expect(files).toContain(".flowcode/mcp.json");
  });

  it("does not ask about a directory with no files of its own", async () => {
    let asked = false;
    const decision = await resolveWorkspaceTrust({
      home,
      cwd: workspace,
      confirm: async () => {
        asked = true;
        return true;
      },
    });

    expect(asked).toBe(false);
    expect(decision.trusted).toBe(true);
  });

  it("says which files were ignored", async () => {
    await mkdir(join(workspace, ".flowcode"), { recursive: true });
    await writeFile(join(workspace, ".flowcode", "hooks.json"), "{}", "utf8");

    const decision = await resolveWorkspaceTrust({
      home,
      cwd: workspace,
    });

    expect(decision.trusted).toBe(false);
    expect(decision.ignored).toContain(".flowcode/hooks.json");
  });
});
