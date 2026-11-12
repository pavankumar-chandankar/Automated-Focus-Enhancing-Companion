export type Consent = {
  participate: true;
  local_aggregate_storage: boolean;
  send_text_to_llm: boolean;
  show_safety_warnings: boolean;
};

export type Preferences = {
  intervention_style: "quiet" | "supportive" | "reflective";
  focus_minutes: number;
  break_minutes: number;
  maximum_nudges_per_hour: number;
  snooze_minutes: number;
  accessibility_reduce_motion: boolean;
  accessibility_high_contrast: boolean;
};

export type Session = {
  id: string;
  created_at: string;
  expires_at: string;
  consent: Consent;
  preferences: Preferences;
  status: string;
};

export type Signal = {
  elapsed_minutes: number;
  focused_minutes: number;
  idle_minutes: number;
  context_switch_count: number;
  self_report_energy: number | null;
};

export type Suggestion = {
  title: string;
  message: string;
  rationale: string;
  choices: string[];
  uncertainty: string;
  evidence: string[];
  prompt_version: string;
  provider: string;
  human_control: boolean;
};

export type CoachResponse = {
  suggestion: Suggestion;
  safety_flags: string[];
  automated_action_taken: false;
  text_sent_to_external_provider: boolean;
};
