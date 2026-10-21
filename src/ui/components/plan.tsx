import { Box, Text } from "ink";
import React from "react";
import type { PlanStep } from "../types.js";

/** The plan panel: what the agent intends to do. */
export const PlanPanel = ({
  steps,
}: {
  readonly steps: readonly PlanStep[];
}): React.ReactElement => (
  <Box flexDirection="column" marginTop={1}>
    <Text dimColor>Plan</Text>
    {steps.map((step, index) => (
      <Text
        key={`${index}-${step.content}`}
        color={step.status === "completed" ? "green" : step.status === "in_progress" ? "yellow" : undefined}
      >
        {step.status === "completed" ? "[x]" : step.status === "in_progress" ? "[>]" : "[ ]"}{" "}
        {step.content}
      </Text>
    ))}
  </Box>
);
