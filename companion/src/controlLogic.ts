import type { Phase, ControlAction } from "./native";
export function sessionActions(phase: Phase): ControlAction[] {
  return phase === "idle" ? ["start"] : phase === "running" ? ["pause","finish"] : ["resume","finish"];
}
export function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n=>String(n).padStart(2,"0")).join(":");
}
