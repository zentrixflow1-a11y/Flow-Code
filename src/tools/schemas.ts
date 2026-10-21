/**
 * Turning tool schemas into the JSON Schema a provider expects.
 */
import { z } from "zod";
import type { ZodType } from "zod";
import type { JsonSchema } from "../providers/types.js";

/**
 * Convert a Zod schema into JSON Schema.
 *
 * Zod's object schemas already produce `additionalProperties: false`, which
 * stops models from inventing arguments, and `unrepresentable: "any"` keeps
 * an exotic type from failing the whole request.
 */
export const toJsonSchema = (schema: ZodType<unknown, unknown>): JsonSchema =>
  z.toJSONSchema(schema, {
    unrepresentable: "any",
  }) as JsonSchema;

/**
 * Describe a validation failure in a way the model can act on.
 *
 * @param issues - The issues Zod reported.
 */
export const describeIssues = (issues: readonly { readonly path: PropertyKey[]; readonly message: string }[]): string =>
  issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "(root)" : issue.path.join(".");
      return `${path}: ${issue.message}`;
    })
    .join("; ");
