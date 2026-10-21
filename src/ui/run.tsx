/**
 * The interactive terminal session.
 */
import { render } from "ink";
import type { FlowSession } from "../agent/session.js";
import type { AgentUi, ApprovalDecision, ApprovalRequest } from "../agent/types.js";
import { runCommand } from "../commands/builtin.js";
import { COMMANDS } from "../commands/registry.js";
import { executeTool } from "../tools/executor.js";
import { globFilesTool } from "../tools/search.js";
import { toPosix } from "../util/paths.js";
import { relative } from "node:path";
import { App } from "./app.js";
import { UiState } from "./state.js";

/** How to run the interactive session. */
export interface InteractiveOptions {
  /** The session to drive. */
  readonly session: FlowSession;
  /** Whether the banner is shown. */
  readonly showBanner?: boolean;
  /** The terminal to draw on. Defaults to the process's own. */
  readonly stdout?: NodeJS.WriteStream;
  /** The terminal to read from. Defaults to the process's own. */
  readonly stdin?: NodeJS.ReadStream;
}

/** The commands the input can suggest. */
const COMMAND_SUGGESTIONS = COMMANDS.map((command) => ({
  name: command.name,
  summary: command.summary,
}));

/**
 * Run the interactive session until the user leaves.
 *
 * @param options - How to run it.
 * @returns The process exit status.
 */
export const runInteractive = async (
  options: InteractiveOptions,
): Promise<number> => {
  const { session } = options;
  const state = new UiState();

  if (!session.workspaceTrusted) {
    state.notify(
      `${session.trustNote ?? "This directory is not trusted."} The project's .flowcode files were ignored.`,
    );
  }

  state.setStatus({
    provider: session.config.provider.provider,
    model: session.config.provider.model ?? "",
    cwd: session.cwd,
    mode: session.config.permissions.mode,
    tokens: 0,
    busy: false,
  });

  const ui: AgentUi = {
    onText: (text) => state.appendStream(text),
    onReasoning: (text) => state.appendReasoning(text),
    onToolStart: (call) => state.startTool(call),
    onToolEnd: (call, result) => state.endTool(call, result),
    approve: (request: ApprovalRequest): Promise<ApprovalDecision> =>
      state.requestApproval(request),
    onAsk: (question, options) => state.requestQuestion(question, options),
  };

  let interrupted = false;

  session.setUi(ui);

  const onSubmit = async (text: string): Promise<void> => {
    if (text.startsWith("/")) {
      const [name, ...rest] = text.slice(1).split(/\s+/);
      const outcome = await runCommand(
        name ?? "",
        rest.join(" "),
        session.commandServices(() => {
          void app.unmount();
        }),
      );
      if (outcome?.output !== undefined && outcome.output !== "") {
        state.notify(outcome.output);
      }
      return;
    }

    state.addUserMessage(text);
    state.setStatus({ busy: true });
    state.commitStream();

    const result = await session.run(text);

    state.commitStream();
    state.setStatus({
      busy: false,
      mode: session.config.permissions.mode,
      model: session.config.provider.model ?? "",
    });

    if (result.reason === "error" && result.error !== undefined) {
      state.reportError(result.error.message);
    }
  };

  const stdout = options.stdout ?? process.stdout;

  const renderOptions = {
    exitOnCtrlC: false,
    // Ink treats a CI environment as non-interactive, which would leave the
    // interface undrawn until the session ended. A terminal is a terminal,
    // whatever the environment says.
    interactive: Boolean(stdout.isTTY),
    // The console is patched so that a stray log cannot corrupt the
    // display. On a stand-in terminal — which is how the interface is
    // tested — the console is left alone.
    patchConsole: options.stdout === undefined,
    ...(options.stdout === undefined ? {} : { stdout: options.stdout }),
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
  };

  const app = render(
    <App
      state={state}
      commands={COMMAND_SUGGESTIONS}
      onSubmit={(text) => void onSubmit(text)}
      onInterrupt={() => {
        interrupted = true;
        state.notify("Interrupted.");
      }}
      onExit={() => {
        void app.unmount();
      }}
      suggestFiles={async (fragment) => suggestFiles(session, fragment)}
      showBanner={options.showBanner ?? true}
    />,
    renderOptions,
  );

  await app.waitUntilExit();
  await session.close();

  return interrupted ? 130 : 0;
};

/**
 * Find the files that match a fragment, for the `@` completion.
 *
 * @param session - The session, for its working directory and tools.
 * @param fragment - What the user has typed after the `@`.
 */
const suggestFiles = async (
  session: FlowSession,
  fragment: string,
): Promise<readonly string[]> => {
  const pattern = fragment === "" ? "**/*" : `**/*${fragment}*`;

  const result = await executeTool(
    globFilesTool,
    { pattern, max_results: 40 },
    await session.toolContext(),
  );

  if (!result.ok) {
    return [];
  }

  return result.output
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("(") && !line.startsWith("â€¦"))
    .map((line) => toPosix(line));
};

/** The path of a file relative to the session's directory. */
export const relativeTo = (path: string, root: string): string =>
  toPosix(relative(root, path));
