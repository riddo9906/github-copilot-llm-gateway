const { GatewayClient } = require('../out-test/client');
const config = {
  serverUrl: 'http://127.0.0.1:8000/v1', requestTimeout: 120000,
  defaultMaxTokens: 16384, defaultMaxOutputTokens: 1024,
  enableImageInput: false, enableToolCalling: false, parallelToolCalling: false,
  agentTemperature: 0, verboseLogging: true, customHeaders: {}, extraModelOptions: {},
};
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

(async () => {
  for await (const chunk of new GatewayClient(config, console.log).streamChatCompletion({
    model: 'qwen2.5-coder-3b', messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 32,
  }, token)) { /* trace is emitted by the client */ }
  for (const model of ['qwen2.5-0.5b', 'llama3.2-1b', 'qwen2.5-coder-3b']) {
  const start = Date.now();
  const response = await fetch('http://127.0.0.1:8000/v1/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: 'Complete this Python function. Output only the missing code.\ndef add(a, b):\n    return',
      max_tokens: 128, temperature: 0.1, stream: true }),
    signal: AbortSignal.timeout(120000),
  });
  const body = await response.text();
  console.log(JSON.stringify({ client: 'Continue autocomplete endpoint', model, status: response.status,
    contentType: response.headers.get('content-type'), elapsedMs: Date.now() - start, body: body.slice(0, 1800) }));
  if (!response.ok || !body.includes('[DONE]')) { process.exitCode = 1; }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
