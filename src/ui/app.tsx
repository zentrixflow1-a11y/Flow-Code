import { Box, Text, useApp, useInput } from "ink";
import React, { useSyncExternalStore } from "react";
import { ApprovalPrompt } from "./components/approval.js";
import { InputBox, type SuggestibleCommand } from "./components/input.js";
import { PlanPanel } from "./components/plan.js";
import { QuestionPrompt } from "./components/question.js";
import { StatusLine } from "./components/status.js";
import { Stream } from "./components/stream.js";
import { Transcript } from "./components/transcript.js";
import { BANNER_LINES } from "./banner.js";
import type { UiState } from "./state.js";

/** The application. */
export interface AppProps {
  /** The interface's state. */
  readonly state: UiState;
  /** The commands the input can suggest. */
  readonly commands: readonly SuggestibleCommand[];
  /** The user sent a message. */
  readonly onSubmit: (text: string) => void;
  /** The user asked to interrupt the current turn. */
  readonly onInterrupt: () => void;
  /** The user asked to leave. */
  readonly onExit: () => void;
  /** Find files that match a fragment. */
  readonly suggestFiles: (fragment: string) => Promise<readonly string[]>;
  /** Whether the banner should be shown. */
  readonly showBanner: boolean;
}

/**
 * The Flow Code terminal interface.
 */
export const App = ({
  state,
  commands,
  onSubmit,
  onInterrupt,
  onExit,
  suggestFiles,
  showBanner,
}: AppProps): React.ReactElement => {
  const { exit } = useApp();
  useSyncExternalStore(state.subscribe, () => state.version);

  const approval = state.approval;
  const question = state.question;
  const busy = state.status.busy;

  // The permission and question prompts are answered with the keyboard, so
  // they are handled here rather than in the prompt components.
  useInput(
    (input, key) => {
      if (approval !== undefined) {
        if (input === "y") {
          state.answerApproval({ kind: "allow" });
        } else if (input === "a") {
          state.answerApproval({ kind: "allow_always" });
        } else if (input === "n") {
          state.answerApproval({ kind: "deny" });
        } else if (input === "d") {
          state.answerApproval({ kind: "deny_always" });
        } else if (key.escape) {
          state.answerApproval({ kind: "deny" });
        }
        return;
      }

      if (question !== undefined) {
        const index = Number.parseInt(input, 10);
        if (Number.isInteger(index) && index >= 1 && index <= question.options.length) {
          state.answerQuestion(question.options[index - 1] as string);
          return;
        }
        if (input !== "" && !key.ctrl && !key.meta) {
          state.answerQuestion(input);
        }
      }
    },
    { isActive: approval !== undefined || question !== undefined },
  );

  return (
    <Box flexDirection="column">
      {showBanner ? <Banner /> : null}

      <Transcript items={state.transcript} />

      <Stream text={state.streaming} reasoning={state.reasoning} busy={busy} />

      {state.plan === undefined ? null : <PlanPanel steps={state.plan} />}

      {approval !== undefined ? (
        <ApprovalPrompt approval={approval} />
      ) : question !== undefined ? (
        <QuestionPrompt question={question} />
      ) : (
        <InputBox
          onSubmit={onSubmit}
          onInterrupt={onInterrupt}
          onExit={() => {
            onExit();
            exit();
          }}
          commands={commands}
          suggestFiles={suggestFiles}
          disabled={busy}
        />
      )}

      <Box marginTop={1}>
        <StatusLine status={state.status} />
      </Box>
    </Box>
  );
};

/** The startup banner. */
const Banner = (): React.ReactElement => (
  <Box flexDirection="column" marginBottom={1}>
    {BANNER_LINES.map((line, index) => (
      <Text key={index} color="cyan" dimColor>
        {line}
      </Text>
    ))}
  </Box>
);
