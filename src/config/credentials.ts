/**
 * Credentials.
 *
 * The configuration stores *references* to credentials, never the values
 * themselves, so a configuration file can be committed without leaking a key.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { configHome } from "./load.js";

/** The file literal credentials are kept in. */
export const CREDENTIALS_FILE = "credentials.json";

/** Where the credentials file lives. */
export const credentialsPath = (home: string): string =>
  join(configHome(home), CREDENTIALS_FILE);

/**
 * Read the credentials file.
 *
 * A file that is missing or unreadable is treated as empty: a missing
 * credential is reported when it is needed, not when it is read.
 */
export const readCredentials = async (
  home: string,
): Promise<Record<string, string>> => {
  try {
    const text = await readFile(credentialsPath(home), "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string") {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
};

/** How to find a credential. */
export interface CredentialOptions {
  /** The environment to look in. */
  readonly env?: NodeJS.ProcessEnv;
  /** The user's home directory. */
  readonly home?: string;
  /** The provider the credential is for. */
  readonly provider: string;
  /** The name of the environment variable that holds the credential. */
  readonly apiKeyEnv?: string;
}

/**
 * Find the credential for a provider.
 *
 * The environment wins, because it is the form that never touches the disk.
 *
 * @param options - Where to look.
 */
export const resolveApiKey = async (
  options: CredentialOptions,
): Promise<string | undefined> => {
  const env = options.env ?? process.env;

  if (options.apiKeyEnv !== undefined) {
    const value = env[options.apiKeyEnv];
    if (value !== undefined && value !== "") {
      return value;
    }
  }

  const home = options.home ?? homedir();
  const credentials = await readCredentials(home);
  return credentials[options.provider];
};
