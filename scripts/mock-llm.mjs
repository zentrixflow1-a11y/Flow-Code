#!/usr/bin/env node
/**
 * A scriptable mock of an OpenAI-compatible chat completions endpoint.
 *
 * This server exists so the whole Flow Code loop — model request, streamed
 * text, tool call, permission prompt, tool result, final answer — can be
 * exercised end to end with no model and no API key.
 *
 * The important trick: the mock works out where it is from the *conversation
 * history* it was sent, not from a request counter. That makes it robust to
 * retries, to parallel tool calls, and to the agent loop re-sending the same
 * history, which a counter-based mock gets wrong.
 *
 * Usage:
 *   node scripts/mock-llm.mjs
 *
 * Environment:
 *   MOCK_PORT        Port to listen on. 0 picks a free one (default 8930).
 *   MOCK_HOST        Host to bind (default 127.0.0.1).
 *   MOCK_SCENARIO    Which script to play. See SCENARIOS below.
 *   MOCK_FAIL_TIMES  Fail this many requests with 500 before serving normally.
 *   MOCK_STATUS      Force every response to use this HTTP status.
 *   MOCK_FINAL_TEXT  Override the text of the final answer.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 8930);
const HOST = process.env.MOCK_HOST ?? "127.0.0.1";
const SCENARIO = process.env.MOCK_SCENARIO ?? "tour";
const FAIL_TIMES = Number(process.env.MOCK_FAIL_TIMES ?? 0);
const FORCED_STATUS = process.env.MOCK_STATUS === undefined ? undefined : Number(process.env.MOCK_STATUS);
const FINAL_TEXT =
  process.env.MOCK_FINAL_TEXT ??
  "Mock answer: read the file, listed the directory, and finished.";

/** The scripts the mock can play. */
const SCENARIOS = ["tour", "text", "split", "error", "auth", "slow", "malformed", "mcp", "subagent"];

let requestCount = 0;

