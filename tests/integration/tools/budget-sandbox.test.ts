/**
 * The tool-schema budget and the optional sandbox.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeTrim, fitToBudget } from "../../../src/tools/budget.js";
import { ToolRegistry } from "../../../src/tools/registry.js";
import type { ToolDefinition } from "../../../src/tools/types.js";
import {
  bubblewrapArgs,
  detectSandbox,
  seatbeltProfile,
  wrapCommand,
} from "../../../src/security/sandbox.js";

const makeTool = (name: string, description: string): ToolDefinition<never> => ({
  name,
  description,
  schema: z.object({ path: z.string().describe("A path that makes the schema long.") }) as never,
  category: "read",
  subjectKind: "path",
  concurrencySafe: true,
  async execute() {
    return { ok: true, output: "" };
  },
});

describe("the tool-schema budget", () => {
  it("leaves the tools alone when they fit", () => {
    const tools = [makeTool("a", "A"), makeTool("b", "B")];
    const result = fitToBudget(tools, 100_000);
    expect(result.trimmed).toEqual([]);
    expect(result.tools).toHaveLength(2);
    expect(result.bytes).toBe(result.totalBytes);
  });

  it("leaves the tools alone when there is no limit", () => {
    const tools = [makeTool("a", "A")];
    const result = fitToBudget(tools, 0);
    expect(result.trimmed).toEqual([]);
  });

  it("drops the least important tools when they do not fit", () => {
    const tools = [
      makeTool("keep", "K"),
      makeTool("drop-one", "D"),
      makeTool("drop-two", "D"),
    ];
    const total = fitToBudget(tools, 0).totalBytes;
    const result = fitToBudget(tools, Math.floor(total / 2));

    expect(result.trimmed.length).toBeGreaterThan(0);
    expect(result.bytes).toBeLessThan(result.totalBytes);
    expect(result.tools[0]?.name).toBe("keep");
  });

  it("keeps the built-in tools and drops the MCP ones", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("read_file", "Read a file"));
    registry.register(makeTool("mcp:one:tool", "An MCP tool"));
    registry.register(makeTool("mcp:two:tool", "Another MCP tool"));

    const total = fitToBudget(registry.advertised(new Set()), 0).totalBytes;
    const result = fitToBudget(registry.advertised(new Set()), Math.floor(total / 2));

    expect(result.tools.map((tool) => tool.name)).toContain("read_file");
    expect(result.trimmed).toContain("mcp:two:tool");
  });

  it("describes what it dropped", () => {
    expect(describeTrim([])).toBe("");
    expect(describeTrim(["mcp:one:tool"])).toContain("mcp:one:tool");
    expect(describeTrim(["mcp:one:tool"])).toContain("maxToolSchemaBytes");
  });
});

describe("the sandbox", () => {
  it("reports that Windows has no sandbox", async () => {
    const support = await detectSandbox("win32");
    expect(support.available).toBe(false);
    expect(support.kind).toBe("none");
    expect(support.reason).toContain("WSL2");
  });

  it("writes a Seatbelt profile that only allows writes in the roots", () => {
    const profile = seatbeltProfile(["/home/user/project"]);
    expect(profile).toContain("(deny default)");
    expect(profile).toContain('(allow file-write* (subpath "/home/user/project"))');
    expect(profile).not.toContain('(allow file-write* (subpath "/etc"))');
  });

  it("writes bubblewrap arguments that bind the roots read-write", () => {
    const args = bubblewrapArgs(["/home/user/project"]);
    expect(args).toContain("--ro-bind");
    expect(args).toContain("/");
    expect(args).toContain("/home/user/project");
    expect(args).toContain("--unshare-all");
  });

  it("wraps a command for the sandbox", () => {
    const seatbelt = wrapCommand("seatbelt", ["/work"], "ls", "/work");
    expect(seatbelt?.command).toBe("sandbox-exec");
    expect(seatbelt?.args.join(" ")).toContain("ls");

    const bubblewrap = wrapCommand("bubblewrap", ["/work"], "ls", "/work");
    expect(bubblewrap?.command).toBe("bwrap");
    expect(bubblewrap?.args.join(" ")).toContain("--chdir /work");
  });

  it("does not wrap a command when there is no sandbox", () => {
    expect(wrapCommand("none", ["/work"], "ls", "/work")).toBeUndefined();
  });
});
