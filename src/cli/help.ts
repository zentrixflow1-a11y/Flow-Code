import type { CommandDefinition } from "../commands/registry.js";
import { COMMANDS } from "../commands/registry.js";
import { BINARY_NAME, VERSION } from "../version.js";

/** The top-level commands Flow Code understands. */
const TOP_LEVEL_COMMANDS: readonly { readonly name: string; readonly summary: string }[] = [
  { name: "setup", summary: "Find a model server and write the configuration" },
  { name: "doctor", summary: "Check that everything is wired up" },
];

/** Options understood by the top-level command. */
const GLOBAL_OPTIONS: readonly { readonly flag: string; readonly summary: string }[] = [
  { flag: "-p, --print <task>", summary: "Carry out one task and print the result" },
  { flag: "    --output-format", summary: "text or json (default text)" },
  { flag: "    --provider <name>", summary: "The provider to use, such as ollama" },
  { flag: "    --model <name>", summary: "The model to use" },
  { flag: "    --base-url <url>", summary: "The provider's base URL" },
  { flag: "    --permission-mode", summary: "ask, accept_edits, plan, safe or trust" },
  { flag: "    --yes", summary: "Approve every tool call without asking" },
  { flag: "    --max-turns <n>", summary: "The most turns to run" },
  { flag: "    --resume <path>", summary: "Resume a session log" },
  { flag: "-h, --help", summary: "Show this help" },
  { flag: "-v, --version", summary: "Print the version" },
];

/** Render the aligned two-column body used by the help output. */
const renderColumns = (rows: readonly (readonly [string, string])[]): string => {
  const width = rows.reduce((widest, [left]) => Math.max(widest, left.length), 0);
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`).join("\n");
};

/**
 * Render the top-level help text.
 *
 * @param commands - The subcommands to list. Defaults to the global registry.
 */
export const renderHelp = (
  commands: readonly CommandDefinition[] = COMMANDS,
): string => {
  const sections: string[] = [
    `${BINARY_NAME} ${VERSION} — local-first terminal AI coding harness`,
    "",
    "Usage:",
    `  ${BINARY_NAME} [options]           Start an interactive session`,
    `  ${BINARY_NAME} -p <task>           Carry out one task and print the result`,
    `  ${BINARY_NAME} <command> [options] Run a subcommand`,
    "",
    "Options:",
    renderColumns(GLOBAL_OPTIONS.map((option) => [option.flag, option.summary] as const)),
  ];

  if (commands.length > 0) {
    sections.push(
      "",
      "Commands:",
      renderColumns(
        TOP_LEVEL_COMMANDS.map((command) => [command.name, command.summary] as const),
      ),
    );

    sections.push(
      "",
      "In a session, type / for:",
      renderColumns(
        commands.map((command) => [`/${command.name}`, command.summary] as const),
      ),
    );
  }

  sections.push(
    "",
    "Run `flowcode setup` to configure a model provider for the first time.",
  );

  return `${sections.join("\n")}\n`;
};
