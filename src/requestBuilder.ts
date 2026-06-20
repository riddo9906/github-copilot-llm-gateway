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

  // -----------------------------
  // TOOL PIPELINE
  // -----------------------------

  const inputTools = options.tools ?? [];

  if (inputTools.length > 0) {

    const routedTools = ToolRouter.select(inputTools, {
      model: options.model,
      messages: options.messages
    });

    console.log(
      `[ToolPipeline] input=${inputTools.length} routed=${routedTools.length}`
    );

    if (routedTools.length > 0) {

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
        request.tool_choice = options.toolChoice ?? "auto";
        request.parallel_tool_calls =
          options.parallelToolCalls ?? false;
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