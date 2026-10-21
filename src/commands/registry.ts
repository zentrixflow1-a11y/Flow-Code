/**
 * The command registry.
 *
 * The built-in commands live in `builtin.ts`; this module is the single
 * place the rest of the code looks them up, so a command cannot exist in one
 * place and be missing from the other.
 */
export * from "./types.js";
export { COMMANDS, runCommand } from "./builtin.js";
