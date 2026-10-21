/**
 * Listing the models a provider can serve.
 *
 * Discovery is a convenience, never a gate. A provider that cannot list its
 * models must still work with a model id the user typed by hand, so a failure
 * here is reported, not thrown.
 */
import { flowError, type FlowError } from "../errors.js";
import { err, ok, type Result } from "../util/result.js";
import { errorForStatus, httpRequest } from "./http.js";
import type { ModelInfo } from "./types.js";

/** Remove a trailing slash from a URL. */
export const trimTrailingSlash = (url: string): string =>
  url.endsWith("/") ? url.slice(0, -1) : url;

/**
 * The origin of a base URL, with any OpenAI-style version suffix removed.
 *
 * `http://127.0.0.1:11434/v1` becomes `http://127.0.0.1:11434`, which is where
 * Ollama's native endpoints live.
 */
export const providerOrigin = (baseUrl: string): string =>
  trimTrailingSlash(baseUrl).replace(/\/v\d+$/, "");

/**
 * List the models available at a base URL.
 *
 * Tries the OpenAI-shaped `/models` endpoint first, then Ollama's native
 * `/api/tags`.
 */
export const listModels = async (
  baseUrl: string,
  headers: Readonly<Record<string, string>> = {},
  signal?: AbortSignal,
): Promise<Result<ModelInfo[], FlowError>> => {
  const trimmed = trimTrailingSlash(baseUrl);

  const outcome = await httpRequest(
    `${trimmed}/models`,
    { method: "GET", headers: { accept: "application/json", ...headers } },
    signal,
  );

  if (!outcome.ok) {
    return outcome;
  }

  const response = outcome.value;
  if (response.status === 404) {
    return listOllamaModels(baseUrl, headers, signal);
  }
  if (!response.ok) {
    return err(errorForStatus(response.status, await response.text()));
  }

  return parseModelList(await response.text());
};

/**
 * List models from Ollama's native endpoint.
 *
 * Ollama exposes `/api/tags` at the server root, outside the OpenAI-compatible
 * `/v1` prefix.
 */
const listOllamaModels = async (
  baseUrl: string,
  headers: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<Result<ModelInfo[], FlowError>> => {
  const origin = providerOrigin(baseUrl);
  if (origin === "") {
    return err(
      flowError("not_found", "This provider does not offer a model listing endpoint.", {
        retryable: false,
        remediation: "Type the model id by hand instead.",
      }),
    );
  }

  const outcome = await httpRequest(
    `${origin}/api/tags`,
    { method: "GET", headers: { accept: "application/json", ...headers } },
    signal,
  );

  if (!outcome.ok) {
    return outcome;
  }

  const response = outcome.value;
  if (!response.ok) {
    return err(errorForStatus(response.status, await response.text()));
  }

  return parseModelList(await response.text());
};

/**
 * Parse a model listing in either the OpenAI or the Ollama shape.
 *
 * @param body - The raw response body.
 */
export const parseModelList = (body: string): Result<ModelInfo[], FlowError> => {
  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch (error) {
    return err(
      flowError("malformed_response", "The provider's model list was not valid JSON.", {
        retryable: false,
        cause: error,
      }),
    );
  }

  if (typeof payload !== "object" || payload === null) {
    return err(
      flowError("malformed_response", "The provider's model list was not an object.", {
        retryable: false,
      }),
    );
  }

  const record = payload as Record<string, unknown>;
  const openAiData = record["data"];
  const ollamaModels = record["models"];

  const models: ModelInfo[] = [];

  if (Array.isArray(openAiData)) {
    for (const entry of openAiData) {
      const model = toModelInfo(entry, ["id"]);
      if (model !== undefined) {
        models.push(model);
      }
    }
  }

  if (Array.isArray(ollamaModels)) {
    for (const entry of ollamaModels) {
      const model = toModelInfo(entry, ["name", "model"]);
      if (model !== undefined) {
        models.push(model);
      }
    }
  }

  if (models.length === 0) {
    return err(
      flowError("not_found", "The provider did not report any models.", {
        retryable: false,
        remediation: "Type the model id by hand instead.",
      }),
    );
  }

  return ok(models);
};

/** Read one entry of a model listing. */
const toModelInfo = (
  entry: unknown,
  idFields: readonly string[],
): ModelInfo | undefined => {
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }
  const record = entry as Record<string, unknown>;

  for (const field of idFields) {
    const value = record[field];
    if (typeof value === "string" && value !== "") {
      const label = record["display_name"];
      const contextWindow = record["context_length"];
      return {
        id: value,
        ...(typeof label === "string" && label !== "" ? { label } : {}),
        ...(typeof contextWindow === "number" ? { contextWindow } : {}),
      };
    }
  }

  return undefined;
};
