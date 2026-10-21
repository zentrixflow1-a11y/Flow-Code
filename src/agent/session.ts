/**
 * A Flow Code session.
 *
 * This is the object the terminal UI and the headless mode both drive. It
 * owns the configuration, the provider, the tool registry and the session
 * log, and it knows how to run the agent over them.
 */
import { readProjectInstructions } from "../context/instructions.js";
import { compactMessages, SUMMARY_INSTRUCTION } from "../context/compactor.js";
import { deriveMessages, filesReadIn } from "../session/replay.js";
import { effectiveRules, loadConfig, type ConfigLayer } from "../config/load.js";
import { resolveApiKey } from "../config/credentials.js";
import { persistRule } from "../config/write.js";
import { flowError, type FlowError } from "../errors.js";
import { findPreset, PRESETS } from "../providers/presets.js";
import { createProvider } from "../providers/factory.js";
import type { ModelInfo, ModelProvider } from "../providers/types.js";
import { createDefaultRegistry } from "../tools/index.js";
import type { ToolRegistry } from "../tools/registry.js";
import { createToolContext } from "../tools/context.js";
import type { ToolContext, ToolQuestion } from "../tools/types.js";
import { createRedactor } from "../util/redact.js";
import { realpathBestEffort } from "../util/paths.js";
import { err, ok, type Result } from "../util/result.js";
import { readMcpConfig } from "../mcp/config.js";
import { connectAll, type McpConnections } from "../mcp/client.js";
import { bridgeTools } from "../mcp/bridge.js";
import { readAgentDefinitions, type AgentDefinition } from "../agents/definitions.js";
import { runSubAgent } from "../agents/subagent.js";
import { readHooks, type HookDefinition } from "../hooks/runner.js";
import { detectSandbox, type SandboxKind } from "../security/sandbox.js";
import {
  resolveWorkspaceTrust,
  type ProjectScope,
} from "../security/trust.js";
import { runAgent } from "./loop.js";
import type { CommandServices } from "../commands/types.js";
import type { AgentOptions, AgentResult, AgentUi, ApprovalDecision } from "./types.js";
import { SessionLog } from "../session/log.js";
import { createSessionId, projectSlug, sessionsRoot } from "../session/store.js";
import type { FlowCodeConfig } from "../config/types.js";
import type { PermissionMode, ToolCategory } from "../permissions/types.js";
import { join } from "node:path";
import { homedir } from "node:os";

/** How a session is set up. */
export interface FlowSessionOptions {
  /** The directory the session works in. */
  readonly cwd: string;
  /** The user's home directory. */
  readonly home?: string;
  /** The environment to read from. */
  readonly env?: NodeJS.ProcessEnv;
  /** How the agent talks to the user. */
  readonly ui?: AgentUi;
  /** Resume this session log instead of starting a new one. */
  readonly resumePath?: string;
  /** The session's identifier, when starting a new one. */
  readonly sessionId?: string;
  /** Cancels the run. */
  readonly signal?: AbortSignal;
  /** The most turns a run may take. */
  readonly maxTurns?: number;
  /** Configuration overrides, from the command line. */
  readonly overrides?: {
    readonly provider?: string;
    readonly model?: string;
    readonly baseUrl?: string;
    readonly permissionMode?: PermissionMode;
  };
  /**
   * Whether the directory has been trusted.
   *
   * When it is not set, the session works it out: the store is consulted
   * first, and the question is only asked when a way to ask is given.
   */
  readonly trusted?: boolean;
  /**
   * Asks the user whether the directory may be used.
   *
   * Without it, a directory that is not already trusted is not used, and its
   * own files are ignored.
   */
  readonly confirmTrust?: (question: string) => Promise<boolean>;
}

/** A running Flow Code session. */
export class FlowSession {
  /** The resolved configuration. */
  config: FlowCodeConfig;
  /** The provider in use. */
  provider: ModelProvider;
  /** The tools the model may call. */
  readonly registry: ToolRegistry;
  /** Where the session is written. */
  log: SessionLog;
  /** The rules in force. */
  rules: ReturnType<typeof effectiveRules>;
  /** The project's instructions. */
  projectInstructions = "";
  /** The MCP servers that answered. */
  mcp: McpConnections = { connections: [], failures: [], close: async () => undefined };
  /** The MCP servers that did not. */
  mcpFailures: readonly { readonly server: string; readonly error: FlowError }[] = [];
  /** The sub-agents the project defines. */
  subAgents: readonly AgentDefinition[] = [];
  /** The hooks the project configures. */
  hooks: readonly HookDefinition[] = [];
  /** Whether the directory's own files may be read. */
  workspaceTrusted = true;
  /** Why the directory's own files were ignored, when they were. */
  trustNote: string | undefined;
  /** Why the sandbox is not in use, when it was asked for and is not available. */
  sandboxNote: string | undefined;

