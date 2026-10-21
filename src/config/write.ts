/**
 * Writing configuration back.
 *
 * Only the personal, uncommitted files are ever written. A project's shared
 * configuration is left alone, so a rule the user adds never changes what
 * their team sees.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { flowError, type FlowError } from "../errors.js";
import { restrictToOwner } from "../util/paths.js";
import { err, ok, type Result } from "../util/result.js";
import { LOCAL_CONFIG_FILE, locateConfigFiles } from "./load.js";

/** Which bucket a rule goes into. */
export type RuleBucket = "allow" | "ask" | "deny";

/** Where a rule is written. */
export type RuleScope = "project" | "user";

/**
 * Add a permission rule to a personal configuration file.
 *
 * @param options - The rule, and where to put it.
 */
export const persistRule = async (options: {
  readonly rule: string;
  readonly bucket: RuleBucket;
  readonly scope: RuleScope;
  readonly cwd: string;
  readonly home?: string;
}): Promise<Result<string, FlowError>> => {
  const home = options.home ?? homedir();
  const sources = locateConfigFiles(home, options.cwd);

  const path =
    options.scope === "project" ? sources.projectLocal : sources.userLocal;
  if (path === undefined) {
    return err(
      flowError("invalid_request", "There is nowhere to save that rule.", {
        retryable: false,
      }),
    );
  }

  const existing = await readJsonFile(path);
  const permissions =
    typeof existing["permissions"] === "object" && existing["permissions"] !== null
      ? (existing["permissions"] as Record<string, unknown>)
      : {};

  const list = Array.isArray(permissions[options.bucket])
    ? (permissions[options.bucket] as string[])
    : [];

  if (!list.includes(options.rule)) {
    list.push(options.rule);
  }
  permissions[options.bucket] = list;
  existing["permissions"] = permissions;

  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, `${JSON.stringify(existing, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    // The mode of a file is only set when it is created, so it is set again
    // for a file that was already there.
    await restrictToOwner(dirname(path), 0o700);
    await restrictToOwner(path, 0o600);
  } catch (error) {
    return err(
      flowError("invalid_request", `The rule could not be saved to '${path}'.`, {
        retryable: false,
        cause: error,
      }),
    );
  }

  return ok(path);
};

/** Read a JSON file, returning an empty object when it is not there. */
const readJsonFile = async (path: string): Promise<Record<string, unknown>> => {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // A file that is missing or unreadable starts from scratch.
  }
  return {};
};

/**
 * Write a whole configuration document.
 *
 * @param path - Where to write it.
 * @param document - What to write.
 */
export const writeConfigFile = async (
  path: string,
  document: unknown,
): Promise<Result<void, FlowError>> => {
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await restrictToOwner(dirname(path), 0o700);
    await restrictToOwner(path, 0o600);
  } catch (error) {
    return err(
      flowError("invalid_request", `The configuration could not be written to '${path}'.`, {
        retryable: false,
        cause: error,
      }),
    );
  }

  return ok(undefined);
};

/** The default place a personal configuration file lives. */
export const defaultUserLocalConfigPath = (home: string): string =>
  join(home, ".flowcode", LOCAL_CONFIG_FILE);
