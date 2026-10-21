import { describe, expect, it } from "vitest";
import { delayFor, withRetry } from "./retry.js";
import { flowError } from "../errors.js";
import { ok, err } from "../util/result.js";

describe("withRetry", () => {
  it("returns the first success without retrying", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return ok("done");
      },
      { sleep: async () => undefined },
    );

    expect(result).toEqual({ ok: true, value: "done" });
    expect(calls).toBe(1);
  });

  it("retries a retryable failure", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          return err(flowError("server_error", "boom", { retryable: true }));
        }
        return ok("recovered");
      },
      { sleep: async () => undefined },
    );

    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("does not retry a failure that is not retryable", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return err(flowError("unauthorized", "nope", { retryable: false }));
      },
      { sleep: async () => undefined },
    );

    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it("gives up after the configured number of attempts", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return err(flowError("server_error", "boom", { retryable: true }));
      },
      { attempts: 3, sleep: async () => undefined },
    );

    expect(result.ok).toBe(false);
    expect(calls).toBe(3);
  });

  it("stops when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;

    const result = await withRetry(
      async () => {
        calls += 1;
        return ok("never");
      },
      { signal: controller.signal, sleep: async () => undefined },
    );

    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it("sleeps between attempts", async () => {
    const delays: number[] = [];
    let calls = 0;

    await withRetry(
      async () => {
        calls += 1;
        return calls < 3
          ? err(flowError("server_error", "boom", { retryable: true }))
          : ok("done");
      },
      { sleep: async (ms) => void delays.push(ms), jitter: 0 },
    );

    expect(delays).toHaveLength(2);
  });
});

describe("delayFor", () => {
  it("doubles the delay on each attempt", () => {
    expect(delayFor(0, 100, 10_000, 0)).toBe(100);
    expect(delayFor(1, 100, 10_000, 0)).toBe(200);
    expect(delayFor(2, 100, 10_000, 0)).toBe(400);
  });

  it("caps the delay", () => {
    expect(delayFor(20, 100, 1000, 0)).toBe(1000);
  });

  it("keeps the jittered delay within the expected band", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const delay = delayFor(0, 1000, 10_000, 0.25);
      expect(delay).toBeGreaterThanOrEqual(750);
      expect(delay).toBeLessThanOrEqual(1250);
    }
  });
});
