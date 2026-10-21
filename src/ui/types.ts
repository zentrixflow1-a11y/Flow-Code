/**
 * The terminal UI's own vocabulary.
 */

/** One step of a plan. */
export interface PlanStep {
  /** What the step is. */
  readonly content: string;
  /** Where the step is up to. */
  readonly status: "pending" | "in_progress" | "completed";
}

/** A file the user mentioned with `@`. */
export interface Mention {
  /** The path the user typed. */
  readonly path: string;
  /** Where in the message the mention appeared. */
  readonly start: number;
  /** How long the mention is. */
  readonly length: number;
}

/**
 * Find the `@path` mentions in a message.
 *
 * @param text - The message.
 */
export const findMentions = (text: string): Mention[] => {
  const mentions: Mention[] = [];
  const pattern = /@([\w./\\-]+)/g;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    mentions.push({
      path: match[1] as string,
      start: match.index,
      length: match[0].length,
    });
    match = pattern.exec(text);
  }
  return mentions;
};

/**
 * Replace the mentions in a message with their contents.
 *
 * A mention that cannot be read is left as it was, so the model can see that
 * the user referred to something.
 *
 * @param text - The message.
 * @param read - How to read a mentioned file.
 */
export const resolveMentions = async (
  text: string,
  read: (path: string) => Promise<string | undefined>,
): Promise<string> => {
  const mentions = findMentions(text);
  if (mentions.length === 0) {
    return text;
  }

  const blocks: string[] = [];
  let working = text;

  for (const mention of mentions) {
    const content = await read(mention.path);
    if (content === undefined) {
      continue;
    }
    blocks.push(`--- ${mention.path} ---\n${content}`);
    working = working.replace(mention.path, mention.path);
  }

  if (blocks.length === 0) {
    return text;
  }

  return `${working}\n\n${blocks.join("\n\n")}`;
};
