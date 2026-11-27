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
export type ModelReply = { provider: Provider; model: string; screen_context_used: boolean; reply: string; reaction: "attentive" | "encouraging"; latency_ms: number; proposal: import("./dialogue").Intent | null };

export type AwarenessCue = "leisure_check" | "return_check";
export type AwarenessStatus = { enabled: boolean; supported: boolean; category: "leisure" | "browser" | "other" | "unavailable"; cue: AwarenessCue | null };

export type ScreenStatus = { supported: boolean; active: boolean; app: string | null; sample_ready: boolean; detail: string; cue: boolean; cloud_context: boolean; monitoring: boolean; relevance: "related" | "possible_distraction" | "unknown"; analysis_detail: string };
export type WindowChoice = { id: number; pid: number; bundle: string; app: string; title: string };
export type ScreenPreview = { id: number; excerpt: string; goal: string; remaining_today: number; valid_for_ms: number };

export type AnalyticsSnapshot = { goal: string; elapsed_ms: number; phase: Phase; active: boolean; monitoring: boolean; remaining_today: number; detail: string; metrics: { samples: number; related: number; possible_distraction: number; unknown: number; changes: number; analyses: number; check_ins: number; returns: number } };

export const companion = {
  startFollowScreen: (cloud: boolean, goal: string) => invoke<ScreenStatus>("start_follow_screen", { cloud, goal }),
  openAnalytics: () => invoke<void>("open_analytics"),
  analytics: () => invoke<AnalyticsSnapshot>("get_analytics"),
  panelKeyboard: (enabled: boolean) => invoke<void>("panel_keyboard", { enabled }),
  screenStatus: () => invoke<ScreenStatus>("screen_status"),
  requestScreenPermission: () => invoke<void>("request_screen_permission"),
  listScreenWindows: () => invoke<WindowChoice[]>("list_screen_windows"),
  selectScreenWindow: (id: number) => invoke<ScreenStatus>("select_screen_window", { id }),
  sampleScreen: () => invoke<ScreenStatus>("sample_screen"),
  stopScreen: () => invoke<void>("stop_screen"),
  previewScreen: () => invoke<ScreenPreview>("preview_screen"),
  analyzeScreen: (id: number) => invoke<string>("analyze_screen", { id }),
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
