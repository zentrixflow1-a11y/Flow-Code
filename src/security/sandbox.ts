/**
 * The optional operating-system sandbox.
 *
 * When it is switched on, a shell command runs inside an operating-system
 * sandbox that refuses writes outside the workspace. It is **opt-in**, because
 * a sandbox that is on by surprise is worse than no sandbox at all, and it is
 * not available on native Windows.
 *
 * The mechanisms are macOS's Seatbelt (`sandbox-exec`) and Linux's
 * bubblewrap (`bwrap`). Both are detected rather than assumed.
 */
import { access, constants } from "node:fs/promises";
import { join } from "node:path";

/** The sandbox mechanisms Flow Code knows about. */
export type SandboxKind = "seatbelt" | "bubblewrap" | "none";

/** What a platform can do. */
export interface SandboxSupport {
  /** The mechanism that would be used. */
  readonly kind: SandboxKind;
  /** Whether it is available. */
  readonly available: boolean;
  /** Why it is not available, when it is not. */
  readonly reason?: string;
}

/**
 * Work out what the platform can do.
 *
 * @param platform - The host platform.
 */
export const detectSandbox = async (
  platform: NodeJS.Platform,
): Promise<SandboxSupport> => {
  if (platform === "darwin") {
    const available = await hasCommand("sandbox-exec");
    return available
      ? { kind: "seatbelt", available: true }
      : {
          kind: "seatbelt",
          available: false,
          reason: "macOS's sandbox-exec was not found on the PATH.",
        };
  }

  if (platform === "linux") {
    const available = await hasCommand("bwrap");
    return available
      ? { kind: "bubblewrap", available: true }
      : {
          kind: "bubblewrap",
          available: false,
          reason:
            "Linux's bubblewrap was not found on the PATH. Install it with 'apt install bubblewrap'.",
        };
  }

  return {
    kind: "none",
    available: false,
    reason:
      platform === "win32"
        ? "There is no operating-system sandbox for native Windows. Run Flow Code inside WSL2 to get one."
        : `There is no operating-system sandbox for ${platform}.`,
  };
};

/** Whether a program is on the PATH. */
const hasCommand = async (command: string): Promise<boolean> => {
  const path = process.env["PATH"] ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  const extensions =
    process.platform === "win32"
      ? (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";")
      : [""];

  for (const directory of path.split(separator)) {
    if (directory === "") {
      continue;
    }
    for (const extension of extensions) {
      try {
        await access(join(directory, `${command}${extension}`), constants.X_OK);
        return true;
      } catch {
        // Try the next one.
      }
    }
  }
  return false;
};

/**
 * The Seatbelt profile that allows writes only inside the given roots.
 *
 * The paths are escaped, because the profile is a string of rules: a path
 * with a quote or a backslash in it would otherwise end the rule early — and
 * a path a user chose should never be able to write rules of its own.
 *
 * @param roots - The directories that may be written to.
 */
export const seatbeltProfile = (roots: readonly string[]): string => {
  const writes = roots
    .filter((root) => !hasControlCharacter(root))
    .map((root) => `  (allow file-write* (subpath "${escapeSeatbeltPath(root)}"))`)
    .join("\n");

  return [
    "(version 1)",
    "(deny default)",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal (target same-sandbox))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read*)",
    "(allow file-read-metadata)",
    "(allow network-outbound)",
    "(allow ipc-posix-shm)",
    writes,
    "",
  ].join("\n");
};

/**
 * Escape a path for the Seatbelt profile language.
 *
 * @param path - The path to escape.
 */
export const escapeSeatbeltPath = (path: string): string =>
  path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/**
 * Whether a path holds a character the profile cannot carry.
 *
 * @param path - The path to check.
 */
const hasControlCharacter = (path: string): boolean =>
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001F\u007F]/.test(path);

/**
 * The bubblewrap arguments that allow writes only inside the given roots.
 *
 * The network is left alone on purpose: the sandbox confines *writes*, and
 * Seatbelt allows the network too. A command that needs the network — an
 * install, a fetch — still has it, and the two mechanisms behave the same
 * way on both platforms.
 *
 * @param roots - The directories that may be written to.
 */
export const bubblewrapArgs = (roots: readonly string[]): readonly string[] => {
  const args: string[] = [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--unshare-user",
    "--unshare-ipc",
    "--unshare-pid",
    "--unshare-uts",
    "--unshare-cgroup",
    "--die-with-parent",
  ];

  for (const root of roots) {
    args.push("--bind", root, root);
  }

  return args;
};

/**
 * How a command is wrapped, when the sandbox is in use.
 *
 * @param kind - The mechanism to use.
 * @param roots - The directories that may be written to.
 * @param command - The command to run.
 * @param cwd - The directory to run it in.
 */
export const wrapCommand = (
  kind: SandboxKind,
  roots: readonly string[],
  command: string,
  cwd: string,
): { readonly command: string; readonly args: readonly string[] } | undefined => {
  switch (kind) {
    case "seatbelt":
      return {
        command: "sandbox-exec",
        args: ["-p", seatbeltProfile(roots), "/bin/sh", "-c", command],
      };
    case "bubblewrap":
      return {
        command: "bwrap",
        args: [...bubblewrapArgs(roots), "--chdir", cwd, "/bin/sh", "-c", command],
      };
    case "none":
      return undefined;
  }
};