  /** The instructions the MCP servers sent, if any did. */
  #mcpInstructions: string | undefined;
  /** The workspace root with every symlink resolved. */
  #resolvedCwd: string;
  /** The operating-system sandbox in use, when one is. */
  #sandbox: { readonly kind: SandboxKind; readonly roots: readonly string[] } | undefined;

  readonly #options: FlowSessionOptions;
  readonly #home: string;
  readonly #env: NodeJS.ProcessEnv;
  #ui: AgentUi;
  private constructor(options: FlowSessionOptions, config: FlowCodeConfig, provider: ModelProvider, log: SessionLog) {
    this.#options = options;
    this.#home = options.home ?? homedir();
    this.#env = options.env ?? process.env;
    this.config = config;
    this.provider = provider;
    this.log = log;
    this.registry = createDefaultRegistry();
    this.rules = effectiveRules(config);
    this.#ui = options.ui ?? silentUi;
    this.#resolvedCwd = options.cwd;
  }

  /**
   * Replace the interface the agent talks to.
   *
   * The terminal interface is built after the session, because the interface
   * and the session refer to each other.
   */
  setUi(ui: AgentUi): void {
    this.#ui = ui;
  }

  /**
   * Start a session.
   *
   * @param options - How to set it up.
   */
  static async create(
    options: FlowSessionOptions,
  ): Promise<Result<FlowSession, FlowError>> {
    const home = options.home ?? homedir();
    const env = options.env ?? process.env;

    // A project's own files are code. They are only read once the directory
    // has been trusted, and the question is only asked when there is a way to
    // ask it.
    const trust = await resolveWorkspaceTrust({
      home,
      cwd: options.cwd,
      ...(options.trusted === undefined ? {} : { trusted: options.trusted }),
      ...(options.confirmTrust === undefined
        ? {}
        : { confirm: options.confirmTrust }),
    });
    const scope: ProjectScope = trust.trusted ? "trusted" : "untrusted";

    const overrides = buildOverrides(options.overrides);
    const loaded = await loadConfig({
      home,
      cwd: options.cwd,
      env,
      project: scope,
      ...(overrides === undefined ? {} : { overrides }),
    });
    if (!loaded.ok) {
      return loaded;
    }

    const config = loaded.value;

    const built = await createProvider({
      provider: config.provider,
      env,
      home,
    });
    if (!built.ok) {
      return built;
    }

    const sessionId = options.sessionId ?? createSessionId();
    const path = join(
      sessionsRoot(home),
      projectSlug(options.cwd),
      `${sessionId}.jsonl`,
    );

    // The log is redacted with the same redactor the tools use, so a secret
    // that reached the conversation does not reach the disk.
    const secrets = await declaredSecrets({ env, home, config });
    const redactor = createRedactor({ secrets });

    let log: SessionLog;
    if (options.resumePath !== undefined) {
      const opened = await SessionLog.open(options.resumePath, {
        redact: redactor,
      });
      if (!opened.ok) {
        return opened;
      }
      log = opened.value;
    } else {
      log = await SessionLog.create(
        path,
        {
          id: sessionId,
          cwd: options.cwd,
          startedAt: Date.now(),
          flowCodeVersion: "0.0.0",
          provider: built.value.id,
          model: config.provider.model ?? "",
        },
        { redact: redactor },
      );
    }

    const session = new FlowSession(options, config, built.value, log);
    session.workspaceTrusted = trust.trusted;
    session.trustNote = trust.reason;
    session.projectInstructions = (await readProjectInstructions(options.cwd)).text;

    // The permission engine compares a rule's specifier with a resolved path,
    // so the workspace root has to be resolved too. On macOS a project
    // directory is often reached through a symlink, and an unresolved root
    // would never match a resolved path.
    const resolvedCwd = (await realpathBestEffort(options.cwd)) ?? options.cwd;
    session.#resolvedCwd = resolvedCwd;

    // The MCP servers, the sub-agents and the hooks are all optional. A
    // missing or broken one must not stop the session. A project's own files
    // are read only when the directory has been trusted.
    const mcpConfig = await readMcpConfig({ cwd: options.cwd, home, project: scope });
    if (mcpConfig.ok && mcpConfig.value.length > 0) {
      session.mcp = await connectAll(mcpConfig.value, {
        cwd: options.cwd,
        env,
      });
      session.mcpFailures = session.mcp.failures;
      for (const connection of session.mcp.connections) {
        for (const tool of bridgeTools(connection)) {
          session.registry.register(tool);
        }
      }

      const instructions = session.mcp.connections
        .map((connection) => connection.instructions)
        .filter((text): text is string => text !== undefined && text !== "");
      if (instructions.length > 0) {
        session.#mcpInstructions = instructions.join("\n\n");
      }
    }

    session.subAgents = await readAgentDefinitions(options.cwd, { project: scope });

    const hooks = await readHooks({ cwd: options.cwd, home, project: scope });
    if (hooks.ok) {
      session.hooks = hooks.value;
    }

    if (config.security.sandbox === "auto") {
      const support = await detectSandbox(process.platform);
      if (support.available) {
        session.#sandbox = {
          kind: support.kind,
          roots: [
            options.cwd,
            ...config.permissions.additionalDirectories,
          ],
        };
      } else {
        session.sandboxNote = support.reason ?? "The sandbox is not available here.";
      }
    }

