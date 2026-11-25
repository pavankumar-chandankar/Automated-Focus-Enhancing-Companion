import { useEffect, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import type { PointerEvent as ReactPointerEvent } from "react";
import { companion, type Phase, type SessionSnapshot, type PreviousTurn } from "./native";
import { planMessage, restingBehaviour, actionAllowed, confirmedPlan, proposalQuestion, resolveConfirmation, type Behaviour, type PendingAction } from "./dialogue";

// Logical pixels. The visible native surface shrinks to the character when closed;
// it is never a conventional full-window application.
const COMPACT = new LogicalSize(192, 210);
const OPEN = new LogicalSize(342, 400);
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


function Character({ phase, behaviour }: { phase: Phase; behaviour: Behaviour }) {
  return (
    <svg className={`character-art phase-${phase} behaviour-${behaviour}`} viewBox="0 0 204 180" aria-hidden="true">
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
        {behaviour === "resting" ? (
          <g fill="none" stroke="#3C365A" strokeLinecap="round" strokeWidth="4.5">
            <path d="M75 94 Q85 88 95 94" /><path d="M117 94 Q127 88 137 94" />
          </g>
        ) : (
          <g className="eyes" fill="#352F53">
            <ellipse cx="84" cy="93" rx="5.4" ry="8" /><ellipse cx="125" cy="93" rx="5.4" ry="8" />
          </g>
        )}
        <path d={phase === "running" ? "M96 117 Q104 124 112 117" : "M99 117 Q104 121 109 117"} fill="none" stroke="#544B77" strokeWidth="3.3" strokeLinecap="round" />
        {behaviour === "working" && <g className="work-book" stroke="#7968ba" strokeWidth="1.7" strokeLinejoin="round"><path d="M73 130 Q89 124 103 134 Q117 124 133 130 L132 149 Q117 145 103 154 Q89 145 74 149Z" fill="#f6f0ff"/><path d="M103 134V154" fill="none"/></g>}
        {behaviour === "celebrating" && <g className="celebrate-spark" fill="#e5ab53"><path d="M37 44 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3Z"/><path d="M170 28 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3Z"/></g>}
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
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [source, setSource] = useState<"local" | "fallback" | "command" | null>(null);
  const previousTurn = useRef<PreviousTurn | null>(null);
  const pendingAction = useRef<PendingAction | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [reaction, setReaction] = useState<Behaviour | null>(null);
  const expandedRef = useRef(false);
  const visibilityEpoch = useRef(0);
  const actionRunning = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void companion.snapshot().then((data) => {
      if (!active) return;
      setCurrent(data);
      setReady(true);
    }).catch((e: unknown) => { if (active) { setError(String(e)); setReady(true); } });
    return () => { active = false; };
  }, []);

  function clearConversation() {
    pendingAction.current = null;
    previousTurn.current = null;
    setReply("");
    setReaction(null);
    setMessage("");
    setSource(null);
    setLatency(null);
  }

  useEffect(() => {
    // Tray/native hides also invalidate a pending confirmation, not only drag.
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void appWindow.listen("oplyra-hidden", () => {
      if (disposed) return;
      visibilityEpoch.current += 1;
      expandedRef.current = false;
      setExpanded(false);
      clearConversation();
      void appWindow.setSize(COMPACT).catch(() => {});
    }).then(unlisten => {
      if (disposed) unlisten();
      else cleanup = unlisten;
    }).catch(() => {});
    return () => { disposed = true; cleanup?.(); };
  }, []);

  async function toggleDetails(open: boolean) {
    if (resizing) return;
    setResizing(true);
    setError("");
    if (!open) { visibilityEpoch.current += 1; pendingAction.current = null; }
    try {
      // The hit-test region grows only when the user explicitly opens controls.
      await appWindow.setSize(open ? OPEN : COMPACT);
      expandedRef.current = open;
      visibilityEpoch.current += 1;
      setExpanded(open);
      if (!open) clearConversation();
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
        pendingAction.current = null;
        visibilityEpoch.current += 1;
        await appWindow.setSize(COMPACT);
        expandedRef.current = false;
        visibilityEpoch.current += 1;
        setExpanded(false);
        clearConversation();
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

  async function sendMessage() {
    if (actionRunning.current || !current || !message.trim()) return;
    const userMessage = message.trim();
    const pending = pendingAction.current;
    pendingAction.current = null;
    const outcome = resolveConfirmation(userMessage, pending, current.phase, performance.now());
    if (outcome === "decline") {
      setMessage(""); setReply("Okay, no change."); setReaction(restingBehaviour(current.phase));
      setSource("command"); setLatency(null); previousTurn.current = null;
      return;
    }
    const confirmationWord = /^(?:yes|yes please|yes, please|sure|go ahead|do it|okay|ok|confirm|no|no thanks|no, thanks|not now|cancel|never mind|nevermind)[.!?]*$/i.test(userMessage);
    if (confirmationWord && outcome !== "accept") {
      setMessage(""); setReply(pending ? "That request is no longer active. Tell me what you'd like to do." : "Tell me what you'd like to do.");
      setReaction(restingBehaviour(current.phase)); setSource("command"); setLatency(null);
      previousTurn.current = null;
      return;
    }
    const plan = outcome === "accept" && pending
      ? confirmedPlan(pending.action, current.phase)
      : planMessage(userMessage, current.phase);
    if (!plan) return;
    actionRunning.current = true;
    const visibility = visibilityEpoch.current;
    setBusy(true);
    setError("");
    setMessage("");
    setSource(null);
    setLatency(null);
    try {
      let data = current;
      if (plan.action === "none" && plan.useModel) {
        setReply("Thinking…");
        setReaction("attentive");
        try {
          const generated = await companion.localReply(userMessage, previousTurn.current);
          if (expandedRef.current && visibility === visibilityEpoch.current) {
            setSource("local");
            setLatency(generated.latency_ms);
            if (generated.proposal) {
              // No model-generated instruction is executed. A proposal is a
              // short-lived question tied to this state and visible conversation.
              const normalized = userMessage.toLowerCase().replace(/[’‘]/g, "'");
              const ambiguous = /["“”]|(?:^|\s)(?:don't|do not|not|never|unless|what if|should i|hypothetically|but|instead)(?:\s|[.,?!]|$)/.test(normalized);
              if (!ambiguous && actionAllowed(generated.proposal, current.phase)) {
                pendingAction.current = { action: generated.proposal, phase: current.phase, expiresAt: performance.now() + 60_000 };
                setReply(proposalQuestion(generated.proposal));
              } else {
                setReply("I haven't changed our session. Tell me directly if you'd like to change it.");
              }
              setReaction("attentive");
              previousTurn.current = null;
            } else {
              setReply(generated.reply);
              setReaction(plan.behaviour === "encouraging" ? "encouraging" : generated.reaction);
              previousTurn.current = { user: userMessage, reply: generated.reply };
            }
          }
        } catch (failure) {
          // Native provider errors contain no message content; keep diagnostics local.
          console.warn("Local AI request failed:", String(failure));
          if (expandedRef.current && visibility === visibilityEpoch.current) {
            setReply(plan.reply);
            setReaction(plan.behaviour);
            setSource("fallback");
            previousTurn.current = null;
          }
        }
        return;
      }
      previousTurn.current = null;
      if (plan.action !== "none" && !actionAllowed(plan.action, current.phase)) {
        throw new Error("This action is not available in the current session");
      }
      switch (plan.action) {
        case "start": data = await companion.start(plan.goal ?? "Focus together", "Continue the chosen task"); break;
        case "pause": data = await companion.pause(); break;
        // The older automatic return-cue policy remains in Rust but isn't
        // invoked here. Conversation is requested by the user, not a prompt.
        case "resume": data = await companion.resume(); break;
        case "finish": data = await companion.finish(); break;
        case "quiet": data = await companion.setSupportMode("quiet"); break;
        case "hide":
          // Hiding never finishes or deletes a session. Menu bar restores it.
          await appWindow.setSize(COMPACT);
          visibilityEpoch.current += 1;
          expandedRef.current = false;
          setExpanded(false);
          clearConversation();
          await appWindow.hide();
          return;
        case "none": break;
      }
      setCurrent(data);
      if (expandedRef.current && visibility === visibilityEpoch.current) {
        setReply(plan.reply);
        setReaction(plan.behaviour);
        setSource("command");
      }
    } catch (failure) {
      if (expandedRef.current && visibility === visibilityEpoch.current) {
        setError(String(failure));
        setReply("I couldn't complete that action. You can try again.");
        setReaction(null);
      } else if (plan.action === "hide") {
        setError("Could not hide Oplyra");
      }
    } finally {
      actionRunning.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && expanded) void toggleDetails(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, resizing]);

  const phase = current?.phase ?? "idle";
  const behaviour = reaction ?? (expanded ? "attentive" : restingBehaviour(phase));
  const phaseName = phase === "running" ? "Working together" : phase === "paused" ? "On a break" : "Here with you";

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
          <Character phase={phase} behaviour={behaviour} />
        </button>
        <div className="character-status" role="status">
          <span className={`status-light status-${phase}`} />
          <span>{phaseName}</span>
        </div>
      </div>

      {expanded && (
        <section id="companion-controls" className="conversation-bubble" aria-label="Talk to Oplyra">
          <p className="companion-reply" role="status" aria-live="polite">
            {reply || (phase === "running" ? "How's it going?" : phase === "paused" ? "Ready when you are." : "Let's spend some time together.")}
          </p>
          <form className="conversation-form" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <input aria-label="Type to Oplyra" value={message} maxLength={300}
              placeholder={pendingAction.current ? "Yes or no…" : "Say something…"} disabled={!ready || !current || busy}
              onChange={(event) => setMessage(event.target.value)} />
            <button type="submit" aria-label="Send message" disabled={busy || !ready || !current || !message.trim()}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </form>
          <p className="conversation-note">{pendingAction.current ? "Reply yes or no · no change yet" : source === "local" ? `Local AI · ${((latency ?? 0) / 1000).toFixed(1)} s` : source === "fallback" ? "Local AI unavailable · basic response" : source === "command" ? "Local companion" : "Private by design · Talk to Oplyra."}</p>
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
