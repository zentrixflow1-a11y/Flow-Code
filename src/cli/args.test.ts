import { describe, expect, it } from "vitest";
import { ArgParseError, booleanFlag, parseArgs, stringFlag } from "./args.js";

describe("parseArgs", () => {
  it("collects positionals in order", () => {
    const parsed = parseArgs(["one", "two", "three"]);
    expect(parsed.positionals).toEqual(["one", "two", "three"]);
  });

  it("treats an unknown dash token as a positional", () => {
    const parsed = parseArgs(["-"]);
    expect(parsed.positionals).toEqual(["-"]);
  });

  it("records bare long flags as booleans", () => {
    const parsed = parseArgs(["--help"]);
    expect(parsed.flags.help).toBe(true);
  });

  it("records inline values", () => {
    const parsed = parseArgs(["--model=qwen2.5-coder:7b"]);
    expect(parsed.flags.model).toBe("qwen2.5-coder:7b");
  });

  it("consumes the next argument for known value flags", () => {
    const spec = { valueFlags: new Set<string>(["model"]), aliases: new Map<string, string>() };
    const parsed = parseArgs(["--model", "llama3", "extra"], spec);
    expect(parsed.flags.model).toBe("llama3");
    expect(parsed.positionals).toEqual(["extra"]);
  });

  it("throws when a value flag has no value", () => {
    const spec = { valueFlags: new Set<string>(["model"]), aliases: new Map<string, string>() };
    expect(() => parseArgs(["--model"], spec)).toThrow(ArgParseError);
  });

  it("resolves short aliases to their long name", () => {
    const spec = { valueFlags: new Set<string>(), aliases: new Map<string, string>([["p", "print"]]) };
    const parsed = parseArgs(["-p"], spec);
    expect(parsed.flags.print).toBe(true);
  });

  it("stops flag parsing after a double dash", () => {
    const parsed = parseArgs(["--", "--not-a-flag", "value"]);
    expect(parsed.positionals).toEqual(["--not-a-flag", "value"]);
    expect(parsed.flags).toEqual({});
  });

  it("keeps the last value when a flag repeats", () => {
    const parsed = parseArgs(["--model=a", "--model=b"]);
    expect(parsed.flags.model).toBe("b");
  });
});

describe("flag readers", () => {
  it("reads a string flag only when it holds a string", () => {
    expect(stringFlag({ model: "x" }, "model")).toBe("x");
    expect(stringFlag({ model: true }, "model")).toBeUndefined();
    expect(stringFlag({}, "model")).toBeUndefined();
  });

  it("treats any present flag as truthy", () => {
    expect(booleanFlag({ help: true }, "help")).toBe(true);
    expect(booleanFlag({ help: "yes" }, "help")).toBe(true);
    expect(booleanFlag({}, "help")).toBe(false);
  });
});