/** Wrap a delta in a chat-completion chunk. */
const chunk = (delta, finish = null) =>
  `data: ${JSON.stringify({
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "mock-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;

/** Wrap a tool call in a chat-completion chunk. */
const toolCallChunk = (index, id, name, args) =>
  chunk({
    tool_calls: [{ index, id, type: "function", function: { name, arguments: args } }],
  });

/** The names of the tools the mock has already been asked to call. */
const priorToolCalls = (messages) => {
  const names = new Set();
  for (const message of messages) {
    if (message?.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        if (typeof call?.function?.name === "string") {
          names.add(call.function.name);
        }
      }
    }
  }
  return names;
};

/** The final text of the conversation, used to vary the script. */
const lastUserText = (messages) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && typeof message.content === "string") {
      return message.content;
    }
  }
  return "";
};

/** Send the response headers for a stream. */
const startStream = (res) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
};

/** Send a JSON error response. */
const sendError = (res, status, message) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message, type: "mock_error" } }));
};

/**
 * Play the "subagent" script: hand the work to a sub-agent, then answer.
 *
 * A sub-agent is not offered the `spawn_agent` tool, so the same script
 * answers it instead of sending it into another sub-agent.
 */
const playSubagent = (res, messages, toolNames) => {
  const called = priorToolCalls(messages);
  const offersSpawn = toolNames.includes("spawn_agent");

  if (offersSpawn && !called.has("spawn_agent")) {
    res.write(
      toolCallChunk(
        0,
        "call_spawn",
        "spawn_agent",
        JSON.stringify({ agent: "reviewer", prompt: "Look at the readme." }),
      ),
    );
    res.write(chunk({}, "tool_calls"));
    res.end("data: [DONE]\n\n");
    return;
  }

  res.write(chunk({ content: "The sub-agent finished its review." }));
  res.write(chunk({}, "stop"));
  res.end("data: [DONE]\n\n");
};

/**
 * Play the "tour" script: a tool call, a second tool call, then an answer.
 */
const playTour = (res, messages) => {
  const called = priorToolCalls(messages);

  if (!called.has("read_file")) {
    res.write(
      toolCallChunk(0, "call_read", "read_file", JSON.stringify({ path: "README.md" })),
    );
    res.write(chunk({}, "tool_calls"));
    res.end("data: [DONE]\n\n");
    return;
  }

  if (!called.has("list_dir")) {
    res.write(
      toolCallChunk(0, "call_list", "list_dir", JSON.stringify({ path: "." })),
    );
    res.write(chunk({}, "tool_calls"));
    res.end("data: [DONE]\n\n");
    return;
  }

  res.write(chunk({ content: FINAL_TEXT }));
  res.write(chunk({}, "stop"));
  res.end("data: [DONE]\n\n");
};

/**
 * Play the "mcp" script: call an MCP tool, then answer with its result.
 */
const playMcp = (res, messages) => {
  const called = priorToolCalls(messages);

  if (!called.has("mcp:mock:echo")) {
    res.write(
      toolCallChunk(
        0,
        "call_mcp",
        "mcp:mock:echo",
        JSON.stringify({ text: "through the MCP server" }),
      ),
    );
    res.write(chunk({}, "tool_calls"));
    res.end("data: [DONE]\n\n");
    return;
  }

  res.write(chunk({ content: "The MCP server answered." }));
  res.write(chunk({}, "stop"));
  res.end("data: [DONE]\n\n");
};

/** Play the "text" script: a plain answer with no tool calls. */
const playText = (res) => {
  res.write(chunk({ content: FINAL_TEXT }));
  res.write(chunk({}, "stop"));
  res.end("data: [DONE]\n\n");
};

/**
 * Play the "split" script: one tool call scattered across many chunks, with
 * its arguments delivered in fragments.
 */
const playSplit = (res) => {
  const args = JSON.stringify({ path: "a/very/long/path/that/arrives/in/fragments.md" });
  const pieces = args.match(/.{1,7}/gs) ?? [args];

  res.write(toolCallChunk(0, "call_split", "read_file", ""));
  for (const piece of pieces) {
    res.write(
      chunk({
        tool_calls: [{ index: 0, function: { arguments: piece } }],
      }),
    );
  }
  res.write(chunk({}, "tool_calls"));
  res.end("data: [DONE]\n\n");
};

/** Play the "slow" script: text that arrives a word at a time. */
const playSlow = (res) => {
  const words = FINAL_TEXT.split(" ");
  let index = 0;
  const timer = setInterval(() => {
    if (index >= words.length) {
      clearInterval(timer);
      res.write(chunk({}, "stop"));
      res.end("data: [DONE]\n\n");
      return;
    }
    res.write(chunk({ content: `${words[index]} ` }));
    index += 1;
  }, 5);
  res.on("close", () => clearInterval(timer));
};

const server = createServer((req, res) => {
  const url = (req.url ?? "").split("?")[0] ?? "";

  if (req.method === "GET" && url.endsWith("/models")) {
    if (process.env.MOCK_NO_MODELS === "1") {
      sendError(res, 404, "No model listing here");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [
          { id: "mock-model", object: "model", owned_by: "flow-code" },
          { id: "mock-coder", object: "model", owned_by: "flow-code" },
        ],
      }),
    );
    return;
  }

  if (req.method === "GET" && url.endsWith("/api/tags")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        models: [
          { name: "mock-model", model: "mock-model" },
          { name: "mock-coder:latest", model: "mock-coder:latest" },
        ],
      }),
    );
    return;
  }

  if (req.method === "GET" && url.endsWith("/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, scenario: SCENARIO, requests: requestCount }));
    return;
  }

  if (req.method !== "POST" || !url.endsWith("/chat/completions")) {
    sendError(res, 404, `No route for ${req.method} ${url}`);
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    requestCount += 1;

    let payload = {};
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      sendError(res, 400, "The request body was not valid JSON");
      return;
    }

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const toolCount = Array.isArray(payload.tools) ? payload.tools.length : 0;
    const toolNames = Array.isArray(payload.tools)
      ? payload.tools
          .map((tool) => (typeof tool?.function?.name === "string" ? tool.function.name : ""))
          .filter((name) => name !== "")
      : [];
    process.stderr.write(
      `[mock] request #${requestCount} model=${payload.model ?? "?"} tools=${toolCount} messages=${messages.length} scenario=${SCENARIO}\n`,
    );

    if (FORCED_STATUS !== undefined) {
      sendError(res, FORCED_STATUS, `Forced ${FORCED_STATUS}`);
      return;
    }
    if (requestCount <= FAIL_TIMES) {
      sendError(res, 500, "Injected failure");
      return;
    }

    switch (SCENARIO) {
      case "text":
        playText(res);
        break;
      case "split":
        playSplit(res);
        break;
      case "slow":
        playSlow(res);
        break;
      case "malformed":
        startStream(res);
        res.write("data: {not json}\n\n");
        res.end("data: [DONE]\n\n");
        break;
      case "tour":
        playTour(res, messages);
        break;
      case "mcp":
        playMcp(res, messages);
        break;
      case "subagent":
        playSubagent(res, messages, toolNames);
        break;
      default:
        process.stderr.write(`[mock] unknown scenario "${SCENARIO}"; playing text\n`);
        playText(res);
        break;
    }
  });
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : PORT;
  // The marker lets a test harness discover an ephemeral port.
  process.stderr.write(`LISTENING ${HOST}:${port}\n`);
  process.stderr.write(`[mock] scenario=${SCENARIO} scenarios=${SCENARIOS.join(",")}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
