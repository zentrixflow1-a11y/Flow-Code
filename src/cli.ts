#!/usr/bin/env node
/**
 * The Flow Code executable.
 *
 * Kept intentionally thin: argument handling and exit-status policy live in
 * `run.ts` so they can be tested without spawning a process.
 */
import { defaultDeps, EXIT, runCli } from "./cli/run.js";

/**
 * Install the process-level signal and stream handlers, then run the CLI.
 *
 * @returns The process exit status.
 */
export const main = async (): Promise<number> => {
  let interrupted = false;

  const onInterrupt = (): void => {
    interrupted = true;
  };

  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onInterrupt);

  try {
    const status = await runCli(process.argv.slice(2), defaultDeps);
    // A signal recorded during the run outranks a normal success status.
    return interrupted ? EXIT.interrupted : status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    defaultDeps.err(`flowcode: ${message}`);
    return EXIT.failure;
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
  }
};

// Only self-start when this module is the process entry point, so tests can
// import it without running the CLI.
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isEntryPoint) {
  const status = await main();
  process.exitCode = status;
}
