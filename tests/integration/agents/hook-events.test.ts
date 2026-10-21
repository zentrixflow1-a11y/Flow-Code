/**
 * The hook events that are not about tools.
 *
 * `session_start`, `user_prompt_submit` and `session_end` are documented, so
 * they have to happen.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowSession } from "../../../src/agent/session.js";
import { startMockServer, type MockServer } from "../../support/mock-server.js";

/**
 * Remember the workspace as trusted, so the project's own files are read.
 */
const trustWorkspace = async (
  home: string,
  workspace: string,
): Promise<void> => {
  const resolved = await realpath(workspace);
  await mkdir(join(home, ".flowcode"), { recursive: true });
  await writeFile(
    join(home, ".flowcode", "trusted.json"),
    JSON.stringify({ version: 1, directories: [resolved] }),
    "utf8",
  );
};

describe("the session hook events", () => {
  let server: MockServer;
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    server = await startMockServer({ MOCK_SCENARIO: "tour" });
    home = await mkdtemp(join(tmpdir(), "flowcode-hooks-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-hooks-work-"));
    await trustWorkspace(home, workspace);
    await mkdir(join(workspace, ".flowcode"), { recursive: true });
  });

  afterEach(async () => {
    await server.stop();
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  const writeHooks = async (hooks: unknown): Promise<void> => {
    await writeFile(
      join(workspace, ".flowcode", "hooks.json"),
      JSON.stringify({ hooks }),
      "utf8",
    );
  };

  const createSession = async (): Promise<
    { readonly ok: true; readonly session: FlowSession } | { readonly ok: false; readonly message: string }
  > => {
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
    return session.ok
      ? { ok: true, session: session.value }
      : { ok: false, message: session.error.message };
  };

  it("does not start the session when a session_start hook refuses", async () => {
    await writeHooks({
      session_start: [
        {
          command: "node -e \"process.stderr.write('not today');process.exit(2)\"",
        },
      ],
    });

    const result = await createSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("not today");
    }
  });

  it("starts the session when the session_start hook is happy", async () => {
    await writeHooks({
      session_start: [{ command: "node -e \"process.exit(0)\"" }],
    });

    const result = await createSession();
    expect(result.ok).toBe(true);
    if (result.ok) {
      await result.session.close();
    }
  });

  it("refuses a prompt that a user_prompt_submit hook refuses", async () => {
    await writeHooks({
      user_prompt_submit: [
        {
          command: "node -e \"process.stderr.write('no prompts today');process.exit(2)\"",
        },
      ],
    });

    const result = await createSession();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const run = await result.session.run("do something");
    expect(run.reason).toBe("error");
    expect(run.error?.message).toContain("no prompts today");
    await result.session.close();
  });

  it("runs the session_end hook when the session closes", async () => {
    const marker = join(workspace, "ended.txt");
    await writeHooks({
      session_end: [
        {
          command: `node -e "require('node:fs').writeFileSync('${marker.replace(/\\/g, "\\\\")}','ended')"`,
        },
      ],
    });

    const result = await createSession();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    await result.session.close();

    const { existsSync } = await import("node:fs");
    expect(existsSync(marker)).toBe(true);
  });
});
