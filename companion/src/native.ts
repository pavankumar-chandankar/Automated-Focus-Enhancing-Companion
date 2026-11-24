import { invoke } from "@tauri-apps/api/core";

export type Phase = "idle" | "running" | "paused";

export interface SessionSnapshot {
  schema_version: number;
  phase: Phase;
  goal: string;
  next_step: string;
  elapsed_ms: number;
  sessions_completed: number;
  quiet_mode: boolean;
  last_completed_ms: number | null;
}

export const companion = {
  snapshot: () => invoke<SessionSnapshot>("get_snapshot"),
  start: (goal: string, nextStep: string) =>
    invoke<SessionSnapshot>("start_session", { goal, nextStep }),
  pause: () => invoke<SessionSnapshot>("pause_session"),
  resume: () => invoke<SessionSnapshot>("resume_session"),
  finish: () => invoke<SessionSnapshot>("finish_session"),
  saveNextStep: (nextStep: string) => invoke<SessionSnapshot>("save_next_step", { nextStep }),
  setQuietMode: (enabled: boolean) => invoke<SessionSnapshot>("set_quiet_mode", { enabled }),
};
