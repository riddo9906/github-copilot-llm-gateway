// Run with VS Code --extensionDevelopmentPath=<repo> --extensionTestsPath=<this file>.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

exports.run = async function () {
  const report = [];
  const reportPath = path.join(__dirname, '..', '.vscode-smoke-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ phase: 'starting', startedAt: new Date().toISOString() }, null, 2));
  try {
    const extension = vscode.extensions.getExtension('AndrewButson.github-copilot-llm-gateway');
    if (!extension) { throw new Error('Gateway extension was not discovered'); }
    await extension.activate();
    for (const vendor of ['copilot-llm-gateway', 'niblit-local']) {
      const models = await vscode.lm.selectChatModels({ vendor });
      const model = models.find((candidate) => candidate.id === 'qwen2.5-coder-3b');
      if (!model) { throw new Error(`${vendor}: Qwen model missing: ${models.map((candidate) => candidate.id)}`); }
      const cancellation = new vscode.CancellationTokenSource();
      const started = Date.now();
      const longContext = process.env.NIBLIT_SMOKE_LONG === '1' && vendor === 'copilot-llm-gateway';
      const deadline = setTimeout(() => cancellation.cancel(), longContext ? 660000 : 120000);
      fs.writeFileSync(reportPath, JSON.stringify({ phase: 'requesting', vendor, longContext,
        startedAt: new Date(started).toISOString(), completed: report }, null, 2));
      try {
        const messages = longContext ? [
          vscode.LanguageModelChatMessage.User('Background file context:\n' + Array.from({ length: 260 }, (_, index) =>
            `// note ${index}: preserve cancellation, finite deadlines and valid SSE framing.\n`).join('')),
          vscode.LanguageModelChatMessage.User('Additional context:\n' + 'The gateway connects a VS Code client to a local inference server.\n'.repeat(60)),
          vscode.LanguageModelChatMessage.User('Read the file context above. Reply only with OK, without calling any tools.'),
        ] : [vscode.LanguageModelChatMessage.User('Reply with the single word OK.')];
        const tools = longContext ? Array.from({ length: 97 }, (_, index) => ({
          name: index === 0 ? 'read_file' : `unrelated_tool_${index}`,
          description: 'Available capability. '.repeat(90),
          inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        })) : undefined;
        const response = await model.sendRequest(messages,
          { modelOptions: { max_tokens: 32 }, tools, toolMode: vscode.LanguageModelChatToolMode.Auto }, cancellation.token);
        let text = '';
        let parts = 0;
        let firstPartMs;
        for await (const part of response.text) {
          firstPartMs ??= Date.now() - started;
          text += part;
          parts++;
        }
        if (!text.trim()) { throw new Error(`${vendor}: empty response`); }
        if (cancellation.token.isCancellationRequested) { throw new Error(`${vendor}: request cancelled`); }
        report.push({ vendor, model: model.id, longContext, offeredTools: tools?.length ?? 0,
          firstPartMs, elapsedMs: Date.now() - started, parts, text, completed: true });
      } finally {
        clearTimeout(deadline);
        cancellation.dispose();
      }
    }
  } catch (error) {
    report.push({ error: String(error), stack: error.stack });
    throw error;
  } finally {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }
};
