import { describe, expect, it } from "vitest";
import { EXIT, runCli, type CliDeps } from "./run.js";

/** Capture everything the CLI prints. */
const capture = (): CliDeps & { readonly outLines: string[]; readonly errLines: string[] } => {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    out: (text) => void outLines.push(text),
    err: (text) => void errLines.push(text),
    cwd: "/tmp",
    env: {},
    outLines,
    errLines,
  };
};

describe("runCli", () => {
  it("prints the version and exits successfully", async () => {
    const deps = capture();
    const status = await runCli(["--version"], deps);
    expect(status).toBe(EXIT.ok);
    expect(deps.outLines).toHaveLength(1);
    expect(deps.outLines[0]).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("accepts -v as a short alias", async () => {
    const deps = capture();
    await runCli(["-v"], deps);
    expect(deps.outLines[0]).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints help and exits successfully", async () => {
    const deps = capture();
    const status = await runCli(["--help"], deps);
    expect(status).toBe(EXIT.ok);
    expect(deps.outLines.join("\n")).toContain("Usage:");
    expect(deps.outLines.join("\n")).toContain("--version");
  });

  it("accepts the `help` command", async () => {
    const deps = capture();
    const status = await runCli(["help"], deps);
    expect(status).toBe(EXIT.ok);
    expect(deps.outLines.join("\n")).toContain("Usage:");
  });

  it("reports an unknown command on stderr and fails", async () => {
    const deps = capture();
    const status = await runCli(["nope"], deps);
    expect(status).toBe(EXIT.failure);
    expect(deps.outLines).toEqual([]);
    expect(deps.errLines.join("\n")).toContain("unknown command 'nope'");
  });

  it("refuses an unknown output format", async () => {
    const deps = capture();
    const status = await runCli(["-p", "hello", "--output-format", "yaml"], deps);
    expect(status).toBe(EXIT.failure);
    expect(deps.errLines.join("\n")).toContain("unknown output format");
  });

  it("refuses an unknown permission mode", async () => {
    const deps = capture();
    const status = await runCli(["-p", "hello", "--permission-mode", "yolo"], deps);
    expect(status).toBe(EXIT.failure);
    expect(deps.errLines.join("\n")).toContain("unknown permission mode");
  });
});
