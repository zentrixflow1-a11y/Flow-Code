/**
 * The published version of Flow Code.
 *
 * Kept as a literal so the compiled CLI never has to read `package.json` at
 * runtime. A unit test asserts this stays in sync with `package.json`.
 */
export const VERSION = "0.1.0";

/** The name of the executable, as installed on `PATH`. */
export const BINARY_NAME = "flowcode";

/** The name of the npm package that publishes this CLI. */
export const PACKAGE_NAME = "flow-code-cli";
