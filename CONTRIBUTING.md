# Contributing to Flow Code

Thanks for your interest. This document explains how to set up a development
environment, what the project expects of a change, and what is deliberately out
of scope.

## Development setup

```bash
git clone https://github.com/zentrixflow1-a11y/Flow-Code.git
cd flow-code
npm ci
npm run typecheck
npm test
```

Requirements: **Node.js 22 or newer**. There are no native modules, so no
compiler or build toolchain is needed.

### Everyday commands

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Type-checks the whole project with `tsc --noEmit` |
| `npm test` | Runs the Vitest suite once |
| `npm run test:watch` | Runs Vitest in watch mode |
| `npm run test:coverage` | Runs the suite with a coverage report |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm run check` | Typecheck plus tests Ã¢â‚¬â€ run this before opening a PR |
| `npm pack` | Builds the publishable tarball |

### Testing conventions

Tests are colocated with the code they cover, in `src/**/*.test.ts`. Tests that
span several modules live under `tests/`.

Flow Code uses a **depth ladder**, and a test should sit at the shallowest
depth that still proves the claim:

| Depth | Location | Proves |
| --- | --- | --- |
| Unit | `src/**/*.test.ts` | One pure module through its public surface |
| Integration | `tests/integration/` | One real I/O boundary (filesystem, process, network) |
| End to end | `tests/e2e/` | The real `flowcode` executable, start to finish |

Two rules that matter:

- **Pure modules stay pure.** Anything in `src/permissions`, `src/session`,
  `src/context`, `src/providers`, and `src/config` must be testable without
  touching the filesystem, the network, or the clock. If a module needs one of
  those, it belongs behind a port.
- **A missing dependency is not a pass.** A test that needs a real Ollama, a
  real MCP server, or a real key must report *skipped*, clearly distinct from
  *passed*.

`scripts/mock-llm.mjs` is a scriptable OpenAI-compatible server used by the
end-to-end tests. It needs no model and no API key, so the full loop Ã¢â‚¬â€ model
call, tool call, permission prompt, tool result Ã¢â‚¬â€ is exercised in CI.

## Code style

- **TypeScript, strict mode.** `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noImplicitReturns`, `noUnusedLocals`, and
  `noUnusedParameters` are all on. Do not weaken them.
- **`NodeNext` ESM.** Relative imports carry the `.js` extension.
- **Discriminated unions over optional fields** wherever a value has a small
  set of shapes. A missing case should be a compile error, not a runtime
  surprise.
- **Prefer a typed error algebra over exceptions** at boundaries that can fail
  for expected reasons (parse failures, permission refusals, provider errors).
  Reserve `throw` for genuine bugs.
- **Comment the *why*, not the *what*.** A comment should explain a decision,
  a constraint, or a surprising behaviour Ã¢â‚¬â€ not restate the code.
- **No dependencies without a reason.** Flow Code ships five runtime
  dependencies on purpose. Adding a sixth needs a strong justification in the
  pull request.

## Clean-room rule

This project is an **original implementation**. It contains no source code,
system prompts, internal strings, or assets from Claude Code, Anthropic, or
any other proprietary product.

- If you consult a third-party product's documentation to understand its
  **observable behaviour**, that is fine Ã¢â‚¬â€ and you should say so in the pull
  request.
- Do **not** copy code, prompt text, or string tables from any source, whether
  proprietary or merely permissively licensed.
- Everything you add must be your own work, or properly attributed with the
  license it comes under.

## Scope

Flow Code is a **local-first terminal harness**. Helpful contributions are
welcome in these areas:

- Providers and model compatibility
- Tools, permission rules, and the security model
- Session persistence, context management, and compaction
- The terminal UI
- MCP client support
- Cross-platform correctness (Windows, macOS, Linux)
- Documentation, tests, and developer experience

Contributions that are **out of scope** and will not be merged:

- Anything that obscures what the agent did or what it was allowed to do
- Credential harvesting, persistence, or evasion
- Undisclosed network calls, telemetry, or analytics
- Bundling proprietary models, prompts, or assets

## Pull requests

1. Open an issue first for anything substantial, so the design can be agreed
   before the code is written.
2. Keep the change focused. Unrelated refactors make review harder.
3. Make sure `npm run check` passes.
4. Describe what you changed and how you verified it. **Never report a check
   you did not run as passing.**
5. Note any deviation from `PLAN.md`, and update `CHANGELOG.md`.

## License

By contributing, you agree that your contributions are licensed under the MIT
License that covers this project.
