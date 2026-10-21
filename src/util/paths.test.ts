import { describe, expect, it } from "vitest";
import { isProtectedPath, isInside, toPosix } from "./paths.js";

describe("toPosix", () => {
  it("replaces backslashes with forward slashes", () => {
    expect(toPosix("C:\\Users\\me\\project")).toBe("C:/Users/me/project");
  });
});

describe("isInside", () => {
  it("accepts a path that is the root itself", () => {
    expect(isInside("/a/b", "/a/b")).toBe(true);
  });

  it("accepts a path below the root", () => {
    expect(isInside("/a/b/c", "/a/b")).toBe(true);
  });

  it("rejects a sibling with a shared prefix", () => {
    expect(isInside("/a/bc", "/a/b")).toBe(false);
  });

  it("rejects a path above the root", () => {
    expect(isInside("/a", "/a/b")).toBe(false);
  });

  it("can ignore case", () => {
    expect(isInside("/A/B/C", "/a/b", true)).toBe(true);
    expect(isInside("/A/B/C", "/a/b", false)).toBe(false);
  });
});

describe("isProtectedPath", () => {
  it("protects git directories", () => {
    expect(isProtectedPath("/project/.git/config")).toBe(true);
  });

  it("protects the agent's own configuration", () => {
    expect(isProtectedPath("/project/.flowcode/config.json")).toBe(true);
  });

  it("protects credential directories", () => {
    expect(isProtectedPath("/home/user/.ssh/id_rsa")).toBe(true);
    expect(isProtectedPath("/home/user/.aws/credentials")).toBe(true);
    expect(isProtectedPath("/home/user/.gnupg/secring.gpg")).toBe(true);
  });

  it("protects credential files by name", () => {
    expect(isProtectedPath("/project/.env")).toBe(true);
    expect(isProtectedPath("/project/.env.local")).toBe(true);
    expect(isProtectedPath("/project/server.pem")).toBe(true);
    expect(isProtectedPath("/project/server.key")).toBe(true);
    expect(isProtectedPath("/project/id_rsa")).toBe(true);
  });

  it("leaves ordinary files alone", () => {
    expect(isProtectedPath("/project/src/index.ts")).toBe(false);
    expect(isProtectedPath("/project/README.md")).toBe(false);
    expect(isProtectedPath("/project/environment.ts")).toBe(false);
  });
});
