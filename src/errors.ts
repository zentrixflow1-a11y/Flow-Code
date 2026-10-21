/**
 * The error type Flow Code passes around instead of throwing.
 *
 * Expected failures — a refused permission, a malformed response, a provider
 * that is down — are values, not exceptions. Only genuine bugs throw.
 */

/** The kinds of failure Flow Code distinguishes. */
export type FlowErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "timeout"
  | "aborted"
  | "malformed_response"
  | "unsupported"
  | "permission_denied"
  | "resource_constraint"
  | "tool_failed";

/** A structured failure with enough context to act on. */
export interface FlowError {
  /** The machine-readable kind of failure. */
  readonly code: FlowErrorCode;
  /** A human-readable description. */
  readonly message: string;
  /** Whether retrying the same request could succeed. */
  readonly retryable: boolean;
  /** What the user or the model should do about it. */
  readonly remediation?: string;
  /** The HTTP status, when the failure came from an HTTP response. */
  readonly status?: number;
  /** The underlying cause, kept for diagnostics. */
  readonly cause?: unknown;
}

/** Build a {@link FlowError}. */
export const flowError = (
  code: FlowErrorCode,
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly remediation?: string;
    readonly status?: number;
    readonly cause?: unknown;
  } = {},
): FlowError => ({
  code,
  message,
  retryable: options.retryable ?? false,
  ...(options.remediation === undefined ? {} : { remediation: options.remediation }),
  ...(options.status === undefined ? {} : { status: options.status }),
  ...(options.cause === undefined ? {} : { cause: options.cause }),
});

/** Whether a value is a {@link FlowError}. */
export const isFlowError = (value: unknown): value is FlowError =>
  typeof value === "object" &&
  value !== null &&
  "code" in value &&
  "message" in value &&
  "retryable" in value;

/** Render a {@link FlowError} as a single line, for logs and tool results. */
export const formatFlowError = (error: FlowError): string =>
  error.remediation === undefined
    ? `${error.code}: ${error.message}`
    : `${error.code}: ${error.message} — ${error.remediation}`;
