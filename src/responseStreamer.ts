/**
 * Stream processor for OpenAI-compatible SSE chat completion chunks.
 *
 * Owns the ThinkingParser and the book-keeping around `reasoning_content`
 * fields, `<thinking>` tags, and force-closed thinking blocks. Reports
 * results through a {@link StreamReporter} interface rather than talking
 * to VS Code directly, so it can be exercised by unit tests with a fake
 * reporter.
 */

import { ThinkingParser, ThinkingChunk } from './thinking';
import { OpenAIUsage } from './types';

export interface StreamReporter {
  reportText(text: string): void;
  reportThinking(text: string): void;
  reportThinkingDone(): void;
  reportToolCall(id: string, name: string, args: Record<string, unknown>): void;
  /**
   * Report a usage frame from the inference server. Called at most once per
   * stream — the OpenAI convention is to emit a trailing chunk with totals
   * after the last delta. Wired to VS Code's chat context-window widget via
   * a `LanguageModelDataPart` (issue #24).
   */
  reportUsage(usage: OpenAIUsage): void;
}

export interface StreamChunk {
  content?: string;
  reasoning_content?: string;
  finished_tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  usage?: OpenAIUsage;
}

export interface StreamStats {
  /** Number of content characters observed across all chunks. */
  totalContentLength: number;
  totalToolCalls: number;
  totalTextParts: number;
  hadThinking: boolean;
  thinkingForceClosed: boolean;
  /**
   * True once a usage frame has been dispatched to the reporter. Internal
   * book-keeping to dedupe re-emitted totals from chatty servers; optional
   * so callers constructing `StreamStats` for `isEmptyStreamResult` checks
   * don't need to pass it.
   */
  reportedUsage?: boolean;
}

export interface StreamResponseParams {
  chunks: AsyncIterable<StreamChunk>;
  reporter: StreamReporter;
  /** Called before reading each chunk; return true to stop early. */
  isCancelled: () => boolean;
  /**
   * Called with each finished tool call. The callback is responsible for
   * JSON-repairing the arguments and filling any missing required properties
   * from the tool's schema.
   */
  resolveToolCallArgs: (toolCall: { id: string; name: string; arguments: string }) => Record<string, unknown>;  /** When false, tool calls emitted by the model are ignored. */
  allowToolCalls?: boolean;}

const FORCE_CLOSED_THINKING_FALLBACK =
  '*(The model ran out of output tokens while thinking and could not produce a response. ' +
  'Try increasing the context length or max output tokens in LM Studio, ' +
  'or disable thinking for this model.)*';

/**
 * Dispatch a single ThinkingParser piece to the reporter, updating stats.
 *
 * `allowForceClose` is true only when flushing the parser at end-of-stream —
 * an 'E' piece mid-stream is just a normal end-of-thinking marker, while an
 * 'E' piece at flush time indicates the stream truncated mid-think block.
 */
function reportParserPiece(
  piece: ThinkingChunk,
  reporter: StreamReporter,
  stats: StreamStats,
  allowForceClose: boolean
): void {
  if (piece.t === 'T') {
    stats.hadThinking = true;
    reporter.reportThinking(piece.c);
    return;
  }
  if (piece.t === 'E') {
    if (allowForceClose) {
      stats.thinkingForceClosed = true;
    }
    reporter.reportThinkingDone();
    return;
  }
  if (piece.c) {
    stats.totalTextParts++;
    reporter.reportText(piece.c);
  }
}

/**
 * Process a single stream chunk, updating stats and dispatching events
 * through the reporter.
 * @returns updated inReasoningField flag.
 */
function findMatchingBrace(text: string, openBraceIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = openBraceIndex; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function stripToolCallLikePayload(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  const toolCallLikeRegex = /\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/i;
  const match = trimmed.match(toolCallLikeRegex);
  if (!match) {
    return text;
  }

  const start = trimmed.indexOf('{', match.index ?? 0);
  if (start === -1) {
    return text;
  }

  const end = findMatchingBrace(trimmed, start);
  if (end === -1) {
    return text;
  }

  const before = trimmed.slice(0, start).trim();
  const after = trimmed.slice(end + 1).trim();
  const pieces = [before, after].filter(Boolean);
  return pieces.join('\n').trim();
}

function sanitizeChunkWithPartialPayloads(content: string, pendingToolCallBuffer?: string): { sanitized: string; pending: string } {
  if (!content && !pendingToolCallBuffer) {
    return { sanitized: '', pending: '' };
  }

  const combined = `${pendingToolCallBuffer ?? ''}${content}`;
  const candidateStart = combined.search(/\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/i);
  if (candidateStart === -1) {
    return { sanitized: pendingToolCallBuffer ? '' : content, pending: pendingToolCallBuffer ?? '' };
  }

  const prefix = combined.slice(0, candidateStart);
  const remainder = combined.slice(candidateStart);
  const stripped = stripToolCallLikePayload(remainder);
  if (stripped === remainder) {
    return { sanitized: prefix, pending: remainder };
  }

  return { sanitized: `${prefix}${stripped}`, pending: '' };
}

export function sanitizeContentForNoToolCalls(content: unknown): string {
  if (content === null || content === undefined) {
    return '';
  }

  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed) {
      return '';
    }

    const { sanitized } = sanitizeChunkWithPartialPayloads(content);
    return sanitized.trim();
  }

  if (typeof content === 'object') {
    const serialized = JSON.stringify(content);
    return sanitizeContentForNoToolCalls(serialized);
  }

  return String(content);
}

