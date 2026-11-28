# I-02 — Desktop interaction (v0.14.4)

Native global shortcuts use the official Tauri plugin; registration failures are shown in Control Center > Desktop without aborting startup. Alt+Shift+O show/hide, C open/focus chat, S Control Center, M stop observation. Esc folds chat. No keystroke logging. Fixed defaults for now.

Desktop page: Compact (342×420), Comfortable (440×520), Large (560×650) expanded logical-pixel sizes, always-on-top and reset. Folded size unchanged. Desktop settings stored separately in desktop.json; no AI request. Reset while hidden restores the companion. Window placement clamps to available work areas; when saved display is disconnected, center on an available primary display. Physical cursor movement avoids source-display scale assumptions during drag; mixed-DPI behavior still needs runtime validation. Periodic bounded layout check recovers out-of-bounds placement. No freely draggable resize border by design.

Acceptance: shortcuts from Chrome and another app, shortcut when hidden, keyboard typing and Esc, all three chat sizes, always-on-top on/off, drag to each edge and across available displays, hide/show and relaunch position restoration, disconnect display if available, reset from menu and Control Center, preserve draft, stop monitoring via shortcut, previous I-01 controls, ordinary Groq chat. No server redeploy.

## v0.14.5 stop shortcut correction
The stop shortcut dispatches on press, shares the verified native stop action with Control Center and Stop all monitoring menu item, and reports activation count for diagnosis. If M fails registration, X is attempted and displayed. An explicit successful stop clears stale local reminders and displays confirmation without changing the session. Re-test on macOS; actual original failure mechanism is not yet established.
