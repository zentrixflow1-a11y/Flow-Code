/**
 * The health check.
 *
 * `flowcode doctor` is strictly read-only: it never writes a file, never
 * changes a setting, and never starts a session.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { effectiveRules, loadConfig } from "./config/load.js";
import { createProvider } from "./providers/factory.js";
import { findPreset } from "./providers/presets.js";
import { isTrustedDirectory, listProjectFiles } from "./security/trust.js";
import { createDefaultRegistry } from "./tools/index.js";
import { formatBytes } from "./util/text.js";

/** How to run the health check. */
export interface DoctorOptions {
  /** The directory to check the configuration for. */
  readonly cwd: string;
  /** The user's home directory. */
  readonly home?: string;
  /** The environment to read from. */
  readonly env?: NodeJS.ProcessEnv;
  /** Where to write the report. */
  readonly out?: (text: string) => void;
}

/** One line of the report. */
interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * Run the health check.
 *
 * @param options - How to run it.
 * @returns The process exit status: zero when everything is fine.
 */
export const runDoctor = async (options: DoctorOptions): Promise<number> => {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const out = options.out ?? ((text) => void process.stdout.write(`${text}\n`));

  const checks: Check[] = [];

  // The health check never asks a question, so it uses the trust store as it
  // stands: a directory that has not been trusted is reported as untrusted
  // and its own files are ignored.
  const projectFiles = await listProjectFiles(options.cwd);
  const trusted = await isTrustedDirectory({ home, directory: options.cwd });

  if (projectFiles.length > 0) {
    checks.push({
      name: "Trust",
      // An untrusted directory is the safe default, not a misconfiguration,
      // so it is reported rather than counted as a problem.
      ok: true,
      detail: trusted
        ? "this directory is trusted"
        : "this directory is not trusted; its .flowcode files were ignored",
    });
  }

  const loaded = await loadConfig({
    home,
    cwd: options.cwd,
    env,
    project: trusted ? "trusted" : "untrusted",
  });
  if (!loaded.ok) {
    checks.push({ name: "Configuration", ok: false, detail: loaded.error.message });
    return report(checks, out);
  }

  const config = loaded.value;
  checks.push({
    name: "Configuration",
    ok: true,
    detail: `provider ${config.provider.provider}, mode ${config.permissions.mode}`,
  });

  const preset = findPreset(config.provider.provider);
  const baseUrl = config.provider.baseUrl ?? preset?.baseUrl ?? "";
  checks.push({
    name: "Provider",
    ok: preset !== undefined,
    detail:
      preset === undefined
        ? `'${config.provider.provider}' is not a provider Flow Code knows about.`
        : `${preset.label} at ${baseUrl}`,
  });

  if (preset !== undefined) {
    const built = await createProvider({ provider: config.provider, env, home });
    if (!built.ok) {
      checks.push({ name: "Credentials", ok: false, detail: built.error.message });
    } else {
      const models = await built.value.listModels();
      if (!models.ok) {
        checks.push({
          name: "Connection",
          ok: false,
          detail: models.error.message,
        });
      } else {
        checks.push({
          name: "Connection",
          ok: true,
          detail: `${models.value.length} model${models.value.length === 1 ? "" : "s"} available`,
        });

        const model = config.provider.model;
        if (model !== undefined && model !== "") {
          const present = models.value.some((entry) => entry.id === model);
          checks.push({
            name: "Model",
            ok: present,
            detail: present
              ? `'${model}' is available`
              : `'${model}' was not found. Run \`flowcode /model\` to see what is.`,
          });
        }
      }
    }
  }

  const registry = createDefaultRegistry();
  const schemaBytes = registry.schemaBytes(new Set());
  const budget = config.tools.maxToolSchemaBytes;
  checks.push({
    name: "Tools",
    ok: true,
    detail: `${registry.size} tools, ${formatBytes(schemaBytes)} of schema (budget ${formatBytes(budget)})`,
  });

  const rules = effectiveRules(config);
  checks.push({
    name: "Permissions",
    ok: true,
    detail: `${rules.allow.length} allow, ${rules.ask.length} ask, ${rules.deny.length} deny`,
  });

  checks.push({
    name: "Sessions",
    ok: true,
    detail: `stored in ${join(home, ".flowcode", "sessions")}`,
  });

  return report(checks, out);
};

/** Print the report and decide the exit status. */
const report = (checks: readonly Check[], out: (text: string) => void): number => {
  out("Flow Code doctor");
  out("");
  for (const check of checks) {
    // The markers are plain ASCII, so the report survives being pasted into
    // an issue, a terminal with an old code page, or a log file.
    out(`  ${check.ok ? "[ok]" : "[!!]"} ${check.name.padEnd(14)} ${check.detail}`);
  }
  const failures = checks.filter((check) => !check.ok).length;
  out("");
  if (failures === 0) {
    out("Everything looks fine.");
    return 0;
  }
  out(`${failures} problem${failures === 1 ? "" : "s"} found.`);
  return 1;
};
