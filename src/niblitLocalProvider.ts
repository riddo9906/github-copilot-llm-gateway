import * as vscode from 'vscode';
import { GatewayProvider } from './provider';
import { GatewayConfig } from './types';

const DEFAULT_NIBLIT_URL = 'http://127.0.0.1:8000/v1';

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

function localConfig(config: GatewayConfig): GatewayConfig {
  const settings = vscode.workspace.getConfiguration('github.copilot.llm-gateway');
  return {
    ...config,
    serverUrl: settings.get<string>('local.url', DEFAULT_NIBLIT_URL),
    requestTimeout: settings.get<number>('local.timeout', 120000),
    apiKey: '',
    customHeaders: {},
    enableImageInput: false,
  };
}

/** Separate local identity and endpoint, sharing the supported gateway API and SSE transport. */
export class NiblitLocalProvider implements vscode.LanguageModelChatProvider {
  private readonly delegate: GatewayProvider;
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.change.event;
  private discoveryTimer?: ReturnType<typeof setInterval>;
  private state: NiblitProviderState = {
    available: false,
    discovery: { cloudFound: false, endpointFound: false, models: [], endpointUrl: DEFAULT_NIBLIT_URL },
    lastChecked: 0,
  };

  constructor(context: vscode.ExtensionContext) {
    this.delegate = new GatewayProvider(context, localConfig, 'Niblit Local Provider');
    context.subscriptions.push(this, this.change,
      this.delegate.onDidChangeLanguageModelChatInformation(() => this.change.fire()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('github.copilot.llm-gateway.local')) {
          this.configureDiscovery();
        }
      })
    );
    this.configureDiscovery();
  }

  private configureDiscovery(): void {
    clearInterval(this.discoveryTimer);
    const settings = vscode.workspace.getConfiguration('github.copilot.llm-gateway');
    if (!settings.get<boolean>('local.enabled', true)) { return; }
    void this.runDiscovery();
    if (settings.get<boolean>('local.autodiscover', true)) {
      this.discoveryTimer = setInterval(() => void this.runDiscovery(), 30000);
    }
  }

  async runDiscovery(): Promise<void> {
    const source = new vscode.CancellationTokenSource();
    try {
      const models = await this.provideLanguageModelChatInformation({ silent: true }, source.token);
      const endpointUrl = vscode.workspace.getConfiguration('github.copilot.llm-gateway')
        .get<string>('local.url', DEFAULT_NIBLIT_URL);
      this.state = {
        available: models.length > 0,
        discovery: { cloudFound: models.length > 0, endpointFound: models.length > 0,
          models: models.map((model) => model.id), endpointUrl },
        lastChecked: Date.now(),
      };
      this.change.fire();
    } finally {
      source.dispose();
    }
  }

  getState(): NiblitProviderState {
    return { ...this.state, discovery: { ...this.state.discovery, models: [...this.state.discovery.models] } };
  }

  async provideLanguageModelChatInformation(
    options: { silent: boolean; configuration?: { readonly [key: string]: unknown } },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (!vscode.workspace.getConfiguration('github.copilot.llm-gateway').get<boolean>('local.enabled', true)) {
      return [];
    }
    const models = await this.delegate.provideLanguageModelChatInformation(options, token);
    return models.map((model) => ({ ...model, detail: 'Niblit Local' }));
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const streaming = vscode.workspace.getConfiguration('github.copilot.llm-gateway')
      .get<boolean>('local.streaming', true);
    const buffered: vscode.LanguageModelResponsePart[] = [];
    await this.delegate.provideLanguageModelChatResponse(model, messages, options,
      streaming ? progress : { report: (part) => buffered.push(part) }, token);
    if (!token.isCancellationRequested) {
      for (const part of buffered) { progress.report(part); }
    }
  }

  provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatMessage,
    token: vscode.CancellationToken
  ): Promise<number> {
    return this.delegate.provideTokenCount(model, text, token);
  }

  dispose(): void { clearInterval(this.discoveryTimer); }
}
