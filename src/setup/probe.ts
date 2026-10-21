/**
 * Finding the model servers that are running.
 *
 * The setup wizard uses this to see which local servers are up and what
 * models they serve, so the user does not have to be told which port to
 * look at.
 */
import { flowError, type FlowError } from "../errors.js";
import { createOpenAiCompatibleProvider } from "../providers/openai-compatible.js";
import { LOCAL_PRESETS, type ProviderPreset } from "../providers/presets.js";
import { err, ok, type Result } from "../util/result.js";

/** How long a probe waits for an answer. */
const PROBE_TIMEOUT_MS = 2500;

/** What a probe found. */
export interface ProviderProbe {
  /** The provider's identifier. */
  readonly id: string;
  /** The provider's name. */
  readonly label: string;
  /** Where the probe looked. */
  readonly baseUrl: string;
  /** Whether the server answered. */
  readonly reachable: boolean;
  /** The models the server reported. */
  readonly models: readonly string[];
  /** Why the probe failed, when it did. */
  readonly error?: string;
}

/**
 * Probe a set of providers.
 *
 * @param presets - The providers to probe. Defaults to the local ones.
 * @param extra - Extra providers to probe, such as a configured remote one.
 */
export const probeProviders = async (
  presets: readonly ProviderPreset[] = LOCAL_PRESETS,
  extra: readonly ProviderPreset[] = [],
): Promise<readonly ProviderProbe[]> => {
  const all = [...presets, ...extra];
  const probes = await Promise.all(all.map((preset) => probeProvider(preset)));
  return probes;
};

/** Probe one provider. */
export const probeProvider = async (
  preset: ProviderPreset,
): Promise<ProviderProbe> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const provider = createOpenAiCompatibleProvider({
      id: preset.id,
      label: preset.label,
      baseUrl: preset.baseUrl,
      ...(preset.placeholderAuth === undefined
        ? {}
        : { apiKey: preset.placeholderAuth }),
      ...(preset.compat === undefined ? {} : { compat: preset.compat }),
    });

    const result = await provider.listModels(controller.signal);

    if (!result.ok) {
      return {
        id: preset.id,
        label: preset.label,
        baseUrl: preset.baseUrl,
        reachable: false,
        models: [],
        error: result.error.message,
      };
    }

    return {
      id: preset.id,
      label: preset.label,
      baseUrl: preset.baseUrl,
      reachable: true,
      models: result.value.map((model) => model.id),
    };
  } catch (error) {
    return {
      id: preset.id,
      label: preset.label,
      baseUrl: preset.baseUrl,
      reachable: false,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Check that a model server is reachable and serves a model.
 *
 * @param baseUrl - The server's base URL.
 * @param model - The model that should be there.
 */
export const checkModel = async (
  baseUrl: string,
  model: string,
): Promise<Result<boolean, FlowError>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const provider = createOpenAiCompatibleProvider({
      id: "check",
      label: "Check",
      baseUrl,
    });
    const result = await provider.listModels(controller.signal);
    if (!result.ok) {
      return result;
    }
    return ok(result.value.some((entry) => entry.id === model));
  } finally {
    clearTimeout(timer);
  }
};

/** A friendly message for a provider that could not be reached. */
export const describeProbe = (probe: ProviderProbe): string => {
  if (!probe.reachable) {
    return `${probe.label} (${probe.baseUrl}) — not running`;
  }
  if (probe.models.length === 0) {
    return `${probe.label} (${probe.baseUrl}) — running, but it reports no models`;
  }
  return `${probe.label} (${probe.baseUrl}) — ${probe.models.length} model${
    probe.models.length === 1 ? "" : "s"
  }`;
};

/** A failure for a provider that is not there. */
export const providerMissing = (id: string): FlowError =>
  flowError("not_found", `The provider '${id}' is not running.`, {
    retryable: false,
    remediation: "Start the server, or pick a different provider.",
  });

export { err };
