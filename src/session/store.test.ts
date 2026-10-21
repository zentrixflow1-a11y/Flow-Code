import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionLog } from "./log.js";
import { createSessionId, listSessions, projectSlug, sessionsRoot } from "./store.js";

describe("projectSlug", () => {
  it("is readable and stable", () => {
    const slug = projectSlug("/home/user/my-project");
    expect(slug).toBe(projectSlug("/home/user/my-project"));
    expect(slug.startsWith("my-project-")).toBe(true);
  });

  it("differs between two directories with the same name", () => {
    expect(projectSlug("/a/project")).not.toBe(projectSlug("/b/project"));
  });

  it("survives a directory name with odd characters", () => {
    expect(projectSlug("/home/user/my project!")).toMatch(/^my-project-\w{8}$/);
  });
});

describe("sessionsRoot", () => {
  it("sits under the user's home", () => {
    expect(sessionsRoot("/home/user")).toBe(join("/home/user", ".flowcode", "sessions"));
  });
});

describe("createSessionId", () => {
  it("is unique", () => {
    const now = new Date("2026-10-21T20:45:01.000Z");
    expect(createSessionId(now)).not.toBe(createSessionId(now));
  });

  it("starts with the date", () => {
    const now = new Date("2026-10-21T20:45:01.000Z");
    expect(createSessionId(now).startsWith("20261021")).toBe(true);
  });
});

describe("listSessions", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "flowcode-store-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists the sessions of a project, newest first", async () => {
    const slug = "project-1234abcd";
    const first = await SessionLog.create(
      join(root, slug, "a.jsonl"),
      {
        id: "a",
        cwd: "/project",
        startedAt: 1000,
        flowCodeVersion: "0.1.0",
        provider: "ollama",
        model: "mock-model",
      },
    );
    await first.close();

    const second = await SessionLog.create(
      join(root, slug, "b.jsonl"),
      {
        id: "b",
        cwd: "/project",
        startedAt: 2000,
        flowCodeVersion: "0.1.0",
        provider: "ollama",
        model: "mock-model",
      },
    );
    await second.close();

    const sessions = await listSessions(root, slug);
    expect(sessions.map((session) => session.id)).toEqual(["b", "a"]);
    expect(sessions[0]?.model).toBe("mock-model");
  });

  it("returns nothing for a project with no sessions", async () => {
    expect(await listSessions(root, "unknown")).toEqual([]);
  });
});
