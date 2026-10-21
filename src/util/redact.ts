/**
 * Redacting secrets from text that leaves the harness.
 *
 * Two things are redacted: values the user has explicitly declared as secret,
 * and a short list of well-known credential shapes.
 *
 * Pattern matching is best-effort. It is a safety net, not a boundary — the
 * README says so plainly, and the real boundary is that Flow Code never puts
 * credentials into the model's context in the first place.
 */

/** The credential shapes that are recognised out of the box. */
export const BUILT_IN_SECRET_PATTERNS: readonly RegExp[] = [
  // AWS access key identifiers.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // OpenAI-style secret keys.
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  // GitHub tokens.
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  // Slack tokens.
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // JSON web tokens.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // Private key blocks.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Bearer tokens in headers.
  /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
];

/** What a redactor replaces a match with. */
export const REDACTION_PLACEHOLDER = "[redacted]";

/** Removes secrets from text. */
export type Redactor = (text: string) => string;

/** How to build a {@link Redactor}. */
export interface RedactorOptions {
  /** Exact values that must never appear in the output. */
  readonly secrets?: readonly string[];
  /** Extra patterns to redact. */
  readonly patterns?: readonly RegExp[];
  /** What to replace a match with. */
  readonly placeholder?: string;
}

/**
 * Build a redactor.
 *
 * @param options - The secrets and patterns to redact.
 */
export const createRedactor = (options: RedactorOptions = {}): Redactor => {
  const placeholder = options.placeholder ?? REDACTION_PLACEHOLDER;
  const secrets = (options.secrets ?? []).filter((secret) => secret.length >= 4);
  const patterns = [...BUILT_IN_SECRET_PATTERNS, ...(options.patterns ?? [])];

  return (text: string): string => {
    let output = text;

    for (const secret of secrets) {
      output = output.split(secret).join(placeholder);
    }

    for (const pattern of patterns) {
      // A shared global regex keeps its lastIndex between calls, so it is
      // reset before every use.
      pattern.lastIndex = 0;
      output = output.replace(pattern, placeholder);
    }

    return output;
  };
};

/** A redactor that changes nothing, for contexts that do not need one. */
export const identityRedactor: Redactor = (text) => text;
