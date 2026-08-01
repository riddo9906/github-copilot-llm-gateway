/**
 * Niblit Local Provider — first-class local inference provider for the
 * GitHub Copilot LLM Gateway.
 *
 * Uses request-scoped lifecycle to avoid abort/timeout leaks between
 * consecutive requests. Stable non-streaming transport by default.
 */

import * as vscode from 'vscode';
import { GatewayClient } from './client';
import { GatewayConfig, OpenAIModelsResponse } from './types';
import {
  convertMessage,
  NormalizedMessage,
  NormalizedRole,
} from './messageConverter';
import { buildChatRequest } from './requestBuilder';

const NIBLIT_HEALTH_ENDPOINTS = [
  { label: 'Niblit Cloud', url: 'http://127.0.0.1:8000/healthz' },
  { label: 'OpenAI endpoint', url: 'http://127.0.0.1:8000/v1/models' },
];

const DEFAULT_NIBLIT_URL = 'http://127.0.0.1:8000/v1';
const DEFAULT_LOCAL_TIMEOUT_MS = 300000;

export interface NiblitDiscoveryResult {
  cloudFound: boolean;
  endpointFound: boolean;
  models: string[];
  endpointUrl: string;
}

export interface NiblitProviderState {
  available: boolean;
  discovery: NiblitDiscoveryResult;
  lastChecked: number;
}

