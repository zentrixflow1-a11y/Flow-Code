/**
 * Sub-agent definitions.
 *
 * A sub-agent is a markdown file with a small frontmatter block. It runs in
 * its own context window, with its own tools, and the parent sees only its
 * final answer.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { toPosix } from "../util/paths.js";

/** The directory sub-agents live in. */
export const AGENTS_DIRECTORY = ".flowcode/agents";

/** One sub-agent. */
export interface AgentDefinition {
  /** The name the model uses to refer to it. */
  readonly name: string;
  /** What it is for, so the model knows when to use it. */
  readonly description: string;
  /** The tools it may use. When it is absent, it inherits the parent's. */
  readonly tools?: readonly string[];
  /** The model it uses. */
  readonly model?: string;
  /** The most turns it may take. */
  readonly maxTurns?: number;
  /** Extra instructions for the sub-agent. */
  readonly systemPrompt?: string;
  /** The body of the file, which becomes its instructions. */
  readonly body: string;
}

/**
 * Read the sub-agents a project defines.
 *
 * @param cwd - The project's directory.
 */
export const readAgentDefinitions = async (
  cwd: string,
): Promise<readonly AgentDefinition[]> => {
  const directory = join(cwd, ...AGENTS_DIRECTORY.split("/"));

  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const definitions: AgentDefinition[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) {
      continue;
    }
    let text: string;
    try {
      text = await readFile(join(directory, entry), "utf8");
    } catch {
      continue;
    }
    const definition = parseAgentDefinition(entry, text);
    if (definition !== undefined) {
      definitions.push(definition);
    }
  }

  return definitions;
};

/**
 * Parse one sub-agent file.
 *
 * @param filename - The file's name.
 * @param text - The file's content.
 */
export const parseAgentDefinition = (
  filename: string,
  text: string,
): AgentDefinition | undefined => {
  const normalized = text.replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---\n")) {
    return undefined;
  }
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return undefined;
  }

  const front = normalized.slice(4, end);
  const body = normalized.slice(end + 4).trim();

  const field = (name: string): string | undefined => {
    const line = front
      .split("\n")
      .find((entry) => entry.trim().toLowerCase().startsWith(`${name}:`));
    if (line === undefined) {
      return undefined;
    }
    return line.slice(line.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "");
  };

  const name = field("name") ?? filename.replace(/\.md$/, "");
  const description = field("description") ?? "";
  const tools = field("tools");
  const model = field("model");
  const maxTurns = field("max_turns");
  const systemPrompt = field("system_prompt");

  return {
    name,
    description,
    ...(tools === undefined
      ? {}
      : { tools: tools.split(",").map((tool) => tool.trim()).filter((tool) => tool !== "") }),
    ...(model === undefined ? {} : { model }),
    ...(maxTurns === undefined || Number.isNaN(Number(maxTurns))
      ? {}
      : { maxTurns: Number(maxTurns) }),
    ...(systemPrompt === undefined ? {} : { systemPrompt }),
    body,
  };
};

/**
 * The names of the tools a sub-agent may use.
 *
 * @param definition - The sub-agent.
 * @param inherited - The tools the parent has.
 */
export const toolsFor = (
  definition: AgentDefinition,
  inherited: readonly string[],
): readonly string[] =>
  definition.tools === undefined ? inherited : definition.tools.map(toPosix);
