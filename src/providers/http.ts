/**
 * The HTTP layer shared by the provider adapters.
 *
 * Failures are classified once, here, so every adapter reports the same codes
 * for the same situations.
 */
import { flowError, type FlowError } from "../errors.js";
import { err, ok, type Result } from "../util/result.js";

/** The headers Flow Code sends with every provider request. */
export const JSON_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json",
  accept: "text/event-stream",
};

/**
 * Perform an HTTP request, turning transport failures into {@link FlowError}s.
 *
 * The response is returned as-is; the caller decides what an error status
 * means, because only the caller knows whether it wants the body.
 */
export const httpRequest = async (
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Result<Response, FlowError>> => {
  try {
    const response = await fetch(url, { ...init, signal });
    return ok(response);
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) {
      return err(
        flowError("aborted", "The request was cancelled.", {
          retryable: false,
          cause: error,
        }),
      );
    }
    return err(
      flowError("network_error", `Could not reach ${url}: ${errorMessage(error)}`, {
        retryable: true,
        remediation:
          "Check that the provider is running and that the base URL is correct.",
        cause: error,
      }),
    );
  }
};

/**
 * Classify an HTTP status into a {@link FlowError}.
 *
 * @param status - The response status.
 * @param body - The response body, used to explain what went wrong.
 */
export const errorForStatus = (status: number, body: string): FlowError => {
  const detail = summarizeBody(body);

  if (status === 401) {
    return flowError("unauthorized", `The provider rejected the credentials.${detail}`, {
      retryable: false,
      status,
      remediation:
        "Set the provider's API key in the environment, or point `apiKeyEnv` at the variable that holds it.",
    });
  }
  if (status === 403) {
    return flowError("forbidden", `The provider refused the request.${detail}`, {
      retryable: false,
      status,
      remediation: "Check that the key is permitted to use this model.",
    });
  }
  if (status === 404) {
    return flowError("not_found", `The provider does not have that endpoint or model.${detail}`, {
      retryable: false,
      status,
      remediation: "Check the base URL and the model id.",
    });
  }
  if (status === 408 || status === 504) {
    return flowError("timeout", `The provider timed out.${detail}`, {
      retryable: true,
      status,
    });
  }
  if (status === 429) {
    return flowError("rate_limited", `The provider is rate limiting this key.${detail}`, {
      retryable: true,
      status,
      remediation: "Wait a moment, or lower the request rate.",
    });
  }
  if (status >= 500) {
    return flowError("server_error", `The provider returned ${status}.${detail}`, {
      retryable: true,
      status,
    });
  }
  return flowError("invalid_request", `The provider rejected the request.${detail}`, {
    retryable: false,
    status,
  });
};

/** Whether an unknown thrown value is an abort. */
export const isAbortError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "AbortError" || error.name === "TimeoutError");

/** Extract a readable message from an unknown thrown value. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Reduce a response body to a short, safe explanation. */
const summarizeBody = (body: string): string => {
  const trimmed = body.trim();
  if (trimmed === "") {
    return "";
  }
  const firstLine = trimmed.split("\n", 1)[0] ?? "";
  const shortened = firstLine.length > 240 ? `${firstLine.slice(0, 240)}…` : firstLine;
  return ` ${shortened}`;
};
