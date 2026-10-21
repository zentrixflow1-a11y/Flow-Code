/**
 * Loading and merging the configuration.
 *
 * Configuration comes from several places, and the value that wins is the
 * one from the highest-precedence scope:
 *
 * ```text
 * command line  >  environment  >  project local  >  project  >  user local  >  user  >  defaults
 * ```
 *
 * Lists of permission rules merge across scopes, so a project can add a rule
 * without removing the user's own.
 *
 * A project's own files are only read once the directory has been trusted,
 * and even then a project may only *tighten* the rules that apply to it. It
 * may not choose the endpoint an API key is sent to, the key that is sent
 * there, the permission mode, or the security settings.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { flowError, type FlowError } from "../errors.js";
import { DEFAULT_RULES } from "../permissions/defaults.js";
import { PERMISSION_MODES, type PermissionMode } from "../permissions/types.js";
import type { ProjectScope } from "../security/trust.js";
import { err, ok, type Result } from "../util/result.js";
import { DEFAULT_CONFIG, type FlowCodeConfig } from "./types.js";

/** The name of the configuration file. */
export const CONFIG_FILE = "config.json";

/** The name of the personal, uncommitted configuration file. */
export const LOCAL_CONFIG_FILE = "config.local.json";

/** The directory Flow Code keeps its configuration in. */
export const configHome = (home: string): string => join(home, ".flowcode");

/** Where the configuration came from. */
export interface ConfigSources {
  /** The user's configuration file. */
  readonly user?: string;
  /** The user's personal configuration file. */
  readonly userLocal?: string;
  /** The project's configuration file. */
  readonly project?: string;
  /** The project's personal configuration file. */
  readonly projectLocal?: string;
}

/** A configuration file, as read from disk. */
type PartialConfig = {
  provider?: {
    provider?: string;
    baseUrl?: string;
    model?: string;
    apiKeyEnv?: string;
  };
  permissions?: {
    mode?: string;
    allow?: readonly string[];
    ask?: readonly string[];
    deny?: readonly string[];
    additionalDirectories?: readonly string[];
  };
  tools?: {
    maxToolSchemaBytes?: number;
    serialiseMixedBatches?: boolean;
    commandTimeoutMs?: number;
  };
  context?: {
    autoCompactRatio?: number;
    keepTurns?: number;
    defaultContextWindow?: number;
  };
  security?: {
    sandbox?: "auto" | "off";
  };
  webEnabled?: boolean;
  shell?: string;
};

/** The loose shape of a configuration layer, before it is merged. */
export type ConfigLayer = PartialConfig;

/**
 * Load the configuration for a session.
 *
 * @param options - Where to look, and what to override.
 */
export const loadConfig = async (
  options: {
    readonly home?: string;
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly overrides?: ConfigLayer;
    /**
     * Whether the project's own files may be read.
     *
     * The default is `untrusted`, so a caller that has not thought about it
     * cannot pick up a project's settings by accident.
     */
    readonly project?: ProjectScope;
  },
): Promise<Result<FlowCodeConfig, FlowError>> => {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const scope = options.project ?? "untrusted";
  const sources = locateConfigFiles(home, options.cwd);

  const layers: PartialConfig[] = [];
  const sourcesToRead: { readonly path: string | undefined; readonly project: boolean }[] = [
    { path: sources.user, project: false },
    { path: sources.userLocal, project: false },
    ...(scope === "trusted"
      ? [
          { path: sources.project, project: true },
          { path: sources.projectLocal, project: true },
        ]
      : []),
  ];

  for (const source of sourcesToRead) {
    if (source.path === undefined) {
      continue;
    }
    const read = await readConfigFile(source.path);
    if (!read.ok) {
      return read;
    }
    layers.push(
      source.project ? restrictProjectLayer(read.value) : read.value,
    );
  }

  const merged = mergeLayers(layers);
  const fromEnvironment = fromEnvironmentOverrides(env);
  const config = applyOverrides(merged, fromEnvironment, options.overrides);

  return ok(config);
};

/**
 * What a project's own configuration is allowed to say.
 *
 * A project may only add rules that make the harness more careful. It may not
 * choose the provider's endpoint or the key that is sent to it, the
 * permission mode, the allow list, the security settings, or the shell —
 * a checkout of somebody else's repository must never be able to redirect an
 * API key or switch the sandbox off.
 *
 * @param layer - The layer as it was read from disk.
 */
export const restrictProjectLayer = (layer: PartialConfig): PartialConfig => {
  const permissions = layer.permissions;

  if (permissions === undefined) {
    return {};
  }

  return {
    permissions: {
      ...(permissions.deny === undefined ? {} : { deny: permissions.deny }),
      ...(permissions.ask === undefined ? {} : { ask: permissions.ask }),
    },
  };
};

/** Where the configuration files are. */
export const locateConfigFiles = (
  home: string,
  cwd: string,
): ConfigSources => {
  const userDirectory = configHome(home);
  return {
    user: join(userDirectory, CONFIG_FILE),
    userLocal: join(userDirectory, LOCAL_CONFIG_FILE),
    project: join(cwd, ".flowcode", CONFIG_FILE),
    projectLocal: join(cwd, ".flowcode", LOCAL_CONFIG_FILE),
  };
};

/** Read one configuration file. */
const readConfigFile = async (path: string): Promise<Result<PartialConfig, FlowError>> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    // A file that is not there is not a problem.
    return ok({});
  }

  try {
    return ok(JSON.parse(text) as PartialConfig);
  } catch (error) {
    return err(
      flowError("invalid_request", `The configuration file '${path}' is not valid JSON.`, {
        retryable: false,
        remediation: "Fix the JSON syntax, or delete the file to fall back to the defaults.",
        cause: error,
      }),
    );
  }
};

