/**
 * Public entry point for the Flow Code package.
 *
 * The CLI is the primary interface, but the pieces it is built from are
 * exported so that the harness can be embedded in another program.
 */
export { BINARY_NAME, PACKAGE_NAME, VERSION } from "./version.js";
export { BANNER, BANNER_BLOCK, BANNER_LINES } from "./ui/banner.js";
export { COMMANDS } from "./commands/registry.js";
export type { CommandDefinition, OptionDefinition } from "./commands/registry.js";
export { runCli, defaultDeps, EXIT } from "./cli/run.js";
export type { CliDeps } from "./cli/run.js";
export { parseArgs, ArgParseError } from "./cli/args.js";
export type { ArgSpec, ParsedArgs } from "./cli/args.js";
export { renderHelp } from "./cli/help.js";
