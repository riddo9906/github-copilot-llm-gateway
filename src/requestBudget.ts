import { OpenAIChatCompletionRequest } from './types';
import {
  TOKEN_CONSTANTS, buildInputText, calculateMaxInputTokens, estimateTextTokens,
  truncateMessagesToFit, TokenLogger,
} from './tokenBudget';

/** Budget the final wire request, after tool routing, schema compaction and instructions. */
export function budgetChatRequest(
  request: OpenAIChatCompletionRequest,
  modelMaxContext: number,
  configuredMaxOutput: number,
  log: TokenLogger = () => { /* optional diagnostics */ }
): { request: OpenAIChatCompletionRequest; inputText: string } {
  const outputCeiling = Math.min(request.max_tokens ?? configuredMaxOutput, configuredMaxOutput);
  const toolsSerializedLength = request.tools?.length ? JSON.stringify(request.tools).length : 0;
  const maxInputTokens = Math.floor(calculateMaxInputTokens({
    modelMaxContext, configuredMaxOutput: outputCeiling, toolsSerializedLength,
  }) / TOKEN_CONSTANTS.INPUT_OVERHEAD_RATIO);
  if (maxInputTokens <= 0) {
    throw new Error('Selected tool schemas leave no room for messages in the model context. Reduce the tool set.');
  }
  const messages = truncateMessagesToFit(request.messages, maxInputTokens, log);
  const latest = request.messages[request.messages.length - 1];
  if (latest && !messages.includes(latest)) {
    throw new Error('The latest message does not fit in the model context. Reduce the attached context or start a new chat.');
  }
  const inputText = buildInputText(messages);
  const inputTokens = estimateTextTokens(inputText);
  const toolsOverhead = Math.ceil(toolsSerializedLength / TOKEN_CONSTANTS.CHARS_PER_TOKEN);
  const remaining = Math.floor(modelMaxContext
    - Math.ceil((inputTokens + toolsOverhead) * TOKEN_CONSTANTS.INPUT_OVERHEAD_RATIO)
    - TOKEN_CONSTANTS.CONTEXT_BUFFER_TOKENS);
  if (remaining < 1) {
    throw new Error('Messages and selected tools exceed the model context. Reduce the attached context or tool set.');
  }
  const result = { ...request, messages, max_tokens: Math.min(outputCeiling, remaining) };
  log(`Token estimate: input=${inputTokens}, tools=${toolsOverhead}, model_context=${modelMaxContext}, chosen_max_tokens=${result.max_tokens}`);
  return { request: result, inputText };
}
