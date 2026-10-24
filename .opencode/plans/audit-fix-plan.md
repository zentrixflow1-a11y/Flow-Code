# Flow Code: Security & Reliability Fix Plan

## Goal

Address the real, high-value findings from the merged audit (FC-01..FC-33 + DOC-1..DOC-11) without rewriting the architecture. Ignore by-design/documentated items and unverified hypotheses. Keep the code typed, dependency-light, and every fix covered by a regression test that fails before the fix.

## Scope decisions (what to fix vs. ignore)

### Worth fixing (real bugs, data loss, or security gaps)

**P0 — Critical/High (fix first):**
1. FC-01: `/compact` data loss (Critical)
2. FC-05/FC-06: read-only classifier holes (High)
3. FC-09: log write queue poisoning (High)
4. FC-10: `webEnabled` dead switch (High)
5. FC-11: missing `--provider` forces ollama (High)
6. FC-07: cancellation theatre (High)
7. FC-08: no provider timeout (High)
8. FC-03: env inheritance (High)

**P1 — Medium (important, fix next):**
9. FC-14: symlink to secret (Medium)
10. FC-16: redaction gaps — MCP data, resume, setModel (Medium)
11. FC-18: glob traversal (Medium, verified real)
12. FC-19: temp file race (Medium)
13. FC-20: output truncation honesty (Medium)
14. FC-21: SSRF in web_fetch (Medium)
15. FC-22: MCP bridge (Medium)
16. FC-23: auto-compact/retry dead code (Medium)
17. FC-24: replay robustness (Medium)
18. FC-25: permission persistence (Medium)
19. FC-17: trust fingerprint (Medium)
20. FC-04: hooks bypass sandbox (Medium, tied to FC-02)

**P2 — Low/doc (fix if time permits):**
21. FC-28: URL credentials (Low)
22. FC-29: size caps (Low)
23. FC-32: unsafe-option gaps (Low)
24. DOC-1..DOC-11: documentation fixes

### Explicitly ignored (by design, documented, or not worth fixing)

- **FC-02** (shell not confined): documented by design. Sandbox is opt-in. README already says so. Not a bug.
- **FC-12** (MCP arbitrary processes): by design behind trust gate. Documented.
- **FC-13** (sandbox scope/network): documented. "Same everywhere" claim softened (DOC-7).
- **FC-15** (credential list gaps): extend list (P1) but "name-based detection only" is inherent; content scan is P3.
- **FC-26** (hostile .git/config): untested hypothetical. Test first, fix only if confirmed.
- **FC-27** (prompt injection): inherent to LLM systems. Document provenance, don't try to fully solve.
- **FC-29** (size caps): Low, nice-to-have. Defer.
- **FC-30** (restrictToOwner on Windows): platform limitation. Document.
- **FC-31** (lockfile drift): Low. Fix metadata, add CI.
- **FC-33** (memory cap): hypothesis, unverified. Defer.
- **FC-18**: verified real (glob traversal confirmed). Fix.

## Phase 1: Critical data loss (P0, no dependencies)

### 1.1 FC-01: /compact no-op data loss
- **Files**: `src/agent/session.ts` (compact method), `src/context/compactor.ts` (compactMessages)
- **Fix**: In `session.compact()`, check `result.droppedMessages === 0` → skip appending `compaction.end` event, return "Nothing to compact." Also in `compactMessages`, when `dropped.length === 0`, return early without producing a summary. Add guard in `deriveMessages` replay: if summary is empty, don't clear messages.
- **Test**: one-user-turn session through `compact()`, then verify next request still has original prompt.

### 1.2 FC-11: missing --provider forces ollama
- **Files**: `src/agent/session.ts` (buildOverrides)
- **Fix**: `provider: overrides.provider ?? ...` → only set provider when `overrides.provider !== undefined`.
- **Test**: loadConfig with no provider override keeps configured provider.

### 1.3 FC-09: log write queue poisoning
- **Files**: `src/session/log.ts` (append)
- **Fix**: catch per-write failure, count failures, continue queue. `flush()` resolves. Add `failedWrites` counter.
- **Test**: failing log write, then more events still written.

### 1.4 FC-10: webEnabled dead switch
- **Files**: `src/tools/index.ts`, `src/permissions/engine.ts`, `src/agent/session.ts`
- **Fix**: In `createDefaultRegistry`, conditionally register `webFetchTool` based on `config.webEnabled`. In permission engine, refuse `web_fetch` if `webEnabled` is false. Pass config through.
- **Test**: `webEnabled: false` → tool not advertised; call refused.

## Phase 2: Security classifier (P0, independent)

### 2.1 FC-05/FC-06: read-only classifier holes
- **Files**: `src/permissions/modes.ts`
- **Fix**: 
  - Reject any command containing `$` (any form: `$VAR`, `$()`, `${}`, `$env:`).
  - Reject `%VAR%` (cmd.exe expansion).
  - Parse short-flag clusters: any cluster containing `r` or `R` in grep/egrep/fgrep/diff → not read-only.
  - Handle `-d recurse`, `-drecurse`, `--directories=recurse`, `--directories recurse`.
  - `realpath` every path-like argument before sensitive check (coordinate with FC-14).
  - Prompt for any argument resolving outside workspace roots.
