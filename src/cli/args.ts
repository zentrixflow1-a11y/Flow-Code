/**
 * A very small argument parser.
 *
 * Flow Code deliberately avoids a CLI framework: the whole surface is a handful
 * of flags and a growing list of subcommands, and hand-rolling the parser keeps
 * full control over exit codes and over what `--help` prints.
 */

/** Describes how a particular invocation should be tokenised. */
export interface ArgSpec {
  /**
   * Long flag names (without the leading dashes) that consume the *next*
   * argument as their value, e.g. `--model gpt-4`.
   */
  readonly valueFlags: ReadonlySet<string>;

  /**
   * Short aliases mapped to their long form, e.g. `p` to `print`. Keys are
   * given without the leading dash.
   */
  readonly aliases: ReadonlyMap<string, string>;
}

/** The result of parsing an argument vector. */
export interface ParsedArgs {
  /** Positional arguments, in order, with the command name removed. */
  readonly positionals: readonly string[];
  /**
   * Parsed flags. A flag that takes a value maps to its string value; a
   * boolean flag maps to `true`. Repeated boolean flags stay `true`.
   */
  readonly flags: Readonly<Record<string, string | boolean>>;
}

/** An error raised while parsing an argument vector. */
export class ArgParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgParseError";
  }
}

/**
 * Parse an argument vector against a spec.
 *
 * Supported forms:
 * - `--flag` — boolean flag
 * - `--flag=value` — flag with an inline value
 * - `--flag value` — flag with a separate value, when `flag` is a value flag
 * - `-f` — short alias, resolved through the spec's alias table
 * - `--` — everything after this is a positional
 *
 * @param argv - Arguments *after* the executable name and command name.
 * @param spec - How to interpret value flags and short aliases.
 */
export const parseArgs = (
  argv: readonly string[],
  spec: ArgSpec = { valueFlags: new Set(), aliases: new Map() },
): ParsedArgs => {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let index = 0;
  let onlyPositionals = false;

  while (index < argv.length) {
    const token = argv[index] as string;
    index += 1;

    if (onlyPositionals) {
      positionals.push(token);
      continue;
    }

    if (token === "--") {
      onlyPositionals = true;
      continue;
    }

    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }

    const isLong = token.startsWith("--");
    const withoutDashes = isLong ? token.slice(2) : token.slice(1);
    const equalsAt = withoutDashes.indexOf("=");
    const rawName = equalsAt === -1 ? withoutDashes : withoutDashes.slice(0, equalsAt);
    const inlineValue = equalsAt === -1 ? undefined : withoutDashes.slice(equalsAt + 1);

    const name = isLong ? rawName : (spec.aliases.get(rawName) ?? rawName);

    if (inlineValue !== undefined) {
      flags[name] = inlineValue;
      continue;
    }

    if (spec.valueFlags.has(name)) {
      const next = argv[index];
      if (next === undefined) {
        throw new ArgParseError(`Missing value for --${name}`);
      }
      index += 1;
      flags[name] = next;
      continue;
    }

    flags[name] = true;
  }

  return { positionals, flags };
};

/** Read a flag as a string, if it was supplied as one. */
export const stringFlag = (
  flags: Readonly<Record<string, string | boolean>>,
  name: string,
): string | undefined => {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
};

/** Read a flag as a boolean, if it was supplied at all. */
export const booleanFlag = (
  flags: Readonly<Record<string, string | boolean>>,
  name: string,
): boolean => flags[name] === true || typeof flags[name] === "string";
