import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The logo assets the project ships. */
const ASSETS = {
  "logo.svg": { viewBox: "0 0 258 72" },
  "logo-mark.svg": { viewBox: "0 0 64 64" },
  "logo-dark.svg": { viewBox: "0 0 258 72" },
  "logo-light.svg": { viewBox: "0 0 258 72" },
  "favicon.svg": { viewBox: "0 0 32 32" },
} as const;

const assetPath = (name: string): string =>
  fileURLToPath(new URL(`../../assets/${name}`, import.meta.url));

interface Tag {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
}

/**
 * Extract the tags from an SVG document.
 *
 * This is not a general XML parser: it understands exactly the subset of XML
 * the logo files use (elements, attributes, self-closing tags, comments and
 * the XML declaration). It is enough to prove the documents are balanced and
 * free of stray markup.
 */
const scanTags = (xml: string): Tag[] => {
  const tags: Tag[] = [];
  const pattern = /<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null = pattern.exec(xml);
  while (match !== null) {
    tags.push({
      name: match[2] as string,
      closing: match[1] === "/",
      selfClosing: match[4] === "/",
    });
    match = pattern.exec(xml);
  }
  return tags;
};

const assertBalanced = (xml: string, name: string): void => {
  const stack: string[] = [];
  for (const tag of scanTags(xml)) {
    if (tag.selfClosing) continue;
    if (tag.closing) {
      const open = stack.pop();
      if (open !== tag.name) {
        throw new Error(`${name}: </${tag.name}> closes <${open ?? "nothing"}>`);
      }
    } else {
      stack.push(tag.name);
    }
  }
  if (stack.length > 0) {
    throw new Error(`${name}: unclosed elements ${stack.join(", ")}`);
  }
};

describe("logo assets", () => {
  it.each(Object.keys(ASSETS))("ships %s", (name) => {
    expect(existsSync(assetPath(name))).toBe(true);
  });

  it.each(Object.entries(ASSETS))("%s is well-formed SVG", (name, expected) => {
    const xml = readFileSync(assetPath(name), "utf8");

    expect(() => assertBalanced(xml, name)).not.toThrow();
    expect(xml).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(xml).toContain(`viewBox="${expected.viewBox}"`);
    expect(xml).toContain("<title>");
    expect(xml.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it.each(Object.entries(ASSETS))("%s references no external resources", (name) => {
    const xml = readFileSync(assetPath(name), "utf8");

    expect(xml).not.toMatch(/href\s*=\s*"https?:/);
    expect(xml).not.toMatch(/url\(\s*['"]?https?:/);
    expect(xml).not.toMatch(/<image\b/);
    expect(xml).not.toMatch(/@import/);
  });

  it.each(Object.entries(ASSETS))("%s resolves every url(#id) reference", (name) => {
    const xml = readFileSync(assetPath(name), "utf8");
    const referenced = [...xml.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1] as string);
    const defined = new Set(
      [...xml.matchAll(/\sid\s*=\s*"([^"]+)"/g)].map((match) => match[1] as string),
    );

    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) {
      expect(defined.has(id), `${name} references undefined id "${id}"`).toBe(true);
    }
  });

  it("keeps the mark free of font dependencies", () => {
    const xml = readFileSync(assetPath("logo-mark.svg"), "utf8");
    expect(xml).not.toContain("<text");
    expect(xml).not.toContain("font-family");
  });

  it("uses a system font stack for the wordmark", () => {
    const xml = readFileSync(assetPath("logo.svg"), "utf8");
    expect(xml).toContain("font-family");
    expect(xml).toContain("system-ui");
  });

  it("gives the dark and light variants different colour treatments", () => {
    const dark = readFileSync(assetPath("logo-dark.svg"), "utf8");
    const light = readFileSync(assetPath("logo-light.svg"), "utf8");
    expect(dark).not.toBe(light);
    expect(dark).toContain("#67E8F9");
    expect(light).toContain("#0891B2");
  });
});
