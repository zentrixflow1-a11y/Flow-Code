/**
 * The built-in commands.
 */
import { PRESETS } from "../providers/presets.js";
import { PERMISSION_MODES } from "../permissions/types.js";
import { scaffoldProjectInstructions } from "../context/init.js";
import { PRIMARY_INSTRUCTION_FILE } from "../context/instructions.js";
import { formatBytes } from "../util/text.js";
import type { CommandDefinition, CommandOutcome, CommandServices } from "./types.js";

/** Show the available commands. */
export const helpCommand: CommandDefinition = {
  name: "help",
  summary: "Show the available commands.",
  usage: "/help",
  async run(_context): Promise<CommandOutcome> {
    const lines = [
      "Commands:",
      ...COMMANDS.map((command) => `  /${command.name.padEnd(12)} ${command.summary}`),
    ];
    return { output: lines.join("\n") };
  },
};

/** List the providers, or switch to one. */
export const modelCommand: CommandDefinition = {
  name: "model",
  summary: "List the available models, or switch to one.",
  usage: "/model [provider] [model]",
  async run(context): Promise<CommandOutcome> {
    const [provider, model] = context.args.split(/\s+/).filter((part) => part !== "");

    if (provider === undefined) {
      const models = await context.services.listModels();
      const lines = [
        `Provider: ${context.services.config.provider.provider}`,
        `Model: ${context.services.config.provider.model ?? "(not set)"}`,
        "",
        "Known providers:",
        ...PRESETS.map((preset) => `  ${preset.id.padEnd(12)} ${preset.label}`),
      ];
      if (models.length > 0) {
        lines.push("", `Models at this provider:`, ...models.map((entry) => `  ${entry.id}`));
      }
      return { output: lines.join("\n") };
    }

    const changed = await context.services.setModel(provider, model ?? "");
    if (!changed.ok) {
      return { output: changed.error.message };
    }
    return { output: `Now using ${provider}${model === undefined ? "" : ` / ${model}`}.` };
  },
};

/** Start a new conversation. */
export const clearCommand: CommandDefinition = {
  name: "clear",
  summary: "Start a new conversation, keeping the project instructions.",
  usage: "/clear",
  async run(context): Promise<CommandOutcome> {
    await context.services.clear();
    return { output: "Started a new conversation.", action: "clear" };
  },
};

/** Compact the conversation now. */
export const compactCommand: CommandDefinition = {
  name: "compact",
  summary: "Summarise the conversation so far and start again with the summary.",
  usage: "/compact",
  async run(context): Promise<CommandOutcome> {
    const message = await context.services.compact();
    return { output: message, action: "compact" };
  },
};

/** Show what the session is using. */
export const statusCommand: CommandDefinition = {
  name: "status",
  summary: "Show the model, the directory, the mode and the session.",
  usage: "/status",
  async run(context): Promise<CommandOutcome> {
    const { config } = context.services;
    return {
      output: [
        `Provider:  ${config.provider.provider}`,
        `Model:     ${config.provider.model ?? "(not set)"}`,
        `Directory: ${context.services.cwd}`,
        `Mode:      ${config.permissions.mode}`,
        `Tools:     ${context.services.registry.size}`,
      ].join("\n"),
    };
  },
};

/** Show the resolved configuration. */
export const configCommand: CommandDefinition = {
  name: "config",
  summary: "Show the resolved configuration.",
  usage: "/config",
  async run(context): Promise<CommandOutcome> {
    const { config } = context.services;
    return {
      output: JSON.stringify(config, null, 2),
    };
  },
};

/** Show the permission rules. */
export const permissionsCommand: CommandDefinition = {
  name: "permissions",
  summary: "Show the permission mode and the rules.",
  usage: "/permissions",
  async run(context): Promise<CommandOutcome> {
    const { config } = context.services;
    const lines = [
      `Mode: ${config.permissions.mode}`,
      `Modes available: ${PERMISSION_MODES.join(", ")}`,
      "",
      "Allow:",
      ...(config.permissions.allow.length === 0 ? ["  (none)"] : config.permissions.allow.map((rule) => `  ${rule}`)),
      "Ask:",
      ...(config.permissions.ask.length === 0 ? ["  (none)"] : config.permissions.ask.map((rule) => `  ${rule}`)),
      "Deny:",
      ...(config.permissions.deny.length === 0 ? ["  (none)"] : config.permissions.deny.map((rule) => `  ${rule}`)),
    ];
    return { output: lines.join("\n") };
  },
};

