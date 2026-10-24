/**
 * The web tool.
 *
 * `web_fetch` is a network tool, so it is gated by the permission engine like
 * any other, and it is off unless the user has allowed it.
 */
import { z } from "zod";
import { flowError } from "../errors.js";
import { capOutput } from "../util/text.js";
import { applyGuard } from "./guard.js";
import type { ToolDefinition, ToolResult } from "./types.js";

/** How long a fetch may take. */
const FETCH_DEADLINE_MS = 120_000;

/** The most bytes a fetched page may be. */
const MAX_RESPONSE_BYTES = 2_000_000;

/** Hosts that are never fetched, because they are metadata endpoints. */
const BLOCKED_HOSTS: readonly string[] = [
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
];

/** Whether a hostname resolves to a private or loopback address. */
const isPrivateHost = (hostname: string): boolean => {
  const lowered = hostname.toLowerCase();
  // localhost is the machine itself: fetching it is not an SSRF, and local
  // development depends on it.
  if (lowered === "localhost" || lowered === "::1" || lowered.endsWith(".localhost")) {
    return false;
  }
  if (lowered === "127.0.0.1") {
    return false;
  }
  if (/^127\./.test(lowered) || /^10\./.test(lowered) || /^192\.168\./.test(lowered)) {
    return true;
  }
  const match172 = /^172\.(\d+)\./.exec(lowered);
  if (match172 !== null) {
    const octet = Number(match172[1]);
    if (octet >= 16 && octet <= 31) {
      return true;
    }
  }
  if (/^169\.254\./.test(lowered)) {
    return true;
  }
  if (/^fc00:|^fd/.test(lowered)) {
    return true;
  }
  return false;
};

/** The arguments of {@link webFetchTool}. */
const webFetchArgs = z.object({
  url: z.string().min(1).describe("The URL to fetch. Must be http or https."),
  format: z
    .enum(["text", "markdown", "html"])
    .optional()
    .describe("What to return. Defaults to text, which strips the markup."),
});

/** Fetch a web page. */
export const webFetchTool: ToolDefinition<z.infer<typeof webFetchArgs>> = {
  name: "web_fetch",
  description:
    "Fetch a web page and return its contents as text. Use this to read documentation or an article.",
  schema: webFetchArgs,
  category: "network",
  subjectKind: "text",
  concurrencySafe: true,
  subject(args) {
    return domainOf(args.url);
  },
  async execute(args, context): Promise<ToolResult> {
    const guard = applyGuard(context, "network");
    if (!guard.ok) {
      return { ok: false, error: guard.error };
    }

    if (context.webEnabled !== true) {
      return {
        ok: false,
        error: flowError("permission_denied", "The web tools are not enabled.", {
          retryable: false,
          remediation: "Set `webEnabled` to true in the configuration file.",
        }),
      };
    }

    let url: URL;
    try {
      url = new URL(args.url);
    } catch {
      return {
        ok: false,
        error: flowError("invalid_request", `'${args.url}' is not a valid URL.`, {
          retryable: false,
          remediation: "Include the scheme, for example https://example.com.",
        }),
      };
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        ok: false,
        error: flowError("invalid_request", `'${url.protocol}' URLs cannot be fetched.`, {
          retryable: false,
          remediation: "Use an http or https URL.",
        }),
      };
    }

    if (BLOCKED_HOSTS.includes(url.hostname.toLowerCase()) || isPrivateHost(url.hostname)) {
      return {
        ok: false,
        error: flowError(
          "permission_denied",
          `'${url.hostname}' is a private or metadata endpoint and is not fetched.`,
          { retryable: false },
        ),
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "manual",
        headers: { accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
      });

      // Follow redirects by hand, so each hop is checked against the blocklist.
      let final = response;
      let current = url;
      let hops = 0;
      while (final.status >= 300 && final.status < 400 && hops < 5) {
        const location = final.headers.get("location");
        if (location === null) {
          break;
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          break;
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          return {
            ok: false,
            error: flowError("invalid_request", `'${next.protocol}' URLs cannot be fetched.`, {
              retryable: false,
            }),
          };
        }
        if (BLOCKED_HOSTS.includes(next.hostname.toLowerCase()) || isPrivateHost(next.hostname)) {
          return {
            ok: false,
            error: flowError(
              "permission_denied",
              `'${next.hostname}' is a private or metadata endpoint and is not fetched.`,
              { retryable: false },
            ),
          };
        }
        current = next;
        final = await fetch(next, {
          signal: controller.signal,
          redirect: "manual",
          headers: { accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
        });
        hops += 1;
      }

      if (!final.ok) {
        return {
          ok: false,
          error: flowError("server_error", `The server returned ${final.status}.`, {
            retryable: final.status >= 500,
            status: final.status,
          }),
        };
      }

      const contentType = final.headers.get("content-type") ?? "";
      const reader = final.body?.getReader();
      if (reader === undefined) {
        return {
          ok: false,
          error: flowError("malformed_response", "The provider returned an empty response body.", {
            retryable: true,
          }),
        };
      }

      let body = "";
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          reader.cancel();
          return {
            ok: false,
            error: flowError(
              "resource_constraint",
              `The page is larger than the ${MAX_RESPONSE_BYTES}-byte limit.`,
              { retryable: false },
            ),
          };
        }
        body += new TextDecoder().decode(value, { stream: true });
      }
      const format = args.format ?? "text";
      const content =
        format === "html"
          ? body
          : format === "markdown"
            ? htmlToText(body)
            : htmlToText(body);

      return {
        ok: true,
        output: capOutput(content).text,
        data: { url: `${url.protocol}//${url.host}${url.pathname}`, contentType, characters: body.length },
      };
    } catch (error) {
      return {
        ok: false,
          error: flowError(
            "network_error",
            `Could not fetch '${url.protocol}//${url.host}${url.pathname}': ${error instanceof Error ? error.message : String(error)}`,
            { retryable: true, cause: error },
          ),
      };
    } finally {
      clearTimeout(timer);
    }
  },
};

/**
 * Reduce a page to readable text.
 *
 * This is a plain-text approximation, not a full HTML parser: it drops the
 * markup, the scripts and the styles, and turns the common entities back into
 * their characters.
 */
export const htmlToText = (html: string): string => {
  const withoutBlocks = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const withBreaks = withoutBlocks
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, "\t");

  const text = withBreaks.replace(/<[^>]+>/g, " ");

  return decodeEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
};

/** Turn the common HTML entities back into characters. */
const decodeEntities = (text: string): string =>
  text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");

/**
 * The hostname of a URL, shaped as `domain:example.com`.
 *
 * The prefix keeps it in the same shape as an MCP tool's subject, so a rule
 * such as `web_fetch:domain:example.com` reads the same way.
 */
export const domainOf = (url: string): string => {
  try {
    return `domain:${new URL(url).hostname.toLowerCase()}`;
  } catch {
    return `domain:${url.toLowerCase()}`;
  }
};
