# Oplyra v0.5 — Adaptive Intelligence Foundation

This is the first policy experiment, not automated attention detection. The existing floating UI, click/drag/drop-to-hide interaction, local app identifier and task fields remain intact.

## Context and decisions

Only explicit user actions are real inputs in this version. Resume after a manual pause is an explicit return, not proof of an interruption or cognitive state. Inactive, working, intentional break and uncertain context fixtures must abstain. No OS permissions, keyboard hooks, foreground-app logs, screenshots, LLMs or network calls are introduced.

Quiet (default) always abstains. Balanced and Supportive are explicit opt-in modes; Supportive has a higher initial utility, not more intrusive UI. A user-authored next step is required. The fixed-point policy uses utility = mode base × confidence / 100 + 12 × bounded preference − 20; threshold 30; confidence must be 80–100. Explicit return uses 100 as certainty of the declared action, not a probability of focus. These are provisional engineering heuristics. All offered cues have a minimum 120-second interval (including across restarts and clock rollback). The policy never opens, raises or focuses the character, plays sound, or sends system notifications.

Useful adds one preference point; Not useful and explicit Dismiss subtract one. Bounds −4…4. In Balanced, two consecutive negative responses suppress future offers at explicit return; Supportive initially requires three. Feedback is accepted once for the current offer; pause, finish, checkpoint changes and mode changes invalidate old offers. Closing the bubble is not negative feedback. Reset returns the weight to zero without resetting rate limits. Manual reminder remains available independently. Only explicit feedback affects preference, not time spent or inferred mood.

Policy state is additive to session.json (schema version 1); old files default to Quiet. A pending offer is cleared on restart. No event history is recorded. Local preferences are retained across sessions, and reset removes the learned weight. Full delete/export, consent-based sensing and separate SQLite event logging are future work. Do not downgrade against the same data file if retaining new preferences is important: older builds do not understand the new fields.

## Power and tests

The previous one-second session snapshot poll now runs only while an expanded running session is visible to the webview. Compact mode has no periodic native timer polling. Existing SVG animations remain; CPU, energy and total WebKit RAM require measurement on the target Mac. Zero model/API calls does not imply zero energy or zero maintenance cost.

Run:
```sh
cd companion
npm install --no-audit --no-fund
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

1. Launch with existing session: checkpoint should survive. Quiet should be the default for older files.
2. Pause, resume in Quiet: no assistance card. Manual cue remains available.
3. Open Assistance, select Balanced; pause and resume: a card with the saved step should appear within the already open bubble.
4. Mark Not useful, pause/resume immediately: no offer (cooldown). After two minutes, repeat a negative response; after another cooldown, Balanced should suppress.
5. Reset cue preferences; after cooldown, confirm the cue can return. Switch to Quiet, verify no cue even after useful feedback. Restart and verify mode persists; old cues must not reopen.
6. Confirm compact drag, drop target, hide/restore still work. No network is needed after dependencies are installed.
7. Build on macOS and Windows CI; on Mac M1, compare Activity Monitor for packaged compact/expanded idle, running, hidden and animation states. No performance claim until measured.

## Research boundary

This is a deterministic feedback loop, not machine learning, automatic away/return sensing, or validated productivity improvement. Adult pilot only. No autonomous prompts, medical positioning or child-facing release. The full research loop remains a subsequent milestone; semantic renderer and OS sensing will be added separately, with opt-in boundaries.
