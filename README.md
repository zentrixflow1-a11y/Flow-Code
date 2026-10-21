<div align="center">

<img src="assets/logo.svg" alt="Flow Code" width="320" />

# Flow Code

**A local-first terminal AI coding harness. Bring your own model Ã¢â‚¬â€ local or hosted.**

[![License: MIT](https://img.shields.io/badge/License-MIT-22d3ee.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)

</div>

---

Flow Code is a terminal agent for software work. It runs entirely on your
machine, talks to a model **you** choose, and gives you file editing, shell
execution, search and MCP tools behind a permission prompt you control.

**If you have a local model, you never need an API key.**

```bash
npm i -g flow-code-cli
flowcode
```

The first run finds the model servers on your machine and walks you through
picking one.

---

## Contents

- [What it is](#what-it-is)
- [Status](#status)
- [Install](#install)
- [Quick start with a local model](#quick-start-with-a-local-model)
- [Using a hosted provider](#using-a-hosted-provider)
- [Configuration](#configuration)
- [The tools](#the-tools)
- [Permissions](#permissions)
- [Slash commands](#slash-commands)
- [MCP servers](#mcp-servers)
- [Sub-agents](#sub-agents)
- [Hooks](#hooks)
- [Headless mode](#headless-mode)
- [Sessions](#sessions)
- [Project instructions](#project-instructions)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Name, ownership and licence](#name-ownership-and-licence)

---

## What it is

Flow Code is a **loop**: it sends your request to a model, the model asks for
tools, Flow Code runs them behind a permission check, and the results go back
to the model. That is the whole product.

It is deliberately small and local-first:

- **Your model, your machine.** Ollama, LM Studio, llama.cpp, vLLM, DeepSeek,
  OpenRouter, Anthropic, OpenAI, or any OpenAI-compatible endpoint. Local
  models need no key and no account.
- **Your files, your rules.** Every tool call is checked against your
  permission rules before it runs. A rule that says "never" is never run.
- **Your session.** Conversations are append-only JSONL under
  `~/.flowcode/sessions`, so you can read them, keep them, and resume them.
- **Nothing phoning home.** There is no telemetry and no account. The only
  network traffic is to the model provider you configured and to whatever MCP
  servers you enabled.

---

## Status

Flow Code is young and honest about it. What works today:

| Area | State |
| --- | --- |
| Provider layer (OpenAI-compatible, Anthropic) | Working |
| Fourteen built-in tools, with permission checks | Working |
| Permission engine, five modes, path sandbox, secret redaction | Working |
| Session log, resume, fork, compaction | Working |
| Terminal interface, streaming, permission prompts, plan mode | Working |
| Headless mode (`flowcode -p`) | Working |
| Setup wizard and `flowcode doctor` | Working |
| MCP client, sub-agents, hooks | Working |
| Operating-system sandbox | Opt-in; macOS and Linux only |

See [`CHANGELOG.md`](./CHANGELOG.md) for the detail, and
[`PLAN.md`](./PLAN.md) for the design.

---

## Install

**Requirements:** Node.js 22 or newer. No compiler, no native modules.

```bash
npm i -g flow-code-cli
```

Or run it without installing:

```bash
npx flow-code-cli
```

From a checkout:

```bash
git clone https://github.com/zentrixflow1-a11y/Flow-Code.git
cd flow-code
npm install
npm run build
node dist/cli.js
```

---

## Quick start with a local model

**1. Start a model server.** Any of these work:

| Server | Start it with | The base URL |
| --- | --- | --- |
| [Ollama](https://ollama.com) | `ollama serve` | `http://127.0.0.1:11434/v1` |
| [LM Studio](https://lmstudio.ai) | start the local server | `http://127.0.0.1:1234/v1` |
| llama.cpp | `llama-server -m model.gguf` | `http://127.0.0.1:8080/v1` |
| vLLM | `vllm serve <model>` | `http://127.0.0.1:8000/v1` |

**2. Pull or load a model.** With Ollama, for example:

```bash
ollama pull qwen2.5-coder:7b
```

**3. Run Flow Code.**

```bash
flowcode
```

The first run asks which model to use, writes `~/.flowcode/config.json`, and
drops you into a session. No key is asked for, because a local server does not
want one.

**4. Ask for something.**

```text
Ã¢â‚¬Âº find every place we log a password and tell me which ones are safe
```

To pick a model later, use `/model`. To check everything is wired up, run
`flowcode doctor`:

```
Flow Code doctor

  [ok] Configuration  provider ollama, mode ask
  [ok] Provider       Ollama at http://127.0.0.1:11434/v1
  [ok] Connection     4 models available
  [ok] Tools          14 tools, 8.9 KiB of schema (budget 23.4 KiB)
  [ok] Permissions    0 allow, 0 ask, 18 deny
  [ok] Sessions       stored in ~/.flowcode/sessions

Everything looks fine.
```

---

## Using a hosted provider

Set the provider and the model, and give Flow Code the key through the
environment:

```bash
export DEEPSEEK_API_KEY=sk-...
flowcode --provider deepseek --model deepseek-chat
```

Or put it in `~/.flowcode/config.json`:

```json
{
  "provider": {
    "provider": "deepseek",
    "model": "deepseek-chat"
  }
}
```

The key itself is never written to the configuration file. Flow Code looks for
it in the environment variable named by `apiKeyEnv`, and falls back to
`~/.flowcode/credentials.json` (created with `0600` permissions) if you put it
there.

The built-in presets are `ollama`, `lmstudio`, `llamacpp`, `vllm`, `deepseek`,
`openrouter`, `openai`, `anthropic`, `groq`, `together`, `cerebras`, `mistral`
and `custom`. `custom` is any OpenAI-compatible endpoint:

```json
{
  "provider": {
    "provider": "custom",
    "baseUrl": "https://my-gateway.example/v1",
    "model": "my-model",
    "apiKeyEnv": "MY_GATEWAY_KEY"
  }
}
```

---

## Configuration

Configuration comes from four places. The one that wins is the highest:

```
command line  >  environment  >  .flowcode/config.local.json  >  .flowcode/config.json
              >  ~/.flowcode/config.local.json  >  ~/.flowcode/config.json  >  defaults
```

| File | Who it is for |
| --- | --- |
| `~/.flowcode/config.json` | You, on this machine, everywhere |
| `~/.flowcode/config.local.json` | You, on this machine, this project only |
| `.flowcode/config.json` | The project Ã¢â‚¬â€ commit it, so your team shares it |
| `.flowcode/config.local.json` | You, this project Ã¢â‚¬â€ do not commit it |

`config.local.json` is the personal one; add it to `.gitignore`. Permission
rule *lists* merge across all four files, so a project can add a rule without
removing yours. Everything else is replaced by the higher-precedence file.

### The whole configuration

```json
{
  "provider": {
    "provider": "ollama",
    "baseUrl": "http://127.0.0.1:11434/v1",
    "model": "qwen2.5-coder:7b",
    "apiKeyEnv": "OLLAMA_API_KEY"
  },
  "permissions": {
    "mode": "ask",
    "allow": ["run_command:npm test *", "run_command:npm run lint *"],
    "ask": [],
    "deny": ["write_file:**/secrets/**"],
    "additionalDirectories": ["../shared-library"]
  },
  "tools": {
    "maxToolSchemaBytes": 24000,
    "serialiseMixedBatches": true,
    "commandTimeoutMs": 120000
  },
  "context": {
    "autoCompactRatio": 0.8,
    "keepTurns": 6,
    "defaultContextWindow": 32000
  },
  "security": {
    "sandbox": "off"
  },
  "webEnabled": false,
  "shell": "powershell"
}
```

### What each setting does

| Setting | Meaning |
| --- | --- |
| `provider.provider` | The preset to use: `ollama`, `lmstudio`, `llamacpp`, `vllm`, `deepseek`, `openrouter`, `openai`, `anthropic`, `groq`, `together`, `cerebras`, `mistral`, `custom` |
| `provider.baseUrl` | Where the provider lives. For `custom`, this is required |
| `provider.model` | The model to talk to |
| `provider.apiKeyEnv` | The environment variable that holds the key |
| `permissions.mode` | `ask`, `accept_edits`, `plan`, `safe` or `trust` |
| `permissions.allow` / `ask` / `deny` | The permission rules. See [Permissions](#permissions) |
| `permissions.additionalDirectories` | Extra directories the session may read and write |
| `tools.maxToolSchemaBytes` | The largest the tool schemas may be. See [The tools](#the-tools) |
| `tools.serialiseMixedBatches` | Whether a turn that mixes read-only and changing tools runs entirely in order |
| `tools.commandTimeoutMs` | The longest a shell command may run for |
| `context.autoCompactRatio` | How full the context window may get before the conversation is compacted |
| `context.keepTurns` | How many of the most recent turns a compaction keeps verbatim |
| `context.defaultContextWindow` | The window to assume when the model does not say |
| `security.sandbox` | `auto` to run commands in the operating system's sandbox, `off` to leave them alone |
| `webEnabled` | Whether `web_fetch` may be used |
| `shell` | `powershell`, `cmd` or `bash` Ã¢â‚¬â€ the platform default when unset |

### Environment variables

| Variable | Meaning |
| --- | --- |
| `FLOWCODE_PROVIDER` | The provider preset |
| `FLOWCODE_MODEL` | The model |
| `FLOWCODE_BASE_URL` | The provider's base URL |
| `FLOWCODE_API_KEY` | The API key, when the provider uses one |
| `FLOWCODE_PERMISSION_MODE` | The permission mode |
| `FLOWCODE_HOME` | Where Flow Code keeps its configuration and sessions |

---

## The tools

Fourteen tools come with Flow Code. The model chooses when to use them; you
decide whether they are allowed.

| Tool | What it does |
| --- | --- |
| `read_file` | Read a text file, with line numbers, a part of it at a time if you like |
| `write_file` | Create a file, or replace it entirely. Written atomically |
| `edit_file` | Replace an exact piece of text. The text must be unique, so a file cannot be corrupted by accident |
| `list_dir` | List a directory, with the size of each entry |
| `glob_files` | Find files by path pattern, such as `**/*.ts` |
| `grep_files` | Search file contents with a regular expression |
| `run_command` | Run a shell command. Each call is a fresh shell |
| `read_command_output` | Read the output of a command running in the background |
| `stop_command` | Stop a background command |
| `web_fetch` | Fetch a web page and return it as text. Off unless you enable it |
| `update_plan` | Record the plan for the work, and show it as a panel |
| `submit_plan` | Present a plan and ask for it to be approved |
| `ask_user` | Ask you a question with a set of answers to choose from |
| `spawn_agent` | Hand the work to a sub-agent, which has its own context and tools |

### The tool-schema budget

Every tool the model can see costs context, and it is paid on **every**
request. Flow Code measures the schemas it is about to send, and if they are
larger than `tools.maxToolSchemaBytes` (24 KB by default) it leaves the least
important tools out and tells you which ones:

> The tool schemas were too large, so 2 tools were left out: mcp:github:create_issue, mcp:github:list_issues. Add a permission rule to allow them, or raise 'tools.maxToolSchemaBytes'.

The built-in tools are kept; the MCP servers that were added last go first.

---

## Permissions

Nothing happens without the permission engine's say-so. Every tool call is
matched against three lists of rules.

### The rule syntax

```
<tool>[:<specifier>]
```

The tool part is matched against the tool's name. The specifier is matched
against the thing the tool acts on.

| Rule | Matches |
| --- | --- |
| `run_command:npm run *` | Shell commands starting with `npm run` |
| `read_file:./secrets/**` | Files under `./secrets` |
| `edit_file:/src/**` | Files under `src`, measured from the workspace root |
| `web_fetch:domain:example.com` | Fetches of that host |
| `mcp:github:*` | Every tool of the `github` MCP server |
| `mcp` | Every MCP tool |
| `run_command` | The whole tool |

A specifier with no wildcard also matches everything below it, so
`read_file:./secrets` covers the whole directory.

### Path specifiers

| Form | Means |
| --- | --- |
| `secrets/**` | Relative to the current directory |
| `/secrets/**` | Relative to the workspace root, so the rule travels between machines |
| `**/.env` | At any depth under the workspace root |
| `~/.ssh/**` | Relative to your home directory |
| `//etc/**`, `C:/Windows/**` | An absolute path |

### How a decision is made

1. **The mode's ceiling.** `plan` and `safe` cap what any rule can grant.
2. **Deny rules.** The first match wins. An allow can never carve out of a deny.
3. **Ask rules.** The first match wins.
4. **Allow rules.** The first match wins.
5. **The mode's default.**

So rules can always *tighten* a decision, and only ever loosen it up to the
ceiling the mode sets. A rule that names a tool and nothing else, like
`run_command`, blocks the whole tool Ã¢â‚¬â€ and Flow Code then stops offering it to
the model at all, so the model never asks for it.

### The modes

| Mode | What it allows |
| --- | --- |
| `ask` | Reading freely. Anything that writes, runs a command or uses the network asks first |
| `accept_edits` | Also accepts file edits inside the workspace. Commands and the network still ask |
| `plan` | Read-only. The agent explores and proposes a plan, and changes nothing |
| `safe` | Read-only and offline. No writes, no commands, no network |
| `trust` | Acts freely inside the workspace. Outside it, and for protected files, never |

`safe` and `plan` are enforced twice: once when the decision is made, and once
inside the tool itself, so a mistake in one layer is caught by the other.

### What is never written to

`.git/`, `.flowcode/`, `.ssh/`, `.aws/`, `.gnupg/`, `.env` files, `*.pem`,
`*.key`, `id_rsa` Ã¢â‚¬â€ in every mode, including `trust`. Writes are also confined
to the workspace and any directory you have explicitly opened, and symlinks
cannot be used to step outside it.

### Approving a tool

When a tool needs your approval, Flow Code shows you what it wants to do and
offers:

- **allow once** Ã¢â‚¬â€ run it this time
- **allow always** Ã¢â‚¬â€ run it this time, and remember the rule in
  `.flowcode/config.local.json`
- **refuse** Ã¢â‚¬â€ do not run it
- **refuse always** Ã¢â‚¬â€ do not run it, and remember the rule

A refusal is a decision, not an obstacle. Flow Code tells the agent it was
refused, and the agent is expected to work within what is allowed.

---

## Slash commands

Type `/` in the session to see them.

| Command | What it does |
| --- | --- |
| `/help` | Show the commands |
| `/model` | List the models, or switch to one |
| `/clear` | Start a new conversation, keeping the project instructions |
| `/compact` | Summarise the conversation and start again with the summary |
| `/status` | Show the model, the directory, the mode and the session |
| `/config` | Show the resolved configuration |
| `/permissions` | Show the permission mode and the rules |
| `/tools` | List the tools the model may call |
| `/plan` | Switch to plan mode |
| `/mcp` | Show the MCP servers, their tools, and the sub-agents |
| `/exit` | Leave |

---

## MCP servers

Flow Code reads the same `mcpServers` shape the rest of the ecosystem uses, so
a server you have already configured needs no changes. Put it in
`.flowcode/mcp.json` (to share it) or `~/.flowcode/mcp.json` (for yourself):

```json
{
  "mcpServers": {
    "files": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@acme/mcp-files"]
    },
    "issues": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
    }
  }
}
```

A server in the project file replaces one of the same name in your own file.

The tools are offered to the model as `mcp:<server>:<tool>`. They are treated
as third-party code, so they are gated like any other call, and `safe` mode
refuses them. A server that will not start does **not** end your session: it is
reported in `/mcp` and the session carries on without it.

`scripts/mock-mcp-server.mjs` is a scriptable MCP server you can point
Flow Code at to check a configuration:

```json
{
  "mcpServers": {
    "mock": {
      "type": "stdio",
      "command": "node",
      "args": ["./scripts/mock-mcp-server.mjs"]
    }
  }
}
```

---

## Sub-agents

A sub-agent is a markdown file with a little frontmatter. It works in its own
context, with its own tools, and you only see its final answer Ã¢â‚¬â€ which is what
makes it useful for anything long.

`.flowcode/agents/reviewer.md`:

```markdown
---
name: reviewer
description: Reviews changed code for quality and correctness
tools: read_file, grep_files, list_dir
max_turns: 12
---
You review code. Report problems, and say plainly when you find none.
```

The `tools` line is optional; without it the sub-agent inherits the parent's
tools. The model calls it with the `spawn_agent` tool.

---

## Hooks

A hook is a command that runs at a point in the session. It receives the event
as JSON on standard input.

`.flowcode/hooks.json`:

```json
{
  "hooks": {
    "post_tool_use": [
      { "matcher": "edit_file", "command": "npm run format" }
    ],
    "pre_tool_use": [
      { "matcher": "run_command", "command": "./scripts/check-allowed.sh" }
    ]
  }
}
```

| Event | When it runs |
| --- | --- |
| `session_start` | The session started |
| `user_prompt_submit` | You sent a message |
| `pre_tool_use` | A tool is about to run |
| `post_tool_use` | A tool finished successfully |
| `post_tool_use_failure` | A tool failed |
| `session_end` | The session ended |

- **Exit code 0** Ã¢â‚¬â€ carry on. If the hook prints
  `{"additional_context": "..."}`, that text is passed to the model.
- **Exit code 2** Ã¢â‚¬â€ block the action. The hook's standard error becomes the
  reason, and the model is told.
- **Anything else** Ã¢â‚¬â€ carry on. A hook that fails is not a broken session.

The `matcher` is a regular expression matched against the tool's name.

---

## Headless mode

```bash
flowcode -p "find every TODO in the project and list them by file"
```

Without a terminal, one task is carried out and the answer is printed. Add
`--output-format json` for a machine-readable envelope:

```json
{
  "ok": true,
  "reason": "completed",
  "turns": 3,
  "text": "There are 12 TODOs, in 5 files."
}
```

> **Through `npx`, use the long form.** `npx` reads `-p` as its own
> `--package` flag, so `npx flow-code-cli --print "task"` works and
> `npx flow-code-cli -p "task"` does not. The installed `flowcode` command has
> no such problem.

Useful flags:

| Flag | What it does |
| --- | --- |
| `--provider <name>` | The provider to use |
| `--model <name>` | The model to use |
| `--base-url <url>` | The provider's base URL |
| `--permission-mode <mode>` | The permission mode |
| `--yes` | Approve every tool call without asking |
| `--max-turns <n>` | The most turns to run |
| `--resume <path>` | Resume a session log |

**`--yes` turns the permission prompt off.** In headless mode there is nobody
to ask, so a tool that would need approval is refused unless you pass `--yes`
or use the `trust` mode. Reading files still works without either, because
reads are allowed by default.

---

## Sessions

Every conversation is an append-only JSONL file under
`~/.flowcode/sessions/<project>/<session>.jsonl`. The first line is a header;
every line after it is an event.

That means the whole session is yours: readable with any text editor,
diffable, and yours to delete. Flow Code never rewrites a session log Ã¢â‚¬â€ a
compaction is recorded as an event, and the view of the conversation is derived
from the log rather than replacing it.

```bash
flowcode --resume ~/.flowcode/sessions/my-project/20261021-204501-a1b2c3.jsonl
```

---

## Project instructions

Flow Code reads `FLOWCODE.md` from the project root. If there is no
`FLOWCODE.md`, it falls back to `AGENTS.md` Ã¢â‚¬â€ an open convention several agent
tools use Ã¢â‚¬â€ so a project that already has one works without being changed.

```markdown
# How we work

- Use `pnpm`, never `npm`.
- Tests live next to the code they test.
- Run `pnpm lint` before you finish.
```

Path-scoped rules go in `.flowcode/rules/*.md`:

```markdown
---
paths: ["src/api/**"]
---
Every route needs a test.
```

A rule with `paths` is only included when the session has touched a file that
matches.

---

## Troubleshooting

**`flowcode doctor` is the first thing to run.** It is read-only and it will
tell you which part is not working.

**"Could not reach http://127.0.0.1:11434/v1/models"** Ã¢â‚¬â€ the model server is
not running, or it is on a different port. Start it, and check
`provider.baseUrl`.

**The model answers but never calls a tool** Ã¢â‚¬â€ the model is not good at tool
use. A coder model such as Qwen2.5-Coder, DeepSeek-Coder or an instruction
tuned model will do much better. Some servers also need
`compat.strictToolSchema` turned off, which the presets already do.

**"The arguments for 'read_file' were not valid"** Ã¢â‚¬â€ the model sent arguments
that do not match the schema. Flow Code tells the model exactly what was
wrong, and asks it to try again.

**A command was refused** Ã¢â‚¬â€ that is the permission engine working. Use
`/permissions` to see the rules, or add an allow rule.

**The session is slow** Ã¢â‚¬â€ the tool schemas are large, or the context window is
full. `/tools` shows the schema size, and `/compact` makes room.

**Nothing works on Windows** Ã¢â‚¬â€ the shell is PowerShell by default. Set
`"shell": "cmd"` or `"shell": "bash"` if you prefer. There is no
operating-system sandbox for native Windows; run Flow Code inside WSL2 to get
one.

**Everything is mojibake** Ã¢â‚¬â€ your terminal is not using UTF-8. Flow Code's
diagnostic output is plain ASCII for exactly this reason.

---

## Contributing

```bash
git clone https://github.com/zentrixflow1-a11y/Flow-Code.git
cd flow-code
npm install
npm run check
```

`npm run check` type-checks and tests. See [`CONTRIBUTING.md`](./CONTRIBUTING.md)
for the conventions, the testing layers, and the clean-room rule.

---

## Name, ownership and licence

**"Flow Code" is simply the name of this personal project.** No ownership,
copyright or trademark is claimed over the name itself. Anyone is free to use,
fork, modify, redistribute and build on this project under its MIT licence. If
you fork it, you are welcome to keep the name Ã¢â‚¬â€ and equally welcome to change
it. Nothing here requires you to continue calling it Flow Code.

See [`NOTICE`](./NOTICE) for the full statement and the third-party
attribution.

Flow Code is licensed under the [MIT Licence](./LICENSE) Ã‚Â© The Flow Code
Authors.

Flow Code is an original implementation. It contains no source code, system
prompts or assets from any proprietary product, and it is not affiliated with,
endorsed by or sponsored by any of the model providers it can talk to.
