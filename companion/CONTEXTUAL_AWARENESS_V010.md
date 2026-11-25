# v0.10 — opt-in activity awareness (macOS preview)

## User interaction
1. Start a session with "Let's focus".
2. Say "Watch my activity". Oplyra describes the data and asks for confirmation. Say "yes" within 60 seconds. No observation before consent. Close the conversation bubble and return to another app.
3. "Working · aware" is the visible indicator. "Check-in · aware" means a small passive check-in is available. Click to read it. No focus stealing, sound, auto-opening or automatic pause.
4. Say "Stop watching", "Don't interrupt me", or choose menu-bar Stop activity awareness. Pausing, ending, hiding, quitting, or starting a new session also disables awareness. Resuming does not re-enable it. "What can you see?" describes the boundary.
5. The opt-in authorizes this separate local check-in policy for this running session, not a persistent change to the older support-mode setting.

## Data boundary
The only sampled inputs are the foreground app's bundle identifier (immediately mapped to a coarse category and discarded) and seconds since last input. Native NSWorkspace / CoreGraphics API calls; no screen recording, accessibility automation, keystroke capture, event tap, clipboard, browser URL/title/history, audio, files, raw app history, or persistent activity log. No cloud requests for sampling or offering check-ins. Observation results are not added to AI prompts or chat history. User-typed text still follows the chosen AI provider. No additional macOS permissions requested by this implementation.
The webview requests a sample every five seconds only while consent is active, session is running and character visible with bubble closed, not dragging or responding. Native consent and phase/visibility gates run before sensor access. Opening/dragging suspends continuity. Missing data, own app, or sample gaps reset the candidate; no negative score for absence. Hide destroys the view and stops consent. Windows remains buildable but sensors are unsupported.

## Policy (engineering hypotheses, not validated productivity inference)
- Browser/unknown app usage alone never triggers a distraction check-in. Known entertainment app category (Apple TV/Steam) plus 90 seconds of consecutive active samples may offer one neutral question. This cannot tell whether that app is work-related.
- A return after at least two minutes of observed inactivity may offer a neutral resumption question, without labeling inactivity a distraction. Inactivity may be reading or thinking.
- At most two cues per explicit opt-in; at least ten minutes between cues. No automatic changes to session state. Reset candidate on invalid sample or gap above 12 seconds.
- No live screen or website understanding yet. YouTube inside Chrome cannot be identified in this version. No proactive cloud inference.

## Acceptance checks
Build/run with existing Groq free-plan key, Ollama off. Verify normal chat, start/pause/resume and draft preservation. Before consent, verify indicator absent. Try watch my activity then no, then yes after a new prompt. Verify indicator. Fold the bubble. Test a browser for over 90 seconds with normal interaction (no leisure cue). Test Apple TV or Steam with regular interaction for 90 seconds (if installed); expect passive check-in. Alternatively leave a non-Oplyra foreground app untouched for over two minutes, then use input; expect a passive return cue after the next sample. Click and read, dismiss by continuing work. Pause/finish/hide/stop via tray and verify indicator disappears and no further sampling. Resume must require fresh consent. Test no sensor/AI calls while hidden. Observe idle CPU and RAM before and after consent; no resource savings or detection accuracy claimed until measured.
Unit tests exercise consent, browser ambiguity, dwell, missing samples, cooldown, idle return and budget. CI does not simulate macOS foreground use.
