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

    if (routedTools.length === 0) {
      return request;
    }

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
    delete (options.extraOptions as any).tools;
    delete (options.extraOptions as any).tool_choice;
    delete (options.extraOptions as any).parallel_tool_calls;

    Object.assign(request, options.extraOptions);
  }

  console.log(
    "[OpenAI Request]",
    JSON.stringify(request, null, 2)
  );

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