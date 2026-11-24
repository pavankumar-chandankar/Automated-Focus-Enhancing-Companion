use serde::{Deserialize, Serialize};
use crate::policy::{Feedback, PolicyState, SupportMode};

const MAX_GOAL: usize = 160;
const MAX_STEP: usize = 240;
const MAX_ELAPSED_MS: u64 = 365 * 24 * 60 * 60 * 1000;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase { Idle, Running, Paused }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct SessionModel {
    pub schema_version: u32,
    pub phase: Phase,
    pub goal: String,
    pub next_step: String,
    pub accumulated_ms: u64,
    pub running_since_ms: Option<u64>,
    pub sessions_completed: u64,
    pub last_completed_ms: Option<u64>,
    pub quiet_mode: bool,
    pub policy: PolicyState,
}

impl Default for SessionModel {
    fn default() -> Self {
        Self {
            schema_version: 1, phase: Phase::Idle, goal: String::new(), next_step: String::new(),
            accumulated_ms: 0, running_since_ms: None, sessions_completed: 0,
            last_completed_ms: None, quiet_mode: true, policy: PolicyState::default(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct SessionSnapshot {
    pub schema_version: u32,
    pub phase: Phase,
    pub goal: String,
    pub next_step: String,
    pub elapsed_ms: u64,
    pub sessions_completed: u64,
    pub last_completed_ms: Option<u64>,
    pub quiet_mode: bool,
    pub support_mode: SupportMode,
    pub preference_weight: i8,
    pub pending_offer_id: Option<u32>,
}

fn valid_text(text: &str, name: &str, limit: usize) -> Result<String, String> {
    let cleaned = text.trim();
    if cleaned.is_empty() { return Err(format!("{name} cannot be empty")); }
    if cleaned.chars().count() > limit { return Err(format!("{name} exceeds {limit} characters")); }
    if cleaned.chars().any(|c| c.is_control() && c != '\n') {
        return Err(format!("{name} contains unsupported control characters"));
    }
    Ok(cleaned.to_owned())
}

impl SessionModel {
    pub fn validate(&self) -> Result<(), String> {
        self.policy.validate()?;
        if self.schema_version != 1 { return Err("Unknown local data version; refusing to overwrite it".into()); }
        if self.phase == Phase::Running && self.running_since_ms.is_none() {
            return Err("Active session has no start timestamp".into());
        }
        if self.phase != Phase::Running && self.running_since_ms.is_some() {
            return Err("Inactive session unexpectedly has a running timestamp".into());
        }
        if self.accumulated_ms > MAX_ELAPSED_MS { return Err("Invalid stored elapsed time".into()); }
        if !self.goal.is_empty() { valid_text(&self.goal, "Goal", MAX_GOAL)?; }
        if !self.next_step.is_empty() { valid_text(&self.next_step, "Next step", MAX_STEP)?; }
        if self.phase != Phase::Idle && (self.goal.is_empty() || self.next_step.is_empty()) {
            return Err("Active session is missing a task or checkpoint".into());
        }
        Ok(())
    }

    pub fn elapsed(&self, now_ms: u64) -> u64 {
        let ongoing = self.running_since_ms.map(|start| now_ms.saturating_sub(start)).unwrap_or(0);
        self.accumulated_ms.saturating_add(ongoing).min(MAX_ELAPSED_MS)
    }

    pub fn snapshot(&self, now_ms: u64) -> SessionSnapshot {
        SessionSnapshot {
            schema_version: self.schema_version, phase: self.phase,
            goal: self.goal.clone(), next_step: self.next_step.clone(), elapsed_ms: self.elapsed(now_ms),
            sessions_completed: self.sessions_completed, last_completed_ms: self.last_completed_ms,
            quiet_mode: self.policy.mode == SupportMode::Quiet,
            support_mode: self.policy.mode,
            preference_weight: self.policy.weight(),
            pending_offer_id: self.policy.pending_id(),
        }
    }

    pub fn start(&mut self, goal: &str, next_step: &str, now_ms: u64) -> Result<(), String> {
        if self.phase != Phase::Idle { return Err("Finish your current session before starting another".into()); }
        let goal = valid_text(goal, "Goal", MAX_GOAL)?;
        let next_step = valid_text(next_step, "Next step", MAX_STEP)?;
        self.policy.clear_pending();
        self.goal = goal;
        self.next_step = next_step;
        self.accumulated_ms = 0;
        self.running_since_ms = Some(now_ms);
        self.phase = Phase::Running;
        Ok(())
    }

    pub fn pause(&mut self, now_ms: u64) -> Result<(), String> {
        if self.phase != Phase::Running { return Err("Session is not running".into()); }
        self.policy.clear_pending();
        self.accumulated_ms = self.elapsed(now_ms);
        self.running_since_ms = None;
        self.phase = Phase::Paused;
        Ok(())
    }

    pub fn resume(&mut self, now_ms: u64) -> Result<(), String> {
        if self.phase != Phase::Paused { return Err("Session is not paused".into()); }
        self.policy.clear_pending();
        self.running_since_ms = Some(now_ms);
        self.phase = Phase::Running;
        Ok(())
    }

    pub fn resume_with_assistance(&mut self, now_ms: u64) -> Result<(), String> {
        self.resume(now_ms)?;
        self.policy.on_return(!self.next_step.trim().is_empty(), now_ms);
        Ok(())
    }

    pub fn set_support_mode(&mut self, mode: SupportMode) {
        self.quiet_mode = mode == SupportMode::Quiet;
        self.policy.set_mode(mode);
    }

    pub fn record_feedback(&mut self, id: u32, response: Feedback) -> Result<(), String> {
        if self.phase != Phase::Running { return Err("No active return cue".into()); }
        self.policy.feedback(id, response)
    }

    pub fn finish(&mut self, now_ms: u64) -> Result<(), String> {
        if self.phase == Phase::Idle { return Err("There is no active session".into()); }
        self.policy.clear_pending();
        let elapsed = self.elapsed(now_ms);
        self.last_completed_ms = Some(elapsed);
        self.accumulated_ms = 0;
        self.running_since_ms = None;
        self.phase = Phase::Idle;
        self.sessions_completed = self.sessions_completed.saturating_add(1);
        Ok(())
    }

    pub fn checkpoint(&mut self, text: &str) -> Result<(), String> {
        if self.phase == Phase::Idle { return Err("Start a session before saving a checkpoint".into()); }
        self.next_step = valid_text(text, "Next step", MAX_STEP)?;
        self.policy.clear_pending();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timer_excludes_paused_time() {
        let mut model = SessionModel::default();
        model.start("Write paper", "Draft table", 1_000).unwrap();
        assert_eq!(model.elapsed(11_000), 10_000);
        model.pause(11_000).unwrap();
        assert_eq!(model.elapsed(50_000), 10_000);
        model.resume(50_000).unwrap();
        assert_eq!(model.elapsed(54_000), 14_000);
        model.finish(54_000).unwrap();
        assert_eq!(model.last_completed_ms, Some(14_000));
        assert_eq!(model.sessions_completed, 1);
    }

    #[test]
    fn rejects_bad_transitions_without_mutation() {
        let mut model = SessionModel::default();
        assert!(model.pause(100).is_err());
        assert!(model.resume(100).is_err());
        model.start("Task", "Next", 100).unwrap();
        assert!(model.start("Other", "Other", 200).is_err());
        assert_eq!(model.goal, "Task");
    }

    #[test]
    fn validates_task_content() {
        let mut model = SessionModel::default();
        assert!(model.start(" ", "step", 100).is_err());
        assert!(model.start("good", " ", 100).is_err());
        assert!(model.start(&"a".repeat(161), "step", 100).is_err());
        assert!(model.start("good", "step", 100).is_ok());
        assert!(model.checkpoint("\u{0000}").is_err());
    }

    #[test]
    fn clock_rollback_never_decreases_elapsed() {
        let mut model = SessionModel::default();
        model.start("Task", "Step", 20_000).unwrap();
        assert_eq!(model.elapsed(10_000), 0);
        model.pause(10_000).unwrap();
        assert_eq!(model.elapsed(40_000), 0);
    }

    #[test]
    fn serializes_and_restores_active_session() {
        let mut model = SessionModel::default();
        model.start("Task", "Checkpoint", 20_000).unwrap();
        let bytes = serde_json::to_vec(&model).unwrap();
        let restored: SessionModel = serde_json::from_slice(&bytes).unwrap();
        restored.validate().unwrap();
        assert_eq!(restored.phase, Phase::Running);
        assert_eq!(restored.elapsed(25_000), 5_000);
    }

    #[test]
    fn legacy_session_without_policy_defaults_to_quiet() {
        let json = r#"{"schema_version":1,"phase":"paused","goal":"Read","next_step":"Page 3","accumulated_ms":12000,"quiet_mode":false}"#;
        let mut restored: SessionModel = serde_json::from_str(json).unwrap();
        restored.validate().unwrap();
        assert_eq!(restored.snapshot(500).support_mode, SupportMode::Quiet);
        restored.resume_with_assistance(500).unwrap();
        assert_eq!(restored.snapshot(500).pending_offer_id, None);
        assert_eq!(restored.goal, "Read");
    }

    #[test]
    fn only_explicit_assisted_resume_offers_and_lifecycle_invalidates() {
        let mut model = SessionModel::default();
        model.set_support_mode(SupportMode::Balanced);
        model.start("Task", "Step", 0).unwrap();
        model.pause(10).unwrap();
        model.resume(20).unwrap();
        assert_eq!(model.policy.pending_id(), None);
        model.pause(30).unwrap();
        model.resume_with_assistance(40).unwrap();
        let id = model.policy.pending_id().unwrap();
        model.pause(50).unwrap();
        assert!(model.record_feedback(id, Feedback::Useful).is_err());
        assert_eq!(model.policy.pending_id(), None);
    }

    #[test]
    fn checkpoint_update_invalidates_previous_offer() {
        let mut model = SessionModel::default();
        model.set_support_mode(SupportMode::Balanced);
        model.start("Task", "Step", 0).unwrap();
        model.pause(10).unwrap();
        model.resume_with_assistance(20).unwrap();
        let id = model.policy.pending_id().unwrap();
        model.checkpoint("New step").unwrap();
        assert!(model.record_feedback(id, Feedback::Useful).is_err());
        assert_eq!(model.next_step, "New step");
    }

    #[test]
    fn refuses_unsupported_schema_version() {
        let mut model = SessionModel::default();
        model.schema_version = 2;
        assert!(model.validate().is_err());
    }
}
