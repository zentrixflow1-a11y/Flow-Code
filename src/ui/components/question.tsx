import { Box, Text } from "ink";
import React from "react";
import type { PendingQuestion } from "../state.js";

/**
 * The question prompt.
 *
 * The model asked something, and the user picks an answer.
 */
export const QuestionPrompt = ({
  question,
}: {
  readonly question: PendingQuestion;
}): React.ReactElement => (
  <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
    <Text color="cyan" bold wrap="wrap">
      {question.question}
    </Text>
    <Box marginTop={1} flexDirection="column">
      {question.options.map((option, index) => (
        <Text key={option}>
          {index + 1}. {option}
        </Text>
      ))}
    </Box>
    <Box marginTop={1}>
      <Text dimColor>Type the number of your answer, or the answer itself.</Text>
    </Box>
  </Box>
);
