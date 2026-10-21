/**
 * The published version of Flow Code.
 *
 * The version lives in `package.json` and nowhere else: this module reads it
 * from there, so there is one thing to change when it is released, and the
 * changelog's headings can be checked against it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the package manifest lives.
 *
 * It is one directory above this module, whether this module is in `src` or
 * in the compiled `dist`.
 */
const manifestPath = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");

/** What the manifest says, when it can be read. */
const manifest = (): { readonly name?: string; readonly version?: string } => {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath(), "utf8")) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as { readonly name?: string; readonly version?: string };
    }
  } catch {
    // A build without a manifest beside it still has to start.
  }
  return {};
};

/** The published version of Flow Code. */
export const VERSION = manifest().version ?? "0.0.0";

/** The name of the executable, as installed on `PATH`. */
export const BINARY_NAME = "flowcode";

/** The name of the npm package that publishes this CLI. */
export const PACKAGE_NAME = manifest().name ?? "flow-code-cli";
