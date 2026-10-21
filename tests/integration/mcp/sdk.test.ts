/**
 * Pins the Model Context Protocol SDK's shape.
 *
 * The MCP TypeScript SDK moved its entry points between major versions, so
 * this test fails loudly if an upgrade breaks the imports the MCP client
 * depends on, rather than at runtime on a user's machine.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly exports: Record<string, unknown>;
}

const clientPackage = (): PackageManifest => {
  // The package does not export "./package.json", so the manifest is read from
  // the package root instead.
  const entry = require.resolve("@modelcontextprotocol/client");
  const packageRoot = dirname(dirname(entry));
  return JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  ) as PackageManifest;
};

describe("the MCP client SDK", () => {
  it("is the package Flow Code depends on", () => {
    expect(clientPackage().name).toBe("@modelcontextprotocol/client");
  });

  it("exposes the root entry point", () => {
    expect(Object.keys(clientPackage().exports)).toContain(".");
  });

  it("exposes the stdio transport entry point", () => {
    expect(Object.keys(clientPackage().exports)).toContain("./stdio");
  });

  it("exports the classes the MCP client needs", () => {
    const root = require.resolve("@modelcontextprotocol/client");
    const stdio = require.resolve("@modelcontextprotocol/client/stdio");

    const rootSource = readFileSync(root, "utf8");
    expect(rootSource).toContain("Client");
    expect(rootSource).toContain("StreamableHTTPClientTransport");

    const stdioSource = readFileSync(stdio, "utf8");
    expect(stdioSource).toContain("StdioClientTransport");
  });
});
