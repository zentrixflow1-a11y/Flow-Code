/**
 * Test support for running the mock provider server.
 *
 * The mock is a real process speaking a real HTTP protocol, so the tests that
 * use it exercise the adapter exactly as it would run in production.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../scripts/mock-llm.mjs", import.meta.url));

/** A running mock server. */
export interface MockServer {
  /** The base URL to point a provider at. */
  readonly baseUrl: string;
  /** The port the server bound to. */
  readonly port: number;
  /** Everything the server has written to stderr so far. */
  readonly stderr: () => string;
  /** Stop the server. */
  stop: () => Promise<void>;
}

/**
 * Start the mock server and wait for it to report its port.
 *
 * @param env - Extra environment variables for the server.
 */
export const startMockServer = async (
  env: Readonly<Record<string, string>> = {},
): Promise<MockServer> => {
  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(
    process.execPath,
    [SCRIPT],
    {
      env: { ...process.env, MOCK_PORT: "0", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text: string) => {
    stderr += text;
  });

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`The mock server did not report a port. stderr:\n${stderr}`));
    }, 15_000);

    const onData = (text: string): void => {
      const match = /LISTENING [^:]+:(\d+)/.exec(text);
      if (match !== null) {
        clearTimeout(timer);
        child.stderr.off("data", onData);
        resolve(Number(match[1]));
      }
    };

    child.stderr.on("data", onData);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`The mock server exited with code ${code}. stderr:\n${stderr}`));
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    port,
    stderr: () => stderr,
    stop: async () => {
      if (child.exitCode !== null) {
        return;
      }
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill();
      });
    },
  };
};
