# Oplyra floating companion: hold to drag / drop to hide

## Interaction contract

- **Click** the character to reveal or fold the small session controls.
- **Press and hold** the character for ~420 ms, then move the pointer to drag it directly. There is no separate drag handle.
- **During dragging only**, a tiny native trash target appears at the bottom center of the current display's usable area (above the macOS Dock). Release the pointer over the target to **hide** Oplyra; release elsewhere to leave it there.
- **Hide is reversible** via the macOS menu-bar **Show Oplyra** action, and never removes the saved session.
- The main window remains transparent and borderless, with no fullscreen, regular titlebar or background app observation. The auxiliary target is 112×112 logical pixels, not a fullscreen overlay.

## Testing (Mac M1)

1. With the old dev job stopped, from `~/Developer/Oplyra/companion`: `npm run build`; `cargo test --manifest-path src-tauri/Cargo.toml`; `npm run tauri dev`.
2. Click character: controls appear; click character again: controls fold.
3. Press and hold ~half a second: drop target should appear near the Dock; drag character; release away from it: character remains.
4. Drag again and release over the center of the bin: Oplyra should hide. Restore from the macOS menu bar. Your current task/checkpoint should still exist.
5. Test if macOS Dock is left/right and on external monitors; please report target-placement issues. Press Escape to dismiss controls.

**Known risk:** JS pointer capture and window-reposition events may vary with macOS/WebKit version, and the final cross-window drop must be tested on the target machine. A single small invisible hit region still accompanies the character because of Tauri's webview window model. If macOS pointer capture is interrupted during native movement, fallback native drag handling will be needed.

## File changes

`src/App.tsx`, `src/styles.css`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs`. Existing `model.rs` and the session JSON schema are **unchanged**.
