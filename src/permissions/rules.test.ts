import { describe, expect, it } from "vitest";
import {
  deniedTools,
  mergeRules,
  parseRule,
  resolvePathSpec,
  ruleMatches,
  toolPartMatches,
} from "./rules.js";
import { EMPTY_RULES } from "./types.js";

const CONTEXT = {
  workspaceRoot: "/home/user/project",
  cwd: "/home/user/project",
  home: "/home/user",
};

describe("parseRule", () => {
  it("splits a rule with a specifier", () => {
    expect(parseRule("run_command:npm run *")).toEqual({
      tool: "run_command",
      spec: "npm run *",
    });
  });

  it("handles a rule with no specifier", () => {
    expect(parseRule("run_command")).toEqual({ tool: "run_command" });
  });

  it("splits at the first colon, so an MCP tool keeps its full name", () => {
    expect(parseRule("mcp:github:create_issue")).toEqual({
      tool: "mcp",
      spec: "github:create_issue",
    });
  });

  it("keeps colons that belong to the specifier", () => {
    expect(parseRule("run_command:npm run build:prod")).toEqual({
      tool: "run_command",
      spec: "npm run build:prod",
    });
  });
});

describe("toolPartMatches", () => {
  it("matches an exact tool name", () => {
    expect(toolPartMatches("read_file", "read_file")).toBe(true);
    expect(toolPartMatches("read_file", "read_files")).toBe(false);
  });

  it("matches a prefix at a segment boundary", () => {
    expect(toolPartMatches("mcp", "mcp:github:create_issue")).toBe(true);
    expect(toolPartMatches("mcp:github", "mcp:github:create_issue")).toBe(true);
    expect(toolPartMatches("mcp:github", "mcp:gitlab:create_issue")).toBe(false);
  });

  it("matches everything with a star", () => {
    expect(toolPartMatches("*", "anything")).toBe(true);
  });

  it("never matches an empty tool part", () => {
    expect(toolPartMatches("", "read_file")).toBe(false);
  });
});

describe("resolvePathSpec", () => {
  it("anchors a single leading slash at the workspace root", () => {
    expect(resolvePathSpec("/src/**", CONTEXT)).toBe("src/**");
  });

  it("resolves a relative specifier against the current directory", () => {
    expect(resolvePathSpec("secrets/**", CONTEXT)).toBe("secrets/**");
  });

  it("keeps a floating specifier as it is", () => {
    expect(resolvePathSpec("**/.env", CONTEXT)).toBe("**/.env");
  });

  it("resolves a home-relative specifier", () => {
    expect(resolvePathSpec("~/.ssh/id_rsa", CONTEXT)).toBe("/home/user/.ssh/id_rsa");
  });

  it("treats a double leading slash as filesystem-absolute", () => {
    expect(resolvePathSpec("//etc/passwd", CONTEXT)).toBe("/etc/passwd");
  });

  it("handles a Windows drive letter as absolute", () => {
    expect(resolvePathSpec("C:/Windows/system.ini", CONTEXT)).toBe("C:/Windows/system.ini");
  });
});

describe("ruleMatches", () => {
  it("matches a rule with no specifier against any subject", () => {
    expect(ruleMatches("read_file", "read_file", "a.ts", "path", CONTEXT)).toBe(true);
  });

  it("does not match a different tool", () => {
    expect(ruleMatches("read_file", "write_file", "a.ts", "path", CONTEXT)).toBe(false);
  });

  it("matches a path specifier", () => {
    expect(
      ruleMatches("read_file:src/**", "read_file", "src/a.ts", "path", CONTEXT),
    ).toBe(true);
    expect(
      ruleMatches("read_file:lib/**", "read_file", "src/a.ts", "path", CONTEXT),
    ).toBe(false);
  });

  it("matches a command specifier as plain text", () => {
    expect(
      ruleMatches("run_command:npm run *", "run_command", "npm run build", "text", CONTEXT),
    ).toBe(true);
    expect(
      ruleMatches("run_command:git push *", "run_command", "npm run build", "text", CONTEXT),
    ).toBe(false);
  });

  it("does not treat a command containing a slash as a path", () => {
    expect(
      ruleMatches("run_command:./gradlew build", "run_command", "./gradlew build", "text", CONTEXT),
    ).toBe(true);
  });
});

describe("deniedTools", () => {
  it("collects the tools a bare deny rule removes", () => {
    const denied = deniedTools({
      allow: [],
      ask: [],
      deny: ["run_command", "read_file:secrets/**"],
    });
    expect([...denied]).toEqual(["run_command"]);
  });

  it("ignores a rule that names every tool", () => {
    expect(deniedTools({ ...EMPTY_RULES, deny: ["*"] }).size).toBe(0);
  });
});

describe("mergeRules", () => {
  it("concatenates the lists", () => {
    const merged = mergeRules(
      { allow: ["a"], ask: [], deny: [] },
      { allow: ["b"], ask: ["c"], deny: ["d"] },
    );
    expect(merged).toEqual({ allow: ["a", "b"], ask: ["c"], deny: ["d"] });
  });

  it("returns empty lists when given nothing", () => {
    expect(mergeRules()).toEqual({ allow: [], ask: [], deny: [] });
  });
});
