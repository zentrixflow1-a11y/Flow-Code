/**
 * The permission engine's decision table.
 *
 * This is the most safety-critical logic in Flow Code, so every branch is
 * covered here rather than being discovered in production.
 */
import { describe, expect, it } from "vitest";
import { decidePermission } from "./engine.js";
import { DEFAULT_RULES } from "./defaults.js";
import { EMPTY_RULES, type PermissionRequest, type PermissionRules } from "./types.js";

const CONTEXT = {
  workspaceRoot: "/home/user/project",
  cwd: "/home/user/project",
  home: "/home/user",
};

const request = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
  tool: "read_file",
  category: "read",
  subject: "src/index.ts",
  subjectKind: "path",
  mode: "ask",
  rules: EMPTY_RULES,
  context: CONTEXT,
  withinWorkspace: true,
  ...overrides,
});

const rules = (overrides: Partial<PermissionRules> = {}): PermissionRules => ({
  allow: [],
  ask: [],
  deny: [],
  ...overrides,
});

describe("decidePermission", () => {
  describe("rule precedence", () => {
    it("denies when a deny rule matches", () => {
      const decision = decidePermission(
        request({ rules: rules({ deny: ["read_file"] }) }),
      );
      expect(decision.kind).toBe("deny");
    });

    it("asks when an ask rule matches", () => {
      const decision = decidePermission(
        request({ rules: rules({ ask: ["read_file"] }) }),
      );
      expect(decision.kind).toBe("ask");
    });

    it("allows when an allow rule matches", () => {
      const decision = decidePermission(
        request({ rules: rules({ allow: ["read_file"] }) }),
      );
      expect(decision.kind).toBe("allow");
    });

    it("prefers deny over ask and allow", () => {
      const decision = decidePermission(
        request({
          rules: rules({
            deny: ["read_file"],
            ask: ["read_file"],
            allow: ["read_file"],
          }),
        }),
      );
      expect(decision.kind).toBe("deny");
    });

    it("prefers ask over allow", () => {
      const decision = decidePermission(
        request({ rules: rules({ ask: ["read_file"], allow: ["read_file"] }) }),
      );
      expect(decision.kind).toBe("ask");
    });

    it("lets a broad deny beat a narrow allow", () => {
      const decision = decidePermission(
        request({
          subject: "src/index.ts",
          rules: rules({
            deny: ["read_file:**"],
            allow: ["read_file:src/index.ts"],
          }),
        }),
      );
      expect(decision.kind).toBe("deny");
    });

    it("lets a narrow ask beat a broad allow", () => {
      const decision = decidePermission(
        request({
          subject: "src/index.ts",
          rules: rules({
            ask: ["read_file:src/index.ts"],
            allow: ["read_file:**"],
          }),
        }),
      );
      expect(decision.kind).toBe("ask");
    });
  });

  describe("mode defaults", () => {
    it("allows reads without asking in ask mode", () => {
      expect(decidePermission(request()).kind).toBe("allow");
    });

    it("asks before a write in ask mode", () => {
      expect(decidePermission(request({ category: "write" })).kind).toBe("ask");
    });

    it("asks before running a command in ask mode", () => {
      expect(decidePermission(request({ category: "execute" })).kind).toBe("ask");
    });

    it("asks before using the network in ask mode", () => {
      expect(decidePermission(request({ category: "network" })).kind).toBe("ask");
    });

    it("allows a write in accept_edits mode", () => {
      expect(
        decidePermission(request({ category: "write", mode: "accept_edits" })).kind,
      ).toBe("allow");
    });

    it("still asks before running a command in accept_edits mode", () => {
      expect(
        decidePermission(request({ category: "execute", mode: "accept_edits" })).kind,
      ).toBe("ask");
    });

    it("allows everything in trust mode", () => {
      for (const category of ["read", "write", "execute", "network", "control"] as const) {
        expect(
          decidePermission(request({ category, mode: "trust" })).kind,
        ).toBe("allow");
      }
    });

    it("still honours a deny rule in trust mode", () => {
      expect(
        decidePermission(
          request({
            tool: "write_file",
            category: "write",
            mode: "trust",
            rules: rules({ deny: ["write_file"] }),
          }),
        ).kind,
      ).toBe("deny");
    });
  });

  describe("hard ceilings", () => {
    it("denies a write in plan mode", () => {
      expect(decidePermission(request({ category: "write", mode: "plan" })).kind).toBe("deny");
    });

    it("denies a command in plan mode", () => {
      expect(decidePermission(request({ category: "execute", mode: "plan" })).kind).toBe("deny");
    });

    it("denies the network in plan mode", () => {
      expect(decidePermission(request({ category: "network", mode: "plan" })).kind).toBe("deny");
    });

    it("allows a read in plan mode", () => {
      expect(decidePermission(request({ category: "read", mode: "plan" })).kind).toBe("allow");
    });

    it("does not let a rule lift the plan-mode ceiling", () => {
      expect(
        decidePermission(
          request({ category: "write", mode: "plan", rules: rules({ allow: ["write_file"] }) }),
        ).kind,
      ).toBe("deny");
    });

    it("denies a write in safe mode", () => {
      expect(decidePermission(request({ category: "write", mode: "safe" })).kind).toBe("deny");
    });

    it("denies a command in safe mode", () => {
      expect(decidePermission(request({ category: "execute", mode: "safe" })).kind).toBe("deny");
    });

    it("denies the network in safe mode", () => {
      expect(decidePermission(request({ category: "network", mode: "safe" })).kind).toBe("deny");
    });

    it("allows a read in safe mode", () => {
      expect(decidePermission(request({ category: "read", mode: "safe" })).kind).toBe("allow");
    });

    it("does not let a rule lift the safe-mode ceiling", () => {
      expect(
        decidePermission(
          request({ category: "network", mode: "safe", rules: rules({ allow: ["web_fetch"] }) }),
        ).kind,
      ).toBe("deny");
    });
  });

  describe("confinement", () => {
    it("denies a write outside the workspace in every mode", () => {
      for (const mode of ["ask", "accept_edits", "plan", "safe", "trust"] as const) {
        expect(
          decidePermission(
            request({ category: "write", mode, withinWorkspace: false }),
          ).kind,
        ).toBe("deny");
      }
    });

    it("allows a read outside the workspace when the user added the directory", () => {
      expect(
        decidePermission(
          request({ category: "read", withinWorkspace: false, mode: "ask" }),
        ).kind,
      ).toBe("allow");
    });
  });

  describe("read-only commands", () => {
    it("allows a read-only command without asking", () => {
      expect(
        decidePermission(
          request({ category: "execute", subject: "ls -la", readOnlyCommand: true }),
        ).kind,
      ).toBe("allow");
    });

    it("asks about a command that writes", () => {
      expect(
        decidePermission(
          request({ category: "execute", subject: "rm -rf build", readOnlyCommand: false }),
        ).kind,
      ).toBe("ask");
    });

    it("still denies a write command in plan mode", () => {
      expect(
        decidePermission(
          request({
            category: "execute",
            subject: "ls",
            readOnlyCommand: true,
            mode: "plan",
          }),
        ).kind,
      ).toBe("deny");
    });
  });

  describe("path rules", () => {
    it("matches a workspace-relative specifier", () => {
      expect(
        decidePermission(
          request({
            subject: "src/index.ts",
            rules: rules({ deny: ["read_file:src/**"] }),
          }),
        ).kind,
      ).toBe("deny");
    });

    it("matches a root-anchored specifier", () => {
      expect(
        decidePermission(
          request({
            subject: "src/index.ts",
            rules: rules({ deny: ["read_file:/src/**"] }),
          }),
        ).kind,
      ).toBe("deny");
    });

    it("matches a floating specifier at any depth", () => {
      expect(
        decidePermission(
          request({
            subject: "a/b/.env",
            rules: rules({ deny: ["read_file:**/.env"] }),
          }),
        ).kind,
      ).toBe("deny");
    });

    it("matches a filesystem-absolute path", () => {
      expect(
        decidePermission(
          request({
            subject: "/home/user/project/secrets.txt",
            rules: rules({ deny: ["read_file://home/user/project/secrets.txt"] }),
          }),
        ).kind,
      ).toBe("deny");
    });

    it("matches a home-relative specifier", () => {
      expect(
        decidePermission(
          request({
            subject: "/home/user/.ssh/id_rsa",
            rules: rules({ deny: ["read_file:~/.ssh/id_rsa"] }),
          }),
        ).kind,
      ).toBe("deny");
    });

    it("does not match a specifier for a different path", () => {
      expect(
        decidePermission(
          request({
            subject: "src/index.ts",
            rules: rules({ deny: ["read_file:lib/**"] }),
          }),
        ).kind,
      ).toBe("allow");
    });
  });

  describe("MCP rules", () => {
    it("matches every tool of a server", () => {
      expect(
        decidePermission(
          request({
            tool: "mcp:github:create_issue",
            category: "network",
            subject: "github:create_issue",
            subjectKind: "mcp",
            rules: rules({ deny: ["mcp:github:*"] }),
          }),
        ).kind,
      ).toBe("deny");
    });

    it("matches one MCP tool", () => {
      expect(
        decidePermission(
          request({
            tool: "mcp:github:create_issue",
            category: "network",
            subject: "github:create_issue",
            subjectKind: "mcp",
            rules: rules({ deny: ["mcp:github:create_issue"] }),
          }),
        ).kind,
      ).toBe("deny");
    });

    it("matches every MCP tool", () => {
      expect(
        decidePermission(
          request({
            tool: "mcp:anything:go",
            category: "network",
            subject: "anything:go",
            subjectKind: "mcp",
            rules: rules({ deny: ["mcp"] }),
          }),
        ).kind,
      ).toBe("deny");
    });

    it("does not match a built-in tool with an MCP rule", () => {
      expect(
        decidePermission(
          request({ tool: "read_file", rules: rules({ deny: ["mcp"] }) }),
        ).kind,
      ).toBe("allow");
    });
  });

  describe("the default rules", () => {
    it("blocks reading an environment file", () => {
      expect(
        decidePermission(
          request({
            subject: "config/.env",
            rules: DEFAULT_RULES,
          }),
        ).kind,
      ).toBe("deny");
    });

    it("blocks writing to a git directory", () => {
      expect(
        decidePermission(
          request({
            tool: "write_file",
            category: "write",
            subject: ".git/config",
            rules: DEFAULT_RULES,
          }),
        ).kind,
      ).toBe("deny");
    });

    it("allows an ordinary source file", () => {
      expect(
        decidePermission(
          request({ subject: "src/index.ts", rules: DEFAULT_RULES }),
        ).kind,
      ).toBe("allow");
    });
  });
});
