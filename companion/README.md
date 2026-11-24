# Oplyra desktop — floating companion alpha

Oplyra is an **optional, local-first floating focus companion**, not a fullscreen dashboard, conventional window or autonomous AI pet. The user explicitly opens, moves, and hides it. The desktop surface is transparent and borderless; the user clicks the character to reveal a compact, on-demand task bubble.

**Current slice:** original 2D animated character, a native macOS/Windows Tauri overlay, menu-bar Show / Hide / Quit, user-controlled Start / Pause / Resume / Finish, a manual next-step cue and persisted local session checkpoints. The Rust model is unchanged from v0.1, so existing `session.json` remains compatible.

## macOS M1 development

```bash
cd companion
npm install
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

Controls: click the character to open/close its small control bubble. To move it, press and start moving the pointer at least 4 pixels—there is **no long-press delay or separate drag handle**. While dragging, a small bin appears near the bottom center; drop the character on the bin to hide it **without deleting work**. Restore with **Show Oplyra** from the macOS menu-bar icon. Press Escape to collapse the bubble; Tab then Enter/Space also opens it. Quit from the menu-bar icon. The overlay runs only when you launch the app; no login auto-start is installed.

## Privacy and explicit limitations

No activity, application, window-title, keyboard, mouse, camera or microphone monitoring is implemented. No automatic intervention policy, model call, third-party account, network sync or backend connection runs. The existing focus timer counts elapsed wall time, including system sleep, until manually paused. The user requests the checkpoint cue. Transparent portions of a Tauri overlay can still intercept pointer events **inside the small native hit region**; the app shrinks this region when the controls are closed.

This is an **unreleased prototype**, not a production or child-facing application. It has not been tested on multiple monitor configurations or distributed as a signed/notarised installer. The project identifier and Oplyra brand are provisional. See `OVERLAY_V02.md` for scope and testing notes.

The original FastAPI/React and C# prototypes remain separate; nothing in this companion transmits data to team dashboards or workplace analytics.
