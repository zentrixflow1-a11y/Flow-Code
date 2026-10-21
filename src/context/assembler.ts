/**
 * Assembling the request that goes to the model.
 */
import type { ChatMessage, ChatRequest, ToolDefinition } from "../providers/types.js";

/** What goes into a request. */
export interface AssembleOptions {
  /** The model to talk to. */
  readonly model: string;
  /** The conversation so far. */
  readonly messages: readonly ChatMessage[];
  /** The system prompt. */
  readonly systemPrompt: string;
  /** The project's instructions, appended to the system prompt. */
  readonly projectInstructions?: string;
  /** The tools the model may call. */
  readonly tools?: readonly ToolDefinition[];
  /** The sampling temperature. */
  readonly temperature?: number;
  /** The output token limit. */
  readonly maxTokens?: number;
  /** Stop sequences. */
  readonly stop?: readonly string[];
}

/**
 * Build the request for one assistant turn.
 *
 * The system prompt and the project's instructions are combined into a single
 * system message, which every provider understands and which keeps the
 * conversation itself free of instructions.
 *
 * @param options - What goes into the request.
 */
export const assembleRequest = (options: AssembleOptions): ChatRequest => {
  const system = combineSystemPrompt(options.systemPrompt, options.projectInstructions);

  const messages: ChatMessage[] =
    options.systemPrompt === "" && options.projectInstructions === undefined
      ? [...options.messages]
      : [{ role: "system", content: system }, ...options.messages];

  return {
    model: options.model,
    messages,
    ...(options.tools === undefined || options.tools.length === 0
      ? {}
      : { tools: options.tools }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.stop === undefined ? {} : { stop: options.stop }),
  };
};

/**
 * Combine the system prompt with the project's instructions.
 *
 * @param systemPrompt - Flow Code's own prompt.
 * @param projectInstructions - What the project asked for.
 */
export const combineSystemPrompt = (
  systemPrompt: string,
  projectInstructions?: string,
): string => {
  if (projectInstructions === undefined || projectInstructions.trim() === "") {
    return systemPrompt;
  }
  return `${systemPrompt}\n\n## Project instructions\n\n${projectInstructions.trim()}`;
};
