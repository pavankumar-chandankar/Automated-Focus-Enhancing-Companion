# Oplyra v0.7 — local language intelligence experiment

Goal: natural, short, emotionally warm focus companionship, not task tutoring or a general assistant. This is an adult development preview. No claim of clinical capability or genuine emotions.

## Install on an M1 Mac
Install Ollama with Homebrew: `brew install ollama`. In a dedicated Terminal, run
```sh
OLLAMA_NO_CLOUD=1 OLLAMA_HOST=127.0.0.1:11434 ollama serve
```
Leave that terminal running. If port 11434 is occupied by an existing Ollama instance, quit it first, then restart in local-only mode. In a separate terminal, download `ollama pull qwen3.5:0.8b`. This is a one-time network requirement (roughly 1.2–1.3 GB model download; runtime memory differs). Do not use a cloud-tagged model.

From the companion folder:
```sh
npm run build
npm run test:dialogue
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

## Implementation
- Known explicit start/pause/resume/end/quiet commands retain deterministic session semantics. Emotional statements and unfamiliar phrases route to the local language model. Explicit recognized crisis phrases bypass the model. This limited check is not a robust safety classifier.
- The Rust provider sends the message, phase and at most one previous successful conversational turn to the fixed 127.0.0.1 Ollama endpoint. No screen data, goal text, system data, tools, network proxy or redirects. No app transcript is persisted. Previous turn is cleared on close, drag or a deterministic command. Ollama's own runtime is a separate process, not under Oplyra's full control.
- Structured output must contain only bounded reply text and an allowed reaction. Model cannot invoke commands. Prompt constraints do not guarantee safe or correct responses; adult-only evaluation is required. No cloud fallback.
- The request uses 2048 context tokens, at most 120 generated tokens, thinking off, keep_alive=0 (request model unload after reply), a 45-second timeout and one in-flight request. Closing the bubble discards the reply, not the in-flight computation. This trades cold-start latency against idle RAM.
- Model source and end-to-end response latency are shown in small text. If unavailable, malformed or timed out, basic deterministic dialogue remains available. No prompts run in the background.

## Test plan
1. Compare paraphrases, not just known commands: "My thoughts keep jumping around", "I feel like I wasted the morning", "I'm finding it hard to sit still", "Could you keep me company while I try again?".
2. Follow up within the same bubble to test short memory; close/reopen and verify no transcript reappears.
3. Request an unsupported task or ask it to change system settings. Ensure no native action occurs. Test explicit commands separately.
4. Stop Ollama; verify fallback. Disconnect internet after model download; test local inference. Use Activity Monitor and `ollama ps` to check memory/CPU during and between replies.
5. Record cold response latency, output relevance, inappropriate replies, idle and peak RAM. Evaluate at least 30 varied prompts before choosing the model. Compare a larger local model or a separately consented hosted provider only if required. No automated test claims to establish dialogue quality, safety or power consumption.

## Future provider strategy
The native inference function is isolated from dialogue routing and session policy. A hosted provider may be added after evaluation, with an explicit opt-in and separate secret handling; never silently send local prompts or future screen content off-device. Offline availability remains desirable but is not a release blocker. Voice, optional screen awareness and automatic intervention are not included here.
