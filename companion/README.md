# Oplyra desktop — companionship preview (v0.6)

You do the work. Oplyra keeps you company.

Oplyra is an optional floating, borderless character with a small text conversation bubble. Click to talk; click and move to drag; drop on the bin to hide; restore via the menu bar. No normal window, timer dashboard, goal form or assistance settings are presented.

## Try it

- "Let's study together" starts a local focus session.
- "I need to work on my paper" starts with an explicitly declared goal.
- "I'm getting distracted" offers a brief encouragement.
- "I need a break", "I'm back", "I'm done" manage the session.
- "Just sit with me" or "Don't interrupt me" selects quiet support.
- "What can you do?" explains supported phrases.

The dialogue is intentionally limited English phrase recognition, not an LLM or a general chatbot. It does not answer subject questions, infer feelings, monitor activities, or pretend to have consciousness. Character states express available, attentive, working, resting, encouraging and celebrating behaviour. The existing native session store and adaptive policy remain, but v0.6 does not trigger return offers or collect cue feedback. A manual resume uses the non-intervening native path. Conversation text/replies are ephemeral; only an explicitly declared session goal and existing session data are persisted. No new dependencies, screen/microphone permission, network calls or periodic session polling. Existing app identifier remains unchanged. Voice and session-authorized context sensing are future work.

## Development

From companion:
```sh
npm install --no-audit --no-fund
npm run build
npm run test:dialogue
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

## Acceptance gates

Test launch, click open/close, instant drag, drop-to-hide and restore on the M1. Verify start/break/return/finish and a restored v0.5 session. Verify unknown input does not execute a session action; closing the bubble clears dialogue. Keep network disconnected after dependency installation and confirm all functions work. Measure the packaged app (including WebKit subprocesses); low energy/RAM is a goal, not a verified result. Screen-aware placement, optional microphone/voice, consent-scoped sensing, adaptive encouragement, delete/export and signed distribution are unfinished. Adults-only formative testing.

## v0.7 local AI experiment

See [LOCAL_AI_V07.md](LOCAL_AI_V07.md) for installing the optional local model, its constraints and the test protocol. The model generates short supportive replies for free-form input. Session commands are deterministic; the scripted fallback remains when the model is unavailable. No cloud provider is configured.

## v0.8 functional intelligence

See [FUNCTIONAL_INTELLIGENCE_V08.md](FUNCTIONAL_INTELLIGENCE_V08.md). The language model can suggest only an allowlisted action. Unfamiliar model proposals require explicit yes/no confirmation, with a 60-second expiry. Direct clear commands remain immediate. No additional downloads or dependencies.
