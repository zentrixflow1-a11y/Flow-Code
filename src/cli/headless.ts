/**
 * Headless mode.
 *
 * `flowcode -p "task"` runs one task without a terminal UI and prints the
 * result. It is the mode the end-to-end tests drive, and the mode to use
 * from a script.
 */
import type { AgentUi, ApprovalDecision, ApprovalRequest } from "../agent/types.js";
import { FlowSession } from "../agent/session.js";
import type { PermissionMode } from "../permissions/types.js";
import type { ToolCall } from "../providers/types.js";
import type { ToolResult } from "../tools/types.js";

/** How to run a headless session. */
export interface HeadlessOptions {
  /** The task to carry out. */
  readonly task: string;
  /** The directory to work in. */
  readonly cwd: string;
  /** The user's home directory. */
  readonly home?: string;
  /** The environment to read from. */
  readonly env?: NodeJS.ProcessEnv;
  /** Where the result goes. */
  readonly stdout: (text: string) => void;
  /** Where progress goes. */
  readonly stderr: (text: string) => void;
  /** The output format. */
  readonly outputFormat: "text" | "json";
  /** The provider to use. */
  readonly provider?: string;
  /** The model to use. */
  readonly model?: string;
  /** The base URL to use. */
  readonly baseUrl?: string;
  /** The permission mode to use. */
  readonly permissionMode?: PermissionMode;
  /**
   * Approve every tool call without asking.
   *
   * This is the equivalent of running with permissions off. It is only
   * offered as an explicit flag.
   */
  readonly approveAll?: boolean;
  /** The most turns to run. */
  readonly maxTurns?: number;
  /** Resume this session log. */
  readonly resumePath?: string;
}

/**
 * Run a headless session.
 *
 * @param options - How to run it.
 * @returns The process exit status.
 */
export const runHeadless = async (options: HeadlessOptions): Promise<number> => {
  const collected: string[] = [];

  const ui: AgentUi = {
    onText(text) {
      collected.push(text);
      if (options.outputFormat === "text") {
        options.stdout(text);
      }
    },
    onReasoning() {
      // Headless mode does not show the model's reasoning.
    },
    onToolStart(call: ToolCall) {
      options.stderr(`· ${call.name}\n`);
    },
    onToolEnd(call: ToolCall, result: ToolResult) {
      options.stderr(`· ${call.name} — ${result.ok ? "done" : "failed"}\n`);
    },
    async approve(request: ApprovalRequest): Promise<ApprovalDecision> {
      if (options.approveAll === true) {
        return { kind: "allow" };
      }
      return {
        kind: "deny",
        reason: `Headless mode cannot ask for approval to run '${request.tool}'.`,
      };
    },
  };

  const session = await FlowSession.create({
    cwd: options.cwd,
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ui,
    ...(options.resumePath === undefined ? {} : { resumePath: options.resumePath }),
    ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
    overrides: {
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.permissionMode === undefined
        ? {}
        : { permissionMode: options.permissionMode }),
    },
  });

  if (!session.ok) {
    options.stderr(`flowcode: ${session.error.message}`);
    if (session.error.remediation !== undefined) {
      options.stderr(`flowcode: ${session.error.remediation}`);
    }
    return 1;
  }

  // There is nobody to ask in headless mode, so an untrusted directory is
  // simply used without its own files. Saying so is better than pretending
  // the project's settings were in force.
  if (!session.value.workspaceTrusted) {
    options.stderr(
      `flowcode: ${session.value.trustNote ?? "This directory is not trusted."} The project's .flowcode files (configuration, hooks, MCP servers and sub-agents) were ignored.`,
    );
  }

  try {
    const result = await session.value.run(options.task);
    const text = collected.join("");

    if (options.outputFormat === "json") {
      options.stdout(
        `${JSON.stringify({
          ok: result.reason === "completed",
          reason: result.reason,
          turns: result.turns,
          text,
          ...(result.error === undefined ? {} : { error: result.error.message }),
        })}\n`,
      );
    } else if (result.reason === "completed" && !text.endsWith("\n")) {
      options.stdout("\n");
    }

    switch (result.reason) {
      case "completed":
        return 0;
      case "aborted":
        return 130;
      default:
        options.stderr(`flowcode: ${result.error?.message ?? "The run did not finish."}`);
        return 1;
    }
  } finally {
    await session.value.close();
  }
};
