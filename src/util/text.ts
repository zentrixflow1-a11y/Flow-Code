/**
 * Text helpers shared by the tools and the UI.
 */

/** The largest tool output Flow Code passes back to the model by default. */
export const MAX_TOOL_OUTPUT_BYTES = 30_000;

/** A capped piece of text. */
export interface CappedText {
  /** The text, shortened if it was too long. */
  readonly text: string;
  /** Whether the text was shortened. */
  readonly truncated: boolean;
  /** How many bytes were left out. */
  readonly omittedBytes: number;
}

/**
 * Shorten text to a byte budget, keeping the beginning and the end.
 *
 * The end matters: that is where errors, stack traces and test failures
 * live, and dropping them is how a harness hides the reason a command
 * failed.
 *
 * @param text - The text to cap.
 * @param maxBytes - The budget.
 */
export const capOutput = (
  text: string,
  maxBytes = MAX_TOOL_OUTPUT_BYTES,
): CappedText => {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) {
    return { text, truncated: false, omittedBytes: 0 };
  }

  const headBytes = Math.floor(maxBytes * 0.3);
  const tailBytes = Math.max(0, maxBytes - headBytes);
  const omitted = buffer.length - headBytes - tailBytes;

  const head = decodeSlice(buffer.subarray(0, headBytes), "start");
  const tail = decodeSlice(buffer.subarray(buffer.length - tailBytes), "end");

  return {
    text: `${head}\n… [${omitted} bytes omitted] …\n${tail}`,
    truncated: true,
    omittedBytes: omitted,
  };
};

/**
 * Decode a byte slice without leaving a broken character at the cut.
 *
 * @param slice - The bytes to decode.
 * @param edge - Which edge of the slice the cut is at.
 */
const decodeSlice = (slice: Buffer, edge: "start" | "end"): string => {
  let text = new TextDecoder("utf-8").decode(slice);
  if (text.endsWith("�")) {
    text = text.slice(0, -1);
  }
  if (edge === "end" && text.startsWith("�")) {
    text = text.slice(1);
  }
  return text;
};

/**
 * Prefix every line with its line number.
 *
 * @param text - The text to number.
 * @param startLine - The number of the first line.
 */
export const withLineNumbers = (text: string, startLine = 1): string => {
  const lines = text.split("\n");
  const width = String(startLine + lines.length - 1).length;
  return lines
    .map((line, index) => `${String(startLine + index).padStart(width, " ")}\t${line}`)
    .join("\n");
};

/** Render a byte count in a human-readable form. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

/** Shorten a single line of text for a one-line display. */
export const oneLine = (text: string, maxLength = 120): string => {
  const flattened = text.replace(/\s+/g, " ").trim();
  if (flattened.length <= maxLength) {
    return flattened;
  }
  return `${flattened.slice(0, Math.max(0, maxLength - 1))}…`;
};

/**
 * Split a command line into the segments a shell would run.
 *
 * A pipeline, a list and a chain are three segments. The quotes are taken
 * into account, so a `;` inside a quoted string is part of the word.
 *
 * @param command - The command line.
 */
export const commandSegments = (command: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;

  for (const character of command) {
    if (quote !== undefined) {
      current += character;
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "|" || character === ";" || character === "&") {
      if (current.trim() !== "") {
        parts.push(current.trim());
      }
      current = "";
      continue;
    }
    current += character;
  }

  if (current.trim() !== "") {
    parts.push(current.trim());
  }

  return parts;
};

/**
 * Split a command line into its words, taking the quotes into account.
 *
 * A quoted word is one word, whatever is inside it, and a word that is only
 * quotes is an empty argument rather than no argument at all.
 *
 * @param command - The command line.
 */
export const commandWords = (command: string): string[] => {
  const words: string[] = [];
  let current = "";
  let started = false;
  let quote: string | undefined;

  for (const character of command) {
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
        continue;
      }
      current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (character === " " || character === "\t") {
      if (started) {
        words.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += character;
    started = true;
  }

  if (started) {
    words.push(current);
  }

  return words;
};
