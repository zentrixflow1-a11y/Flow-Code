/**
 * The permission rules Flow Code ships with.
 *
 * The defaults are conservative: they deny a handful of things that are
 * destructive or irreversible, and leave everything else to the mode.
 */
import type { PermissionRules } from "./types.js";

/** The rules applied when the user has not configured any of their own. */
export const DEFAULT_RULES: PermissionRules = {
  allow: [],
  ask: [],
  deny: [
    // Reading credential files is never useful to a coding task, and leaking
    // them into the conversation is the single worst thing this harness could
    // do by accident.
    "read_file:**/.env",
    "read_file:**/.env.*",
    "read_file:**/*.pem",
    "read_file:**/*.key",
    "read_file:**/id_rsa*",
    "read_file:**/.ssh/**",
    "read_file:**/.aws/**",
    "read_file:**/.gnupg/**",
    // Writing to them is worse.
    "write_file:**/.env",
    "write_file:**/.env.*",
    "write_file:**/*.pem",
    "write_file:**/*.key",
    "write_file:**/id_rsa*",
    "write_file:**/.ssh/**",
    "write_file:**/.aws/**",
    "write_file:**/.gnupg/**",
    // The agent's own configuration is off limits too.
    "write_file:**/.flowcode/**",
    "write_file:**/.git/**",
  ],
};
