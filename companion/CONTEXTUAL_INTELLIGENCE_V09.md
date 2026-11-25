# v0.9 — contextual intelligence and optional DeepSeek provider

## What changed
- Versioned compact personality prompt in src-tauri/src/prompts/companion_v09.txt.
- Fresh native snapshot on each inference: active goal only, phase, elapsed minutes, quiet mode, explicit screen-observation=false. Not an attention measurement.
- Four recent completed exchanges in webview RAM, including confirmed successful actions and visible confirmation questions. Folding and dragging retain context. Hide destroys the window and its chat history; unsent draft and persisted session survive as in v0.8.1. Quit clears chat history. Type "forget our chat" to clear the local history without ending the session. This cannot delete data already sent to a provider.
- Local Ollama remains default. 4096 context tokens, at most 120 generated tokens, unload after each reply.
- Optional hosted DeepSeek Flash non-thinking mode, fixed HTTPS endpoint with TLS verification, no redirects/proxies/tools, at most 120 generated tokens. Both providers use strict whole-line proposals requiring confirmation; direct commands remain deterministic. No automatic provider fallback. On failure, basic dialogue remains.
- Cloud credential read by native process from DEEPSEEK_API_KEY, not source, app storage or webview. No real API key is included. This environment-variable approach is for developer testing only; production needs a secure backend, quotas, consent, data-retention and cross-border transfer review. No silent collection of files, audio or screen contents.
- The active provider is identified in the conversation bubble.

## Run locally
From companion, keep the existing Ollama server running:
```sh
unset OPLYRA_PROVIDER DEEPSEEK_API_KEY
npm run tauri dev
```

## Run with DeepSeek (developer-only, opt-in)
Create a key at https://platform.deepseek.com/api_keys and review API terms, privacy policy and pricing. Top up only if needed. The hosted provider receives the typed message, four recent chat exchanges and declared active goal/session facts. Do not send sensitive, confidential or third-party personal information. Your API balance is charged. Stop Ollama if you no longer need local inference. In the macOS zsh Terminal, from companion:
```sh
read -rs 'DEEPSEEK_API_KEY?DeepSeek API key: '; echo
export DEEPSEEK_API_KEY
OPLYRA_PROVIDER=deepseek npm run tauri dev
```
After stopping the development process, run unset DEEPSEEK_API_KEY. Never share keys in chat, commits, files or screenshots. No live cloud request is made by CI.

## Evaluation scenarios
Run both providers against the same cases. Start a session with "I need to work on mechanics", then "The introduction is giving me trouble", "I tried again", "Still stuck on it". Fold/reopen before the last turn. Test "I'm going to grab a coffee" and confirm only if appropriate, then "I'm back" and ask what the session goal was. Check "Don't pause" and ambiguous references; verify no action without confirmation. Type "forget our chat" and verify old chat isn't referenced (session facts still available). Hide/restore and verify fresh conversation and preserved draft. Score contextual relevance, consistency, warmth, correct actions, false proposals, latency, API cost. No claims of model quality or safety before evaluation. No screen sensing, voice or new background intervention. Keep v0.8.1 drag, bin and draft lifecycle unchanged.

## References
- https://api-docs.deepseek.com/quick_start/pricing/
- https://api-docs.deepseek.com/api/create-chat-completion/
- https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017

## v0.9.1 — local model comparison (zero API fees)

With the local Ollama server running, download `ollama pull qwen3.5:2b` once. Launch from companion with `OPLYRA_PROVIDER=local OPLYRA_LOCAL_MODEL=qwen3.5:2b npm run tauri dev`. Only the two official local tags qwen3.5:0.8b and qwen3.5:2b are accepted. No implicit online fallback. The response footer identifies the selected model. Keep the 0.8B model for comparison; set OPLYRA_LOCAL_MODEL=qwen3.5:0.8b to revert. Model quality, speed and RAM on the 8GB M1 remain experimental; download size is not runtime RAM. No screen context added.

## v0.9.2 — Groq free-plan development experiment

Use an API key from a Groq Free account only. Do not upgrade or add payment details. The application cannot verify the account's billing tier. Stop Ollama; cloud inference requires no local model server. From the companion directory in zsh, run:

```sh
unset DEEPSEEK_API_KEY
read -rs 'GROQ_API_KEY?Groq API key: '; echo
export GROQ_API_KEY
OPLYRA_PROVIDER=groq npm run tauri dev
```

The key is not stored by the app. After quitting, `unset GROQ_API_KEY`. The fixed HTTPS endpoint uses openai/gpt-oss-120b, low reasoning effort, include_reasoning=false and a 512 completion-token cap (including reasoning). No tools, paid fallback, automatic retries at the application level, background polling, or model downloads. Existing session actions and confirmation rules remain unchanged. HTTP 429 blocks further Groq requests in this process for the provider's retry-after seconds (default 60 seconds); the app shows a quota notice and basic local dialogue remains available. Do not restart to bypass quota. The Free plan itself controls billing and usage. Verify account tier at https://console.groq.com/settings/billing and limits at https://console.groq.com/settings/limits. Typed message, recent four exchanges and declared session facts are transmitted to Groq; no screens or audio. Do not send sensitive information. Live API and dialogue quality require user testing; CI uses no API key.

Official docs: https://console.groq.com/docs/reasoning and https://console.groq.com/docs/rate-limits
