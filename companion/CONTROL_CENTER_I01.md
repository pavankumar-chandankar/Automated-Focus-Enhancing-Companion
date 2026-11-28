# I-01 — Control Center (v0.14.3)

Open from menu-bar Open Control Center or the gear in the companion chat header. Standard resizable window with Overview, Focus session, Monitoring, About, and existing separate Analytics. No additional dependencies, permissions, model requests or gateway deployment. Provider shown is configuration only, not connectivity. All controls use existing Rust state and commands. Starting a session does not start observation. Hide preserves unsent draft and revokes observation as before; closing Control Center leaves companion running. Quit preserves persisted session and stops observation.

## Mac acceptance
1. Open from both entry points; resize, close, reopen. Verify no duplicate windows in normal sequential use.
2. Start a goal with optional next step from Control Center. Verify buddy status changes and elapsed timer increases. Pause from center, resume from buddy, finish from center. Check both surfaces converge and completed count increments. Verify offline.
3. Enable observation through existing consent flow; stop from center and verify badge/status and no further cues. Test pause/finish/hide revocation. No consent restored automatically.
4. Type unsent buddy draft; hide/show from center and verify draft restored. Control Center remains open. Test menu bar show/hide and state updates.
5. Analytics opens normally; close Control Center without quitting. Quit using confirmation, then relaunch.
6. Verify normal Groq chat still works. Existing monitor accuracy and performance remain unchanged/unverified.

No new preference storage, keyboard shortcuts, live connection checks, or permissions UI in I-01. Native focus behavior and concurrent window interactions require M1 testing.