# Oplyra v0.2 overlay alpha

## Product contract

Oplyra is an **optional, floating 2D companion**. It is not a fullscreen experience and has no conventional titlebar, desktop dashboard, or maximized mode. The user launches it explicitly, can drag the handle, opens a small control bubble by clicking the character, and can hide/restore it from the macOS menu-bar icon. Closing the overlay hides it; Quit stops the app.

The bubble is part of the same small transparent Tauri surface. When the bubble is closed, the native surface is only 192 × 210 logical pixels; opening it explicitly grows the surface to 342 × 594, and closing it shrinks it again. Transparent areas *inside* that hit region can still intercept pointer events on macOS; dynamic sizing mitigates but does not entirely remove that limitation.

Existing session data uses the same local JSON schema and Tauri application identifier as v0.1. Rust session logic and tests are unchanged.

## What ships in this patch

- Borderless, transparent, always-on-top character; no full-window mode.
- 2D original animated character; honours macOS **Reduce Motion** preference.
- Drag handle (top-left), Hide button (top-right), menu-bar Show / Hide / Quit.
- Small on-demand form for goal and next-step checkpoint; Start/Pause/Resume/Finish.
- Manual task-resumption cue **only when requested**; no unsolicited interruptions.
- No sensor permission requests, no background app/idle tracking, no model calls, no cloud, and no account.

## Apply on the existing local desktop branch

1. Stop `npm run tauri dev` with `Control + C`.
2. Back up or commit any edited project files.
3. Download `oplyra-v0.2-overlay-patch.zip` into `~/Downloads`.
4. In Terminal: `cd ~/Developer/Oplyra && unzip -o ~/Downloads/oplyra-v0.2-overlay-patch.zip -d .`
5. Run `cd companion && npm run build && cargo test --manifest-path src-tauri/Cargo.toml && npm run tauri dev`.
6. When verified, commit the changes to **your local** `feature/oplyra-desktop-macos` branch; pushing requires GitHub authentication.

## Deliberately not yet implemented

Automatic interruption or app-idle detection, adaptive intervention policy, per-user feedback model, Rive assets, UI testing on multiple monitors, crash/performance soak tests and signed distribution are future milestones. Do not represent the manual-cue overlay as an adaptive AI system yet.
