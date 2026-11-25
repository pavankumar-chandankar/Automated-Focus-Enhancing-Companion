# Oplyra v0.8 — functional intelligence

The v0.7.1 local language model now has a restricted action-proposal channel. No JSON grammar, tool execution, OS permissions, new dependencies or cloud fallback. The runtime remains the existing Ollama server and qwen3.5:0.8b.

## Interaction
- Clear direct commands and declarations such as "Pause the session, I am taking a break" execute immediately. Native session transitions still validate phase and persist successfully before the reply indicates completion.
- Unfamiliar wording uses local inference. An exact whole-response token (PROPOSE START/PAUSE/RESUME/FINISH/QUIET/HIDE) is parsed in Rust, allowlisted and checked against the session phase. Unknown/malformed tokens, tool calls and invalid phases cannot become actions.
- The model cannot execute anything. Oplyra generates a trusted yes/no question. Confirmation is valid only for the current phase and pending request, expires after 60 seconds, and is cleared by closing/dragging/hiding or sending a different message. No proposal survives restart. Negated, hypothetical and quoted inputs receive an additional conservative guard against proposals.
- Yes executes only the pending allowed action via the existing app commands; no cancels; ambiguous confirmations do not execute. Model-proposed starts use a generic "Focus together" goal rather than storing model-invented or free-form context. Existing explicit goal declarations remain supported.
- Hide removes the character without ending a session, and menu-bar Show Oplyra restores it. Quiet sets the persisted quiet policy but does not stop work. Automatic nudges and screen observation are not implemented yet.
- Ordinary supportive dialogue remains generated. Model replies are display-only; the prompt prohibits claiming actions happened, but generated text is not guaranteed accurate. The native status reflects the actual persisted session state. The tiny model may fail to recognize a paraphrase or generate an invalid token; fallback remains available.

## Test on the M1
Keep the existing Ollama terminal running. Update the source branch, then run npm run build, npm run test:dialogue, cargo test --manifest-path src-tauri/Cargo.toml, npm run tauri dev.

1. Begin in a running session. Type "Pause the session, I am taking a break". Status becomes On a break; character rests.
2. Type "Alright, let's get going again". Status becomes Working together.
3. Try unfamiliar wording "I'm going to grab a coffee". If the model proposes Pause, verify no change until typing yes. Repeat and decline; verify unchanged.
4. Type "Don't pause the session", "Should I take a break?", "Pause and finish the session". Verify no state change. If any confirmation is pending, close/reopen or wait over 60 seconds and type yes; verify no action.
5. Test "I'm finished for today", "Let's study together", "Just sit with me", "Hide yourself". Restore from menu bar and verify existing work isn't deleted.
6. Test ordinary conversation, failure of Ollama, and malformed/incompatible output. Direct commands should work offline without inference. Run at least 30 paraphrases and record correct proposal, false proposal, missed proposal, and actual transition. Evaluate safety and latency with adults before distribution.

## Known limitations
This is a constrained intent experiment, not unrestricted tool calling. Existing session schema is unchanged. No general computer control, screen observation, voice, or autonomous interruptions. The small model may misunderstand and confirmation exists to protect against misclassification. Actual inference/action reliability, low power targets and multi-monitor placement must still be measured. No new dependency lockfiles are included.
