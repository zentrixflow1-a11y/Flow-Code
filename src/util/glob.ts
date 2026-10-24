/**
 * Glob matching.
 *
 * The semantics follow the gitignore conventions people already know:
 * `*` matches within one path segment, `**` matches across segments, and `?`
 * matches exactly one character. Paths are always compared with forward
 * slashes, so the same rule works on Windows and on POSIX.
 */

/** The characters that make a pattern a glob rather than a literal. */
const GLOB_CHARACTERS = /[*?]/;

/** Whether a pattern contains any wildcard. */
export const isGlob = (pattern: string): boolean => GLOB_CHARACTERS.test(pattern);

/** Escape the characters that mean something inside a regular expression. */
const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Translate one path segment into a regular expression fragment.
 *
 * `*` becomes "anything but a slash", `?` becomes "one character but a
 * slash", and everything else is literal.
 */
const segmentToRegExp = (segment: string): string => {
  let out = "";
  let i = 0;
  while (i < segment.length) {
    const character = segment[i] as string;
    if (character === "\\") {
      // Backslash escapes the next character.
      const next = segment[i + 1];
      if (next !== undefined) {
        out += escapeRegExp(next);
        i += 2;
        continue;
      }
    }
    if (character === "*") {
      out += "[^/]*";
    } else if (character === "?") {
      out += "[^/]";
    } else {
      out += escapeRegExp(character);
    }
    i += 1;
  }
  return out;
};

/**
 * Compile a glob pattern into an anchored regular expression.
 *
 * @param pattern - The glob, using forward slashes.
 */
export const globToRegExp = (pattern: string): RegExp => {
  // Backslashes are escapes, not path separators, so they are preserved.
  const normalized = pattern;
  const segments = normalized.split("/");

  let source = "";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as string;
    const isLast = index === segments.length - 1;

    if (segment === "**") {
      // A trailing `**` matches everything below; a leading `**` directory
      // segment matches zero or more directories.
      source += isLast ? ".*" : "(?:[^/]+/)*";
      continue;
    }

    source += segmentToRegExp(segment);
    if (!isLast) {
      source += "/";
    }
  }

  return new RegExp(`^${source}$`);
};

/**
 * Match a subject against a glob pattern.
 *
 * A pattern with no wildcards also matches a subject that continues past it
 * with a separator, which gives the gitignore behaviour people expect:
 * `secrets` covers `secrets` and everything inside it.
 *
 * @param pattern - The glob to match.
 * @param subject - The text to test.
 * @param separator - The character that separates a parent from its children.
 */
export const matchGlob = (
  pattern: string,
  subject: string,
  separator = "/",
): boolean => {
  // Backslashes are escapes, not separators.
  const normalizedSubject = subject;
  const normalizedPattern = pattern;

  if (isGlob(normalizedPattern)) {
    return globToRegExp(normalizedPattern).test(normalizedSubject);
  }

  if (normalizedSubject === normalizedPattern) {
    return true;
  }

  return normalizedSubject.startsWith(`${normalizedPattern}${separator}`);
};

/**
 * Match a path against a glob pattern.
 *
 * @param pattern - The glob, using forward slashes.
 * @param path - The path to test.
 */
export const matchPath = (pattern: string, path: string): boolean =>
  matchGlob(pattern, path, "/");
