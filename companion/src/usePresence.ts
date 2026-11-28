import { useEffect, useRef, useState } from "react";
import type { Phase } from "./native";
import type { Behaviour } from "./dialogue";
import { scheduleAmbient, canAnimateAmbient, choosePose, reactionPose, type Pose } from "./presence";

type Props = {
  phase: Phase; quiet: boolean; ready: boolean; dragging: boolean; reducedMotion?:boolean;
  busy: boolean; reminder: boolean; expanded: boolean; reaction: Behaviour | null; reply: string;
};

// No render loop or IPC polling. CSS animates; a cancellable timeout
// schedules small autonomous gestures when the companion is undisturbed.
export function usePresence(p: Props) {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [gesture, setGesture] = useState<Pose | null>(null);
  const [response, setResponse] = useState<Pose | null>(null);
  const [ambient, setAmbient] = useState<Pose | null>(null);
  const [visible, setVisible] = useState(!document.hidden);
  const gestureTimer = useRef<number | null>(null);
  const lastPhase = useRef<Phase | null>(null);
  const lastDrag = useRef(false);

  function pulse(pose: Pose, ms: number) {
    if (gestureTimer.current !== null) window.clearTimeout(gestureTimer.current);
    setGesture(pose);
    gestureTimer.current = window.setTimeout(() => {
      gestureTimer.current = null; setGesture(null);
    }, ms);
  }
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => {
      document.removeEventListener("visibilitychange", change);
      if (gestureTimer.current !== null) window.clearTimeout(gestureTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!p.ready) return;
    const before = lastPhase.current;
    lastPhase.current = p.phase;
    if (before === null) pulse("stretch", 1900);
    else if (before !== p.phase) {
      if (p.phase === "idle") pulse("celebrate", 2300);
      else if (p.phase === "running") pulse("settle", 950);
      else pulse("yawn", 1800);
    }
  }, [p.ready, p.phase]);
  useEffect(() => {
    if (lastDrag.current && !p.dragging) pulse("settle", 800);
    lastDrag.current = p.dragging;
  }, [p.dragging]);
  useEffect(() => {
    const next = reactionPose(p.reaction);
    setResponse(next);
    if (!next) return;
    const timer = window.setTimeout(() => setResponse(null), next === "celebrate" ? 2400 : 1600);
    return () => window.clearTimeout(timer);
  }, [p.reaction, p.reply]);

  const inputs = {...p, pressed, hovered, gesture, response, ambient};
  const free = p.ready && visible && !p.reducedMotion && canAnimateAmbient(inputs);
  useEffect(() => {
    setAmbient(null);
    if (!free) return;
    return scheduleAmbient(p.phase, p.quiet, setAmbient, {
      set: (fn, ms) => window.setTimeout(fn, ms),
      clear: id => window.clearTimeout(id),
      random: Math.random,
    });
  }, [free, p.phase, p.quiet]);

  return {
    pose: choosePose(inputs), visible,
    enter: () => setHovered(true),
    leave: () => setHovered(false),
    down: () => { if (gestureTimer.current !== null) window.clearTimeout(gestureTimer.current); gestureTimer.current = null; setPressed(true); setAmbient(null); setGesture(null); },
    up: (cancelled: boolean, wasDrag: boolean) => {
      setPressed(false);
      if (!cancelled && !wasDrag) pulse("curious", 650);
    },
  };
}
