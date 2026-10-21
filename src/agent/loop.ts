/**
 * The agent loop.
 *
 * ```text
 * turn:
 *   assemble the request from the session log
 *   stream the model's answer
 *   append the answer to the log
 *   if the model asked for tools:
 *     check each call's permission
 *     run the ones that are allowed
 *     append the results to the log
 *     go round again
 *   otherwise the turn is over
 * ```
 *
 * The loop never throws. A provider failure, a refused tool, a tool that
 * throws — all of them are recorded and the model is told what happened.
 */
import { flowError, type FlowError } from "../errors.js";
import { assembleRequest } from "../context/assembler.js";
import { buildSystemPrompt } from "../context/system-prompt.js";
import { decidePermission } from "../permissions/engine.js";
import { isReadOnlyCommand } from "../permissions/modes.js";
import { hookApplies, runHook } from "../hooks/runner.js";
import { parseRule } from "../permissions/rules.js";
import type { PermissionRequest } from "../permissions/types.js";
import type { ChatMessage, ToolCall } from "../providers/types.js";
import { deriveMessages } from "../session/replay.js";
import { executeTool } from "../tools/executor.js";
import { resolveToolPath } from "../tools/fs.js";
import { describeTrim, fitToBudget } from "../tools/budget.js";
import type { ToolContext, ToolResult } from "../tools/types.js";
import type { AgentOptions, AgentResult } from "./types.js";

/** The default number of turns a run may take. */
export const DEFAULT_MAX_TURNS = 50;

/**
 * Run the agent until it finishes.
 *
 * @param options - Everything the agent needs.
 * @param prompt - The user's message, when the run starts with one.
 */
export const runAgent = async (
  options: AgentOptions,
  prompt?: string,
): Promise<AgentResult> => {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  let turns = 0;
  let text = "";

  if (prompt !== undefined && prompt !== "") {
    await options.session.append({ type: "user.message", data: { text: prompt } });
  }

  while (turns < maxTurns) {
    if (options.signal?.aborted === true) {
      await options.session.append({
        type: "turn.end",
        data: { turn: turns, reason: "aborted" },
      });
      return { reason: "aborted", turns, text };
    }

    turns += 1;
    await options.session.append({ type: "turn.start", data: { turn: turns } });

    const request = buildRequest(options);

    const calls: ToolCall[] = [];
    let turnText = "";
    let failure: FlowError | undefined;

    try {
      for await (const event of options.provider.streamChat(request, options.signal)) {
        switch (event.type) {
          case "text_delta":
            turnText += event.text;
            options.ui.onText(event.text);
            break;
          case "reasoning_delta":
            options.ui.onReasoning(event.text);
            break;
          case "tool_call":
            calls.push(event.call);
            break;
          case "error":
            failure = event.error;
            break;
          case "usage":
          case "done":
            break;
        }
      }
    } catch (error) {
      failure = flowError(
        "network_error",
        `The model request failed: ${error instanceof Error ? error.message : String(error)}`,
        { retryable: true, cause: error },
      );
    }

    text = turnText;
    await options.session.append({
      type: "assistant.message",
      data: { text: turnText, toolCalls: calls },
    });

    if (failure !== undefined) {
      await options.session.append({
        type: "turn.end",
        data: { turn: turns, reason: "error" },
      });
      await options.session.append({
        type: "error",
        data: { message: failure.message },
      });
      return { reason: "error", turns, text, error: failure };
    }

    if (calls.length === 0) {
      await options.session.append({
        type: "turn.end",
        data: { turn: turns, reason: "completed" },
      });
      return { reason: "completed", turns, text };
    }

    await runToolCalls(options, calls);

    await options.session.append({
      type: "turn.end",
      data: { turn: turns, reason: "completed" },
    });
  }

  return { reason: "max_turns", turns, text };
};

/**
 * Build the request for one turn.
 *
 * @param options - Everything the agent needs.
 */
export const buildRequest = (options: AgentOptions) => {
  const messages: ChatMessage[] = deriveMessages(options.session.events);
  const denied = deniedTools(options.rules);
  const advertised = options.registry.advertised(denied);
  const budget = options.toolSchemaBudget ?? 0;
  const fitted = fitToBudget(advertised, budget);

  if (fitted.trimmed.length > 0) {
    options.ui.onNotice?.(describeTrim(fitted.trimmed));
  }

  const tools = options.registry.toProviderTools(denied);
  const allowed = new Set(fitted.tools.map((tool) => tool.name));

  const systemPrompt = buildSystemPrompt({
    cwd: options.toolContext.cwd,
    platform: options.toolContext.platform,
    mode: options.config.permissions.mode,
    provider: options.provider.id,
    model: options.config.provider.model ?? "",
    tools: fitted.tools,
    additionalDirectories: options.config.permissions.additionalDirectories,
  });

  return assembleRequest({
    model: options.config.provider.model ?? "",
    messages,
    systemPrompt,
    ...(options.extraInstructions === undefined
      ? {}
      : { projectInstructions: options.extraInstructions }),
    tools: tools.filter((tool) => allowed.has(tool.name)),
  });
};

