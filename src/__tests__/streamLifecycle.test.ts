import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type * as vscode from 'vscode';
import { GatewayClient } from '../client';
import { GatewayConfig } from '../types';

const config: GatewayConfig = {
  serverUrl: 'http://127.0.0.1:8000/v1/', requestTimeout: 1000,
  defaultMaxTokens: 16384, defaultMaxOutputTokens: 1024,
  enableImageInput: false, enableToolCalling: false, parallelToolCalling: false,
  agentTemperature: 0, verboseLogging: false, customHeaders: {}, extraModelOptions: {},
};

function cancellation() {
  const listeners = new Set<() => void>();
  const token: vscode.CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: (event: unknown) => unknown) => {
      const callback = () => { listener(undefined); };
      listeners.add(callback);
      return { dispose: () => { listeners.delete(callback); } };
    },
  };
  return { token, listeners, cancel: () => {
    Object.assign(token, { isCancellationRequested: true });
    for (const listener of listeners) { listener(); }
  } };
}

const request = { model: 'qwen2.5-coder-3b', messages: [{ role: 'user', content: 'hello' }], max_tokens: 32 };
const delta = 'data:{"choices":[{"delta":{"content":"hello"}}]}\r\n\r\n';

describe('stream lifecycle', () => {
  test('normalizes URL, sends POST/SSE, handles split CRLF frames and stops at DONE on an open connection', async (t) => {
    const cancel = cancellation();
    let readerCancelled = false;
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      assert.equal(url, 'http://127.0.0.1:8000/v1/chat/completions');
      assert.equal(init.method, 'POST');
      const body = JSON.parse(String(init.body));
      assert.equal(body.stream, true);
      assert.equal(body.model, request.model);
      assert.equal(body.max_tokens, 32);
      return new Response(new ReadableStream({
        start(controller) {
          for (const piece of [delta.slice(0, 13), delta.slice(13), 'data: [DO', 'NE]\r\n\r\n']) {
            controller.enqueue(new TextEncoder().encode(piece));
          }
          // Intentionally leave the socket open: DONE must terminate it.
        },
        cancel() { readerCancelled = true; },
      }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const logs: string[] = [];
    const chunks = [];
    for await (const chunk of new GatewayClient(config, (line) => logs.push(line)).streamChatCompletion(request, cancel.token)) {
      chunks.push(chunk);
    }
    assert.equal(chunks.map((chunk) => chunk.content).join(''), 'hello');
    assert.equal(readerCancelled, true);
    assert.equal(cancel.listeners.size, 0);
    assert.ok(logs.some((line) => line.includes('done=true')));
    assert.ok(!logs.some((line) => line.includes('"content":"hello"')));
  });

  test('processes the final frame without a trailing newline', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(delta.trim()));
    const chunks = [];
    for await (const chunk of new GatewayClient(config).streamChatCompletion(request, cancellation().token)) {
      chunks.push(chunk.content);
    }
    assert.equal(chunks.join(''), 'hello');
  });

  test('reports header timeout and cleans up its cancellation subscription', async (t) => {
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }));
    const cancel = cancellation();
    await assert.rejects(async () => {
      for await (const _chunk of new GatewayClient({ ...config, requestTimeout: 20 }).streamChatCompletion(request, cancel.token)) { /* consume */ }
    }, /header_timeout/);
    assert.equal(cancel.listeners.size, 0);
  });

  test('distinguishes body inactivity from user cancellation', async (t) => {
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
      },
    })));
    await assert.rejects(async () => {
      for await (const _chunk of new GatewayClient({ ...config, requestTimeout: 20 }).streamChatCompletion(request, cancellation().token)) { /* consume */ }
    }, /inactivity_timeout/);
    const cancel = cancellation();
    const stream = new GatewayClient(config).streamChatCompletion(request, cancel.token);
    const pending = stream.next();
    cancel.cancel();
    assert.equal((await pending).done, true);
    assert.equal(cancel.listeners.size, 0);
  });

  test('propagates a server error frame', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response('data: {"error":{"message":"governance denied"}}\n\n'));
    await assert.rejects(async () => {
      for await (const _chunk of new GatewayClient(config).streamChatCompletion(request, cancellation().token)) { /* consume */ }
    }, /governance denied/);
  });
});
