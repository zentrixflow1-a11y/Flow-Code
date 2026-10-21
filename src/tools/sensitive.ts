/**
 * Refusing to read a secret.
 *
 * A credential file is a credential file however it is reached: read
 * directly, searched for, listed, or printed by a command. The tools ask
 * {@link isSensitivePath} rather than deciding for themselves, so the answer
 * is the same everywhere.
 */
import { flowError, type FlowError } from "../errors.js";
import { isSensitivePath } from "../util/paths.js";
import { commandWords } from "../util/text.js";

/**
 * The error a tool returns when it refuses a file that holds a secret.
 *
 * @param path - The path it refused.
 */
export const refuseSensitivePath = (path: string): FlowError =>
  flowError(
    "permission_denied",
    `'${path}' looks like a file that holds a credential, and it will not be read.`,
    {
      retryable: false,
      remediation:
        "Ask the user for the value you need instead, or work from a file that does not hold a secret.",
    },
  );

/**
 * The words of a command that name a file that holds a secret.
 *
 * This is best effort: it sees the words of the command, not what the shell
 * will do with them.
 *
 * @param command - The command line.
 */
export const sensitiveWords = (command: string): string[] =>
  commandWords(command).filter((word) => isSensitivePath(word));

/**
 * The error a tool returns when it refuses a command that names a secret.
 *
 * @param words - The words that gave it away.
 */
export const refuseSensitiveCommand = (words: readonly string[]): FlowError =>
  flowError(
    "permission_denied",
    `The command refers to ${words.map((word) => `'${word}'`).join(", ")}, which looks like a file that holds a credential, so it will not be run.`,
    {
      retryable: false,
      remediation:
        "Leave the credential alone, and ask the user for what you need.",
    },
  );
