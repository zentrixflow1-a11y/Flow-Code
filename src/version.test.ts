import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BINARY_NAME, PACKAGE_NAME, VERSION } from "./version.js";

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { name: string; version: string; bin: Record<string, string> };

describe("version", () => {
  it("matches the version in package.json", () => {
    expect(VERSION).toBe(packageJson.version);
  });

  it("matches the package name in package.json", () => {
    expect(PACKAGE_NAME).toBe(packageJson.name);
  });

  it("installs an executable named flowcode", () => {
    expect(packageJson.bin[BINARY_NAME]).toBeDefined();
  });
});
