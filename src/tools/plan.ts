/**
 * The session tools: the plan, the plan-mode exit, and asking the user.
 */
import { z } from "zod";
import { flowError } from "../errors.js";
import type { ToolDefinition, ToolResult } from "./types.js";

/** The state of one step in a plan. */
export type PlanStepStatus = "pending" | "in_progress" | "completed";

/** The arguments of {@link updatePlanTool}. */
const updatePlanArgs = z.object({
  steps: z
    .array(
      z.object({
        content: z.string().min(1).describe("What the step is."),
        status: z
          .enum(["pending", "in_progress", "completed"])
          .describe("Where the step is up to."),
      }),
    )
    .min(1)
    .describe("The whole plan. Send every step every time, with its current status."),
});

/**
 * The plan the model last set.
 *
 * The tool itself has no side effects beyond producing text: the agent loop
 * reads the plan out of the tool result and the UI renders it.
 */
let currentPlan: { readonly steps: readonly { readonly content: string; readonly status: PlanStepStatus }[] } | undefined;

/** The plan the model last set, if any. */
export const activePlan = (): typeof currentPlan => currentPlan;

/** The arguments of {@link submitPlanTool}. */
const submitPlanArgs = z.object({
  plan: z
    .string()
    .min(1)
    .describe("The plan, in markdown. Say what will change, in what order, and why."),
});

/** Propose a plan and ask the user to approve it. */
export const submitPlanTool: ToolDefinition<z.infer<typeof submitPlanArgs>> = {
  name: "submit_plan",
  description:
    "Present a plan for the work and ask the user to approve it. Use this in plan mode, or when a change is large enough that the user should agree to it first.",
  schema: submitPlanArgs,
  category: "control",
  subjectKind: "text",
  concurrencySafe: false,
  subject() {
    return "plan";
  },
  async execute(args): Promise<ToolResult> {
    return {
      ok: true,
      output: `The plan was presented to the user.\n\n${args.plan}`,
      data: { plan: args.plan },
    };
  },
};

/** Publish the plan and return it for display. */
export const updatePlanTool: ToolDefinition<z.infer<typeof updatePlanArgs>> = {
  name: "update_plan",
  description:
    "Record the plan for the work, one step per entry, with each step's status. Send the whole plan every time so the list stays accurate.",
  schema: updatePlanArgs,
  category: "control",
  subjectKind: "text",
  concurrencySafe: false,
  subject() {
    return "plan";
  },
  async execute(args): Promise<ToolResult> {
    currentPlan = { steps: args.steps };
    const lines = args.steps.map((step) => {
      const marker = step.status === "completed" ? "x" : step.status === "in_progress" ? ">" : " ";
      return `[${marker}] ${step.content}`;
    });
    return {
      ok: true,
      output: `The plan was updated.\n${lines.join("\n")}`,
      data: { steps: args.steps },
    };
  },
};

/** The arguments of {@link askUserTool}. */
const askUserArgs = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1).describe("The question to ask."),
        header: z.string().min(1).optional().describe("A short label for the question."),
        options: z
          .array(
            z.object({
              label: z.string().min(1).describe("The answer."),
              description: z.string().min(1).optional().describe("What the answer means."),
            }),
          )
          .min(1)
          .describe("The answers the user can choose from."),
        multi_select: z
          .boolean()
          .optional()
          .describe("Whether the user may pick more than one answer."),
      }),
    )
    .min(1)
    .describe("The questions to ask."),
});

/** Put a question to the user and wait for the answer. */
export const askUserTool: ToolDefinition<z.infer<typeof askUserArgs>> = {
  name: "ask_user",
  description:
    "Ask the user a question with a set of answers to choose from. Use this when the right choice is not yours to make.",
  schema: askUserArgs,
  category: "control",
  subjectKind: "text",
  concurrencySafe: false,
  subject() {
    return "question";
  },
  async execute(args, context): Promise<ToolResult> {
    if (context.askUser === undefined) {
      return {
        ok: false,
        error: flowError(
          "unsupported",
          "This session cannot ask the user a question.",
          {
            retryable: false,
            remediation: "Explain the choice in your reply instead, and stop for the user's answer.",
          },
        ),
      };
    }

    const answers: string[] = [];
    for (const question of args.questions) {
      const chosen = await context.askUser({
        question: question.question,
        ...(question.header === undefined ? {} : { header: question.header }),
        options: question.options,
        ...(question.multi_select === undefined
          ? {}
          : { multiSelect: question.multi_select }),
      });
      answers.push(`${question.question} → ${chosen.join(", ")}`);
    }

    return {
      ok: true,
      output: answers.join("\n"),
      data: { answers },
    };
  },
};