/** The tool names a bare deny rule removes from the model's context. */
const deniedTools = (rules: { readonly deny: readonly string[] }) => {
  const denied = new Set<string>();
  for (const rule of rules.deny) {
    const parsed = parseRule(rule);
    // Only a rule that names a tool and nothing else removes the tool. A rule
    // with a specifier blocks that one call, not the whole tool.
    if (parsed.spec === undefined && parsed.tool !== "" && parsed.tool !== "*") {
      denied.add(parsed.tool);
    }
  }
  return denied;
};

/**
 * Run a batch of tool calls.
 *
 * A batch that contains a tool which is not concurrency-safe runs entirely
 * in order. A model that asks to read a file, change it, and read it again
 * means it in that order, and running them at once would not.
 *
 * @param options - Everything the agent needs.
 * @param calls - The calls the model made.
 */
export const runToolCalls = async (
  options: AgentOptions,
  calls: readonly ToolCall[],
): Promise<void> => {
  const definitions = calls.map(
    (call) => options.registry.get(call.name),
  );
  const allConcurrent = definitions.every(
    (definition) => definition?.concurrencySafe === true,
  );

  if (allConcurrent) {
    const results = await Promise.all(
      calls.map((call) => runToolCall(options, call)),
    );
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      const result = results[index];
      if (call !== undefined && result !== undefined) {
        await recordResult(options, call, result);
      }
    }
    return;
  }

  for (const call of calls) {
    const result = await runToolCall(options, call);
    await recordResult(options, call, result);
  }
};

/** Run one tool call and write its result to the session. */
const runToolCall = async (
  options: AgentOptions,
  call: ToolCall,
): Promise<ToolResult> => {
  const definition = options.registry.get(call.name);
  if (definition === undefined) {
    return {
      ok: false,
      error: flowError(
        "not_found",
        `There is no tool called '${call.name}'.`,
        {
          retryable: false,
          remediation: "Use one of the tools you were given.",
        },
      ),
    };
  }
  const decision = await decideFor(options, definition, call);
  if (decision.kind === "deny") {
    return {
      ok: false,
      error: flowError("permission_denied", decision.reason, {
        retryable: false,
        remediation:
          "Do not try to reach the same result another way. Tell the user what you would have done.",
      }),
    };
  }

  if (decision.kind === "ask") {
    const approval = await options.ui.approve({
      tool: call.name,
      args: call.args,
      reason: decision.reason,
      ...(decision.rule === undefined ? {} : { rule: decision.rule }),
    });
    if (approval.kind === "deny" || approval.kind === "deny_always") {
      await options.session.append({
        type: "approval.decided",
        data: { tool: call.name, decision: approval.kind },
      });
      return {
        ok: false,
        error: flowError(
          "permission_denied",
          approval.reason ?? `The user refused to let you run '${call.name}'.`,
          {
            retryable: false,
            remediation: "Accept the refusal and work within what is allowed.",
          },
        ),
      };
    }
    await options.session.append({
      type: "approval.decided",
      data: { tool: call.name, decision: approval.kind },
    });
  }

  const before = await runHooks(options, "pre_tool_use", call);
  if (before.blocked !== undefined) {
    return {
      ok: false,
      error: flowError("permission_denied", before.blocked, {
        retryable: false,
        remediation: "A hook refused this action. Do not try to work around it.",
      }),
    };
  }

  options.ui.onToolStart(call);
  const result = await executeTool(definition, call.args, options.toolContext);
  options.ui.onToolEnd(call, result);

  const after = await runHooks(
    options,
    result.ok ? "post_tool_use" : "post_tool_use_failure",
    call,
    result,
  );

  // Whatever a hook had to say is passed back to the model with the result.
  const notes = [before.context, after.context].filter(
    (note): note is string => note !== undefined && note !== "",
  );

  if (notes.length === 0) {
    return result;
  }

  if (!result.ok) {
    return {
      ok: false,
      error: {
        ...result.error,
        message: `${result.error.message}\n${notes.join("\n")}`,
      },
    };
  }

  return {
    ok: true,
    output: `${result.output}\n\n${notes.join("\n")}`,
    ...(result.data === undefined ? {} : { data: result.data }),
  };
};

