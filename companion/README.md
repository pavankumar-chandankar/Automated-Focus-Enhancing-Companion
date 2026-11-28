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

## v0.8.1 menu-bar lifecycle and draft preservation

See [OVERLAY_LIFECYCLE_V081.md](OVERLAY_LIFECYCLE_V081.md). The drop target is created on demand and destroyed after dragging; hiding destroys the companion window and leaves only the tray process. macOS accessory activation and LSUIElement remove conventional application presence. Unsent drafts survive moving, folding and tray restoration in RAM until quit.

## v0.9 contextual intelligence

See [CONTEXTUAL_INTELLIGENCE_V09.md](CONTEXTUAL_INTELLIGENCE_V09.md). The default local provider and explicit experimental DeepSeek cloud provider share a versioned personality prompt, current native session facts, four recent exchanges and the existing confirmed action protocol. No cloud requests without explicit launch configuration. No screen data or microphone access.

## v0.10 contextual awareness

See [CONTEXTUAL_AWARENESS_V010.md](CONTEXTUAL_AWARENESS_V010.md). macOS-only session-scoped, opt-in foreground-app category and inactivity sampling; conservative local check-ins, no observation data sent to AI. Voice remains deferred.

## v0.11 semantic screen awareness preview

See [SCREEN_AWARENESS_V011.md](SCREEN_AWARENESS_V011.md). User-selected foreground-window capture on macOS 14+, local Apple Vision OCR, reviewed one-shot Groq relevance analysis, and a persistent 20-attempt UTC-day budget. No autonomous cloud analysis or screen/audio recording. Voice deferred.

## v0.11.1 ambient overlay repair

See [AMBIENT_OVERLAY_V0111.md](AMBIENT_OVERLAY_V0111.md). Experimental non-activating macOS panel, native OCR scheduler, explicit follow-work-apps mode, preserved ordinary replies and passive check-ins. Cloud screen analysis still requires reviewed approval.

## v0.11.2 automatic foreground following

See [FOLLOW_CONTEXT_V0112.md](FOLLOW_CONTEXT_V0112.md). One session opt-in, no window chooser, optional Groq chat-time screen context, larger bounded native panel. No background cloud observation.

## v0.12 proactive monitoring preview

See [PROACTIVE_MONITOR_V012.md](PROACTIVE_MONITOR_V012.md). Small floating companion, separate maximizable analytics window, explicitly authorized automatic goal-relative checks, improved OCR and bounded passive reminders.

## v0.13 embodied presence

See [EMBODIED_PRESENCE_V013.md](EMBODIED_PRESENCE_V013.md). Independent local character behaviour, responsive facial expressions, touch and drag reactions, sparse autonomous gestures and time-limited dialogue reactions. No additional inference, sensing or permissions.

## v0.13.1 — local tab-switch speech reminders

See [TAB_REMINDERS_V0131.md](TAB_REMINDERS_V0131.md). Explicit local reference-tab monitoring and a native non-activating speech panel outside the compact webview.
