# Oplyra Floating Companion — immediate drag refinement (v0.4)

This patch updates only `companion/src/App.tsx` from v0.3. Apply **after** the v0.3 hold-to-drag patch; it does not replace the Rust session model or native drop-target commands.

## Interaction

- A normal primary-button click/tap opens or collapses the compact task controls.
- Press the primary mouse button and move at least **4 screen pixels**: dragging starts immediately; **no 420 ms hold timer**.
- The draggable character can be moved while the native bottom-center bin appears. Drop on the bin to hide Oplyra without deleting the task/session. Restore from **Show Oplyra** in the macOS menu-bar menu.
- Keyboard access: focus the character with Tab and press Space/Enter to toggle controls.
- Pointer geometry is fetched on pointerdown, and the bin startup runs independently of window positioning to minimise latency. Native move events are coalesced to avoid overlapping position updates.

## Apply

From `~/Developer/Oplyra`:

```sh
unzip -o "$HOME/Downloads/oplyra-v0.4-instant-drag-patch.zip" -d .
cd companion
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

Stop existing `tauri dev` processes with **Control+C** before relaunching; **Control+Z** suspends them and may leave port 1420 occupied.

## Quick smoke test before commit

1. A single short click opens the task bubble; another closes it.
2. Click and move immediately, without holding first; the character follows and bin appears.
3. Release away from bin; character stays visible and task bubble does not open.
4. Drag onto bin, release, then restore from menu bar.
5. Repeat with the task bubble open and check the session checkpoint is unchanged.
6. Use Tab + Enter to open controls and Escape to collapse them.

**Validation:** TSX syntax and basic behavior markers were checked in a non-macOS environment. Full `npm run build`, Tauri runtime and interactive performance need verification on the developer's M1 before committing. No external data collection or OS sensing added.
