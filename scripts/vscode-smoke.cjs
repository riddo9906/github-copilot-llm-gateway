// Run with VS Code --extensionDevelopmentPath=<repo> --extensionTestsPath=<this file>.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

exports.run = async function () {
  const report = [];
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
      const deadline = setTimeout(() => cancellation.cancel(), 120000);
      try {
        const response = await model.sendRequest([
          vscode.LanguageModelChatMessage.User('Reply with the single word OK.')
        ], { modelOptions: { max_tokens: 32 } }, cancellation.token);
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
        report.push({ vendor, model: model.id, firstPartMs, elapsedMs: Date.now() - started, parts, text, completed: true });
      } finally {
        clearTimeout(deadline);
        cancellation.dispose();
      }
    }
  } catch (error) {
    report.push({ error: String(error), stack: error.stack });
    throw error;
  } finally {
    fs.writeFileSync(path.join(__dirname, '..', '.vscode-smoke-report.json'), JSON.stringify(report, null, 2));
  }
};
