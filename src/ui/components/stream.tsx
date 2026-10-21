import { Box, Text } from "ink";
import React from "react";

/**
 * The live region: the text the model is producing right now.
 *
 * The buffer is updated far faster than a terminal can draw it, so this
 * component is only re-rendered at a fixed rate.
 */
export const Stream = ({
  text,
  reasoning,
  busy,
}: {
  readonly text: string;
  readonly reasoning: string;
  readonly busy: boolean;
}): React.ReactElement => {
  if (!busy && text === "" && reasoning === "") {
    return <></>;
  }

  return (
    <Box flexDirection="column">
      {reasoning === "" ? null : (
        <Text dimColor wrap="wrap">
          {reasoning}
        </Text>
      )}
      {text === "" ? null : (
        <Text wrap="wrap">{text}</Text>
      )}
    </Box>
  );
};
