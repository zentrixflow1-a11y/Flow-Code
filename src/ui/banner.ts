/**
 * The ASCII startup banner.
 *
 * This is the terminal counterpart of `assets/logo-mark.svg`: a prompt chevron
 * above a stream wave, framed in a box. The lines are assembled from a single
 * width constant so they can never drift out of alignment.
 */

/** Inner width of the banner frame, excluding the border characters. */
const FRAME_WIDTH = 38;

/** Left margin applied to every line. */
const MARGIN = "   ";

const frame = (): string => `${MARGIN}+${"-".repeat(FRAME_WIDTH)}+`;

const panel = (inner: string): string =>
  `${MARGIN}|${inner.padEnd(FRAME_WIDTH)}|`;

/**
 * The banner lines, top to bottom.
 *
 * The wave row is a solid run of `~` so it reads as a stream at any width,
 * and the prompt row leaves the chevron offset to the left.
 */
export const BANNER_LINES: readonly string[] = [
  frame(),
  panel("  >"),
  panel("~".repeat(FRAME_WIDTH)),
  frame(),
];

/** The full banner as a single newline-separated string. */
export const BANNER: string = BANNER_LINES.join("\n");

/**
 * The banner followed by a blank line, ready to print above a session.
 */
export const BANNER_BLOCK: string = `${BANNER}\n`;
