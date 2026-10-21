import { describe, expect, it } from "vitest";
import { createRedactor, REDACTION_PLACEHOLDER } from "./redact.js";

describe("createRedactor", () => {
  it("removes a declared secret", () => {
    const redact = createRedactor({ secrets: ["super-secret-value"] });
    expect(redact("the key is super-secret-value here")).toBe(
      `the key is ${REDACTION_PLACEHOLDER} here`,
    );
  });

  it("ignores a declared secret that is too short to be meaningful", () => {
    const redact = createRedactor({ secrets: ["ab"] });
    expect(redact("ab cd")).toBe("ab cd");
  });

  it("removes an AWS access key", () => {
    const redact = createRedactor();
    expect(redact("AKIAIOSFODNN7EXAMPLE")).toBe(REDACTION_PLACEHOLDER);
  });

  it("removes an OpenAI-style key", () => {
    const redact = createRedactor();
    expect(redact("sk-abcdefghijklmnopqrstuvwxyz012345")).toBe(REDACTION_PLACEHOLDER);
  });

  it("removes a GitHub token", () => {
    const redact = createRedactor();
    expect(redact("ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe(REDACTION_PLACEHOLDER);
  });

  it("removes a private key block", () => {
    const redact = createRedactor();
    const key = "-----BEGIN RSA PRIVATE KEY-----\nabc\ndef\n-----END RSA PRIVATE KEY-----";
    expect(redact(key)).toBe(REDACTION_PLACEHOLDER);
  });

  it("removes a JSON web token", () => {
    const redact = createRedactor();
    expect(redact("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      REDACTION_PLACEHOLDER,
    );
  });

  it("leaves ordinary text alone", () => {
    const redact = createRedactor();
    expect(redact("const answer = 42;")).toBe("const answer = 42;");
  });

  it("can be used more than once", () => {
    const redact = createRedactor();
    const first = redact("AKIAIOSFODNN7EXAMPLE");
    const second = redact("AKIAIOSFODNN7EXAMPLE");
    expect(first).toBe(second);
    expect(first).toBe(REDACTION_PLACEHOLDER);
  });

  it("accepts extra patterns", () => {
    const redact = createRedactor({ patterns: [/custom-\d+/g] });
    expect(redact("value custom-42 here")).toBe(`value ${REDACTION_PLACEHOLDER} here`);
  });
});
