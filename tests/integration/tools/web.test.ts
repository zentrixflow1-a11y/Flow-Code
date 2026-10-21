/**
 * The web tool, against a local HTTP server.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeTool } from "../../../src/tools/executor.js";
import { domainOf, htmlToText, webFetchTool } from "../../../src/tools/web.js";
import { startScriptedServer } from "../../support/scripted-server.js";

describe("htmlToText", () => {
  it("drops the markup", () => {
    expect(htmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("drops scripts and styles", () => {
    const text = htmlToText(
      "<style>p{color:red}</style><script>alert(1)</script><p>Body</p>",
    );
    expect(text).toBe("Body");
  });

  it("turns entities back into characters", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &lt;3</p>")).toBe("Tom & Jerry <3");
  });

  it("keeps paragraph breaks", () => {
    expect(htmlToText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
  });
});

describe("domainOf", () => {
  it("shapes a URL as a domain subject", () => {
    expect(domainOf("https://Example.com/path")).toBe("domain:example.com");
  });

  it("survives a URL that will not parse", () => {
    expect(domainOf("not a url")).toBe("domain:not a url");
  });
});

describe("the web tool", () => {
  let server: Awaited<ReturnType<typeof startScriptedServer>>;

  beforeAll(async () => {
    server = await startScriptedServer(
      "<html><body><h1>Title</h1><p>Some content</p></body></html>",
    );
  });

  afterAll(async () => {
    await server.stop();
  });

  it("fetches a page and returns its text", async () => {
    const result = await executeTool(
      webFetchTool,
      { url: `${server.baseUrl}/page` },
      {
        cwd: process.cwd(),
        workspaceRoot: process.cwd(),
        additionalDirectories: [],
        env: process.env,
        redact: (text) => text,
        platform: process.platform,
        caseInsensitivePaths: process.platform === "win32",
        guard: () => undefined,
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("Some content");
      expect(result.output).not.toContain("<p>");
    }
  });

  it("refuses a URL that is not http or https", async () => {
    const result = await executeTool(
      webFetchTool,
      { url: "file:///etc/passwd" },
      {
        cwd: process.cwd(),
        workspaceRoot: process.cwd(),
        additionalDirectories: [],
        env: process.env,
        redact: (text) => text,
        platform: process.platform,
        caseInsensitivePaths: false,
        guard: () => undefined,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_request");
    }
  });

  it("refuses a URL that will not parse", async () => {
    const result = await executeTool(
      webFetchTool,
      { url: "not a url" },
      {
        cwd: process.cwd(),
        workspaceRoot: process.cwd(),
        additionalDirectories: [],
        env: process.env,
        redact: (text) => text,
        platform: process.platform,
        caseInsensitivePaths: false,
        guard: () => undefined,
      },
    );
    expect(result.ok).toBe(false);
  });
});
