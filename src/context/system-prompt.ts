/**
 * Flow Code's system prompt.
 *
 * This is written from scratch for this project. It is deliberately short:
 * a long prompt costs context on every request, and small local models
 * follow short instructions more reliably than long ones.
 */
import type { PermissionMode } from "../permissions/types.js";
import type { ToolDefinition } from "../tools/types.js";

/** What the prompt needs to know about the session. */
export interface SystemPromptContext {
  /** The directory the session is working in. */
  readonly cwd: string;
  /** The host platform. */
  readonly platform: NodeJS.Platform;
  /** The active permission mode. */
  readonly mode: PermissionMode;
  /** The provider in use. */
  readonly provider: string;
  /** The model in use. */
  readonly model: string;
  /** The tools the model may call. */
  readonly tools: readonly ToolDefinition[];
  /** Extra directories the user has opened up. */
  readonly additionalDirectories: readonly string[];
}

/**
 * Build the system prompt for a session.
 *
 * @param context - What the prompt needs to know.
 */
export const buildSystemPrompt = (context: SystemPromptContext): string => {
  const lines: string[] = [];

  lines.push(
    "You are Flow Code, a coding agent working directly in the user's own files.",
  );
  lines.push("");
  lines.push(`Working directory: ${context.cwd}`);
  lines.push(`Platform: ${context.platform}`);
  lines.push(`Model: ${context.model} (through ${context.provider})`);
  lines.push(`Permission mode: ${context.mode}`);

  if (context.additionalDirectories.length > 0) {
    lines.push(
      `Also allowed to read and write: ${context.additionalDirectories.join(", ")}`,
    );
  }

  lines.push("");
  lines.push("## Tools");
  for (const tool of context.tools) {
    lines.push(`- ${tool.name}: ${firstSentence(tool.description)}`);
  }

  lines.push("");
  lines.push("## How to work");
  lines.push("- Look before you change. Read a file before editing it.");
  lines.push(
    "- Prefer edit_file for a small change and write_file only for a whole new file.",
  );
  lines.push(
    "- After a change, run the project's own tests or build if there is one, and report what happened.",
  );
  lines.push(
    "- If a tool reports a problem, fix the problem and try again rather than working around it.",
  );
  lines.push(
    "- When the task is not clear, or a decision is the user's to make, use ask_user.",
  );

  lines.push("");
  lines.push("## The permission mode");
  lines.push(describeMode(context.mode));

  lines.push("");
  lines.push("## Rules");
  lines.push(
    "- Only use the tools you were given. Never claim to have read or changed something you did not.",
  );
  lines.push(
    "- If a tool call is refused, say so and work within what is allowed. Do not try to reach the same result another way.",
  );
  lines.push(
    "- Keep the user informed in plain language. Say what you are about to do when it matters, and what you did when it is done.",
  );

  return lines.join("\n");
};

/** The first sentence of a tool's description, for the prompt's tool list. */
const firstSentence = (description: string): string => {
  const stop = description.indexOf(". ");
  const sentence = stop === -1 ? description : description.slice(0, stop + 1);
  return sentence.replace(/\s+/g, " ").trim();
};

/** A sentence about the active permission mode. */
const describeMode = (mode: PermissionMode): string => {
  switch (mode) {
    case "ask":
      return (
        "You may read files freely. Anything that writes, runs a command, or uses the network needs the user's approval first. " +
        "Expect the user to approve or refuse; a refusal is a decision, not an obstacle to route around."
      );
    case "accept_edits":
      return (
        "You may read files freely and edit files inside the working directory without asking. " +
        "Running a command or using the network still needs the user's approval."
      );
    case "plan":
      return (
        "You may read files and explore, but you may not change anything. " +
        "When you have a plan, call submit_plan and wait for the user to approve it."
      );
    case "safe":
      return (
        "You may read files and explore only. You may not write files, run commands, or use the network. " +
        "Report what you find and what you would change."
      );
    case "trust":
      return (
        "You may act freely inside the working directory. Files outside it are still off limits, " +
        "and protected files such as .env and .git are never written to."
      );
  }
};