/** Merge the configuration layers, lowest precedence first. */
export const mergeLayers = (layers: readonly PartialConfig[]): FlowCodeConfig => {
  let config: FlowCodeConfig = {
    ...DEFAULT_CONFIG,
    provider: { ...DEFAULT_CONFIG.provider },
    permissions: {
      ...DEFAULT_CONFIG.permissions,
      allow: [...DEFAULT_CONFIG.permissions.allow],
      ask: [...DEFAULT_CONFIG.permissions.ask],
      deny: [...DEFAULT_CONFIG.permissions.deny],
      additionalDirectories: [...DEFAULT_CONFIG.permissions.additionalDirectories],
    },
    tools: { ...DEFAULT_CONFIG.tools },
    context: { ...DEFAULT_CONFIG.context },
    security: { ...DEFAULT_CONFIG.security },
  };

  for (const layer of layers) {
    if (layer.provider !== undefined) {
      config = {
        ...config,
        provider: {
          ...config.provider,
          provider: layer.provider.provider ?? config.provider.provider,
          ...(layer.provider.baseUrl === undefined
            ? {}
            : { baseUrl: layer.provider.baseUrl }),
          ...(layer.provider.model === undefined ? {} : { model: layer.provider.model }),
          ...(layer.provider.apiKeyEnv === undefined
            ? {}
            : { apiKeyEnv: layer.provider.apiKeyEnv }),
        },
      };
    }

    if (layer.permissions !== undefined) {
      const mode = parseMode(layer.permissions.mode);
      config = {
        ...config,
        permissions: {
          mode: mode ?? config.permissions.mode,
          allow: [...config.permissions.allow, ...(layer.permissions.allow ?? [])],
          ask: [...config.permissions.ask, ...(layer.permissions.ask ?? [])],
          deny: [...config.permissions.deny, ...(layer.permissions.deny ?? [])],
          additionalDirectories: [
            ...config.permissions.additionalDirectories,
            ...(layer.permissions.additionalDirectories ?? []),
          ],
        },
      };
    }

    if (layer.tools !== undefined) {
      config = {
        ...config,
        tools: {
          maxToolSchemaBytes:
            layer.tools.maxToolSchemaBytes ?? config.tools.maxToolSchemaBytes,
          serialiseMixedBatches:
            layer.tools.serialiseMixedBatches ?? config.tools.serialiseMixedBatches,
          commandTimeoutMs: layer.tools.commandTimeoutMs ?? config.tools.commandTimeoutMs,
        },
      };
    }

    if (layer.context !== undefined) {
      config = {
        ...config,
        context: {
          autoCompactRatio:
            layer.context.autoCompactRatio ?? config.context.autoCompactRatio,
          keepTurns: layer.context.keepTurns ?? config.context.keepTurns,
          defaultContextWindow:
            layer.context.defaultContextWindow ?? config.context.defaultContextWindow,
        },
      };
    }

    if (layer.security !== undefined) {
      config = {
        ...config,
        security: {
          sandbox: layer.security.sandbox ?? config.security.sandbox,
        },
      };
    }

    if (layer.webEnabled !== undefined) {
      config = { ...config, webEnabled: layer.webEnabled };
    }
    if (layer.shell !== undefined) {
      config = { ...config, shell: layer.shell };
    }
  }

  return config;
};

/** Read the configuration overrides the environment provides. */
export const fromEnvironmentOverrides = (env: NodeJS.ProcessEnv): PartialConfig => {
  const provider: NonNullable<PartialConfig["provider"]> = {};
  if (env["FLOWCODE_PROVIDER"] !== undefined) {
    provider.provider = env["FLOWCODE_PROVIDER"];
  }
  if (env["FLOWCODE_BASE_URL"] !== undefined) {
    provider.baseUrl = env["FLOWCODE_BASE_URL"];
  }
  if (env["FLOWCODE_MODEL"] !== undefined) {
    provider.model = env["FLOWCODE_MODEL"];
  }
  if (env["FLOWCODE_API_KEY"] !== undefined) {
    provider.apiKeyEnv = "FLOWCODE_API_KEY";
  }

  const permissions: NonNullable<PartialConfig["permissions"]> = {};
  const mode = parseMode(env["FLOWCODE_PERMISSION_MODE"]);
  if (mode !== undefined) {
    permissions.mode = mode;
  }

  const overrides: PartialConfig = {};
  if (Object.keys(provider).length > 0) {
    overrides.provider = provider;
  }
  if (Object.keys(permissions).length > 0) {
    overrides.permissions = permissions;
  }
  return overrides;
};

/**
 * Apply the environment and the command line over a merged configuration.
 *
 * @param config - The merged configuration.
 * @param environment - What the environment overrides.
 * @param overrides - What the command line overrides.
 */
export const applyOverrides = (
  config: FlowCodeConfig,
  environment: PartialConfig,
  overrides?: PartialConfig,
): FlowCodeConfig => {
  const withEnvironment = mergeLayers([config as PartialConfig, environment]);
  if (overrides === undefined) {
    return withEnvironment;
  }
  return mergeLayers([withEnvironment as PartialConfig, overrides]);
};

/** Read a permission mode, ignoring anything that is not one. */
export const parseMode = (value: string | undefined): PermissionMode | undefined =>
  value !== undefined && (PERMISSION_MODES as readonly string[]).includes(value)
    ? (value as PermissionMode)
    : undefined;

/**
 * The rules a session starts with: the built-in defaults plus the user's.
 */
export const effectiveRules = (config: FlowCodeConfig) => ({
  allow: [...config.permissions.allow],
  ask: [...config.permissions.ask],
  deny: [...DEFAULT_RULES.deny, ...config.permissions.deny],
});