async function probeUrl(url: string, timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method: 'GET', signal: controller.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNiblitModels(baseUrl: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/models`;
  try {
    const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return [];
    const data = (await resp.json()) as OpenAIModelsResponse;
    if (!data?.data) return [];
    return data.data.map((m) => m.id).filter(Boolean);
  } catch {
    return [];
  }
}

export async function discoverNiblit(): Promise<NiblitDiscoveryResult> {
  const cloudFound = await probeUrl(NIBLIT_HEALTH_ENDPOINTS[0].url);
  const endpointFound = cloudFound;
  const endpointUrl = DEFAULT_NIBLIT_URL;
  const models = endpointFound ? await fetchNiblitModels(endpointUrl) : [];

  return { cloudFound, endpointFound, models, endpointUrl };
}

interface RequestLifecycle {
  requestId: string;
  controller: AbortController;
  timeoutHandle?: NodeJS.Timeout;
  cancellationDisposable?: vscode.Disposable;
}

function createRequestLifecycle(requestId: string, token: vscode.CancellationToken): RequestLifecycle {
  const controller = new AbortController();
  const cancellationDisposable = token.onCancellationRequested(() => controller.abort());
  return {
    requestId,
    controller,
    cancellationDisposable,
  };
}

function cleanupRequest(lifecycle: RequestLifecycle): void {
  if (lifecycle.timeoutHandle) {
    clearTimeout(lifecycle.timeoutHandle);
  }
  lifecycle.cancellationDisposable?.dispose();
}

export class NiblitLocalProvider implements vscode.LanguageModelChatProvider {
  private _state: NiblitProviderState = {
    available: false,
    discovery: {
      cloudFound: false,
      endpointFound: false,
      models: [],
      endpointUrl: DEFAULT_NIBLIT_URL,
    },
    lastChecked: 0,
  };

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

  private client?: GatewayClient;
  private discoveryTimer?: NodeJS.Timeout;
  private readonly outputChannel: vscode.OutputChannel;
  supportsStreaming = false;

  constructor(context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel('Niblit Local Provider');
    context.subscriptions.push(this.outputChannel, this._onDidChange);
    void this.runDiscovery();
    this.discoveryTimer = setInterval(() => void this.runDiscovery(), 30_000);
    context.subscriptions.push({ dispose: () => clearInterval(this.discoveryTimer) });
  }

  async runDiscovery(): Promise<void> {
    const discovery = await discoverNiblit();
    this._state = {
      available: discovery.endpointFound,
      discovery,
      lastChecked: Date.now(),
    };

    if (discovery.endpointFound) {
      this.outputChannel.appendLine(`[Niblit] Active Local Endpoint: ${discovery.endpointUrl}`);
      this.outputChannel.appendLine(`[Niblit] Detected Models: ${discovery.models.join(', ') || '<none>'}`);
      if (!this.client) {
        const config: GatewayConfig = {
          serverUrl: discovery.endpointUrl,
          apiKey: '',
          requestTimeout: DEFAULT_LOCAL_TIMEOUT_MS,
          defaultMaxTokens: 262144,
          defaultMaxOutputTokens: 4096,
          enableImageInput: false,
          enableToolCalling: true,
          parallelToolCalling: true,
          agentTemperature: 0.0,
          verboseLogging: false,
          customHeaders: {},
          extraModelOptions: {},
        };
        this.client = new GatewayClient(config, (msg) => this.outputChannel.appendLine(`[Niblit] ${msg}`));
      }
    } else {
      this.outputChannel.appendLine('[Niblit] Not found — will retry');
    }

    this._onDidChange.fire();
  }

  getState(): NiblitProviderState {
    return { ...this._state, discovery: { ...this._state.discovery } };
  }

  async provideLanguageModelChatInformation(): Promise<vscode.LanguageModelChatInformation[]> {
    if (!this._state.available || this._state.discovery.models.length === 0) {
      return [];
    }
    return this._state.discovery.models.map((modelId) => ({
      id: modelId,
      vendor: 'niblit-local',
      name: modelId,
      maxInputTokens: 16384,
      maxOutputTokens: 4096,
      capabilities: {
        chat: true,
        streaming: false,
        toolCalling: true,
        imageInput: false,
      },
    }));
  }

  async provideLanguageModelChat(
    request: vscode.LanguageModelChatRequest,
    options: vscode.LanguageModelChatRequestOptions,
    progress: vscode.Progress<vscode.LanguageModelChatResponse>
  ): Promise<void> {
    if (!this.client) {
      throw new vscode.LanguageModelError('Niblit Local not available', { retryable: true });
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const debug = process.env.NIBLIT_LOCAL_DEBUG === 'true';
    const baseUrl = (this.client as any).config.serverUrl;

    if (debug) {
      this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] provider instance: ${this.client.config.serverUrl}`);
      this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] base URL: ${baseUrl}`);
    }

    const lifecycle = createRequestLifecycle(requestId, options.token);
    const chatRequest = this.buildChatRequest(request, options);

    if (debug) {
      this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] final request URL: ${baseUrl}/v1/chat/completions`);
      this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] selected model: ${chatRequest.model}`);
      this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] streaming=false`);
      this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] timeout: ${DEFAULT_LOCAL_TIMEOUT_MS}`);
      this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] normalized request body:\n${JSON.stringify(chatRequest, null, 2)}`);
    }

    this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] request started`);

    try {
      lifecycle.timeoutHandle = setTimeout(() => {
        lifecycle.controller.abort();
      }, DEFAULT_LOCAL_TIMEOUT_MS);

      if (options.token.isCancellationRequested) {
        this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] cancellation source: already_cancelled`);
        throw new vscode.LanguageModelError('Niblit Local request cancelled before start', { retryable: true });
      }

      const response = await fetch(`${normalizeBaseUrl(baseUrl)}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatRequest),
        signal: lifecycle.controller.signal,
      });

      this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] response status: ${response.status}`);
      this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] response content-type: ${response.headers.get('content-type')}`);

      const rawText = await response.text();
      if (debug) {
        this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] raw response body:\n${rawText}`);
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] invalid_response: invalid JSON`);
        throw new vscode.LanguageModelError('Niblit Local returned invalid JSON', { retryable: false });
      }

      const content = parsed?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] invalid_response: no assistant content`);
        throw new vscode.LanguageModelError('Niblit Local response contained no assistant content', { retryable: true });
      }

      this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] parsed assistant content: ${content.slice(0, 120)}`);

      const message = new vscode.LanguageModelChatResponse();
      message.content = new vscode.LanguageModelChatResponsePart(
        new vscode.LanguageModelChatResponsePartDelta(content)
      );
      progress.report(message);

      this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] returned response to VS Code`);
    } catch (error) {
      if (lifecycle.controller.signal.aborted && options.token.isCancellationRequested) {
        this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] cancellation source: user_cancelled`);
        throw new vscode.LanguageModelError('Niblit Local request cancelled by user', { retryable: true });
      }
      if (lifecycle.controller.signal.aborted && lifecycle.timeoutHandle && !options.token.isCancellationRequested) {
        this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] cancellation source: local_timeout`);
        throw new vscode.LanguageModelError(`Niblit Local request timed out after ${DEFAULT_LOCAL_TIMEOUT_MS}ms`, { retryable: true });
      }
      this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] connection_failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new vscode.LanguageModelError(`Niblit Local endpoint unavailable at ${DEFAULT_NIBLIT_URL}: ${error instanceof Error ? error.message : String(error)}`, { retryable: true });
    } finally {
      cleanupRequest(lifecycle);
      this.outputChannel.appendLine(`[NIBLIT LOCAL][${requestId}] request cleanup completed`);
    }
  }

  dispose(): void {
    clearInterval(this.discoveryTimer);
  }

  private mapRole(role: vscode.LanguageModelChatMessageRole): NormalizedRole {
    if (role === vscode.LanguageModelChatMessageRole.Assistant) return 'assistant';
    if (role === vscode.LanguageModelChatMessageRole.System) return 'system';
    return 'user';
  }

  private classifyPart(part: vscode.LanguageModelChatMessagePart): any {
    if (part instanceof vscode.LanguageModelTextPart) {
      return { type: 'text', text: part.value };
    }
    if (part instanceof vscode.LanguageModelToolCallPart) {
      return {
        type: 'tool_call',
        tool_call_id: part.toolCallId,
        function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) },
      };
    }
    if (part instanceof vscode.LanguageModelToolResultPart) {
      return {
        type: 'tool_result',
        tool_call_id: part.toolCallId,
        content: this.flattenToolResultContent(part.content),
      };
    }
    if (part instanceof vscode.LanguageModelDataPart) {
      return { type: 'data', mimeType: part.mimeType, data: part.data };
    }
    return { type: 'text', text: '' };
  }

  private flattenToolResultContent(parts: readonly vscode.LanguageModelChatResponsePart[]): string {
    const partsArray = Array.isArray(parts) ? parts : [parts];
    return partsArray.map((p) => {
      if (p instanceof vscode.LanguageModelTextPart) return p.value;
      if (p instanceof vscode.LanguageModelDataPart) return `[data:${p.mimeType}]`;
      return '';
    }).join('');
  }

  private convertAllMessages(messages: readonly vscode.LanguageModelChatMessage[]): any[] {
    const result: any[] = [];
    const log = (msg: string): void => this.outputChannel.appendLine(msg);
    for (const msg of messages) {
      const normalized: NormalizedMessage = {
        role: this.mapRole(msg.role),
        parts: msg.content.map((part) => this.classifyPart(part)),
      };
      result.push(...convertMessage(normalized, { enableImageInput: false }, log));
    }
    return result;
  }

  private buildChatRequest(
    request: vscode.LanguageModelChatRequest,
    options: vscode.LanguageModelChatRequestOptions
  ): any {
    const openAIMessages = this.convertAllMessages(request.messages);

    const body = buildChatRequest({
      model: options.modelName || 'local',
      messages: openAIMessages,
      maxTokens: options.modelOptions?.maxTokens ?? 4096,
      temperature: options.modelOptions?.temperature ?? 0.2,
      stream: false,
      stream_options: undefined,
      tools: [],
      toolChoice: undefined,
      parallelToolCalls: undefined,
      extraOptions: {},
    });

    return body;
  }
}

function normalizeBaseUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  while (url.endsWith('/')) { url = url.slice(0, -1); }
  url = url.replace(/\/(openai\/)?v1$/i, '');
  return url;
}