- **Test**: all listed bypasses return false.

### 2.2 FC-15/FC-32: extend credential list + unsafe options
- **Files**: `src/util/paths.ts` (SENSITIVE_FILE_PATTERNS, SENSITIVE_DIRECTORIES), `src/permissions/modes.ts` (UNSAFE_OPTIONS)
- **Fix**: Add missing credential patterns (`.config/gh/hosts.yml`, `.config/rclone/`, `.config/gcloud/`, `.bash_history`, `.zsh_history`, `.psql_history`, `.mysql_history`, `.python_history`, `.node_repl_history`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `.kube/`, `.docker/config.json`, `terraform.tfstate`, `*.tfvars`, `*.kdbx`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `.env~`, `.env.bak`, `.env.swp`, `shadow`, `environ`). Add `file -C`, `rg -z/--search-zip`, `rg --hostname-bin` to unsafe options.
- **Test**: each new path refused.

## Phase 3: Environment & cancellation (P0, independent)

### 3.1 FC-03: env inheritance
- **Files**: `src/tools/shell.ts`, `src/hooks/runner.ts`, `src/mcp/client.ts`
- **Fix**: Replace `...process.env` spread with an allowlist (PATH, HOME, USERPROFILE, LANG, LC_*, TERM, CI, NODE_ENV, TZ, COLORTERM, NO_COLOR). Merge `options.env` on top. Apply to shell, hooks, MCP stdio.
- **Test**: child process with AWS_SECRET_ACCESS_KEY set → variable absent.

### 3.2 FC-07: cancellation
- **Files**: `src/agent/loop.ts`, `src/cli/headless.ts`, `src/ui/run.tsx`, `src/tools/shell.ts`
- **Fix**: Create AbortController per run, wire to `options.signal`, pass to providers. Headless: SIGINT/SIGTERM → abort. UI: interrupt → abort. Shell: SIGKILL after 5s grace on process group. Use `detached: true` on Unix for process group.
- **Test**: mid-stream abort; TERM-trapping command.

### 3.3 FC-08: provider timeout
- **Files**: `src/providers/http.ts` (or openai-compatible.ts)
- **Fix**: 5-minute idle timeout, reset on each chunk. AbortSignal support.
- **Test**: stalled provider → idle timeout error.

## Phase 4: Redaction & data integrity (P1)

### 4.1 FC-16: redaction gaps
- **Files**: `src/tools/executor.ts`, `src/session/log.ts`, `src/agent/session.ts`
- **Fix**: Redact `result.data` (deep redact). Re-redact on `SessionLog.open`. Rebuild redactor on `setModel`.
- **Test**: MCP returns token in data → absent from context.

### 4.2 FC-24: replay robustness
- **Files**: `src/session/replay.ts`
- **Fix**: Null-check `event.data` and nested fields. Skip malformed events, count them.
- **Test**: corrupt user.message line → skipped and counted.

### 4.3 FC-01: /compact no-op
- **Files**: `src/agent/session.ts`, `src/context/compactor.ts`, `src/session/replay.ts`
- **Fix**: No-op when droppedMessages === 0. Don't append compaction.end. Guard deriveMessages against empty summary.
- **Test**: one-turn session compact → no data loss.

## Phase 5: Confinement & traversal (P1)

### 5.1 FC-18: glob traversal
- **Files**: `src/tools/search.ts`
- **Fix**: Reject `..` and absolute prefixes in pattern. Containment check on searchRoot. Test with ../, repeated parents, absolute, Windows separators, symlinks.
- **Test**: `../**` → rejected.

### 5.2 FC-14: symlink to secret
- **Files**: `src/agent/loop.ts` (decideFor), `src/util/paths.ts`
- **Fix**: realpath every path-like argument before sensitive check. Run sensitive check on resolved path.
- **Test**: `notes.txt → .env`: `cat notes.txt` → prompt.

### 5.3 FC-19: temp file race
- **Files**: `src/tools/fs.ts` (writeFileAtomically), `src/tools/shell.ts` (saveOutput)
- **Fix**: O_EXCL, O_NOFOLLOW, unpredictable name, restrictive mode.
- **Test**: pre-created symlink at predictable path → refused.

### 5.4 FC-20: output truncation honesty
- **Files**: `src/tools/shell.ts`
- **Fix**: Keep head+tail. Label clearly. Remove misleading "full output saved" or make it accurate.
- **Test**: output > cap → truncation explicit.

## Phase 6: Network & MCP (P1)

### 6.1 FC-21: SSRF
- **Files**: `src/tools/web.ts`
- **Fix**: Block private ranges (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1, fc00::/7). Re-check after redirect. Cap stream reader. DNS rebinding: resolve hostname, check IP.
- **Test**: loopback, private range, redirect-to-metadata, endless body.

