/**
 * The project's instructions.
 *
 * They go into the model's context, so they are read only when the directory
 * has been trusted.
 */
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowSession } from "../../../src/agent/session.js";

/** A server that records what it is sent. */
interface Recorder {
  readonly baseUrl: string;
  readonly bodies: () => readonly string[];
  stop: () => Promise<void>;
}

/** Start a server that records the requests it is sent, and answers with text. */
const startRecorder = async (): Promise<Recorder> => {
  const bodies: string[] = [];

  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      bodies.push(body);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion.chunk",
          created: 0,
          model: "mock-model",
          choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
        })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    bodies: () => [...bodies],
    stop: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
};

describe("the project's instructions", () => {
  let recorder: Recorder;
  let home: string;
  let workspace: string;

  beforeEach(async () => {
    recorder = await startRecorder();
    home = await mkdtemp(join(tmpdir(), "flowcode-instructions-home-"));
    workspace = await mkdtemp(join(tmpdir(), "flowcode-instructions-work-"));
  });

  afterEach(async () => {
    await recorder.stop();
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  const trust = async (): Promise<void> => {
    const resolved = await realpath(workspace);
    await mkdir(join(home, ".flowcode"), { recursive: true });
    await writeFile(
      join(home, ".flowcode", "trusted.json"),
      JSON.stringify({ version: 1, directories: [resolved] }),
      "utf8",
    );
  };

  const createSession = async (): Promise<FlowSession> => {
    const session = await FlowSession.create({
      cwd: workspace,
      home,
      env: {},
      overrides: {
        provider: "custom",
        baseUrl: recorder.baseUrl,
        model: "mock-model",
      },
    });
    expect(session.ok).toBe(true);
    if (!session.ok) {
      throw new Error(session.error.message);
    }
    return session.value;
  };

  it("reach the model in a trusted directory", async () => {
    await trust();
    await writeFile(
      join(workspace, "FLOWCODE.md"),
      "# How we work\n\n- Use tabs, never spaces.\n",
      "utf8",
    );

    const session = await createSession();
    await session.run("look around");

    expect(recorder.bodies().join("\n")).toContain("Use tabs, never spaces.");
    await session.close();
  });

  it("do not reach the model in a directory that is not trusted", async () => {
    await writeFile(
      join(workspace, "FLOWCODE.md"),
      "# How we work\n\n- Use tabs, never spaces.\n",
      "utf8",
    );

    const session = await createSession();
    await session.run("look around");

    expect(recorder.bodies().join("\n")).not.toContain("Use tabs, never spaces.");
    await session.close();
  });
});
