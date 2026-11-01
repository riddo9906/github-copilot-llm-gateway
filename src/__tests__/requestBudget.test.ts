import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChatRequest } from '../requestBuilder';
import { budgetChatRequest } from '../requestBudget';
import { OpenAIToolDefinition } from '../types';

describe('wire request budgeting', () => {
  test('97 offered tools do not discard the task when only one compact tool is transmitted', () => {
    const tools: OpenAIToolDefinition[] = Array.from({ length: 97 }, (_, index) => ({
      type: 'function', function: {
        name: index === 0 ? 'read_file' : `unrelated_tool_${index}`,
        description: 'Available capability. '.repeat(90),
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    }));
    const messages = [
      { role: 'user', content: 'a'.repeat(17192) },
      { role: 'user', content: 'b'.repeat(7800) },
      { role: 'user', content: 'Fix this file. Read the file first.' },
    ];
    assert.ok(JSON.stringify(tools).length / 4 > 16384);
    const wire = buildChatRequest({ model: 'qwen2.5-coder-3b', messages, tools, maxTokens: 1024, temperature: 0 });
    assert.equal(wire.tools?.length, 1);
    const logs: string[] = [];
    const result = budgetChatRequest(wire, 16384, 1024, (message) => logs.push(message));
    assert.deepEqual(result.request.messages, messages);
    assert.equal(result.request.max_tokens, 1024);
    assert.ok(!logs.some((message) => message.includes('Truncated')));
    assert.equal(messages.length, 3);
  });

  test('counts automatically injected instructions and honors a caller budget below 64', () => {
    const wire = buildChatRequest({ model: 'qwen2.5-0.5b', messages: [{ role: 'user', content: 'OK' }],
      maxTokens: 256, temperature: 0, extraOptions: { max_tokens: 16 } });
    const result = budgetChatRequest(wire, 4096, 256);
    assert.match(result.inputText, /Answer directly/);
    assert.equal(result.request.max_tokens, 16);
  });

  test('fails clearly when final tool schemas cannot fit', () => {
    assert.throws(() => budgetChatRequest({ model: 'test', messages: [{ content: 'task' }],
      tools: [{ type: 'function', function: { name: 'tool', description: 'x'.repeat(10000) } }],
      max_tokens: 128 }, 1024, 128), /tool schemas leave no room/);
  });

  test('never silently drops the latest task to retain only the first message', () => {
    assert.throws(() => budgetChatRequest({ model: 'test', messages: [
      { role: 'user', content: 'x'.repeat(1700) }, { role: 'user', content: 'y'.repeat(3000) },
    ], max_tokens: 128 }, 1024, 128), /latest message does not fit/);
  });

  test('does not force 64 output tokens into an already full context', () => {
    assert.throws(() => budgetChatRequest({ model: 'test', messages: [{ content: 'x'.repeat(10000) }],
      max_tokens: 128 }, 1024, 128), /exceed the model context/);
  });
});
