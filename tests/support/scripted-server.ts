/**
 * A local HTTP server that replies with a caller-supplied SSE body.
 *
 * Used to exercise the adapter against stream shapes the mock server does not
 * produce, such as interleaved text and tool-call fragments.
 */
import { createServer, type Server } from "node:http";

/** A running scriptable server. */
export interface ScriptedServer {
  /** The base URL to point a provider at. */
  readonly baseUrl: string;
  /** The port the server bound to. */
  readonly port: number;
  /** How many requests the server has answered. */
  readonly requests: () => number;
  /** Stop the server. */
  stop: () => Promise<void>;
}

/**
 * Start a server that answers every chat-completions request with `body`.
 *
 * @param body - The raw response body to send.
 * @param status - The HTTP status to send.
 */
export const startScriptedServer = async (
  body: string,
  status = 200,
): Promise<ScriptedServer> => {
  let requests = 0;

  const server: Server = createServer((req, res) => {
    requests += 1;
    req.resume();
    req.on("end", () => {
      res.writeHead(status, { "content-type": "text/event-stream" });
      res.end(body);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    port,
    requests: () => requests,
    stop: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
};

/** Build one chat-completion SSE chunk. */
export const sseChunk = (delta: unknown, finish: unknown = null): string =>
  `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 0,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
