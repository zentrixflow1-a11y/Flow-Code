# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] â€” M7 (Hardening, documentation, release)

### Added

- **The tool-schema budget** (`src/tools/budget.ts`): the tool schemas are
  measured before they are sent, and the least important ones are left out
  when they are too large â€” with a message saying which ones and how to allow
  them.
- **The optional operating-system sandbox** (`src/security/sandbox.ts`):
  macOS's Seatbelt and Linux's bubblewrap, detected rather than assumed, and
  used only when `security.sandbox` is `"auto"`. There is no sandbox for
  native Windows, and the README says so.
- **The full README**: what it is, the install, the quick start with a local
  model, the configuration reference, the tools, the permissions, the slash
  commands, MCP, sub-agents, hooks, headless mode, sessions, project
  instructions, and troubleshooting.
- **A documentation test** (`tests/docs.test.ts`): the README, the `NOTICE`
  and the `LICENSE` are checked against the code, so a command or a tool that
  is not documented fails the build.
- **The quick start is verified in CI**: the packaged CLI is installed into a
  temporary prefix and carried out a task against a mock model server, which
  is exactly what the README tells a reader to do.

### Fixed

- **The path sandbox compared a resolved path with an unresolved root.** On
  macOS a temporary directory is reached through `/var`, which is a symlink to
  `/private/var`, so every file in the workspace was refused. Both sides are
  now resolved before they are compared. There is a regression test for it.
- The terminal interface tests waited for a fixed number of milliseconds for
  the first frame. They now wait for the frame itself, so they do not depend
  on how fast the machine draws.

### Notes and deviations from `PLAN.md`

- The **diagnostic output is plain ASCII** (`flowcode doctor`, `flowcode
  setup`). The live interface keeps its glyphs, but a report that gets pasted
  into an issue should survive a terminal with an old code page.
- The **`.gitignore` no longer excludes the whole `.flowcode/` directory.**
  Only the personal `config.local.json` is excluded; the shared
  configuration, the MCP servers, the agents and the rules are meant to be
  committed.
- The **`scripts/` directory ships with the package**, so that a reader who
  installed Flow Code from npm can still point it at the mock MCP server.

## [0.6.0] â€” M6 (MCP client, sub-agents, hooks)

### Added

- **The MCP client** (`src/mcp/`): reads the same `mcpServers` shape the rest
  of the ecosystem uses, from `.flowcode/mcp.json` and `~/.flowcode/mcp.json`,
  with the project winning per server. It connects over stdio and over
  streamable HTTP, lists the servers' tools, and offers them under Flow Code's
  own `mcp:<server>:<tool>` convention.
- **A mock MCP server** (`scripts/mock-mcp-server.mjs`): a scriptable server
  for checking a configuration without installing anything.
- **Sub-agents** (`src/agents/`): `.flowcode/agents/*.md` with a small
  frontmatter block. A sub-agent runs in its own context with its own tools
  and its own session log, and the parent sees only its final answer.
- **Hooks** (`src/hooks/`): six events â€” `session_start`,
  `user_prompt_submit`, `pre_tool_use`, `post_tool_use`,
  `post_tool_use_failure`, `session_end` â€” with a small protocol. The hook
  receives the event as JSON on standard input; exit code zero lets the
  action proceed and may add context for the model; exit code two blocks it
  and the standard error becomes the reason.
- **The `/mcp` command**: the servers, their tools, and the sub-agents.

### Notes and deviations from `PLAN.md`

- **MCP tools are gated as network calls.** A tool from a third-party server
  is code Flow Code did not write, so it is asked for like any other gated
  call, and `safe` mode refuses it.
- **A broken MCP server does not end the session.** It is reported in `/mcp`
  and the session carries on without it.
- **The hook protocol is smaller than Claude Code's.** Six events and two
  outcomes, and the context a hook adds is passed to the model with the tool
  result.

## [0.5.0] â€” M5 (Terminal interface, setup wizard, doctor)

### Added

- **The terminal interface** (`src/ui/`): a banner, a permanent transcript, a
  live streaming region, tool rows, the permission prompt, the question
  prompt, a plan panel, a status line, and an input box with history,
  slash-command completion and `@` file completion.
- **The interface state** (`src/ui/state.ts`): a plain observable store, so
  that the agent loop â€” which runs outside React â€” can push updates into the
  interface, and so that the model's text is buffered and drawn at a fixed
  rate instead of on every token.
- **The setup wizard** (`flowcode setup`): finds the model servers running on
  the machine, writes the configuration, and needs no API key for a local
  server.
