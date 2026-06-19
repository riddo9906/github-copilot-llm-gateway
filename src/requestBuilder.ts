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

  /**
   * =========================
   * TOOL PIPELINE (SAFE FIXED)
   * =========================
   */

  const inputTools = options.tools ?? [];

  if (inputTools.length > 0) {

    // 1. ROUTE (semantic filtering)
    const routedTools = ToolRouter.select(inputTools, {
      model: options.model,
      messages: options.messages
    });

    console.log("[ToolPipeline] input:", inputTools.length, "routed:", routedTools.length);

    // 2. FIX #2 — HARD GUARD (prevents full tool leakage)
    if (routedTools.length === 0) {
      request.tool_choice = 'none';
      return request;
    }

    // 3. COMPRESS TOOL SCHEMA
    const compactTools = ToolSchemaBuilder.build(routedTools, {
      maxTools: getMaxToolsForModel(options.model),
      maxDescriptionLength: 120
    });

    // 4. FINAL SAFETY LIMIT (absolute cap)
    const finalTools = compactTools.slice(0, getMaxToolsForModel(options.model));

    request.tools = finalTools;

    request.tool_choice = options.toolChoice ?? 'auto';
    request.parallel_tool_calls = options.parallelToolCalls ?? false;

  } else {
    // no tools at all
    request.tool_choice = 'none';
  }

  /**
   * Extra overrides (VS Code / Copilot injection)
   */
  if (options.extraOptions) {
    Object.assign(request, options.extraOptions);
  }

  return request;
}

/**
 * Model-aware tool budget (critical for 1B models like yours)
 */
function getMaxToolsForModel(model: string): number {
  const m = model.toLowerCase();

  if (m.includes('1b') || m.includes('2b') || m.includes('3b') || m.includes('tiny')) {
    return 3;
  }

  if (m.includes('7b') || m.includes('8b')) {
    return 6;
  }

  return 8;
}