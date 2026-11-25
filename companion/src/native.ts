import { invoke } from "@tauri-apps/api/core";

export type Phase = "idle" | "running" | "paused";
export type SupportMode = "quiet" | "balanced" | "supportive";
export type CueFeedback = "useful" | "not_useful" | "dismiss";

export interface SessionSnapshot {
  schema_version: number;
  phase: Phase;
  goal: string;
  next_step: string;
  elapsed_ms: number;
  sessions_completed: number;
  quiet_mode: boolean;
  support_mode: SupportMode;
  preference_weight: number;
  pending_offer_id: number | null;
  last_completed_ms: number | null;
}

export type PreviousTurn = { user: string; reply: string };
export type Provider = "local" | "deepseek" | "groq";
export type ModelReply = { provider: Provider; model: string; reply: string; reaction: "attentive" | "encouraging"; latency_ms: number; proposal: import("./dialogue").Intent | null };

export type AwarenessCue = "leisure_check" | "return_check";
export type AwarenessStatus = { enabled: boolean; supported: boolean; category: "leisure" | "browser" | "other" | "unavailable"; cue: AwarenessCue | null };

export const companion = {
  awarenessStatus: () => invoke<AwarenessStatus>("awareness_status"),
  setAwareness: (enabled: boolean) => invoke<AwarenessStatus>("set_awareness", { enabled }),
  sampleAwareness: () => invoke<AwarenessStatus>("sample_awareness"),
  suspendAwareness: () => invoke<void>("suspend_awareness"),
  provider: () => invoke<Provider>("intelligence_provider"),
  localReply: (message: string, history: PreviousTurn[]) => invoke<ModelReply>("local_companion_reply", { message, history }),
  snapshot: () => invoke<SessionSnapshot>("get_snapshot"),
  start: (goal: string, nextStep: string) =>
    invoke<SessionSnapshot>("start_session", { goal, nextStep }),
  pause: () => invoke<SessionSnapshot>("pause_session"),
  resume: () => invoke<SessionSnapshot>("resume_session"),
  resumeWithAssistance: () => invoke<SessionSnapshot>("resume_with_assistance"),
  setSupportMode: (mode: SupportMode) => invoke<SessionSnapshot>("set_support_mode", { mode }),
  feedback: (offerId: number, response: CueFeedback) => invoke<SessionSnapshot>("record_cue_feedback", { offerId, response }),
  resetPreference: () => invoke<SessionSnapshot>("reset_cue_preference"),
  finish: () => invoke<SessionSnapshot>("finish_session"),
  saveNextStep: (nextStep: string) => invoke<SessionSnapshot>("save_next_step", { nextStep }),
  setQuietMode: (enabled: boolean) => invoke<SessionSnapshot>("set_quiet_mode", { enabled }),
};
