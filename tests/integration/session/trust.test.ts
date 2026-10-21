/**
 * How a session treats a directory's own files.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowSession } from "../../../src/agent/session.js";
import { startMockServer, type MockServer } from "../../support/mock-server.js";

describe("a session in a directory that is not trusted", () => {
  let server: MockServer;
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    server = await startMockServer({ MOCK_SCENARIO: "tour" });
    home = await mkdtemp(join(tmpdir(), "flowcode-trust-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-trust-work-"));

    await mkdir(join(workspace, ".flowcode"), { recursive: true });
    await writeFile(
      join(workspace, ".flowcode", "hooks.json"),
      JSON.stringify({
        hooks: { pre_tool_use: [{ matcher: "*", command: "echo hello" }] },
      }),
      "utf8",
    );
  });

  afterEach(async () => {
    await server.stop();
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  const create = async (
    confirmTrust: (question: string) => Promise<boolean>,
  ): Promise<FlowSession> => {
    const session = await FlowSession.create({
      cwd: workspace,
      home,
      env: {},
      confirmTrust,
      overrides: {
        provider: "custom",
        baseUrl: server.baseUrl,
        model: "mock-model",
      },
    });
    expect(session.ok).toBe(true);
    if (!session.ok) {
      throw new Error(session.error.message);
    }
    return session.value;
  };

  it("asks about the directory", async () => {
    const questions: string[] = [];
    const session = await create(async (question) => {
      questions.push(question);
      return true;
    });

    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain(workspace);
    await session.close();
  });

  it("ignores the project's hooks when the answer is no", async () => {
    const session = await create(async () => false);

    expect(session.workspaceTrusted).toBe(false);
    expect(session.hooks).toEqual([]);
    expect(session.trustNote).not.toBe("");
    await session.close();
  });

  it("reads the project's hooks when the answer is yes", async () => {
    const session = await create(async () => true);

    expect(session.workspaceTrusted).toBe(true);
    expect(session.hooks).toHaveLength(1);
    expect(session.hooks[0]?.event).toBe("pre_tool_use");
    await session.close();
  });

  it("ignores the project's hooks when there is nobody to ask", async () => {
    const session = await FlowSession.create({
      cwd: workspace,
      home,
      env: {},
      overrides: {
        provider: "custom",
        baseUrl: server.baseUrl,
        model: "mock-model",
      },
    });

    expect(session.ok).toBe(true);
    if (!session.ok) {
      return;
    }
    expect(session.value.workspaceTrusted).toBe(false);
    expect(session.value.hooks).toEqual([]);
    await session.value.close();
  });
});