function processStreamChunk(
  chunk: StreamChunk,
  parser: ThinkingParser,
  reporter: StreamReporter,
  stats: StreamStats,
  inReasoningField: boolean,
  resolveToolCallArgs: StreamResponseParams['resolveToolCallArgs'],
  allowToolCalls: boolean,
  pendingToolCallBuffer: string
): { inReasoningField: boolean; pendingToolCallBuffer: string } {
  if (chunk.reasoning_content) {
    stats.hadThinking = true;
    inReasoningField = true;
    reporter.reportThinking(chunk.reasoning_content);
  }

  if (chunk.content) {
    if (inReasoningField) {
      inReasoningField = false;
      reporter.reportThinkingDone();
    }

    const { sanitized, pending } = sanitizeChunkWithPartialPayloads(chunk.content, pendingToolCallBuffer);
    pendingToolCallBuffer = pending;
    const visibleText = sanitized.trim();
    if (!visibleText) {
      return { inReasoningField, pendingToolCallBuffer };
    }

    stats.totalContentLength += visibleText.length;
    for (const piece of parser.process(visibleText)) {
      reportParserPiece(piece, reporter, stats, false);
    }
  }

  if (chunk.finished_tool_calls?.length) {
    if (!allowToolCalls) {
      return { inReasoningField, pendingToolCallBuffer };
    }
    for (const toolCall of chunk.finished_tool_calls) {
      stats.totalToolCalls++;
      const args = resolveToolCallArgs(toolCall);
      reporter.reportToolCall(toolCall.id, toolCall.name, args);
    }
  }

  if (chunk.usage && !stats.reportedUsage) {
    // Latch on the first usage frame; some servers re-emit the same totals
    // across the trailing few chunks. Reporting twice would briefly double
    // VS Code's running context-window count before settling.
    stats.reportedUsage = true;
    reporter.reportUsage(chunk.usage);
  }

  return { inReasoningField, pendingToolCallBuffer };
}

/**
 * Consume an async stream of chat completion chunks, dispatching pieces to
 * the reporter as they arrive. Returns aggregate stats that the caller can
 * use to decide whether the response was empty and needs an error fallback.
 */
export async function streamResponse(params: StreamResponseParams): Promise<StreamStats> {
  const { chunks, reporter, isCancelled, resolveToolCallArgs } = params;

  const stats: StreamStats = {
    totalContentLength: 0,
    totalToolCalls: 0,
    totalTextParts: 0,
    hadThinking: false,
    thinkingForceClosed: false,
    reportedUsage: false,
  };

  const parser = new ThinkingParser();
  let inReasoningField = false;
  let pendingToolCallBuffer = '';

  for await (const chunk of chunks) {
    if (isCancelled()) {
      break;
    }
    ({ inReasoningField, pendingToolCallBuffer } = processStreamChunk(
      chunk,
      parser,
      reporter,
      stats,
      inReasoningField,
      resolveToolCallArgs,
      params.allowToolCalls ?? true,
      pendingToolCallBuffer
    ));
  }

  // Flush any remaining buffered content. 'E' pieces here signal that the
  // stream ended mid-think block.
  for (const piece of parser.flush()) {
    reportParserPiece(piece, reporter, stats, true);
  }

  if (inReasoningField) {
    reporter.reportThinkingDone();
  }

  // If the model spent all its output budget inside a thinking block and
  // produced no visible text or tool calls, emit a fallback message so the
  // Copilot Chat UI has something to render.
  if (stats.thinkingForceClosed && stats.totalTextParts === 0 && stats.totalToolCalls === 0) {
    reporter.reportText(FORCE_CLOSED_THINKING_FALLBACK);
  }

  return stats;
}

/**
 * Determine whether a completed stream should be treated as empty (and thus
 * needs an error fallback message). A stream with thinking content but no
 * visible output is still "empty" from the user's perspective only if the
 * thinking block was force-closed.
 */
export function isEmptyStreamResult(stats: StreamStats): boolean {
  return (
    stats.totalContentLength === 0 &&
    stats.totalToolCalls === 0 &&
    !stats.hadThinking &&
    !stats.thinkingForceClosed
  );
}
