import { describe, expect, it } from "vitest";
import { globToRegExp, isGlob, matchGlob, matchPath } from "./glob.js";

describe("isGlob", () => {
  it("detects wildcards", () => {
    expect(isGlob("*.ts")).toBe(true);
    expect(isGlob("a?b")).toBe(true);
    expect(isGlob("plain.txt")).toBe(false);
  });
});

describe("globToRegExp", () => {
  it("matches within one segment", () => {
    const pattern = globToRegExp("*.ts");
    expect(pattern.test("a.ts")).toBe(true);
    expect(pattern.test("src/a.ts")).toBe(false);
  });

  it("matches across segments with a double star", () => {
    const pattern = globToRegExp("**/*.ts");
    expect(pattern.test("a.ts")).toBe(true);
    expect(pattern.test("src/a.ts")).toBe(true);
    expect(pattern.test("src/deep/a.ts")).toBe(true);
    expect(pattern.test("src/a.js")).toBe(false);
  });

  it("matches a directory prefix", () => {
    const pattern = globToRegExp("src/**");
    expect(pattern.test("src/a.ts")).toBe(true);
    expect(pattern.test("src/deep/a.ts")).toBe(true);
    expect(pattern.test("lib/a.ts")).toBe(false);
  });

  it("matches a single character with a question mark", () => {
    const pattern = globToRegExp("a?c.txt");
    expect(pattern.test("abc.txt")).toBe(true);
    expect(pattern.test("ac.txt")).toBe(false);
  });

  it("treats regular expression characters as literals", () => {
    const pattern = globToRegExp("a+b.txt");
    expect(pattern.test("a+b.txt")).toBe(true);
    expect(pattern.test("aab.txt")).toBe(false);
  });
});

describe("matchGlob", () => {
  it("matches a literal exactly", () => {
    expect(matchGlob("a.txt", "a.txt")).toBe(true);
    expect(matchGlob("a.txt", "b.txt")).toBe(false);
  });

  it("matches a literal that continues with a separator", () => {
    expect(matchGlob("secrets", "secrets/a.env")).toBe(true);
    expect(matchGlob("secrets", "secretsfile")).toBe(false);
  });

  it("uses the given separator", () => {
    expect(matchGlob("github", "github:create_issue", ":")).toBe(true);
    expect(matchGlob("github", "github:create_issue", "/")).toBe(false);
  });
});

describe("matchPath", () => {
  it("matches a path against a pattern", () => {
    expect(matchPath("**/*.ts", "src/a.ts")).toBe(true);
    expect(matchPath("src/**", "src/deep/a.ts")).toBe(true);
    expect(matchPath("src/**", "lib/a.ts")).toBe(false);
  });
});
