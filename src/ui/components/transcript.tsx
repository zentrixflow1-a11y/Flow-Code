import { Box, Text } from "ink";
import React from "react";
import type { TranscriptItem } from "../state.js";

/** The permanent transcript: everything that has already happened. */
export const Transcript = ({
  items,
}: {
  readonly items: readonly TranscriptItem[];
}): React.ReactElement => (
  <Box flexDirection="column">
    {items.map((item) => (
      <TranscriptEntry key={item.id} item={item} />
    ))}
  </Box>
);

/** One entry of the transcript. */
const TranscriptEntry = ({
  item,
}: {
  readonly item: TranscriptItem;
}): React.ReactElement => {
  switch (item.kind) {
    case "user":
      return (
        <Text color="cyan" wrap="wrap">
          › {item.text}
        </Text>
      );

    case "assistant":
      return (
        <Text wrap="wrap">{item.text}</Text>
      );

    case "tool":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={item.tool?.status === "failed" ? "red" : "yellow"}>
            {item.tool?.status === "failed" ? "✗" : "•"} {item.tool?.name}
          </Text>
          {item.text.trim() === "" ? null : (
            <Text dimColor wrap="wrap">
              {item.text}
            </Text>
          )}
        </Box>
      );

    case "error":
      return (
        <Text color="red" wrap="wrap">
          {item.text}
        </Text>
      );

    case "notice":
      return (
        <Text dimColor wrap="wrap">
          {item.text}
        </Text>
      );
  }
};
