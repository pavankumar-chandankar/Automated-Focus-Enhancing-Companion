// Local embodiment policy. Inputs are existing UI and explicit session events.
import type { Phase } from "./native";
import type { Behaviour } from "./dialogue";

export type Pose = "idle" | "work" | "rest" | "curious" | "touch" | "carried" |
  "settle" | "listening" | "thinking" | "encourage" | "celebrate" |
  "stretch" | "look-around" | "turn-page" | "yawn";

export type PresenceInputs = {
  phase: Phase; dragging: boolean; pressed: boolean; busy: boolean;
  reminder: boolean; expanded: boolean; hovered: boolean;
  gesture: Pose | null; response: Pose | null; ambient: Pose | null;
};
export function basePose(phase: Phase): Pose {
  return phase === "running" ? "work" : phase === "paused" ? "rest" : "idle";
}
export function reactionPose(behaviour: Behaviour | null): Pose | null {
  switch (behaviour) {
    case "encouraging": return "encourage";
    case "celebrating": return "celebrate";
    case "attentive": return "listening";
    default: return null;
  }
}
export function choosePose(s: PresenceInputs): Pose {
  if (s.dragging) return "carried";
  if (s.pressed) return "touch";
  if (s.gesture) return s.gesture;
  if (s.busy) return "thinking";
  if (s.reminder) return "encourage";
  if (s.response) return s.response;
  if (s.expanded) return "listening";
  if (s.hovered) return "curious";
  return s.ambient ?? basePose(s.phase);
}
export function autonomousMove(phase: Phase, random: number, quiet: boolean): {pose: Pose; duration: number; delay: number} {
  const r = Number.isFinite(random) ? Math.min(.999, Math.max(0, random)) : .5;
  if (phase === "running") return {pose: "turn-page", duration: 1800, delay: (quiet ? 65000 : 35000) + Math.floor(r * 25000)};
  if (phase === "paused") return {pose: "yawn", duration: 1800, delay: 25000 + Math.floor(r * 20000)};
  return {pose: r < .5 ? "stretch" : "look-around", duration: 1900, delay: 12000 + Math.floor(r * 17000)};
}
export function canAnimateAmbient(s: PresenceInputs): boolean {
  return !s.dragging && !s.pressed && !s.busy && !s.reminder && !s.expanded && !s.hovered && !s.gesture && !s.response;
}


// The scheduler accepts a clock so cancellation, recurrence and expiry can
// be tested without React, real sleeps, or a native window.
export function scheduleAmbient(phase: Phase, quiet: boolean, emit: (pose: Pose | null) => void,
    clock: {set: (fn: () => void, ms: number) => number; clear: (id: number) => void; random: () => number}): () => void {
  let timer: number | undefined;
  let cancelled = false;
  const schedule = () => {
    const move = autonomousMove(phase, clock.random(), quiet);
    timer = clock.set(() => {
      if (cancelled) return;
      emit(move.pose);
      timer = clock.set(() => {
        if (cancelled) return;
        emit(null);
        schedule();
      }, move.duration);
    }, move.delay);
  };
  schedule();
  return () => { cancelled = true; if (timer !== undefined) clock.clear(timer); };
}
