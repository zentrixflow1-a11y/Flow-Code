/**
 * Scaffolding the project instructions.
 *
 * `/init` writes a starting `FLOWCODE.md` from what the repository says
 * about itself: its name, its language, its package manager and its
 * commands. The parts that only a person knows are left as questions,
 * because a file full of guesses is worse than a short list of blanks.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { flowError, type FlowError } from "../errors.js";
import { err, ok, type Result } from "../util/result.js";
import {
  FALLBACK_INSTRUCTION_FILE,
  PRIMARY_INSTRUCTION_FILE,
} from "./instructions.js";

/** The lockfiles that tell us which package manager the project uses. */
const PACKAGE_MANAGERS: readonly (readonly [string, string])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/** The files that tell us which language the project is written in. */
const LANGUAGES: readonly (readonly [string, string])[] = [
  ["tsconfig.json", "TypeScript"],
  ["package.json", "JavaScript"],
  ["pyproject.toml", "Python"],
  ["requirements.txt", "Python"],
  ["go.mod", "Go"],
  ["Cargo.toml", "Rust"],
  ["pom.xml", "Java"],
  ["build.gradle", "Java"],
  ["Gemfile", "Ruby"],
  ["composer.json", "PHP"],
];

/** What the repository says about itself. */
export interface RepositoryFacts {
  /** The project's name, when it has one. */
  readonly name?: string;
  /** The language it is written in, when it is obvious. */
  readonly language?: string;
  /** The package manager it uses, when there is a lockfile. */
  readonly packageManager?: string;
  /** The commands its package manifest defines. */
  readonly scripts: readonly string[];
  /** The install command, when there is a package manifest. */
  readonly install?: string;
}

/** A scaffolded instructions file. */
export interface Scaffold {
  /** Where the file goes. */
  readonly path: string;
  /** What goes in it. */
  readonly content: string;
  /** What the scaffold worked out for itself. */
  readonly facts: readonly string[];
}

/**
 * Work out what the repository says about itself.
 *
 * @param cwd - The project's directory.
 */
export const readRepositoryFacts = async (cwd: string): Promise<RepositoryFacts> => {
  const manifest = await readJson(join(cwd, "package.json"));

  let name: string | undefined;
  let scripts: readonly string[] = [];
  let hasManifest = false;

  if (manifest !== undefined) {
    hasManifest = true;
    if (typeof manifest["name"] === "string" && manifest["name"] !== "") {
      name = manifest["name"];
    }
    const defined = manifest["scripts"];
    if (typeof defined === "object" && defined !== null) {
      scripts = Object.keys(defined as Record<string, unknown>).sort();
    }
  }

  let packageManager: string | undefined;
  for (const [lockfile, manager] of PACKAGE_MANAGERS) {
    if (await exists(join(cwd, lockfile))) {
      packageManager = manager;
      break;
    }
  }

  let language: string | undefined;
  for (const [marker, name] of LANGUAGES) {
    if (await exists(join(cwd, marker))) {
      language = name;
      break;
    }
  }

  return {
    ...(name === undefined ? {} : { name }),
    ...(language === undefined ? {} : { language }),
    ...(packageManager === undefined ? {} : { packageManager }),
    scripts,
    ...(hasManifest ? { install: "npm install" } : {}),
  };
};

/**
 * Write a starting instructions file for a project.
 *
 * @param cwd - The project's directory.
 */
export const scaffoldProjectInstructions = async (
  cwd: string,
): Promise<Result<Scaffold, FlowError>> => {
  for (const existing of [PRIMARY_INSTRUCTION_FILE, FALLBACK_INSTRUCTION_FILE]) {
    if (await exists(join(cwd, existing))) {
      return err(
        flowError(
          "invalid_request",
          `There is already a '${existing}' in this project.`,
          {
            retryable: false,
            remediation: `Edit '${existing}' directly, or delete it and run '/init' again.`,
          },
        ),
      );
    }
  }

  const facts = await readRepositoryFacts(cwd);
  const path = join(cwd, PRIMARY_INSTRUCTION_FILE);
  const content = renderInstructions(facts);

  return ok({
    path,
    content,
    facts: [
      ...(facts.name === undefined ? [] : [`the project is called ${facts.name}`]),
      ...(facts.language === undefined ? [] : [`it is written in ${facts.language}`]),
      ...(facts.packageManager === undefined
        ? []
        : [`it uses ${facts.packageManager}`]),
    ],
  });
};

/**
 * Render the instructions file.
 *
 * @param facts - What the repository said.
 */
export const renderInstructions = (facts: RepositoryFacts): string => {
  const lines: string[] = [
    "# How we work",
    "",
    "<!-- Written by `flowcode /init`. It is yours: edit it, and delete the parts",
    "     that are not true. Flow Code reads this file and gives it to the model. -->",
    "",
    "## The project",
    "",
  ];

  if (facts.name !== undefined) {
    lines.push(`- **Name:** ${facts.name}`);
  }
  if (facts.language !== undefined) {
    lines.push(`- **Language:** ${facts.language}`);
  }
  if (facts.packageManager !== undefined) {
    lines.push(`- **Package manager:** ${facts.packageManager}`);
  }
  if (facts.name === undefined && facts.language === undefined && facts.packageManager === undefined) {
    lines.push("- (Flow Code could not tell what this project is — fill this in.)");
  }

  lines.push("", "## The commands", "", "| What | How |", "| --- | --- |");

  if (facts.install !== undefined) {
    lines.push(`| Install | \`${facts.install}\` |`);
  }
  for (const script of facts.scripts) {
    lines.push(`| \`${script}\` | \`npm run ${script}\` |`);
  }
  if (facts.scripts.length === 0 && facts.install === undefined) {
    lines.push("| (none found) | |");
  }

  lines.push(
    "",
    "## The conventions",
    "",
    "- How the code is written, and how it is not.",
    "- What the tests must pass.",
    "- What must never be changed without asking.",
    "",
    "## The traps",
    "",
    "- The thing that breaks when nobody expects it.",
    "",
  );

  return lines.join("\n");
};

/** Whether a path exists. */
const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Read a JSON file, returning undefined when it is not there. */
const readJson = async (path: string): Promise<Record<string, unknown> | undefined> => {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // A manifest that is not there, or not JSON, tells us nothing.
  }
  return undefined;
};
