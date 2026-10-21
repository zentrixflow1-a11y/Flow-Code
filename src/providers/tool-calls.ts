/**
 * Reassembles streamed tool calls.
 *
 * The OpenAI streaming format spreads one tool call across many chunks: the
 * first chunk carries the call's id and name, and the arguments arrive as
 * fragments of a JSON string in the chunks that follow. Several calls can be
 * in flight at once, distinguished by their `index`.
 *
 * This is the highest-risk code in the provider layer, so it is kept small,
 * free of I/O, and tested hard.
 */
import { flowError, type FlowError } from "../errors.js";
import type { ToolCall } from "./types.js";

/** One streamed fragment of a tool call. */
export interface ToolCallDelta {
  /** The call's position within the assistant message. */
  readonly index: number;
  /** The call's identifier, present on the first fragment. */
  readonly id?: string;
  /** The tool's name, present on the first fragment. */
  readonly name?: string;
  /** A fragment of the call's JSON arguments. */
  readonly argumentsDelta?: string;
}

/** A completed tool call whose arguments were not valid JSON. */
export interface MalformedToolCall {
  /** The call, with the raw argument text in `args`. */
  readonly call: ToolCall;
  /** Why the arguments could not be parsed. */
  readonly error: FlowError;
}

interface PartialCall {
  id: string;
  name: string;
  args: string;
}

/**
 * Accumulates streamed tool-call fragments into complete calls.
 */
export class ToolCallAssembler {
  readonly #calls = new Map<number, PartialCall>();
  readonly #order: number[] = [];

  /**
   * Add one streamed fragment.
   *
   * Fragments may arrive out of order, and a later fragment may repeat the id
   * or the name; the last value seen wins.
   */
  add(delta: ToolCallDelta): void {
    let partial = this.#calls.get(delta.index);
    if (partial === undefined) {
      partial = { id: "", name: "", args: "" };
      this.#calls.set(delta.index, partial);
      this.#order.push(delta.index);
    }

    if (delta.id !== undefined && delta.id !== "") {
      partial.id = delta.id;
    }
    if (delta.name !== undefined && delta.name !== "") {
      partial.name = delta.name;
    }
    if (delta.argumentsDelta !== undefined) {
      partial.args += delta.argumentsDelta;
    }
  }

  /**
   * The complete calls, in the order their first fragment arrived.
   *
   * Arguments that are not valid JSON are returned with the raw text in
   * `args`; {@link ToolCallAssembler.malformed} reports them.
   */
  complete(): ToolCall[] {
    return this.#order.map((index) => {
      const partial = this.#calls.get(index);
      if (partial === undefined) {
        return { id: "", name: "", args: undefined };
      }
      return {
        id: partial.id,
        name: partial.name,
        args: parseArguments(partial.args),
      };
    });
  }

  /** The calls whose arguments could not be parsed. */
  malformed(): MalformedToolCall[] {
    const failures: MalformedToolCall[] = [];
    for (const index of this.#order) {
      const partial = this.#calls.get(index);
      if (partial === undefined || partial.args.trim() === "") {
        continue;
      }
      if (parseArguments(partial.args) !== undefined) {
        continue;
      }
      failures.push({
        call: { id: partial.id, name: partial.name, args: partial.args },
        error: flowError(
          "malformed_response",
          `The arguments for tool '${partial.name}' were not valid JSON.`,
          {
            remediation:
              "The tool call was rejected. Ask the model to call the tool again with valid JSON arguments.",
          },
        ),
      });
    }
    return failures;
  }
}

/**
 * Parse a tool call's accumulated argument text.
 *
 * An empty argument string is a valid call with no arguments. Anything that
 * does not parse yields `undefined`, which the caller reports as a malformed
 * response.
 */
const parseArguments = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return {};
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
};
