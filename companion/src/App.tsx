import { useEffect, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import type { PointerEvent as ReactPointerEvent } from "react";
import { companion, type Phase, type SessionSnapshot, type SupportMode, type CueFeedback } from "./native";

// Logical pixels. The visible native surface shrinks to the character when closed;
// it is never a conventional full-window application.
const COMPACT = new LogicalSize(192, 210);
const OPEN = new LogicalSize(342, 594);
const appWindow = getCurrentWindow();
// A click remains a click; moving the pointer at least 4px while pressed
// begins dragging immediately, with no long-press timer.
const DRAG_START_DISTANCE = 4;

type DragGesture = {
  pointerId: number;
  downX: number;
  downY: number;
  latestX: number;
  latestY: number;
  ended: boolean;
  started: boolean; // The pointer crossed the movement threshold.
  binReady: boolean;
  base: PhysicalPosition | null;
  scale: number;
  geometryPromise: Promise<void> | null;
  startPromise: Promise<void> | null;
};

// The target is a separate, small, transparent, non-focusable native surface.
// No full-screen overlay or desktop-wide mouse capture is used.
function DropTarget() {
  return (
    <div className="drop-target" role="presentation">
      <svg viewBox="0 0 72 72" aria-hidden="true" className="trash-icon">
        <path d="M23 19h26M30 19v-5h12v5M26 25l2 29h16l2-29M33 32v15M39 32v15" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Drop to hide</span>
    </div>
  );
}


function formatTime(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function Character({ phase }: { phase: Phase }) {
  return (
    <svg className={`character-art phase-${phase}`} viewBox="0 0 204 180" aria-hidden="true">
      <defs>
        <linearGradient id="oplyra-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E2DBFF" />
          <stop offset=".54" stopColor="#B9B1F6" />
          <stop offset="1" stopColor="#9188DF" />
        </linearGradient>
        <linearGradient id="oplyra-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity=".8" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse className="creature-shadow" cx="101" cy="166" rx="53" ry="8" fill="#4D456C" opacity=".13" />
      <g className="creature-float">
        <path d="M62 108 Q34 103 38 128 Q47 145 63 123" fill="#A79EEE" />
        <path d="M144 108 Q166 101 172 124 Q171 137 153 127" fill="#9789DE" />
        <path d="M77 142 Q71 155 83 156 L93 148" fill="#8173CD" />
        <path d="M117 148 L129 156 Q141 155 132 142" fill="#8173CD" />
        <path d="M68 53 Q62 27 78 22 Q95 23 98 50" fill="#C9C1F8" />
        <path d="M118 50 Q127 22 143 28 Q156 38 144 58" fill="#AFA5F0" />
        <path d="M45 107 C41 64 60 41 100 39 C140 37 162 64 163 109 C164 144 142 157 102 157 C64 157 45 140 45 107Z" fill="url(#oplyra-body)" />
        <path d="M60 86 C63 58 82 49 107 50 C91 53 73 68 69 91Z" fill="url(#oplyra-shine)" />
        <ellipse cx="73" cy="110" rx="13" ry="7" fill="#FFB4C9" opacity=".6" />
        <ellipse cx="135" cy="110" rx="13" ry="7" fill="#FFB4C9" opacity=".6" />
        {phase === "paused" ? (
          <g fill="none" stroke="#3C365A" strokeLinecap="round" strokeWidth="4.5">
            <path d="M75 94 Q85 88 95 94" /><path d="M117 94 Q127 88 137 94" />
          </g>
        ) : (
          <g className="eyes" fill="#352F53">
            <ellipse cx="84" cy="93" rx="5.4" ry="8" /><ellipse cx="125" cy="93" rx="5.4" ry="8" />
          </g>
        )}
        <path d={phase === "running" ? "M96 117 Q104 124 112 117" : "M99 117 Q104 121 109 117"} fill="none" stroke="#544B77" strokeWidth="3.3" strokeLinecap="round" />
        {phase === "running" && <circle className="focus-spark" cx="160" cy="53" r="4" fill="#FFE0A7" />}
      </g>
    </svg>
  );
}

function CompanionApp() {
  const [current, setCurrent] = useState<SessionSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const held = useRef<DragGesture | null>(null);
  const pendingPosition = useRef<PhysicalPosition | null>(null);
  const movingPosition = useRef(false);
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [draftNextStep, setDraftNextStep] = useState("");
  const [showCue, setShowCue] = useState(false);
  const [offerId, setOfferId] = useState<number | null>(null);
  const expandedRef = useRef(false);
  const visibilityEpoch = useRef(0);
  const actionEpoch = useRef(0);
  const actionRunning = useRef(false);
  const [error, setError] = useState("");
  const runningRequest = useRef(false);

  useEffect(() => {
    let active = true;
    void companion.snapshot().then((data) => {
      if (!active) return;
      setCurrent(data);
      setGoal(data.goal);
      setNextStep(data.next_step);
      setDraftNextStep(data.next_step);
      setReady(true);
    }).catch((e: unknown) => { if (active) { setError(String(e)); setReady(true); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    // No periodic native clock reads in compact mode or during a pause.
    // Refresh immediately when the user opens the running session.
    if (!ready || !expanded || current?.phase !== "running") return;
    let active = true;
    const tick = () => {
      if (document.hidden || runningRequest.current || actionRunning.current) return;
      const epoch = actionEpoch.current;
      runningRequest.current = true;
      void companion.snapshot().then((data) => {
        if (active && epoch === actionEpoch.current && !actionRunning.current) setCurrent(data);
      }).catch((e: unknown) => {
        if (active && epoch === actionEpoch.current) setError(String(e));
      }).finally(() => { runningRequest.current = false; });
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => { active = false; window.clearInterval(interval); };
  }, [ready, expanded, current?.phase]);

  async function toggleDetails(open: boolean) {
    if (resizing) return;
    setResizing(true);
    setError("");
    try {
      // The hit-test region grows only when the user explicitly opens controls.
      await appWindow.setSize(open ? OPEN : COMPACT);
      expandedRef.current = open;
      visibilityEpoch.current += 1;
      setExpanded(open);
      if (!open) { setShowCue(false); setOfferId(null); }
    } catch (failure) { setError(`Could not resize companion: ${String(failure)}`); }
    finally { setResizing(false); }
  }

  async function flushPosition() {
    if (movingPosition.current) return;
    movingPosition.current = true;
    try {
      // Coalesce rapid pointer events so native setPosition requests cannot race.
      while (pendingPosition.current) {
        const next = pendingPosition.current;
        pendingPosition.current = null;
        await appWindow.setPosition(next);
      }
    } catch (failure) {
      setError(`Could not move Oplyra: ${String(failure)}`);
    } finally {
      movingPosition.current = false;
    }
  }

  function updateDragPosition(gesture: DragGesture) {
    if (!gesture.started || !gesture.base || gesture.ended) return;
    pendingPosition.current = new PhysicalPosition(
      Math.round(gesture.base.x + (gesture.latestX - gesture.downX) * gesture.scale),
      Math.round(gesture.base.y + (gesture.latestY - gesture.downY) * gesture.scale),
    );
    void flushPosition();
  }

  async function beginDrag(gesture: DragGesture) {
    // Called only after movement exceeds the click/drag threshold. The position
    // request was already started on pointerdown, to minimise perceived latency.
    try {
      if (expanded) {
        await appWindow.setSize(COMPACT);
        expandedRef.current = false;
        visibilityEpoch.current += 1;
        setExpanded(false);
        setShowCue(false);
        setOfferId(null);
      }
      await gesture.geometryPromise;
      if (!gesture.base) return; // No native coordinates: do not open an unusable bin.
      // Even a brief drag should move the character; pointerup will wait for
      // the latest coalesced native position before considering a drop.
      updateDragPosition(gesture);
      if (gesture.ended) return;
      await invoke("begin_companion_drag");
      gesture.binReady = true;
    } catch (failure) {
      setError(`Could not begin dragging: ${String(failure)}`);
      try { await invoke("cancel_companion_drag"); } catch { /* target may be unavailable */ }
    }
  }

  function onCharacterPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || resizing || held.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const gesture: DragGesture = {
      pointerId: event.pointerId,
      downX: event.screenX, downY: event.screenY,
      latestX: event.screenX, latestY: event.screenY,
      ended: false, started: false, binReady: false,
      base: null, scale: 1, geometryPromise: null, startPromise: null,
    };
    held.current = gesture;
    // Warm up native geometry immediately rather than waiting for drag start.
    gesture.geometryPromise = Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()])
      .then(([base, scale]) => {
        gesture.base = base;
        gesture.scale = scale;
        if (gesture.started && !gesture.ended) updateDragPosition(gesture);
      })
      .catch((failure: unknown) => {
        setError(`Could not read companion position: ${String(failure)}`);
      });
  }

  function onCharacterPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = held.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.ended) return;
    gesture.latestX = event.screenX;
    gesture.latestY = event.screenY;
    if (!gesture.started) {
      const distance = Math.hypot(event.screenX - gesture.downX, event.screenY - gesture.downY);
      if (distance < DRAG_START_DISTANCE) return;
      gesture.started = true;
      setDragging(true);
      // Do not wait for the bin to appear before moving the character.
      gesture.startPromise = beginDrag(gesture);
    }
    event.preventDefault();
    updateDragPosition(gesture);
  }

  function endCharacterPointer(event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const gesture = held.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    held.current = null;
    gesture.ended = true;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!gesture.started) {
      // Pointerup is the single place that handles a genuine click. The normal
      // onClick handler is reserved for keyboard/assistive-tech activation.
      if (!cancelled) void toggleDetails(!expanded);
      return;
    }
    void (async () => {
      try {
        // A quick release can race the native bin/show IPC. Wait for startup,
        // then finish/cancel once, so the bin cannot appear after the drop.
        await gesture.startPromise;
        while (movingPosition.current) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 12));
        }
        if (gesture.binReady) {
          await invoke(cancelled ? "cancel_companion_drag" : "finish_companion_drag");
        }
      } catch (failure) {
        setError(`Could not complete drag: ${String(failure)}`);
      } finally {
        setDragging(false);
      }
    })();
  }

  async function act(
    action: () => Promise<SessionSnapshot>,
    options: { offer?: boolean; preserveDraft?: boolean } = {},
  ) {
    if (actionRunning.current) return;
    actionRunning.current = true;
    actionEpoch.current += 1;
    const visibility = visibilityEpoch.current;
    setBusy(true);
    setError("");
    try {
      const data = await action();
      setCurrent(data);
      if (!options.preserveDraft) setDraftNextStep(data.next_step);
      setShowCue(false);
      // Only the user's explicit Resume action can surface a policy offer.
      // Never resurrect a cue from polling, restart, or a collapsed bubble.
      setOfferId(options.offer && expandedRef.current && visibility === visibilityEpoch.current
        ? data.pending_offer_id : null);
    } catch (failure) { setError(String(failure)); }
    finally { actionRunning.current = false; setBusy(false); }
  }

  function respondToOffer(response: CueFeedback) {
    if (offerId !== null) void act(() => companion.feedback(offerId, response), { preserveDraft: true });
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && expanded) void toggleDetails(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, resizing]);

  const phase = current?.phase ?? "idle";
  const inSession = phase !== "idle";
  const hasOffer = current?.phase === "running" && offerId !== null && offerId === current.pending_offer_id && current.support_mode !== "quiet";
  const phaseName = phase === "running" ? "Focusing" : phase === "paused" ? "On a break" : "Here when you need me";

  return (
    <main className={`overlay ${expanded ? "is-expanded" : "is-compact"} ${dragging ? "is-dragging" : ""}`}>
      <div className="character-stage">
        <button
          type="button"
          className="character-button"
          onPointerDown={onCharacterPointerDown}
          onPointerMove={onCharacterPointerMove}
          onPointerUp={(event) => endCharacterPointer(event, false)}
          onPointerCancel={(event) => endCharacterPointer(event, true)}
          onClick={(event) => {
            // Keyboard and assistive-technology activation only; pointer clicks
            // are handled on pointerup to avoid double toggles.
            if (event.detail === 0) void toggleDetails(!expanded);
          }}
          disabled={resizing}
          aria-expanded={expanded}
          aria-controls="companion-controls"
          aria-label={`${phaseName}. Click to ${expanded ? "close" : "open"} controls; click and drag to move; drop on the bottom-centre bin to hide.`}
          title="Click for controls · Drag immediately to move · Drop on bin to hide"
        >
          <Character phase={phase} />
        </button>
        <div className="character-status" role="status">
          <span className={`status-light status-${phase}`} />
          <span>{phaseName}</span>
        </div>
      </div>

      {expanded && (
        <section id="companion-controls" className="control-bubble" aria-label="Oplyra focus controls">
          <div className="bubble-header">
            <div><span className="eyebrow">OPLYRA · LOCAL FIRST</span><h1>{inSession ? "Keep your place." : "Begin gently."}</h1></div>
            <button className="fold-button" type="button" onClick={() => void toggleDetails(false)} aria-label="Close controls">−</button>
          </div>
          {!ready && <p className="small-copy">Loading your local session…</p>}
          {ready && !current && <p className="small-copy">Your saved session could not be loaded.</p>}
          {ready && current && !inSession && (
            <form className="session-form" onSubmit={(event) => { event.preventDefault(); void act(() => companion.start(goal, nextStep)); }}>
              <label htmlFor="goal">What will you work on?</label>
              <input id="goal" value={goal} maxLength={160} placeholder="Read chapter four" required onChange={(event) => setGoal(event.target.value)} />
              <label htmlFor="next-step">Your very next step</label>
              <textarea id="next-step" value={nextStep} maxLength={240} rows={2} placeholder="Open the chapter and take notes" required onChange={(event) => setNextStep(event.target.value)} />
              <button className="primary-action" type="submit" disabled={busy || !goal.trim() || !nextStep.trim()}>Begin focus session</button>
              {current.sessions_completed > 0 && <p className="quiet-note">{current.sessions_completed} sessions completed at your own pace.</p>}
            </form>
          )}
          {ready && current && inSession && (
            <div className="session-active">
              <div className="session-meta"><span className={`session-pill status-${phase}`}>{phase === "running" ? "In progress" : "Paused"}</span><span className="elapsed">{formatTime(current.elapsed_ms)}</span></div>
              <h2 className="current-goal">{current.goal}</h2>
              <button type="button" className="cue-toggle" onClick={() => setShowCue(!showCue)} aria-expanded={showCue}>{showCue ? "Hide next-step cue" : "Remind me of my next step"}</button>
              {showCue && !hasOffer && <p className="cue-card">{current.next_step}</p>}
              {hasOffer && (
                <section className="return-offer" aria-label="Optional return cue">
                  <span className="offer-heading">Your saved next step</span>
                  <p>{current.next_step}</p>
                  <div className="offer-actions">
                    <button type="button" disabled={busy} onClick={() => respondToOffer("useful")}>Useful</button>
                    <button type="button" disabled={busy} onClick={() => respondToOffer("not_useful")}>Not useful</button>
                    <button type="button" disabled={busy} onClick={() => respondToOffer("dismiss")}>Dismiss</button>
                  </div>
                  <small>Only shown after you resume. Feedback changes future cues locally.</small>
                </section>
              )}
              <label htmlFor="checkpoint">Save your next step</label>
              <textarea id="checkpoint" maxLength={240} rows={2} value={draftNextStep} onChange={(event) => setDraftNextStep(event.target.value)} />
              <div className="action-row">
                <button type="button" className="secondary-action" disabled={busy || !draftNextStep.trim() || draftNextStep.trim() === current.next_step} onClick={() => void act(() => companion.saveNextStep(draftNextStep))}>Save step</button>
                <button type="button" className="primary-action" disabled={busy} onClick={() => phase === "running" ? void act(companion.pause) : void act(companion.resumeWithAssistance, { offer: true })}>{phase === "running" ? "Pause" : "Resume"}</button>
              </div>
              <button type="button" className="finish-button" disabled={busy} onClick={() => void act(companion.finish)}>Finish session</button>
            </div>
          )}
          {ready && current && (
            <details className="support-settings">
              <summary>Assistance · {current.support_mode === "quiet" ? "Quiet" : current.support_mode === "balanced" ? "Balanced" : "Supportive"}</summary>
              <label htmlFor="support-mode">Support intensity</label>
              <select id="support-mode" disabled={busy} value={current.support_mode}
                onChange={(event) => {
                  const mode = event.target.value as SupportMode;
                  void act(() => companion.setSupportMode(mode), { preserveDraft: true });
                }}>
                <option value="quiet">Quiet — manual cues only</option>
                <option value="balanced">Balanced — optional return cue</option>
                <option value="supportive">Supportive — more willing to offer</option>
              </select>
              <p className="quiet-note">Offers only when you press Resume, with at least two minutes between offers. No activity sensing.</p>
              <button type="button" className="cue-toggle" disabled={busy} onClick={() => void act(companion.resetPreference, { preserveDraft: true })}>Reset cue preferences</button>
            </details>
          )}
          <div className="bubble-footer">You choose when Oplyra appears. Offline · no background sensing or external AI.</div>
          {error && <p className="error-message" role="alert">{error}</p>}
        </section>
      )}
      {!expanded && error && <div className="compact-error" role="alert" title={error}>!</div>}
    </main>
  );
}

export default function App() {
  return window.location.hash === "#drop-zone" ? <DropTarget /> : <CompanionApp />;
}
