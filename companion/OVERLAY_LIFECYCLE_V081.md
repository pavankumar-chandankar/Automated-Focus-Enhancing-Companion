# v0.8.1 — menu-bar utility and input preservation

## Problem
Earlier versions kept both the companion and drop target as native windows even after hiding, and cleared the unsent input when dragging or collapsing. skipTaskbar alone is not a macOS application activation policy.

## Changes
- macOS accessory activation policy in native setup, plus LSUIElement in the macOS bundle plist. No ordinary Dock or Cmd+Tab application presence is intended.
- Drop target config is create:false. It is built only when a drag begins and destroyed on release/cancel. The character still moves immediately, before the target finishes creating.
- Dropping into the bin, a tray Hide request, or an explicit chat hide command destroys the main webview window. Explicit menu-bar Show recreates it from config, centered with a compact character. Last-window exit is prevented; menu-bar Quit still exits. A second app launch does not restore a hidden overlay.
- The active input is held by React and a synchronous draft ref. Moving or folding no longer clears input; a normal drag keeps the bubble open. Before a hide, the frontend passes its latest unsent draft to the native memory store; tray hide requests use the same path. It is hydrated on a new webview after registering the hide listener. Input is disabled until hydration. Drafts are not written to disk, not submitted to the model and are discarded on process quit. Sending consumes the input as before.
- Pending model action confirmation is invalidated on drag/collapse/hide. In-flight model replies from a previous visibility epoch cannot act or reappear. Session state remains native and persisted unchanged.

## Acceptance checks (must be run on M1)
1. Open Oplyra, check Cmd+Tab and Mission Control (and any third-party window switcher). No ordinary Dock/app-switcher entry is intended; the visible character is still a real window.
2. Enter a distinctive unsent draft; drag the character around without dropping it into the bin. Bubble remains open and text stays. Fold/reopen and verify text. No automatic send.
3. Drop the character into bin. Both native surfaces should disappear. Switch applications repeatedly; no empty Oplyra window should be present. Menu-bar icon and ongoing session remain.
4. Choose Show Oplyra. Character reappears centered; open bubble and verify exact draft. Repeat tray Hide/Show, including Unicode input and an active session.
5. Check drag cancel, fast release, repeated hide/show, tray Quit, single instance, and a pending AI action. Quit/restart should not restore the draft. Confirm the session still restores.
6. Verify existing dialogue and local AI remain functional. Measure drag target creation time, native process/window inventory and energy use. Windows tray behaviour must be checked separately.

Native window-manager and hardware behaviour cannot be proved by the compile/unit tests. A transient cold creation delay is possible with a newly constructed drop target. No new dependencies or screen permissions. No model changes.