- **The health check** (`flowcode doctor`): strictly read-only. It reports the
  configuration, the provider, the connection, the model, the tool budget, the
  permissions and the session directory.
- **The interactive session** is now what `flowcode` starts.

### Notes and deviations from `PLAN.md`

- **The input keeps the text and the cursor in refs as well as in state.** A
  key pressed straight after another one would otherwise be handled against a
  stale value, and the last character typed before Enter could be lost.
- **The plan panel and the question prompt** are in v1. The plan was not in
  the plan's list of components, but the `update_plan` and `ask_user` tools
  need somewhere to show their output.
- The **TUI was tested through a stand-in terminal** rather than a real pty, so
  that it can be tested in CI on every platform. A pty is a native module and
  would have made the test suite depend on one.

## [0.4.0] â€” M4 (Agent loop, commands, headless mode)

### Added

- **The agent loop** (`src/agent/loop.ts`): turn â†’ model â†’ tools â†’ repeat, with
  cancellation, a turn limit, and a batch that contains a tool which is not
  concurrency-safe running entirely in order.
- **The session object** (`src/agent/session.ts`): owns the configuration, the
  provider, the tool registry and the session log, and drives the agent over
  them. Both the terminal UI and the headless mode use it, so they behave
  identically.
- **Configuration** (`src/config/`): four scopes with a documented precedence,
  lists that merge, environment and command-line overrides, and a
  credentials file that stores references rather than values.
- **Slash commands** (`src/commands/`): `/help`, `/model`, `/clear`,
  `/compact`, `/status`, `/config`, `/permissions`, `/tools`, `/plan` and
  `/exit`.
- **Headless mode** (`flowcode -p <task>`): one task, no terminal UI, with
  `--output-format json` for a machine-readable envelope.
- **Provider factory** (`src/providers/factory.ts`): builds the provider the
  configuration asks for, resolving the credential from the environment or the
  credentials file.

### Notes and deviations from `PLAN.md`

- The **session log** keeps the compaction summary as an event rather than
  rewriting the log, and the derived view honours it. The log stays
  append-only; what changes is the view of it.
- The **headless mode** refuses a tool call that would need approval unless
  `--yes` is given or the mode is `trust`. Reading files still works, because
  reads are allowed by default.
- The **plan command** was not in the plan's command list in this form; it
  was added because plan mode is a mode the permission engine already
  enforces.

## [0.3.0] â€” M2 (Tool system and permission engine)

### Added

- **Permission engine** (`src/permissions/`): a pure decision function with an
  exhaustive test suite. The order is the security contract: hard ceilings,
  then deny, then ask, then allow, then the mode's default. Rules can only
  tighten the outcome.
- **Rule syntax** (`tool:specifier`), Flow Code's own: `run_command:npm run *`,
  `read_file:./secrets/**`, `web_fetch:domain:example.com`, `mcp:github:*`.
- **Permission modes** (`src/permissions/modes.ts`): `ask`, `accept_edits`,
  `plan`, `safe`, `trust`. `plan` and `safe` impose ceilings no rule can lift.
- **Path sandbox** (`src/util/paths.ts`): symlink-aware confinement to the
  workspace, with protected paths for `.git`, `.flowcode`, credential files and
  `.env` files.
- **Secret redaction** (`src/util/redact.ts`): declared values plus a
  conservative set of well-known credential shapes, applied to tool output,
  error messages and logs.
- **Thirteen built-in tools** (`src/tools/`): `read_file`, `write_file`,
  `edit_file`, `list_dir`, `glob_files`, `grep_files`, `run_command`,
  `read_command_output`, `stop_command`, `web_fetch`, `update_plan`,
  `submit_plan`, `ask_user`.
- **Tool framework** (`src/tools/`): Zod schemas as the single source of truth
  for validation and JSON Schema, a registry, and an executor that redacts and
  caps output and turns a thrown error into a result the model can read.
- **A second enforcement layer** (`src/tools/guard.ts`): the host's guard is
  applied inside the tools themselves, so the `safe` and `plan` ceilings hold
  even if the decision upstream were wrong.

### Notes and deviations from `PLAN.md`

- **Path rule arithmetic is platform-neutral.** Rules are written with forward
  slashes and are resolved with POSIX semantics on every platform, so a rule
  behaves the same on Windows and on Linux. A leading `/` anchors at the
  workspace root, `//` means a filesystem-absolute path, and `~` is
  home-relative.
- **Writes are confined in every mode, including `trust`.** `trust` relaxes
  prompting, never confinement. This is a deliberate strengthening of the
  plan's wording.
