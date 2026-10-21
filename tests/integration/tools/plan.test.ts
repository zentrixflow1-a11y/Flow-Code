/**
 * The session tools: the plan, the plan-mode exit, and asking the user.
 */
import { describe, expect, it } from "vitest";
import { executeTool } from "../../../src/tools/executor.js";
import { askUserTool, submitPlanTool, updatePlanTool } from "../../../src/tools/plan.js";
import type { ToolContext } from "../../../src/tools/types.js";

const baseContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  cwd: process.cwd(),
  workspaceRoot: process.cwd(),
  additionalDirectories: [],
  env: process.env,
  redact: (text) => text,
  platform: process.platform,
  caseInsensitivePaths: process.platform === "win32",
  ...overrides,
});

describe("update_plan", () => {
  it("records the plan and shows it", async () => {
    const result = await executeTool(
      updatePlanTool,
      {
        steps: [
          { content: "Inspect the repository", status: "in_progress" },
          { content: "Run the tests", status: "pending" },
        ],
      },
      baseContext(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("[>] Inspect the repository");
      expect(result.output).toContain("[ ] Run the tests");
    }
  });

  it("refuses an empty plan", async () => {
    const result = await executeTool(updatePlanTool, { steps: [] }, baseContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_request");
    }
  });
});

describe("submit_plan", () => {
  it("returns the plan for the user to see", async () => {
    const result = await executeTool(
      submitPlanTool,
      { plan: "1. Read the file\n2. Change it" },
      baseContext(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("1. Read the file");
    }
  });
});

describe("ask_user", () => {
  it("puts the question to the host and returns the answer", async () => {
    const asked: string[] = [];
    const result = await executeTool(
      askUserTool,
      {
        questions: [
          {
            question: "Which approach?",
            header: "Approach",
            options: [
              { label: "Rewrite", description: "Start over" },
              { label: "Patch", description: "Change little" },
            ],
          },
        ],
      },
      baseContext({
        askUser: async (question) => {
          asked.push(question.question);
          return ["Patch"];
        },
      }),
    );

    expect(asked).toEqual(["Which approach?"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toContain("Which approach? → Patch");
    }
  });

  it("reports when the session cannot ask", async () => {
    const result = await executeTool(
      askUserTool,
      { questions: [{ question: "Which?", options: [{ label: "A" }] }] },
      baseContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unsupported");
    }
  });
});