/** Show the tools the model may call. */
export const toolsCommand: CommandDefinition = {
  name: "tools",
  summary: "List the tools the model may call.",
  usage: "/tools",
  async run(context): Promise<CommandOutcome> {
    const tools = context.services.registry.list();
    const lines = tools.map((tool) => `  ${tool.name.padEnd(22)} ${tool.category}`);
    lines.push("");
    lines.push(`${tools.length} tools, ${formatBytes(context.services.registry.schemaBytes(new Set()))} of schema.`);
    return { output: lines.join("\n") };
  },
};

/** Switch to plan mode, or back. */
export const planCommand: CommandDefinition = {
  name: "plan",
  summary: "Switch to plan mode, where the agent can read but not change anything.",
  usage: "/plan [on|off]",
  async run(context): Promise<CommandOutcome> {
    const argument = context.args.trim().toLowerCase();
    const current = context.services.config.permissions.mode;

    if (argument === "off") {
      if (current !== "plan") {
        return { output: `Already in ${current} mode.` };
      }
      context.services.setPermissionMode("ask");
      return { output: "Plan mode is off. Back to ask mode." };
    }

    if (current === "plan") {
      context.services.setPermissionMode("ask");
      return { output: "Plan mode is off. Back to ask mode." };
    }

    context.services.setPermissionMode("plan");
    return { output: "Plan mode is on. The agent can read and explore, but not change anything." };
  },
};

/** Show the MCP servers and the sub-agents. */
export const mcpCommand: CommandDefinition = {
  name: "mcp",
  summary: "Show the MCP servers, their tools, and the sub-agents.",
  usage: "/mcp",
  async run(context): Promise<CommandOutcome> {
    const servers = context.services.mcpServers ?? [];
    const agents = context.services.subAgents ?? [];

    const lines: string[] = ["MCP servers:"];

    if (servers.length === 0) {
      lines.push("  (none configured)");
    } else {
      for (const server of servers) {
        lines.push(
          server.connected
            ? `  ${server.name} — ${server.tools.length} tool${server.tools.length === 1 ? "" : "s"}`
            : `  ${server.name} — not reachable${server.error === undefined ? "" : `: ${server.error}`}`,
        );
        for (const tool of server.tools) {
          lines.push(`      ${tool}`);
        }
      }
    }

    lines.push("", "Sub-agents:");
    if (agents.length === 0) {
      lines.push("  (none defined)");
    } else {
      for (const agent of agents) {
        lines.push(`  ${agent.name} — ${agent.description}`);
      }
    }

    return { output: lines.join("\n") };
  },
};

/** Write a starting project instructions file. */
export const initCommand: CommandDefinition = {
  name: "init",
  summary: "Write a starting FLOWCODE.md from the repository.",
  usage: "/init",
  async run(context): Promise<CommandOutcome> {
    const scaffold = await scaffoldProjectInstructions(context.services.cwd);
    if (!scaffold.ok) {
      return { output: scaffold.error.message };
    }

    const writer = context.services.writeWorkspaceFile;
    if (writer === undefined) {
      return { output: "This session cannot write files." };
    }

    const written = await writer(
      PRIMARY_INSTRUCTION_FILE,
      scaffold.value.content,
    );
    if (!written.ok) {
      return { output: written.error.message };
    }

    const facts =
      scaffold.value.facts.length === 0
        ? "It could not tell anything about the project, so the file is a set of questions."
        : `It worked out that ${scaffold.value.facts.join(", ")}.`;

    return {
      output: [
        `Wrote ${PRIMARY_INSTRUCTION_FILE}.`,
        facts,
        "Read it, change what is not true, and delete the parts you do not need.",
      ].join("\n"),
    };
  },
};

/** Leave the session. */
export const exitCommand: CommandDefinition = {
  name: "exit",
  summary: "Leave Flow Code.",
  usage: "/exit",
  async run(context): Promise<CommandOutcome> {
    context.services.exit();
    return { output: "Goodbye.", action: "exit" };
  },
};

/** Every built-in command. */
export const COMMANDS: readonly CommandDefinition[] = [
  helpCommand,
  modelCommand,
  clearCommand,
  compactCommand,
  statusCommand,
  configCommand,
  permissionsCommand,
  toolsCommand,
  planCommand,
  mcpCommand,
  initCommand,
  exitCommand,
];

/**
 * Run a command.
 *
 * @param name - The command's name, without the slash.
 * @param args - The arguments the user typed.
 * @param services - What the command can do.
 */
export const runCommand = async (
  name: string,
  args: string,
  services: CommandServices,
): Promise<CommandOutcome | undefined> => {
  const command = COMMANDS.find((entry) => entry.name === name);
  if (command === undefined) {
    return undefined;
  }
  return command.run({ args, services });
};
