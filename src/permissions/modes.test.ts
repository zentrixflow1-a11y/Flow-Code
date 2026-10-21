import { describe, expect, it } from "vitest";
import { categoryOutcome, describeMode, isHardCeiling, isReadOnlyCommand } from "./modes.js";

describe("categoryOutcome", () => {
  it("allows reads and session control in ask mode", () => {
    expect(categoryOutcome("ask", "read")).toBe("allow");
    expect(categoryOutcome("ask", "control")).toBe("allow");
  });

  it("asks for everything else in ask mode", () => {
    expect(categoryOutcome("ask", "write")).toBe("ask");
    expect(categoryOutcome("ask", "execute")).toBe("ask");
    expect(categoryOutcome("ask", "network")).toBe("ask");
  });

  it("allows writes in accept_edits mode", () => {
    expect(categoryOutcome("accept_edits", "write")).toBe("allow");
    expect(categoryOutcome("accept_edits", "execute")).toBe("ask");
  });

  it("denies changes in plan and safe modes", () => {
    for (const mode of ["plan", "safe"] as const) {
      expect(categoryOutcome(mode, "write")).toBe("deny");
      expect(categoryOutcome(mode, "execute")).toBe("deny");
      expect(categoryOutcome(mode, "network")).toBe("deny");
      expect(categoryOutcome(mode, "read")).toBe("allow");
    }
  });

  it("allows everything in trust mode", () => {
    for (const category of ["read", "write", "execute", "network", "control"] as const) {
      expect(categoryOutcome("trust", category)).toBe("allow");
    }
  });
});

describe("isHardCeiling", () => {
  it("reports a ceiling only for the modes that have one", () => {
    expect(isHardCeiling("plan", "write")).toBe(true);
    expect(isHardCeiling("safe", "network")).toBe(true);
    expect(isHardCeiling("ask", "write")).toBe(false);
    expect(isHardCeiling("accept_edits", "write")).toBe(false);
    expect(isHardCeiling("trust", "write")).toBe(false);
  });
});

describe("describeMode", () => {
  it("describes every mode", () => {
    for (const mode of ["ask", "accept_edits", "plan", "safe", "trust"] as const) {
      expect(describeMode(mode).length).toBeGreaterThan(0);
    }
  });
});

describe("isReadOnlyCommand", () => {
  it("recognises commands that only read", () => {
    expect(isReadOnlyCommand("ls")).toBe(true);
    expect(isReadOnlyCommand("ls -la")).toBe(true);
    expect(isReadOnlyCommand("cat package.json")).toBe(true);
    expect(isReadOnlyCommand("grep -r foo src")).toBe(true);
    expect(isReadOnlyCommand("pwd")).toBe(true);
  });

  it("recognises read-only git subcommands", () => {
    expect(isReadOnlyCommand("git status")).toBe(true);
    expect(isReadOnlyCommand("git log --oneline")).toBe(true);
    expect(isReadOnlyCommand("git diff")).toBe(true);
  });

  it("rejects git commands that write", () => {
    expect(isReadOnlyCommand("git commit -m x")).toBe(false);
    expect(isReadOnlyCommand("git push")).toBe(false);
  });

  it("rejects commands that write", () => {
    expect(isReadOnlyCommand("rm -rf build")).toBe(false);
    expect(isReadOnlyCommand("npm install")).toBe(false);
    expect(isReadOnlyCommand("mkdir out")).toBe(false);
  });

  it("rejects a find that acts", () => {
    expect(isReadOnlyCommand("find . -name '*.ts'")).toBe(true);
    expect(isReadOnlyCommand("find . -delete")).toBe(false);
    expect(isReadOnlyCommand("find . -exec rm {} ;")).toBe(false);
  });

  it("rejects a redirect", () => {
    expect(isReadOnlyCommand("ls > out.txt")).toBe(false);
  });

  it("rejects running a program, even an interpreter", () => {
    expect(isReadOnlyCommand("node script.js")).toBe(false);
    expect(isReadOnlyCommand("python script.py")).toBe(false);
  });

  it("ignores a leading environment assignment", () => {
    expect(isReadOnlyCommand("NODE_ENV=test ls")).toBe(true);
    expect(isReadOnlyCommand("NODE_ENV=test rm -rf x")).toBe(false);
  });

  it("treats a chain as read-only only when every part is", () => {
    expect(isReadOnlyCommand("ls && cat file")).toBe(true);
    expect(isReadOnlyCommand("ls && rm file")).toBe(false);
  });

  it("rejects an empty command", () => {
    expect(isReadOnlyCommand("")).toBe(false);
  });
});
