import {
  OpenAIChatCompletionRequest,
  OpenAIMessage,
  OpenAIToolDefinition
} from './types';

import { ToolRouter } from './toolRouter';
import { ToolSchemaBuilder } from './toolSchemaBuilder';

export type { OpenAIToolDefinition } from './types';

export type ToolChoice = 'auto' | 'required' | 'none';

export interface ChatRequestOptions {
  model: string;
  messages: OpenAIMessage[];
  maxTokens: number;
  temperature: number;
  tools?: OpenAIToolDefinition[];
  toolChoice?: ToolChoice;
  parallelToolCalls?: boolean;
  extraOptions?: Record<string, unknown>;
}

export function buildChatRequest(
  options: ChatRequestOptions
): OpenAIChatCompletionRequest {

  const request: OpenAIChatCompletionRequest = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxTokens,
    temperature: options.temperature,
  };

  const noToolInstruction =
    'Answer directly in plain text. Do not emit tool calls or tool-call JSON unless the user explicitly asks for tool use.';

  // -----------------------------
  // TOOL PIPELINE
  // -----------------------------

  const inputTools = options.tools ?? [];
  const shouldAddNoToolInstruction = inputTools.length === 0 || !ToolRouter.select(inputTools, {
    model: options.model,
    messages: options.messages
  }).length;

  if (shouldAddNoToolInstruction) {
    const existingMessages = Array.isArray(options.messages) ? options.messages : [];
    const hasSystemPrompt = existingMessages.some((message) => message.role === 'system');
    const prefixedMessages = hasSystemPrompt
      ? existingMessages.map((message, index) => {
          if (index !== 0 || message.role !== 'system') {
            return message;
          }
          const existingContent = typeof message.content === 'string' ? message.content : '';
          const nextContent = existingContent ? `${existingContent}\n${noToolInstruction}` : noToolInstruction;
          return { ...message, content: nextContent };
        })
      : [{ role: 'system', content: noToolInstruction }, ...existingMessages];
    request.messages = prefixedMessages as OpenAIMessage[];
  }

  if (inputTools.length > 0) {

    const routedTools = ToolRouter.select(inputTools, {
      model: options.model,
      messages: options.messages
    });

    console.log(
      `[ToolPipeline] input=${inputTools.length} routed=${routedTools.length}`
    );

    const compactTools = ToolSchemaBuilder.build(routedTools, {
      maxTools: getMaxToolsForModel(options.model),
      maxDescriptionLength: 120
    });

    const finalTools = compactTools.slice(
      0,
      getMaxToolsForModel(options.model)
    );

    if (finalTools.length > 0) {
      request.tools = finalTools;
      if (options.toolChoice === 'required' || options.toolChoice === 'none') {
        request.tool_choice = options.toolChoice;
      }
      if (options.parallelToolCalls === true) {
        request.parallel_tool_calls = true;
      }
    }
  }

  // -----------------------------
  // EXTRA OPTIONS
  // -----------------------------

  if (options.extraOptions) {

    // Prevent downstream code from re-enabling tools
    const extras = { ...options.extraOptions };
    for (const key of ['tools', 'tool_choice', 'parallel_tool_calls', 'maxTokens', 'max_tokens', 'max_completion_tokens', 'maxOutputTokens', 'max_output_tokens']) {
      delete extras[key];
    }
    Object.assign(request, extras);
  }

  // Caller budgets may lower the computed ceiling, but never raise it.
  const requested = options.extraOptions ?? {};
  request.max_tokens = Math.min(options.maxTokens, ...[
    requested.max_tokens, requested.maxTokens, requested.max_completion_tokens,
    requested.maxOutputTokens, requested.max_output_tokens,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 1)
    .map((value) => Math.floor(value)));

  return request;
}

/**
 * Model-aware tool budget
 */
function getMaxToolsForModel(model: string): number {

  const m = model.toLowerCase();

  if (
    m.includes("1b") ||
    m.includes("2b") ||
    m.includes("3b") ||
    m.includes("tiny")
  ) {
    return 3;
  }

  if (
    m.includes("7b") ||
    m.includes("8b")
  ) {
    return 6;
  }

  return 8;
}
