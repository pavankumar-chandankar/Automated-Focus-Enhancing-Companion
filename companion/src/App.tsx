import { useEffect, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import type { PointerEvent as ReactPointerEvent } from "react";
import { companion, type Phase, type SessionSnapshot, type PreviousTurn, type Provider, type AwarenessStatus, type AwarenessCue, type ScreenStatus, type WindowChoice, type ScreenPreview } from "./native";
import { planMessage, restingBehaviour, actionAllowed, confirmedPlan, proposalQuestion, resolveConfirmation, rememberTurn, awarenessCommand, screenCommand, type Behaviour, type PendingAction } from "./dialogue";

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
  const [message, setMessageState] = useState("");
  const draftRef = useRef("");
  const hiding = useRef(false);
  const finishingDrag = useRef(false);
  function setMessage(value: string) {
    draftRef.current = value;
    setMessageState(value);
  }
  const [reply, setReply] = useState("");
  const [source, setSource] = useState<Provider | "fallback" | "command" | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const history = useRef<PreviousTurn[]>([]);
  const pendingAction = useRef<PendingAction | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [awareness, setAwareness] = useState<AwarenessStatus | null>(null);
  const [screen, setScreen] = useState<ScreenStatus | null>(null);
  const [screenPanel, setScreenPanel] = useState<"permission" | "choose" | "preview" | null>(null);
  const [windows, setWindows] = useState<WindowChoice[]>([]);
  const [selectedWindow, setSelectedWindow] = useState("");
  const [screenPreview, setScreenPreview] = useState<ScreenPreview | null>(null);
  const screenEpoch = useRef(0);
  const screenActive = useRef(false);
  const [ambientCue, setAmbientCue] = useState("");
  const ambientTimer = useRef<number | null>(null);
  const [checkIn, setCheckIn] = useState<AwarenessCue | null>(null);
  const checkInExpiry = useRef(0);
  const awarenessPending = useRef<number | null>(null);
  const awarenessEpoch = useRef(0);
  const [aiNotice, setAiNotice] = useState("");
  const [reaction, setReaction] = useState<Behaviour | null>(null);
  const expandedRef = useRef(false);
  const visibilityEpoch = useRef(0);
  const actionRunning = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    // Draft hydration happens after registering the native hide listener below.
    void companion.screenStatus().then(value => { if (active && screenEpoch.current === 0) setScreen(value); }).catch(() => {});
    void companion.awarenessStatus().then(value => { if (active && awarenessEpoch.current === 0) setAwareness(value); }).catch(() => {});
    void companion.provider().then(value => { if (active) setProvider(value); }).catch(failure => { if (active) setError(String(failure)); });
    void companion.snapshot().then((data) => {
      if (active) setCurrent(data);
    }).catch((e: unknown) => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!screenPreview) return;
    const timer = window.setTimeout(() => {
      setScreenPreview(null);
      setScreenPanel(null);
      setReply("That window excerpt expired. Ask what I can read again after using the window.");
    }, Math.max(0, screenPreview.valid_for_ms));
    return () => window.clearTimeout(timer);
  }, [screenPreview]);

  function clearScreenPanel() {
    screenEpoch.current += 1;
    setScreenPanel(null);
    setWindows([]);
    setSelectedWindow("");
    setScreenPreview(null);
  }

  function clearScreen() {
    screenActive.current = false;
    setAmbientCue("");
    clearScreenPanel();
    setScreen(old => old ? {...old, active: false, app: null, sample_ready: false} : null);
  }

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void appWindow.listen("oplyra-screen-stopped", () => { if (!disposed) clearScreen(); })
      .then(unlisten => { if (disposed) unlisten(); else cleanup = unlisten; }).catch(() => {});
    return () => { disposed = true; cleanup?.(); };
  }, []);

  function showAmbient(text: string) {
    if (expandedRef.current || held.current || hiding.current || actionRunning.current) return;
    if (ambientTimer.current !== null) window.clearTimeout(ambientTimer.current);
    setAmbientCue(text);
    ambientTimer.current = window.setTimeout(() => { setAmbientCue(""); ambientTimer.current = null; }, 12000);
  }

  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const subscribe = async () => {
      const first = await appWindow.listen<ScreenStatus>("oplyra-screen-status", ({payload}) => {
        if (disposed || !screenActive.current || hiding.current) return;
        setScreen(payload);
        if (!payload.active) { clearScreen(); return; }
        if (payload.cue) showAmbient("Welcome back. Ready to continue?");
      });
      if (disposed) { first(); return; } cleanups.push(first);
      const second = await appWindow.listen<string>("oplyra-screen-error", ({payload}) => {
        if (disposed || !screenActive.current) return;
        clearScreen();
        setError("Screen observation stopped: " + payload);
      });
      if (disposed) second(); else cleanups.push(second);
    };
    void subscribe().catch(() => {});
    return () => { disposed = true; cleanups.forEach(fn => fn()); if (ambientTimer.current !== null) window.clearTimeout(ambientTimer.current); };
  }, []);

  // Native UI confirmation buttons, not model-generated instructions.
  async function screenOperation(operation: () => Promise<void>) {
    if (actionRunning.current || hiding.current || !expandedRef.current) return;
    actionRunning.current = true;
    setBusy(true);
    setError("");
    try { await operation(); }
    catch (failure) { if (expandedRef.current && !hiding.current) setError(String(failure)); }
    finally { actionRunning.current = false; setBusy(false); }
  }

  function chooseWindows() {
    void screenOperation(async () => {
      const epoch = screenEpoch.current;
      await companion.requestScreenPermission();
      if (epoch !== screenEpoch.current || hiding.current || !expandedRef.current) return;
      const choices = await companion.listScreenWindows();
      if (epoch !== screenEpoch.current || hiding.current || !expandedRef.current) {
        await companion.stopScreen(); return;
      }
      setScreen(old => old ? {...old, active: false, app:null, sample_ready:false} : null);
      setWindows(choices);
      setSelectedWindow("");
      setScreenPanel("choose");
      setReply(choices.length ? "Choose a single window or follow supported work apps. Local OCR only." : "No supported visible work windows found. Open a browser or document and try again.");
    });
  }

  function startWindow() {
    void screenOperation(async () => {
      if (!selectedWindow) return;
      const epoch = screenEpoch.current;
      const status = await companion.selectScreenWindow(Number(selectedWindow));
      if (epoch !== screenEpoch.current || hiding.current || !expandedRef.current) {
        await companion.stopScreen(); return;
      }
      clearScreenPanel();
      screenActive.current = status.active;
      setScreen(status);
      setReply("Local observation is on. Close this bubble and carry on working. Ask what I can read whenever you want.");
      setSource("command");
    });
  }

  function sharePreview() {
    void screenOperation(async () => {
      if (!screenPreview || provider !== "groq") return;
      const epoch = screenEpoch.current;
      const id = screenPreview.id;
      setScreenPreview(null);
      setScreenPanel(null);
      setReply("Checking how the reviewed text relates to your goal…");
      try {
        const answer = await companion.analyzeScreen(id);
        if (epoch === screenEpoch.current && expandedRef.current && !hiding.current) {
          setReply(answer);
          setSource("command");
          setLatency(null);
        }
      } catch (failure) {
        if (epoch === screenEpoch.current && expandedRef.current && !hiding.current) {
          setReply("I couldn't analyze that excerpt. No automatic retry.");
          setError(String(failure));
        }
      }
    });
  }

  function clearConversation() {
    pendingAction.current = null;
    awarenessPending.current = null;
    clearScreenPanel();
    // Folding the bubble does not erase conversational context.
    setReply("");
    setReaction(null);
    // Closing or moving a bubble must never discard unsent input.
    setSource(null);
    setLatency(null);
  }

  function clearAwareness() {
    awarenessEpoch.current += 1;
    awarenessPending.current = null;
    setAwareness(old => old ? { ...old, enabled: false, category: "unavailable", cue: null } : null);
    setCheckIn(null);
  }

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void appWindow.listen("oplyra-awareness-stopped", () => { if (!disposed) clearAwareness(); })
      .then(unlisten => { if (disposed) unlisten(); else cleanup = unlisten; }).catch(() => {});
    return () => { disposed = true; cleanup?.(); };
  }, []);

  useEffect(() => {
    // No poller while off, paused, expanded, dragging, busy, or destroyed.
    if (!awareness?.enabled || current?.phase !== "running" || expanded || dragging || busy || !ready) return;
    let disposed = false;
    let inFlight = false;
    const poll = async () => {
      if (disposed || inFlight || expandedRef.current || held.current || hiding.current || document.hidden) return;
      inFlight = true;
      const epoch = awarenessEpoch.current;
      try {
        const result = await companion.sampleAwareness();
        if (disposed || epoch !== awarenessEpoch.current || expandedRef.current || hiding.current) return;
        setAwareness(result);
        if (!result.enabled) setCheckIn(null);
        else if (result.cue) { checkInExpiry.current = performance.now() + 60_000; setCheckIn(result.cue); showAmbient(result.cue === "leisure_check" ? "Still on task, or taking a break?" : "Welcome back. Ready to continue?"); }
        else if (performance.now() >= checkInExpiry.current) setCheckIn(null);
      } catch {
        if (!disposed && epoch === awarenessEpoch.current) {
          clearAwareness();
          void companion.setAwareness(false).catch(() => {});
        }
      } finally { inFlight = false; }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [awareness?.enabled, current?.phase, expanded, dragging, busy, ready]);

  async function hideOverlay() {
    if (hiding.current) return;
    hiding.current = true;
    clearScreen();
    void companion.stopScreen().catch(() => {});
    clearAwareness();
    void companion.setAwareness(false).catch(() => {});
    visibilityEpoch.current += 1;
    pendingAction.current = null;
    // The native tray request also uses this path; preserve the exact draft
    // rather than depending on asynchronous per-keystroke IPC or disk storage.
    try {
      // A tray hide may arrive while a bin is still being constructed.
      // Let that creation finish before native teardown can destroy both windows.
      const gesture = held.current;
      if (gesture) {
        gesture.ended = true;
        held.current = null;
        await gesture.startPromise;
      }
      while (movingPosition.current) {
        await new Promise<void>(resolve => window.setTimeout(resolve, 12));
      }
      await invoke("hide_companion", { draft: draftRef.current });
    } catch (failure) {
      hiding.current = false;
      setDragging(false);
      setError("Could not hide Oplyra: " + String(failure));
    }
  }

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void appWindow.listen("oplyra-request-hide", () => {
      if (!disposed) void hideOverlay();
    }).then(async unlisten => {
      if (disposed) { unlisten(); return; }
      cleanup = unlisten;
      const draft = await invoke<string>("load_overlay_draft");
      if (!disposed) { setMessage(draft); setReady(true); }
    }).catch((failure: unknown) => {
      if (!disposed) setError("Could not restore the overlay: " + String(failure));
    });
    return () => { disposed = true; cleanup?.(); };
  }, []);

  async function toggleDetails(open: boolean) {
    if (resizing) return;
    setResizing(true);
    setError("");
    if (!open) {
      visibilityEpoch.current += 1;
      if (pendingAction.current || awarenessPending.current !== null || screenPanel || busy) {
        setReply("Ready when you are."); setSource(null);
      }
      pendingAction.current = null; awarenessPending.current = null; clearScreenPanel();
      void companion.panelKeyboard(false).catch(() => {});
    }
    else { screenEpoch.current += 1; }
    if (open && awareness?.enabled) {
      awarenessEpoch.current += 1;
      void companion.suspendAwareness().catch(() => {});
    }
    try {
      // The hit-test region grows only when the user explicitly opens controls.
      await appWindow.setSize(open ? OPEN : COMPACT);
      expandedRef.current = open;
      visibilityEpoch.current += 1;
      setExpanded(open);
      // Folding is presentation only; keep the latest ordinary reply and chat history.
      if (open) setAmbientCue("");
      if (open && checkIn && performance.now() < checkInExpiry.current) {
        setReply(checkIn === "leisure_check" ? "Still on task, or taking a break?" : "Welcome back. Ready to pick up where you left off?");
        setReaction("attentive");
        setSource("command");
        setCheckIn(null);
      }
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
      // Keep the open bubble and its text in place relative to the character.
      // Moving is not a request to erase a draft or close a conversation.
      awarenessPending.current = null;
      clearScreenPanel();
      awarenessEpoch.current += 1;
      setCheckIn(null);
      setAmbientCue("");
      if (awareness?.enabled) void companion.suspendAwareness().catch(() => {});
      if (pendingAction.current) {
        pendingAction.current = null;
        setReply("Tell me what you'd like to do.");
        setSource(null);
      }
      if (actionRunning.current) {
        setReply("Ready when you are.");
        setSource(null);
      }
      visibilityEpoch.current += 1;
      await gesture.geometryPromise;
      if (!gesture.base) return; // No native coordinates: do not open an unusable bin.
      // Even a brief drag should move the character; pointerup will wait for
      // the latest coalesced native position before considering a drop.
      updateDragPosition(gesture);
      if (gesture.ended || hiding.current) return;
      await invoke("begin_companion_drag");
      gesture.binReady = true;
    } catch (failure) {
      setError(`Could not begin dragging: ${String(failure)}`);
      try { await invoke("cancel_companion_drag"); } catch { /* target may be unavailable */ }
    }
  }

  function onCharacterPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || resizing || held.current || finishingDrag.current || hiding.current) return;
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
    finishingDrag.current = true;
    void (async () => {
      try {
        // A quick release can race the native bin/show IPC. Wait for startup,
        // then finish/cancel once, so the bin cannot appear after the drop.
        await gesture.startPromise;
        while (movingPosition.current) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 12));
        }
        if (gesture.binReady && !hiding.current) {
          if (cancelled) await invoke("cancel_companion_drag");
          else if (await invoke<boolean>("finish_companion_drag")) await hideOverlay();
        }
      } catch (failure) {
        setError(`Could not complete drag: ${String(failure)}`);
      } finally {
        finishingDrag.current = false;
        setDragging(false);
      }
    })();
  }

  async function sendMessage() {
    if (actionRunning.current || hiding.current || !current || !message.trim()) return;
    const userMessage = message.trim();
    const screenRequest = screenCommand(userMessage) ?? (screen?.active && /^what can you see[.!?]*$/i.test(userMessage) ? "preview" : null);
    if (screenRequest) {
      pendingAction.current = null;
      awarenessPending.current = null;
      clearScreenPanel();
      setMessage(""); setSource("command"); setLatency(null); setReaction("attentive"); setError("");
      if (screenRequest === "choose") {
        if (current.phase !== "running") { setReply("Start a focus session first."); return; }
        if (screen?.supported === false) { setReply("Window observation requires macOS 14 or newer."); return; }
        // Stop old capture before asking for a new selection.
        void screenOperation(async () => {
          const epoch = screenEpoch.current;
          await companion.stopScreen();
          if (epoch !== screenEpoch.current || hiding.current || !expandedRef.current) return;
          screenActive.current = false;
          setAmbientCue("");
          setScreen(old => old ? {...old, active:false, app:null, sample_ready:false} : null);
          setReply("I can read a chosen window, or follow supported work apps locally. Avoid sensitive pages. Nothing is sent to Groq unless you review and approve it.");
          setScreenPanel("permission");
        });
        return;
      }
      if (screenRequest === "stop") {
        void screenOperation(async () => { await companion.stopScreen(); clearScreen(); setReply("Screen observation is off."); });
        return;
      }
      void screenOperation(async () => {
        const epoch = screenEpoch.current;
        const preview = await companion.previewScreen();
        if (epoch !== screenEpoch.current || hiding.current || !expandedRef.current) return;
        setScreenPreview(preview);
        setScreenPanel("preview");
        setReply("Here's the latest locally recognised excerpt. Review it and your goal before sharing.");
      });
      return;
    }
    clearScreenPanel();
    const awarenessRequest = awarenessCommand(userMessage);
    const consent = awarenessPending.current;
    awarenessPending.current = null;
    const consentAnswer = consent !== null ? resolveConfirmation(userMessage, { action: "quiet", phase: current.phase, expiresAt: consent }, current.phase, performance.now()) : "unrelated";
    if (awarenessRequest || consentAnswer === "accept" || consentAnswer === "decline" || (consentAnswer === "expired" && /^(?:yes|sure|ok|okay|no|confirm)[.!?]*$/i.test(userMessage))) {
      pendingAction.current = null;
      setMessage(""); setSource("command"); setLatency(null); setReaction("attentive"); setError("");
      if (awarenessRequest === "enable") {
        if (current.phase !== "running") setReply("Start a focus session first, then ask me to watch your activity.");
        else if (awareness?.supported === false) setReply("Activity awareness is only available on macOS in this preview.");
        else if (awareness?.enabled) setReply("Activity awareness is already on. Say stop watching whenever you want.");
        else {
          awarenessPending.current = performance.now() + 60_000;
          setReply("I can check the active app type and idle time locally, until you pause, hide or finish. I may offer gentle check-ins. No screen content is read. Start?");
        }
        return;
      }
      if (awarenessRequest === "status") {
        setReply(awareness?.enabled ? "Awareness is on for this session. I check app type and idle time when the bubble is closed. No screen content is read or sent." : "Activity awareness is off. I cannot see your screen.");
        return;
      }
      if (consentAnswer === "decline" || consentAnswer === "expired") {
        setReply("No change. Activity awareness stays off."); return;
      }
      const enable = awarenessRequest !== "disable" && consentAnswer === "accept" && current.phase === "running";
      actionRunning.current = true; setBusy(true);
      const epoch = ++awarenessEpoch.current;
      const visibility = visibilityEpoch.current;
      try {
        if (!enable) { await companion.stopScreen(); clearScreen(); }
        const result = await companion.setAwareness(enable);
        if (epoch === awarenessEpoch.current && !hiding.current) {
          setAwareness(result); setCheckIn(null);
          if (expandedRef.current && visibility === visibilityEpoch.current) setReply(result.enabled ? "Activity awareness is on. Close the bubble and carry on. Say stop watching to turn it off." : "Activity awareness is off.");
        } else if (result.enabled) {
          // A hide, move, or revocation superseded this in-flight enable request.
          await companion.setAwareness(false);
        }
      } catch (failure) {
        if (expandedRef.current && visibility === visibilityEpoch.current) setReply("I could not change activity awareness. " + String(failure));
      } finally { actionRunning.current = false; setBusy(false); }
      return;
    }
    if (/^(?:forget (?:this|our) conversation|clear (?:the |our )?conversation|forget our chat)[.!?]*$/i.test(userMessage)) {
      history.current = [];
      clearConversation();
      setMessage("");
      setReply("I cleared our recent chat. Your focus session is unchanged.");
      setSource("command");
      return;
    }
    const pending = pendingAction.current;
    pendingAction.current = null;
    const outcome = resolveConfirmation(userMessage, pending, current.phase, performance.now());
    if (outcome === "decline") {
      setMessage(""); setReply("Okay, no change."); setReaction(restingBehaviour(current.phase));
      setSource("command"); setLatency(null);
      history.current = rememberTurn(history.current, userMessage, "Okay, no change.");
      return;
    }
    const confirmationWord = /^(?:yes|yes please|yes, please|sure|go ahead|do it|okay|ok|confirm|no|no thanks|no, thanks|not now|cancel|never mind|nevermind)[.!?]*$/i.test(userMessage);
    if (confirmationWord && outcome !== "accept" && pending) {
      setMessage(""); setReply(pending ? "That request is no longer active. Tell me what you'd like to do." : "Tell me what you'd like to do.");
      setReaction(restingBehaviour(current.phase)); setSource("command"); setLatency(null);
      history.current = rememberTurn(history.current, userMessage, "That request is no longer active.");
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
          const generated = await companion.localReply(userMessage, history.current);
          if (expandedRef.current && visibility === visibilityEpoch.current) {
            setAiNotice("");
            setSource(generated.provider);
            setActiveModel(generated.model);
            setLatency(generated.latency_ms);
            if (generated.proposal) {
              // No model-generated instruction is executed. A proposal is a
              // short-lived question tied to this state and visible conversation.
              const normalized = userMessage.toLowerCase().replace(/[’‘]/g, "'");
              const ambiguous = /["“”]|(?:^|\s)(?:don't|do not|not|never|unless|what if|should i|hypothetically|but|instead)(?:\s|[.,?!]|$)/.test(normalized);
              if (!ambiguous && !confirmationWord && actionAllowed(generated.proposal, current.phase)) {
                pendingAction.current = { action: generated.proposal, phase: current.phase, expiresAt: performance.now() + 60_000 };
                const question = proposalQuestion(generated.proposal);
                setReply(question);
                history.current = rememberTurn(history.current, userMessage, question);
              } else {
                const clarification = "I haven't changed our session. Tell me directly if you'd like to change it.";
                setReply(clarification);
                history.current = rememberTurn(history.current, userMessage, clarification);
              }
              setReaction("attentive");
            } else {
              setReply(generated.reply);
              setReaction(plan.behaviour === "encouraging" ? "encouraging" : generated.reaction);
              history.current = rememberTurn(history.current, userMessage, generated.reply);
            }
          }
        } catch (failure) {
          // Native provider errors contain no message content; keep diagnostics local.
          console.warn("AI request failed:", String(failure));
          if (expandedRef.current && visibility === visibilityEpoch.current) {
            setReply(plan.reply);
            setReaction(plan.behaviour);
            setSource("fallback");
            setAiNotice(String(failure).includes("Groq rate limit") ? "Groq limit reached · try later" : String(failure).includes("Groq API key missing") ? "Groq API key missing" : "AI unavailable · basic response");
            history.current = rememberTurn(history.current, userMessage, plan.reply);
          }
        }
        return;
      }
      if (plan.action !== "none" && !actionAllowed(plan.action, current.phase)) {
        throw new Error("This action is not available in the current session");
      }
      switch (plan.action) {
        case "start": data = await companion.start(plan.goal ?? "Focus together", "Continue the chosen task"); break;
        case "pause": data = await companion.pause(); clearAwareness(); clearScreen(); break;
        // The older automatic return-cue policy remains in Rust but isn't
        // invoked here. Conversation is requested by the user, not a prompt.
        case "resume": data = await companion.resume(); break;
        case "finish": data = await companion.finish(); clearAwareness(); clearScreen(); break;
        case "quiet": data = await companion.setSupportMode("quiet"); clearAwareness(); clearScreen(); break;
        case "hide":
          // Hiding never finishes or deletes a session. Menu bar recreates it.
          await hideOverlay();
          return;
        case "none": break;
      }
      setCurrent(data);
      // Record only the reply after native success; do not claim a failed action.
      if (plan.reply) history.current = rememberTurn(history.current, userMessage, plan.reply);
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
  const behaviour = checkIn && !expanded ? "attentive" : reaction ?? (expanded ? "attentive" : restingBehaviour(phase));
  const phaseName = screen?.active && phase === "running" ? (screen.sample_ready ? "Screen · read" : "Screen · local") : awareness?.enabled && phase === "running" ? (checkIn ? "Check-in · aware" : "Working · aware") : phase === "running" ? "Working together" : phase === "paused" ? "On a break" : "Here with you";

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
        {!expanded && !dragging && ambientCue && <div className="ambient-cue" role="status">{ambientCue}</div>}
      </div>

      {expanded && (
        <section id="companion-controls" className="conversation-bubble" aria-label="Talk to Oplyra">
          <p className="companion-reply" role="status" aria-live="polite">
            {reply || (phase === "running" ? "How's it going?" : phase === "paused" ? "Ready when you are." : "Let's spend some time together.")}
          </p>
          {screenPanel === "permission" && <div className="screen-controls">
            <button type="button" disabled={busy} onClick={chooseWindows}>Choose work window</button>
            <button type="button" className="secondary-screen" disabled={busy} onClick={clearScreenPanel}>Cancel</button>
          </div>}
          {screenPanel === "choose" && <div className="screen-controls">
            <select aria-label="Select a work window" value={selectedWindow} onChange={event => setSelectedWindow(event.target.value)} disabled={busy}>
              <option value="">Select a window…</option>
              {windows.map(w => <option key={w.id} value={w.id}>{w.app}{w.title ? " — " + w.title : ""}</option>)}
            </select>
            <p className="screen-detail">Follow mode reads whichever supported work window is in front, including browser tabs. Avoid sensitive pages.</p>
            <button type="button" disabled={busy || !selectedWindow} onClick={startWindow}>{selectedWindow === "0" ? "Follow work apps locally" : "Watch this window"}</button>
            <button type="button" className="secondary-screen" disabled={busy} onClick={clearScreenPanel}>Cancel</button>
          </div>}
          {screenPanel === "preview" && screenPreview && <div className="screen-controls">
            <p className="screen-detail">Goal: {screenPreview.goal || "(not set)"}</p>
            <pre className="screen-excerpt">{screenPreview.excerpt}</pre>
            <p className="screen-detail">Share only this goal and excerpt with Groq. {screenPreview.remaining_today} analyses left today. Preview expires in at most 60 seconds.</p>
            <button type="button" disabled={busy || provider !== "groq" || screenPreview.remaining_today === 0} onClick={sharePreview}>Analyze with Groq once</button>
            <button type="button" className="secondary-screen" disabled={busy} onClick={clearScreenPanel}>Don't share</button>
          </div>}
          <form className="conversation-form" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <input aria-label="Type to Oplyra" value={message} maxLength={300}
              placeholder={pendingAction.current || awarenessPending.current !== null ? "Yes or no…" : "Say something…"} disabled={!ready || !current || busy}
              onPointerDown={() => { void companion.panelKeyboard(true).catch(() => {}); }}
              onChange={(event) => setMessage(event.target.value)} />
            <button type="submit" aria-label="Send message" disabled={busy || !ready || !current || !message.trim()}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </form>
          <p className="conversation-note">{awarenessPending.current !== null ? "Reply yes or no · awareness is off" : pendingAction.current ? "Reply yes or no · no change yet" : source === "local" || source === "deepseek" || source === "groq" ? `${source === "groq" ? "GPT-OSS-120B · Groq" : source === "deepseek" ? "DeepSeek · online" : activeModel ?? "Local AI"} · ${((latency ?? 0) / 1000).toFixed(1)} s` : source === "fallback" ? aiNotice || "AI unavailable · basic response" : provider === "groq" ? "Groq online · chat and session context sent" : provider === "deepseek" ? "DeepSeek online · chat and session context sent" : provider === "local" ? "On-device · Talk to Oplyra." : "AI provider loading…"} </p>
          {screen?.active && <p className="screen-detail">Local OCR · {screen.app} · {screen.detail || (screen.sample_ready ? "text available" : "waiting for window")} · say “stop watching my screen”</p>}
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
