# v0.11.1 — ambient overlay repair

## Changes
- macOS native non-activating floating panel via pinned tauri-nspanel, first-click webview support, no focus request on tray restore. Explicit input clicks request keyboard focus; folding releases it. Native panel conversion is experimental and must be tested on hardware, including destruction/restore. No screen-share hiding or evasion features.
- Folding keeps ordinary last reply, draft and recent four exchanges. Consent prompts and unconfirmed actions are invalidated. Hiding still destroys the view and clears chat history; session/draft retained as before.
- Native worker checks every five seconds, starts an OCR attempt at most every 15 seconds while compact, visible and explicitly opted in. Removes dependence on background WebKit timer delivery. Foreground-window resolution uses the WindowServer order joined with eligible ScreenCaptureKit windows, ignoring tiny auxiliary windows. Diagnostics show whether no eligible window or no readable text.
- A deliberate new selection option follows supported foreground work apps (not an unrestricted display stream). No capture in unsupported applications. Browsers can still show sensitive data; stop observing before opening sensitive pages. No automatic cloud transmission, no image retention, no audio. Normal chat cannot see raw OCR. Reviewed one-shot analysis remains.
- A neutral return cue after two minutes without an eligible window, then successful OCR, and existing coarse activity cues appear as a small passive bubble on the character for 12 seconds. At most two return cues per opt-in, ten-minute separation. No autonomous task relevance judgment or state changes; no new API calls for passive cues.

## Acceptance checks
1. Click and drag character immediately from Chrome, without prior click. Check Chrome stays the active application; explicit text input can receive keys. Fold and type in Chrome. Check tray hide/show and no ghost window; test repeated cycles.
2. Chat, fold, reopen; verify previous ordinary reply and draft persist. Verify pending actions cannot be accidentally confirmed after fold.
3. Start session; say Watch my screen, choose Follow supported work apps, explicitly confirm. Fold and work in Chrome, then TextEdit. Wait for Screen · read, ask What am I working on? Review actual excerpt and verify no Groq request unless clicking Analyze with Groq once.
4. Switch to an unsupported foreground app for >2 minutes with bubble folded; return to an eligible document. Check subtle passive cue. Verify no app activation, no automatic session change and stop/hide/pause disables observation.
5. Check native compilation, memory/CPU, permission denial, empty/changed window and cloud budget. No actual macOS validation is claimed before these checks.
