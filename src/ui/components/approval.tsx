import { Box, Text } from "ink";
import React from "react";
import { oneLine } from "../../util/text.js";
import type { PendingApproval } from "../state.js";

/**
 * The permission prompt.
 *
 * The prompt takes over the input area rather than floating above it, because
 * a terminal interface has no reliable way to draw an overlay.
 */
export const ApprovalPrompt = ({
  approval,
}: {
  readonly approval: PendingApproval;
}): React.ReactElement => {
  const { request } = approval;
  const summary = oneLine(JSON.stringify(request.args ?? {}), 72);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        Allow {request.tool}?
      </Text>
      <Text dimColor wrap="wrap">
        {request.reason}
      </Text>
      {summary === "" ? null : (
        <Text dimColor wrap="wrap">
          {summary}
        </Text>
      )}
      <Box marginTop={1} gap={2}>
        <Text color="green">y</Text>
        <Text dimColor>allow once</Text>
        <Text color="green">a</Text>
        <Text dimColor>allow always</Text>
        <Text color="red">n</Text>
        <Text dimColor>refuse</Text>
        <Text color="red">d</Text>
        <Text dimColor>refuse always</Text>
        <Text dimColor>esc</Text>
        <Text dimColor>cancel</Text>
      </Box>
    </Box>
  );
};
