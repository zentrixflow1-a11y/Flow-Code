/**
 * The built-in provider presets.
 *
 * A preset is configuration, not code: it says where a provider lives, which
 * environment variable holds its key, and how it wants requests shaped. Users
 * can define their own without touching the adapter.
 */
import type { CompatFlags } from "./compat.js";

/** A named provider configuration. */
export interface ProviderPreset {
  /** A stable identifier, used in configuration files. */
  readonly id: string;
  /** A human-readable name. */
  readonly label: string;
  /** The base URL of the provider's API. */
  readonly baseUrl: string;
  /** The environment variable that holds the API key. */
  readonly apiKeyEnv?: string;
  /**
   * A credential to send when the server insists on an `Authorization` header
   * but no key is configured. Local servers usually ignore the value but
   * reject the request when the header is missing.
   */
  readonly placeholderAuth?: string;
  /** Request-shaping overrides for this provider. */
  readonly compat?: Partial<CompatFlags>;
  /** Whether this provider runs on the user's own machine. */
  readonly local: boolean;
  /** A model to suggest first, when the provider is well known. */
  readonly suggestedModel?: string;
  /** A short note about what this provider is. */
  readonly note?: string;
}

/** The provider presets Flow Code ships with. */
export const PRESETS: readonly ProviderPreset[] = [
  {
    id: "ollama",
    label: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    placeholderAuth: "ollama",
    compat: { strictToolSchema: false, parallelToolCalls: false },
    local: true,
    note: "Local models served by Ollama. No API key needed.",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    placeholderAuth: "lm-studio",
    compat: { strictToolSchema: false },
    local: true,
    note: "Local models served by LM Studio. No API key needed.",
  },
  {
    id: "llamacpp",
    label: "llama.cpp",
    baseUrl: "http://127.0.0.1:8080/v1",
    placeholderAuth: "llama",
    compat: { strictToolSchema: false, parallelToolCalls: false },
    local: true,
    note: "A llama.cpp `llama-server` instance. No API key needed.",
  },
  {
    id: "vllm",
    label: "vLLM",
    baseUrl: "http://127.0.0.1:8000/v1",
    placeholderAuth: "vllm",
    compat: { strictToolSchema: false, parallelToolCalls: false },
    local: true,
    note: "A vLLM server. No API key needed.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    compat: { developerRole: false, maxTokensField: "max_tokens", strictToolSchema: false },
    local: false,
    suggestedModel: "deepseek-chat",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    compat: { maxTokensField: "max_tokens" },
    local: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    compat: { developerRole: true, maxTokensField: "max_completion_tokens" },
    local: false,
    suggestedModel: "gpt-4o-mini",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    local: false,
    note: "Uses the Anthropic Messages API rather than the OpenAI-compatible one.",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    compat: { developerRole: false, maxTokensField: "max_tokens" },
    local: false,
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    apiKeyEnv: "TOGETHER_API_KEY",
    compat: { strictToolSchema: false },
    local: false,
  },
  {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAS_API_KEY",
    compat: { strictToolSchema: false, parallelToolCalls: false },
    local: false,
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    compat: { strictToolSchema: false },
    local: false,
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    baseUrl: "",
    local: false,
    note: "Any endpoint that speaks the OpenAI chat completions API.",
  },
];

/** Find a preset by its identifier. */
export const findPreset = (id: string): ProviderPreset | undefined =>
  PRESETS.find((preset) => preset.id === id);

/** The presets that run on the user's own machine. */
export const LOCAL_PRESETS: readonly ProviderPreset[] = PRESETS.filter(
  (preset) => preset.local,
);
