# Niblit Local Provider

## Overview

The Niblit Local Provider adds Niblit as a first-class inference provider in the GitHub Copilot LLM Gateway. It auto-discovers Niblit Cloud and llama-server running on localhost, fetches available models, and routes VS Code AI requests through the local GGUF inference stack.

## Architecture

```
VS Code
    │
    ▼
GitHub Copilot LLM Gateway
    │
    ├── copilot-llm-gateway (configured serverUrl)
    └── niblit-local (auto-discovered)
            │
            ▼
    Niblit Cloud (http://127.0.0.1:8000/v1)
            │
            ▼
    llama-server (http://127.0.0.1:8080)
            │
            ▼
    Local GGUF Model
```

## Auto-Discovery

On extension activation, the local provider queries the configured OpenAI model endpoint:

- `http://127.0.0.1:8000/v1/models` — OpenAI-compatible model list

If found, models are registered under the `niblit-local` provider. Discovery repeats every 30 seconds.

If Niblit is not running, the gateway continues normally — no startup failure.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `github.copilot.llm-gateway.local.enabled` | `true` | Enable auto-discovery |
| `github.copilot.llm-gateway.local.url` | `http://127.0.0.1:8000/v1` | Niblit Cloud endpoint |
| `github.copilot.llm-gateway.local.timeout` | `120000` | Request timeout (ms) |
| `github.copilot.llm-gateway.local.streaming` | `true` | Report SSE parts immediately; false buffers them until completion |
| `github.copilot.llm-gateway.local.autodiscover` | `true` | Periodic health probes |
| `github.copilot.llm-gateway.local.providerPriority` | `auto` | `auto`, `cloud`, `local`, `hybrid` |

## Provider Selection

Choose **LLM Gateway** or **Niblit Local** explicitly in VS Code's chat model picker.
The registered vendor IDs are `copilot-llm-gateway` and `niblit-local`; both are declared in the extension manifest.
`local.providerPriority` is a legacy setting and does not route requests between these vendors.

For Niblit Cloud, set both server URLs to `http://127.0.0.1:8000/v1`.
The gateway normalizes `/v1` before appending API paths. This URL is an inference endpoint and must not be used as an HTTP proxy.

Use `defaultMaxTokens: 16384` and `defaultMaxOutputTokens: 1024` when the server omits context metadata.
Set `modelOutputTokenLimits: { "qwen2.5-0.5b": 256 }` for the utility model.
Caller output options can reduce these ceilings but cannot raise them. Cloud governance remains authoritative.

## Supported Endpoints

All OpenAI-compatible endpoints are supported:

- `/v1/chat/completions` — Chat (streaming + non-streaming)
- `/v1/models` — Model listing
- `/v1/completions` — Text completions
- Tool calling (if the GGUF model supports it)

## VS Code Integration

VS Code AI features that work through the local provider:

- Copilot Chat
- Agent Mode
- Edit suggestions
- Code explanation
- Workspace reasoning
- Terminal agent
- Debug assistance
- Refactoring

## Authentication

No API key is required for localhost Niblit servers. For remote Niblit instances, set `NIBLIT_API_KEY` environment variable or configure a Bearer token.

## Troubleshooting

### "Niblit Local: Not found"
1. Start Niblit Cloud: `cd Niblit-cloud-server && python main.py`
2. Verify: `curl http://127.0.0.1:8000/healthz`
3. Run "Discover Local Niblit" command from the Command Palette

### "Model not responding"
- Check llama-server: `curl http://127.0.0.1:8080/health`
- Verify GGUF model is loaded in Niblit Cloud

### "Streaming not working"
- Ensure `github.copilot.llm-gateway.local.streaming` is `true`
- Check that the GGUF model supports streaming (most do)

## Manual Configuration

If auto-discovery fails, manually configure the gateway:

1. Run "Configure Server" command
2. Set Server URL to `http://127.0.0.1:8000`
3. Leave API Key blank (no auth for localhost)
4. Click "Refresh Models"

## Niblit Setup

Install and start Niblit Cloud:

```bash
cd Niblit-cloud-server
python main.py
```

Expected output:
```
Cloud Server Boot
Loading configuration
Loading storage
...
Cloud READY
```

Place GGUF models in `~/llama_migration/models/` and set `NIBLIT_GGUF_MODEL` environment variable.
</arg_value><arg_key>task_progress</arg_key><arg_value>- [x] Study Copilot Gateway architecture
- [x] Create NiblitLocalProvider with auto-discovery
- [x] Integrate into extension.ts activation
- [x] Update package.json with Niblit config + commands
- [x] Register discover command in extension.ts
- [x] Create LOCAL_PROVIDER.md documentation
- [ ] Test build</arg_value></tool_call>
