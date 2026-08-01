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

On extension activation, the gateway probes:

- `http://127.0.0.1:8000/healthz` — Niblit Cloud health
- `http://127.0.0.1:8080/health` — llama-server health
- `http://127.0.0.1:8000/v1/models` — OpenAI-compatible model list

If found, models are registered under the `niblit-local` provider. Discovery repeats every 30 seconds.

If Niblit is not running, the gateway continues normally — no startup failure.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `github.copilot.llm-gateway.local.enabled` | `true` | Enable auto-discovery |
| `github.copilot.llm-gateway.local.url` | `http://127.0.0.1:8000/v1` | Niblit Cloud endpoint |
| `github.copilot.llm-gateway.local.timeout` | `120000` | Request timeout (ms) |
| `github.copilot.llm-gateway.local.streaming` | `true` | Enable SSE streaming |
| `github.copilot.llm-gateway.local.autodiscover` | `true` | Periodic health probes |
| `github.copilot.llm-gateway.local.providerPriority` | `auto` | `auto`, `cloud`, `local`, `hybrid` |

## Provider Priority

- **auto** (default): Prefer local Niblit when available, fall back to configured serverUrl
- **cloud**: Always use the configured `serverUrl` (ignores local)
- **local**: Only use Niblit Local (no cloud fallback)
- **hybrid**: Round-robin between local and cloud

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
- Inline completion
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