### 6.2 FC-22: MCP bridge
- **Files**: `src/mcp/bridge.ts`, `src/mcp/client.ts`
- **Fix**: Validate args against schema. Sanitize tool names (alphanumeric + underscore/hyphen, length cap). Connect timeout. Merge `options.env`.
- **Test**: non-object args rejected; name with space sanitized.

### 6.3 FC-25: permission persistence
- **Files**: `src/agent/loop.ts`
- **Fix**: On `allow_always`/`deny_always`, call `session.rememberRule()` with the rule. Immediate in-run effect.
- **Test**: "Allow always" → rule persisted and active.

## Phase 7: Auto-compact & retry wiring (P1)

### 7.1 FC-23: wire dead code
- **Files**: `src/agent/loop.ts`, `src/agent/session.ts`
- **Fix**: Call `shouldCompact` before each turn using `estimateMessagesTokens` vs context window. Wrap provider call in `withRetry`. Cap summariser transcript.
- **Test**: long session triggers auto-compact.

## Phase 8: Trust & hooks (P1)

### 8.1 FC-17: trust fingerprint
- **Files**: `src/security/trust.ts`
- **Fix**: Hash hooks.json, mcp.json, agents/, FLOWCODE.md, AGENTS.md. Store fingerprint. Re-prompt on change. Show diff.
- **Test**: trusted project's hooks.json changes → re-evaluated.

### 8.2 FC-04: hooks through sandbox
- **Files**: `src/hooks/runner.ts`
- **Fix**: Route hook spawn through `wrapCommand` when sandbox available. Apply env filtering.
- **Test**: hook attempts write outside root → blocked.

## Phase 9: Documentation (P2)

### 9.1 DOC-1: mojibake test + fix
- **Files**: `tests/docs.test.ts`, `README.md`, `CHANGELOG.md`
- **Fix**: Extend test to catch single-code-point mojibake (é, ’). Fix both lines.

### 9.2 DOC-2: NOTICE license
- **Files**: `NOTICE`
- **Fix**: `@modelcontextprotocol/client` is Apache-2.0, not MIT.

### 9.3 DOC-3: webEnabled claim
- **Files**: `README.md` (or implement FC-10)
- **Fix**: Either implement gate (done in P0) or remove claim.

### 9.4 DOC-4: FLOWCODE_HOME
- **Files**: `README.md` or `src/config/load.ts`
- **Fix**: Implement env var or drop from docs.

### 9.5 DOC-5: cd path
- **Files**: `README.md`
- **Fix**: `cd Flow-Code`.

### 9.6 DOC-6: npm publish
- **Action**: `npm publish` or reorder install steps.

### 9.7 DOC-7: "same everywhere"
- **Files**: `README.md`, `CHANGELOG.md`
- **Fix**: Soften claim, list differences.

### 9.8 DOC-8: PLAN.md cleanup
- **Files**: `PLAN.md`
- **Fix**: Separate implemented/limitations/future.

### 9.9 DOC-9: trust re-check note
- **Files**: `README.md`
- **Fix**: Add under "Approving a tool".

### 9.10 DOC-10: wizard/doctor sandbox warning
- **Files**: `src/setup/wizard.ts`, `src/doctor.ts`
- **Fix**: Show sandbox state and recommendation.

### 9.11 DOC-11: THREAT_MODEL.md
- **Files**: new `THREAT_MODEL.md`
- **Fix**: Define trust boundaries, attacker capabilities, control mapping.

## Phase 10: Low-priority (P2/P3)

### 10.1 FC-28: URL credentials
- **Files**: `src/providers/http.ts` or error handling
- **Fix**: Strip userinfo from URLs in error messages.

### 10.2 FC-29: size caps
- **Files**: `src/tools/fs.ts`
- **Fix**: Cap content size for write_file/edit_file. ReDoS guard for grep.

### 10.3 FC-32: unsafe-option gaps
- **Files**: `src/permissions/modes.ts`
- **Fix**: Add `file -C`, `rg -z/--search-zip`, `rg --hostname-bin`.

## Dependencies

- Phase 1, 2, 3 are independent → can run in parallel.
- Phase 4 depends on Phase 1 (log redaction).
- Phase 5 depends on Phase 2 (sensitive paths).
- Phase 6 depends on Phase 3 (env) and Phase 5 (sandbox).
- Phase 7 depends on Phase 1 (compact).
- Phase 8 depends on Phase 6 (sandbox).
- Phase 9 is independent.
- Phase 10 is independent.

## Testing strategy

- Every fix gets a regression test that fails before the fix.
- Prefer end-to-end invariants over helper-level unit tests.
- Run `npm run check` after each phase.
- Final: full check + build + manual smoke test of headless mode.

## Verification

After all phases:
1. `npm run check` — all tests pass.
2. `npm run build` — clean.
3. Manual: `flowcode -p "read the readme"` against mock server → works.
4. Manual: hostile repo test → nothing runs.
5. Manual: `flowcode --version` → 0.7.0.
6. Manual: `flowcode /init` in a fresh repo → writes FLOWCODE.md.
7. Manual: session log mode 0600 (on Linux/macOS).
8. Manual: `flowcode doctor` → reports trust + sandbox state.
