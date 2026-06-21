import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildChatRequest } from '../requestBuilder';

describe('buildChatRequest', () => {
  test('builds a minimal request without tools', () => {
    const req = buildChatRequest({
      model: 'my-model',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 128,
      temperature: 0.7,
    });
    assert.equal(req.model, 'my-model');
    assert.equal(req.max_tokens, 128);
    assert.equal(req.temperature, 0.7);
    assert.equal(req.messages[0].role, 'system');
    assert.match(String(req.messages[0].content), /plain text|tool-call/i);
    assert.equal(req.messages[1].role, 'user');
    assert.equal(req.messages[1].content, 'hi');
    assert.equal(req.tools, undefined);
    assert.equal(req.tool_choice, undefined);
    assert.equal(req.parallel_tool_calls, undefined);
  });

  test('omits tool fields when tools array is empty', () => {
    const req = buildChatRequest({
      model: 'm',
      messages: [],
      maxTokens: 1,
      temperature: 0,
      tools: [],
      toolChoice: 'auto',
      parallelToolCalls: true,
    });
    assert.equal(req.tools, undefined);
    assert.equal(req.tool_choice, undefined);
    assert.equal(req.parallel_tool_calls, undefined);
  });

  test('includes tools when the router selects them', () => {
    const tools = [
      {
        type: 'function' as const,
        function: { name: 'web_search', description: 'search the web', parameters: {} },
      },
    ];
    const req = buildChatRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'Please search the web' }],
      maxTokens: 1,
      temperature: 0,
      tools,
      toolChoice: 'required',
      parallelToolCalls: false,
    });
    assert.equal(req.tools?.[0]?.function?.name, 'web_search');
    assert.equal(req.tools?.[0]?.function?.description, 'search the web');
    assert.equal(req.tool_choice, 'required');
    assert.equal(req.parallel_tool_calls, undefined);
  });

  test('omits toolChoice when undefined even with tools', () => {
    const req = buildChatRequest({
      model: 'm',
      messages: [],
      maxTokens: 1,
      temperature: 0,
      tools: [{ type: 'function', function: { name: 'f' } }],
    });
    assert.equal(req.tool_choice, undefined);
    assert.equal(req.parallel_tool_calls, undefined);
  });

  test('does not force tool_choice for default auto mode', () => {
    const req = buildChatRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: 32,
      temperature: 0,
      tools: [{ type: 'function', function: { name: 'read_file' } }],
      toolChoice: 'auto',
    });
    assert.equal(req.tool_choice, undefined);
  });

  test('omits tools for ordinary chat when the router selects none', () => {
    const req = buildChatRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: 32,
      temperature: 0,
      tools: [{ type: 'function', function: { name: 'read_file' } }],
    });
    assert.equal(req.tools, undefined);
  });

  test('adds a compact system prompt for ordinary chat without tools', () => {
    const req = buildChatRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: 32,
      temperature: 0,
      tools: [{ type: 'function', function: { name: 'read_file' } }],
    });
    assert.equal(req.messages[0].role, 'system');
    assert.match(String(req.messages[0].content), /plain text|tool-call/i);
  });

  test('merges extraOptions on top of base fields', () => {
    const req = buildChatRequest({
      model: 'm',
      messages: [],
      maxTokens: 10,
      temperature: 0.5,
      extraOptions: { top_p: 0.9, frequency_penalty: 0.1 },
    });
    assert.equal(req.top_p, 0.9);
    assert.equal(req.frequency_penalty, 0.1);
    assert.equal(req.max_tokens, 10);
  });

  test('extraOptions can override base fields', () => {
    const req = buildChatRequest({
      model: 'm',
      messages: [],
      maxTokens: 10,
      temperature: 0.5,
      extraOptions: { temperature: 0.9 },
    });
    assert.equal(req.temperature, 0.9);
  });

  test('per-request modelOptions take precedence over user-configured extras', () => {
    // Mirrors how the provider merges them:
    //   extraOptions: { ...config.extraModelOptions, ...options.modelOptions }
    const userExtras = { top_k: 40, repetition_penalty: 1.1 };
    const perRequest = { top_k: 20 };
    const req = buildChatRequest({
      model: 'm',
      messages: [],
      maxTokens: 10,
      temperature: 0.5,
      extraOptions: { ...userExtras, ...perRequest },
    });
    assert.equal(req.top_k, 20);
    assert.equal(req.repetition_penalty, 1.1);
  });

  test('handles `none` toolChoice when tools are actually routed', () => {
    const req = buildChatRequest({
      model: 'm',
      messages: [{ role: 'user', content: 'Please search the web' }],
      maxTokens: 1,
      temperature: 0,
      tools: [{ type: 'function', function: { name: 'web_search' } }],
      toolChoice: 'none',
    });
    assert.equal(req.tool_choice, 'none');
    assert.equal(req.tools?.[0]?.function?.name, 'web_search');
  });
});
