/**
 * Building a provider from the configuration.
 */
import { flowError, type FlowError } from "../errors.js";
import { err, ok, type Result } from "../util/result.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
import { findPreset, type ProviderPreset } from "./presets.js";
import type { ModelProvider } from "./types.js";
import { resolveApiKey } from "../config/credentials.js";
import type { ProviderSettings } from "../config/types.js";

/** How to build a provider. */
export interface ProviderFactoryOptions {
  /** The provider settings. */
  readonly provider: ProviderSettings;
  /** The environment to read credentials from. */
  readonly env?: NodeJS.ProcessEnv;
  /** The user's home directory. */
  readonly home?: string;
}

/**
 * Build the provider the configuration asks for.
 *
 * @param options - The provider settings.
 */
export const createProvider = async (
  options: ProviderFactoryOptions,
): Promise<Result<ModelProvider, FlowError>> => {
  const preset = findPreset(options.provider.provider);

  if (preset === undefined) {
    return err(
      flowError(
        "invalid_request",
        `'${options.provider.provider}' is not a provider Flow Code knows about.`,
        {
          retryable: false,
          remediation:
            "Use one of the built-in presets, or set a baseUrl to talk to any OpenAI-compatible endpoint.",
        },
      ),
    );
  }

  const baseUrl = options.provider.baseUrl ?? preset.baseUrl;
  if (baseUrl === "") {
    return err(
      flowError("invalid_request", "The custom provider needs a base URL.", {
        retryable: false,
        remediation: "Set `provider.baseUrl` in the configuration file.",
      }),
    );
  }

  const apiKey = await resolveApiKey({
    env: options.env,
    ...(options.home === undefined ? {} : { home: options.home }),
    provider: preset.id,
    ...(options.provider.apiKeyEnv === undefined
      ? {}
      : { apiKeyEnv: options.provider.apiKeyEnv }),
  });

  const key = apiKey ?? (preset.placeholderAuth ?? undefined);

  if (preset.id === "anthropic") {
    return ok(
      createAnthropicProvider({
        id: preset.id,
        label: preset.label,
        baseUrl,
        ...(key === undefined ? {} : { apiKey: key }),
      }),
    );
  }

  return ok(
    createOpenAiCompatibleProvider({
      id: preset.id,
      label: preset.label,
      baseUrl,
      ...(key === undefined ? {} : { apiKey: key }),
      ...(preset.compat === undefined ? {} : { compat: preset.compat }),
    }),
  );
};

/**
 * The model to use, when the configuration does not name one.
 *
 * @param preset - The provider preset.
 */
export const defaultModelFor = (preset: ProviderPreset): string | undefined =>
  preset.suggestedModel;