    return ok(session);
  }

  /** The directory the session works in. */
  get cwd(): string {
    return this.#options.cwd;
  }

  /** The user's home directory. */
  get home(): string {
    return this.#home;
  }

  /**
   * Build the context the tools run in.
   *
   * Every context in a session comes from here, so a sub-agent has the same
   * redactor and the same guard as the agent that spawned it.
   */
  async toolContext(): Promise<ToolContext> {
    const secrets = await this.#declaredSecrets();

    const shared = {
      cwd: this.cwd,
      workspaceRoot: this.cwd,
      additionalDirectories: this.config.permissions.additionalDirectories,
      env: this.#env,
      secrets,
      platform: process.platform,
      caseInsensitivePaths: process.platform === "win32",
      registry: this.registry,
      guard: this.#guard,
      ...(this.#sandbox === undefined ? {} : { sandbox: this.#sandbox }),
    };

    return createToolContext({
      ...shared,
      ...(this.#ui.onAsk === undefined
        ? {}
        : {
            askUser: async (question: ToolQuestion) => {
              const answers = await this.#ui.onAsk?.(
                question.question,
                question.options.map((option) => option.label),
              );
              return answers ?? [];
            },
          }),
      spawnAgent: async (name, prompt) => {
        const definition = this.subAgents.find((entry) => entry.name === name);
        if (definition === undefined) {
          return err(
            flowError(
              "not_found",
              `There is no sub-agent called '${name}'.`,
              {
                retryable: false,
                remediation:
                  this.subAgents.length === 0
                    ? "This project defines no sub-agents. Put one in .flowcode/agents/."
                    : `Known sub-agents: ${this.subAgents.map((entry) => entry.name).join(", ")}.`,
              },
            ),
          );
        }

        return runSubAgent({
          definition,
          prompt,
          provider: this.provider,
          allowedTools:
            definition.tools ?? this.registry.list().map((tool) => tool.name),
          config: this.config,
          rules: this.rules,
          permissionContext: {
            workspaceRoot: this.#resolvedCwd,
            cwd: this.#resolvedCwd,
            home: this.#home,
          },
          // The sub-agent is given a context built the same way, so it has
          // the same redactor and the same guard. It cannot spawn another
          // sub-agent, though: that is how a session turns into a fork bomb.
          toolContext: createToolContext(shared),
          ui: this.#ui,
        });
      },
    });
  }

  /**
   * The second enforcement layer.
   *
   * The tool refuses to act even if the decision upstream were wrong.
   */
  #guard = (category: ToolCategory): FlowError | undefined => {
    const mode = this.config.permissions.mode;
    if (mode === "safe" && category !== "read" && category !== "control") {
      return flowError(
        "permission_denied",
        `Safe mode does not allow ${category} tools.`,
        { retryable: false },
      );
    }
    if (mode === "plan" && category !== "read" && category !== "control") {
      return flowError(
        "permission_denied",
        `Plan mode does not allow ${category} tools.`,
        { retryable: false },
      );
    }
    return undefined;
  };

  /**
   * Run the agent.
   *
   * @param prompt - The user's message, when the run starts with one.
   */
  async run(prompt?: string): Promise<AgentResult> {
    const agentOptions: AgentOptions = {
      provider: this.provider,
      registry: this.registry,
      session: this.log,
      config: this.config,
      rules: this.rules,
      permissionContext: {
        workspaceRoot: this.#resolvedCwd,
        cwd: this.#resolvedCwd,
        home: this.#home,
      },
      toolContext: await this.toolContext(),
      ui: this.#ui,
      ...(this.hooks.length === 0 ? {} : { hooks: this.hooks }),
      toolSchemaBudget: this.config.tools.maxToolSchemaBytes,
      ...(this.#mcpInstructions === undefined
        ? {}
        : { extraInstructions: this.#mcpInstructions }),
      ...(this.#options.signal === undefined ? {} : { signal: this.#options.signal }),
      ...(this.#options.maxTurns === undefined ? {} : { maxTurns: this.#options.maxTurns }),
    };

    return runAgent(agentOptions, prompt);
  }

  /**
   * List the models the provider serves.
   */
  async listModels(): Promise<ModelInfo[]> {
    const result = await this.provider.listModels();
    return result.ok ? result.value : [];
  }

  /**
   * Change the provider or the model.
   *
   * @param provider - The provider preset, or `keep` to leave it alone.
   * @param model - The model to talk to.
   */
  async setModel(provider: string, model: string): Promise<Result<void, FlowError>> {
    const nextProvider = provider === "keep" ? this.config.provider.provider : provider;
    const preset = findPreset(nextProvider);
    if (preset === undefined) {
      return err(
        flowError("invalid_request", `'${nextProvider}' is not a provider Flow Code knows about.`, {
          retryable: false,
          remediation: `Known providers: ${PRESETS.map((entry) => entry.id).join(", ")}.`,
        }),
      );
    }

    const config: FlowCodeConfig = {
      ...this.config,
      provider: {
        ...this.config.provider,
        provider: nextProvider,
        model,
        ...(nextProvider === this.config.provider.provider
          ? {}
          : { baseUrl: preset.baseUrl, apiKeyEnv: preset.apiKeyEnv }),
      },
    };

    const built = await createProvider({
      provider: config.provider,
      env: this.#env,
      home: this.#home,
    });
    if (!built.ok) {
      return built;
    }

    this.config = config;
    this.provider = built.value;
    this.rules = effectiveRules(config);

    await this.log.append({
      type: "model.changed",
      data: { provider: built.value.id, model },
    });

    return ok(undefined);
  }

  /**
   * Start a new conversation, keeping the project instructions.
   */
  async clear(): Promise<void> {
    const sessionId = createSessionId();
    const path = join(
      sessionsRoot(this.#home),
      projectSlug(this.cwd),
      `${sessionId}.jsonl`,
    );
    const log = await SessionLog.create(
      path,
      {
        id: sessionId,
        cwd: this.cwd,
        startedAt: Date.now(),
        flowCodeVersion: "0.0.0",
        provider: this.provider.id,
        model: this.config.provider.model ?? "",
      },
      { redact: createRedactor({ secrets: await this.#declaredSecrets() }) },
    );
    await this.log.close();
    this.log = log;
  }

  /**
   * Compact the conversation now.
   *
   * @returns A message describing what happened.
   */
  async compact(): Promise<string> {
    const messages = deriveMessages(this.log.events);
    if (messages.length === 0) {
      return "There is nothing to compact yet.";
    }

    const result = await compactMessages(messages, {
      keepTurns: this.config.context.keepTurns,
      summarize: async (transcript) => {
        const answer = await this.provider.streamChat({
          model: this.config.provider.model ?? "",
          messages: [
            { role: "system", content: SUMMARY_INSTRUCTION },
            { role: "user", content: transcript },
          ],
        });

        let text = "";
        for await (const event of answer) {
          if (event.type === "text_delta") {
            text += event.text;
          }
        }
        return text;
      },
    });

    await this.log.append({
      type: "compaction.end",
      data: {
        summary: result.summary,
        droppedMessages: result.droppedMessages,
        filesToReread: filesReadIn(this.log.events),
      },
    });

    return result.truncated
      ? `Compacted, but the summary could not be produced, so ${result.droppedMessages} messages were dropped.`
      : `Compacted ${result.droppedMessages} messages into a summary.`;
  }

  /**
   * Change the permission mode.
   *
   * @param mode - The new mode.
   */
  setPermissionMode(mode: PermissionMode): void {
    this.config = {
      ...this.config,
      permissions: { ...this.config.permissions, mode },
    };
  }

  /**
   * Remember a permission rule.
   *
   * The rule is saved in the user's own configuration. A project's file may
   * only add rules that tighten the harness, so a rule saved there would be
   * ignored — or would stop being honoured the moment the directory was no
   * longer trusted.
   *
   * @param rule - The rule.
   * @param bucket - Which list it goes in.
   */
  async rememberRule(
    rule: string,
    bucket: "allow" | "ask" | "deny",
  ): Promise<Result<void, FlowError>> {
    const saved = await persistRule({
      rule,
      bucket,
      scope: "user",
      cwd: this.cwd,
      home: this.#home,
    });
    if (!saved.ok) {
      return saved;
    }

    this.config = {
      ...this.config,
      permissions: {
        ...this.config.permissions,
        [bucket]: [...this.config.permissions[bucket], rule],
      },
    };
    this.rules = effectiveRules(this.config);
    return ok(undefined);
  }

  /** The API key, if there is one. */
  async apiKey(): Promise<string | undefined> {
    return resolveApiKey({
      env: this.#env,
      home: this.#home,
      provider: this.config.provider.provider,
      ...(this.config.provider.apiKeyEnv === undefined
        ? {}
        : { apiKeyEnv: this.config.provider.apiKeyEnv }),
    });
  }

  /** Close the session. */
  async close(): Promise<void> {
    await this.mcp.close();
    await this.log.close();
  }

  /**
   * The services a slash command can use.
   *
   * The configuration and the provider are read live, because a command may
   * change them.
   *
   * @param exit - Called when the user asks to leave.
   */
  commandServices(exit?: () => void): CommandServices {
    return {
      get config() {
        return this.config;
      },
      get provider() {
        return this.provider;
      },
      registry: this.registry,
      listModels: () => this.listModels(),
      setModel: (provider, model) => this.setModel(provider, model),
      setPermissionMode: (mode) => this.setPermissionMode(mode),
      clear: () => this.clear(),
      compact: () => this.compact(),
      exit: () => exit?.(),
      cwd: this.cwd,
      mcpServers: [
        ...this.mcp.connections.map((connection) => ({
          name: connection.server,
          connected: true,
          tools: connection.tools.map((tool) => tool.name),
        })),
        ...this.mcpFailures.map((failure) => ({
          name: failure.server,
          connected: false,
          tools: [] as string[],
          error: failure.error.message,
        })),
      ],
      subAgents: this.subAgents.map((agent) => ({
        name: agent.name,
        description: agent.description,
      })),
    };
  }

  /** The secrets that should never appear in the model's context. */
  async #declaredSecrets(): Promise<readonly string[]> {
    return declaredSecrets({
      env: this.#env,
      home: this.#home,
      config: this.config,
    });
  }
}

/**
 * The secrets that should never appear in the model's context.
 *
 * @param options - The environment, the home directory and the configuration.
 */
const declaredSecrets = async (options: {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly config: FlowCodeConfig;
}): Promise<readonly string[]> => {
  const key = await resolveApiKey({
    env: options.env,
    home: options.home,
    provider: options.config.provider.provider,
    ...(options.config.provider.apiKeyEnv === undefined
      ? {}
      : { apiKeyEnv: options.config.provider.apiKeyEnv }),
  });
  return key === undefined ? [] : [key];
};

/** An interface that shows nothing, for sessions with no terminal. */
const silentUi: AgentUi = {
  onText: () => undefined,
  onReasoning: () => undefined,
  onToolStart: () => undefined,
  onToolEnd: () => undefined,
  approve: async () => ({ kind: "deny" }),
};

/** Build the configuration overrides the command line asked for. */
const buildOverrides = (
  overrides: FlowSessionOptions["overrides"],
): ConfigLayer | undefined => {
  if (overrides === undefined) {
    return undefined;
  }

  const provider: NonNullable<ConfigLayer["provider"]> = {
    provider: overrides.provider ?? "ollama",
  };
  if (overrides.model !== undefined) {
    provider.model = overrides.model;
  }
  if (overrides.baseUrl !== undefined) {
    provider.baseUrl = overrides.baseUrl;
  }

  const layer: ConfigLayer = { provider };

  if (overrides.permissionMode !== undefined) {
    layer.permissions = {
      mode: overrides.permissionMode,
      allow: [],
      ask: [],
      deny: [],
      additionalDirectories: [],
    };
  }

  return layer;
};

export type { ApprovalDecision };