/** What the hooks had to say. */
interface HookReport {
  /** The reason a hook blocked the action. */
  readonly blocked?: string;
  /** The context a hook asked to pass to the model. */
  readonly context?: string;
}

/**
 * Run the hooks for an event.
 *
 * @param options - Everything the agent needs.
 * @param event - The event.
 * @param call - The tool call, for a tool event.
 * @param result - The tool's result, when there is one.
 * @returns What the hooks had to say.
 */
const runHooks = async (
  options: AgentOptions,
  event: "pre_tool_use" | "post_tool_use" | "post_tool_use_failure",
  call: ToolCall,
  result?: ToolResult,
): Promise<HookReport> => {
  if (options.hooks === undefined || options.hooks.length === 0) {
    return {};
  }

  let blocked: string | undefined;
  const contexts: string[] = [];

  for (const hook of options.hooks) {
    if (hook.event !== event) {
      continue;
    }
    if (!hookApplies(hook, call.name)) {
      continue;
    }

    const outcome = await runHook(
      hook,
      {
        event,
        tool: call.name,
        arguments: call.args,
        ...(result === undefined
          ? {}
          : { result: result.ok ? result.output : result.error.message }),
        cwd: options.toolContext.cwd,
      },
      { cwd: options.toolContext.cwd, env: options.toolContext.env },
    );

    if (!outcome.ok) {
      if (event === "pre_tool_use") {
        blocked = outcome.reason;
        continue;
      }
      // The action has already happened, so a hook that failed afterwards is
      // reported to the model rather than blocking anything.
      contexts.push(`A hook failed: ${outcome.reason}`);
      continue;
    }
    if (outcome.context !== undefined) {
      contexts.push(outcome.context);
    }
  }

  return {
    ...(blocked === undefined ? {} : { blocked }),
    ...(contexts.length === 0 ? {} : { context: contexts.join("\n") }),
  };
};

/** Write a tool result to the session and report it. */
const recordResult = async (
  options: AgentOptions,
  call: ToolCall,
  result: ToolResult,
): Promise<void> => {
  await options.session.append({
    type: "tool.call",
    data: { id: call.id, name: call.name, args: call.args },
  });
  await options.session.append({
    type: "tool.result",
    data: {
      id: call.id,
      ok: result.ok,
      output: result.ok ? result.output : result.error.message,
      ...(result.ok ? {} : { error: result.error.message }),
    },
  });
};

/**
 * Decide whether a tool call may run, asking the user when it may not.
 *
 * @param options - Everything the agent needs.
 * @param definition - The tool being called.
 * @param call - The call.
 */
const decideFor = async (
  options: AgentOptions,
  definition: {
    readonly category: string;
    readonly subjectKind: string;
    readonly subject?: (args: never) => string | undefined;
  },
  call: ToolCall,
): Promise<{ kind: "allow" } | { kind: "ask"; reason: string; rule?: string } | { kind: "deny"; reason: string; rule?: string }> => {
  const subject = computeSubject(definition, call);
  const withinWorkspace = await isWithinWorkspace(definition, subject, options.toolContext);

  const request: PermissionRequest = {
    tool: call.name,
    category: definition.category as PermissionRequest["category"],
    ...(subject === undefined ? {} : { subject }),
    subjectKind: definition.subjectKind as PermissionRequest["subjectKind"],
    mode: options.config.permissions.mode,
    rules: options.rules,
    context: options.permissionContext,
    withinWorkspace,
    ...(isReadOnlyCommandFor(call) ? { readOnlyCommand: true } : {}),
  };

  return decidePermission(request);
};

/** The subject of a tool call. */
const computeSubject = (
  definition: {
    readonly subject?: (args: never) => string | undefined;
  },
  call: ToolCall,
): string | undefined => {
  if (definition.subject === undefined) {
    return undefined;
  }
  return definition.subject(call.args as never);
};

/** Whether a path subject lies inside the workspace. */
const isWithinWorkspace = async (
  definition: { readonly subjectKind: string },
  subject: string | undefined,
  context: ToolContext,
): Promise<boolean> => {
  if (definition.subjectKind !== "path" || subject === undefined) {
    return true;
  }
  const resolved = await resolveToolPath(subject, context);
  return resolved.ok;
};

/** Whether a call is a command that only reads. */
const isReadOnlyCommandFor = (call: ToolCall): boolean => {
  if (call.name !== "run_command") {
    return false;
  }
  const args = call.args as { command?: unknown } | undefined;
  return typeof args?.command === "string" && isReadOnlyCommand(args.command);
};
