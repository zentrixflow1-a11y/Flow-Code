/**
 * Retrying transient provider failures.
 *
 * Only failures that are explicitly marked retryable are retried; an
 * authentication error is never retried, because retrying it cannot help and
 * only delays the message the user needs to see.
 */
import type { FlowError } from "../errors.js";
import { err, type Result } from "../util/result.js";

/** How {@link withRetry} behaves. */
export interface RetryOptions {
  /** The total number of attempts, including the first. Defaults to 3. */
  readonly attempts?: number;
  /** The delay before the first retry, in milliseconds. Defaults to 500. */
  readonly baseDelayMs?: number;
  /** The longest delay between attempts, in milliseconds. Defaults to 8000. */
  readonly maxDelayMs?: number;
  /** The jitter applied to each delay, as a fraction. Defaults to 0.25. */
  readonly jitter?: number;
  /** An injectable sleep, so tests do not have to wait. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Cancels the retries. */
  readonly signal?: AbortSignal;
}

/** The default sleep, backed by `setTimeout`. */
const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

/**
 * Run an operation, retrying it while it reports a retryable failure.
 *
 * @param operation - The work to run. Receives the zero-based attempt number.
 * @param options - See {@link RetryOptions}.
 */
export const withRetry = async <T>(
  operation: (attempt: number) => Promise<Result<T, FlowError>>,
  options: RetryOptions = {},
): Promise<Result<T, FlowError>> => {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const jitter = options.jitter ?? 0.25;
  const sleep = options.sleep ?? defaultSleep;

  let last: FlowError | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted === true) {
      return err(
        last ??
          ({
            code: "aborted",
            message: "The request was cancelled.",
            retryable: false,
          } satisfies FlowError),
      );
    }

    const outcome = await operation(attempt);
    if (outcome.ok) {
      return outcome;
    }

    last = outcome.error;
    if (!outcome.error.retryable || attempt === attempts - 1) {
      return outcome;
    }

    await sleep(delayFor(attempt, baseDelayMs, maxDelayMs, jitter));
  }

  return err(
    last ??
      ({ code: "server_error", message: "The request failed.", retryable: true } satisfies FlowError),
  );
};

/**
 * The delay before the given attempt's retry.
 *
 * The delay doubles each time and is capped, with a little jitter so that
 * several clients do not retry in lockstep.
 */
export const delayFor = (
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: number,
): number => {
  const exponential = baseDelayMs * 2 ** attempt;
  const capped = Math.min(exponential, maxDelayMs);
  const spread = capped * jitter;
  return Math.round(capped - spread + Math.random() * spread * 2);
};
