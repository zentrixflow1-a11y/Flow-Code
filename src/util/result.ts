/**
 * A tiny result type.
 *
 * Flow Code uses this instead of exceptions for anything that can fail for an
 * expected reason. It keeps the failure on the type level, so a caller cannot
 * forget to handle it.
 */

/** A value that succeeded, or a value that failed with a reason. */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Build a successful result. */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/** Build a failed result. */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Map the success value of a result, leaving a failure untouched. */
export const mapResult = <T, U, E>(
  result: Result<T, E>,
  map: (value: T) => U,
): Result<U, E> => (result.ok ? ok(map(result.value)) : result);

/** Run a function that may throw, capturing the throw as a failure. */
export const attempt = <T>(fn: () => T): Result<T, Error> => {
  try {
    return ok(fn());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
};
