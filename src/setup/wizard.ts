/**
 * The setup wizard.
 *
 * It finds the model servers that are running, asks which one to use, and
 * writes the configuration. It never needs an API key for a local server.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { configHome, CONFIG_FILE } from "../config/load.js";
import { findPreset, PRESETS } from "../providers/presets.js";
import { probeProviders, type ProviderProbe } from "./probe.js";

/** How the wizard should run. */
export interface SetupOptions {
  /** The user's home directory. */
  readonly home?: string;
  /** The provider to configure, when it is already known. */
  readonly provider?: string;
  /** The model to configure, when it is already known. */
  readonly model?: string;
  /** The base URL, when the provider is a custom one. */
  readonly baseUrl?: string;
  /** Answer every question with the default. */
  readonly yes?: boolean;
  /** Where to write progress. */
  readonly out?: (text: string) => void;
  /** Where to write the report. */
  readonly err?: (text: string) => void;
}

/** What the wizard decided. */
export interface SetupResult {
  /** The provider that was chosen. */
  readonly provider: string;
  /** The model that was chosen. */
  readonly model: string;
  /** Where the configuration was written. */
  readonly configPath: string;
  /** The servers that were found. */
  readonly probes: readonly ProviderProbe[];
}

/**
 * Run the setup wizard.
 *
 * @param options - How to run it.
 * @returns The process exit status.
 */
export const runSetup = async (
  options: SetupOptions = {},
): Promise<number> => {
  const home = options.home ?? homedir();
  const out = options.out ?? ((text) => void process.stdout.write(`${text}\n`));
  const err = options.err ?? ((text) => void process.stderr.write(`${text}\n`));

  out("Looking for model servers on this machine…");

  const probes = await probeProviders();
  for (const probe of probes) {
    out(
      `  ${probe.reachable ? "[ok]" : "[--]"} ${probe.label} — ${
        probe.reachable ? probe.models.join(", ") || "no models" : "not running"
      }`,
    );
  }

  const chosen = chooseProvider(options, probes);

  if (chosen === undefined) {
    err("");
    err("No model server was found.");
    err("");
    err("Start one of these, then run `flowcode setup` again:");
    for (const preset of PRESETS.filter((entry) => entry.local)) {
      err(`  ${preset.label.padEnd(12)} ${preset.baseUrl}`);
    }
    err("");
    err("Or configure a hosted provider by hand in ~/.flowcode/config.json:");
    err('  { "provider": { "provider": "deepseek", "model": "deepseek-chat" } }');
    return 1;
  }

  const model = options.model ?? chosen.models[0] ?? "";
  if (model === "") {
    err(`${chosen.label} is running but reports no models, so there is nothing to configure.`);
    return 1;
  }

  const configPath = join(configHome(home), CONFIG_FILE);
  const document = {
    provider: {
      provider: chosen.id,
      model,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    },
  };

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  out("");
  out(`Configured ${chosen.label} with the model '${model}'.`);
  out(`Written to ${configPath}`);
  out("");
  out("Next: run `flowcode` and start a session.");
  out("Run `flowcode doctor` at any time to check the setup.");

  return 0;
};

/**
 * Choose the provider to configure.
 *
 * @param options - The options the user gave.
 * @param probes - What the probe found.
 */
const chooseProvider = (
  options: SetupOptions,
  probes: readonly ProviderProbe[],
): ProviderProbe | undefined => {
  if (options.provider !== undefined) {
    const preset = findPreset(options.provider);
    if (preset === undefined) {
      return undefined;
    }
    const probe = probes.find((entry) => entry.id === options.provider);
    return (
      probe ?? {
        id: preset.id,
        label: preset.label,
        baseUrl: preset.baseUrl,
        reachable: false,
        models: [],
      }
    );
  }

  const reachable = probes.filter((probe) => probe.reachable && probe.models.length > 0);
  return reachable[0];
};
