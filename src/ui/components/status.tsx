import { Box, Text } from "ink";
import React from "react";
import type { StatusInfo } from "../state.js";

/** The status line: what the session is using, and what it is doing. */
export const StatusLine = ({
  status,
}: {
  readonly status: StatusInfo;
}): React.ReactElement => (
  <Box>
    <Text dimColor>
      {status.provider}
      {status.model === "" ? "" : `/${status.model}`}
      {"  ·  "}
      {status.cwd}
      {"  ·  "}
      {status.mode}
      {"  ·  "}
      {status.tokens} tokens
      {status.busy ? "  ·  working…" : ""}
    </Text>
  </Box>
);