- `edit_file` and `write_file` write **atomically** (temporary file, then
  rename), which the plan did not specify.
- The search tools walk the tree themselves instead of shelling out to `rg` or
  `find`, so the harness does not depend on a search binary being installed.

## [0.2.0] â€” M1 (Provider layer)

### Added

- **Provider contract** (`src/providers/types.ts`): `ModelProvider`, `ChatRequest`,
  `ChatMessage`, `ToolCall`, `ProviderEvent`, and a discriminated `FinishReason`.
- **OpenAI-compatible adapter** (`src/providers/openai-compatible.ts`): one
  adapter for Ollama, LM Studio, llama.cpp, vLLM, DeepSeek, OpenRouter, Groq,
  Together, Cerebras, Mistral, OpenAI, and any gateway.
- **Anthropic Messages adapter** (`src/providers/anthropic.ts`) for the
  `anthropic` preset.
- **Compatibility flags** (`src/providers/compat.ts`): `developerRole`,
  `maxTokensField`, `strictToolSchema`, `parallelToolCalls`, `toolResultRole` â€”
  the small differences between servers, expressed as configuration instead of
  forked code paths.
- **Provider presets** (`src/providers/presets.ts`): thirteen built-ins, four of
  them local and keyless.
- **SSE decoder** (`src/providers/sse.ts`): an incremental, transport-agnostic
  decoder.
- **Tool-call assembler** (`src/providers/tool-calls.ts`): reassembles a tool
  call that arrives split across many chunks.
- **Model discovery** (`src/providers/discovery.ts`): the OpenAI `/models`
  shape and Ollama's native `/api/tags` fallback.
- **Retry with backoff** (`src/providers/retry.ts`): only retryable failures
  are retried; an authentication failure is never retried.
- **Mock provider server** (`scripts/mock-llm.mjs`): a scriptable
  OpenAI-compatible endpoint that reconstructs its position from the
  conversation rather than a request counter, so the whole loop can be
  exercised with no model and no API key.

### Notes and deviations from `PLAN.md`

- The MCP client SDK is pinned to **v2** (`@modelcontextprotocol/client@2.3.1`),
  whose entry points are `@modelcontextprotocol/client` and
  `@modelcontextprotocol/client/stdio`. The v1 layout
  (`@modelcontextprotocol/sdk/client/*`) is not used. A test pins the export
  map so an upgrade cannot break the imports silently.
- `strictToolSchema` defaults to **off**. The OpenAI `strict` flag demands that
  every property be listed as required, which Flow Code's tool schemas do not
  do, and many servers reject the request when they see it.
- The provider layer was implemented with **Zod 4.6** and **TypeScript 7**,
  newer than the versions named in `PLAN.md`.

## [0.1.0] â€” M0 (Foundations)

### Added

- Project scaffold: strict TypeScript (`NodeNext` ESM), Vitest, CI matrix
  (Node 20/22/24 Ã— ubuntu/macos/windows).
- MIT `LICENSE` and a `NOTICE` recording the clean-room process and the
  third-party dependency inventory.
- Hand-designed logo assets in `assets/`: `logo.svg` (full lockup),
  `logo-mark.svg` (icon), `logo-dark.svg` and `logo-light.svg`
  (background variants), and `favicon.svg`.
- `flowcode --version` and `flowcode --help` on a small argument parser that
  will grow into the full command registry.

### Notes and deviations from `PLAN.md`

- **npm package name.** `PLAN.md` Â§12 asked whether to publish as `flowcode`.
  The `flowcode` name on npm is already taken by an unrelated project
  ("Tools for building dataflow graphs"), so the package is published as
  **`flow-code-cli`** and the executable stays **`flowcode`**, per the review
  note on open question 1. `flow-code` and `flow-code-cli` were both
  unregistered at the time of this decision.
- **Repository URL.** `package.json` currently points at a placeholder
  `https://github.com/zentrixflow1-a11y/Flow-Code`. Replace it with the real
  repository slug before publishing.
- **Copyright line.** `LICENSE` uses `The Flow Code Authors` as the copyright
  holder. Change it if the project is published under a different name or by a
  named individual.

[Unreleased]: https://github.com/zentrixflow1-a11y/Flow-Code/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/zentrixflow1-a11y/Flow-Code/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/zentrixflow1-a11y/Flow-Code/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/zentrixflow1-a11y/Flow-Code/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/zentrixflow1-a11y/Flow-Code/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/zentrixflow1-a11y/Flow-Code/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/zentrixflow1-a11y/Flow-Code/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zentrixflow1-a11y/Flow-Code/releases/tag/v0.1.0
