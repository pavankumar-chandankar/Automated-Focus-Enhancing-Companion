//! Pure, deterministic assistance policy. No sensors, network or clock access.
use serde::{Deserialize, Serialize};

pub const POLICY_VERSION: u32 = 1;
pub const COOLDOWN_MS: u64 = 120_000;
const MIN_CONFIDENCE: u8 = 80;
const MIN_UTILITY: i32 = 30;
const MAX_WEIGHT: i8 = 4;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportMode {
    #[default]
    Quiet,
    Balanced,
    Supportive,
}

// These describe observable or declared events, never inferred emotion or focus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Context {
    Inactive,
    Working,
    IntentionalBreak,
    ExplicitReturn,
    Uncertain,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AbstainReason {
    Quiet,
    NotReturning,
    LowConfidence,
    MissingCheckpoint,
    Cooldown,
    LowUtility,
    SequenceExhausted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    None(AbstainReason),
    OfferCheckpoint,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Feedback {
    Useful,
    NotUseful,
    Dismiss,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct PolicyState {
    pub mode: SupportMode,
    preference: i8,
    last_offer_ms: Option<u64>,
    sequence: u32,
    pending: Option<u32>,
}

impl PolicyState {
    pub fn validate(&self) -> Result<(), String> {
        if !(-MAX_WEIGHT..=MAX_WEIGHT).contains(&self.preference) {
            return Err("Invalid local assistance preference".into());
        }
        if self.pending.is_some_and(|id| id == 0 || id != self.sequence || self.last_offer_ms.is_none()) {
            return Err("Invalid local assistance offer".into());
        }
        if self.mode == SupportMode::Quiet && self.pending.is_some() {
            return Err("Quiet mode cannot have a pending offer".into());
        }
        Ok(())
    }

    pub fn weight(&self) -> i8 { self.preference }
    pub fn pending_id(&self) -> Option<u32> { self.pending }

    pub fn clear_pending(&mut self) { self.pending = None; }

    pub fn set_mode(&mut self, mode: SupportMode) {
        self.mode = mode;
        self.clear_pending();
    }

    // Keep sequence and cooldown intact; reset cannot bypass rate limits
    // or make an old feedback identifier valid again.
    pub fn reset_preference(&mut self) {
        self.preference = 0;
        self.clear_pending();
    }

    pub fn decide(&self, context: Context, confidence: u8, has_checkpoint: bool, now_ms: u64) -> Decision {
        use AbstainReason::*;
        if self.mode == SupportMode::Quiet { return Decision::None(Quiet); }
        if context != Context::ExplicitReturn { return Decision::None(NotReturning); }
        if !(MIN_CONFIDENCE..=100).contains(&confidence) { return Decision::None(LowConfidence); }
        if !has_checkpoint { return Decision::None(MissingCheckpoint); }
        if self.last_offer_ms.is_some_and(|last| now_ms.saturating_sub(last) < COOLDOWN_MS) {
            return Decision::None(Cooldown);
        }
        if self.sequence == u32::MAX { return Decision::None(SequenceExhausted); }
        // Integer utility points, intentionally not a learned probability.
        // Initial weights are engineering hypotheses, subject to adult pilot tests.
        let base = match self.mode {
            SupportMode::Quiet => 0,
            SupportMode::Balanced => 70,
            SupportMode::Supportive => 85,
        };
        let utility = base * i32::from(confidence) / 100 + 12 * i32::from(self.preference) - 20;
        if utility < MIN_UTILITY { Decision::None(LowUtility) } else { Decision::OfferCheckpoint }
    }

    // Called only on an explicit user return, never from a periodic timer.
    pub fn on_return(&mut self, has_checkpoint: bool, now_ms: u64) -> Decision {
        self.clear_pending();
        let decision = self.decide(Context::ExplicitReturn, 100, has_checkpoint, now_ms);
        if decision == Decision::OfferCheckpoint {
            self.sequence += 1; // decide() rejects exhaustion
            self.pending = Some(self.sequence);
            self.last_offer_ms = Some(now_ms);
        }
        decision
    }

    pub fn feedback(&mut self, id: u32, response: Feedback) -> Result<(), String> {
        if self.pending != Some(id) || self.mode == SupportMode::Quiet {
            return Err("This assistance offer is no longer active".into());
        }
        let delta = match response { Feedback::Useful => 1, Feedback::NotUseful | Feedback::Dismiss => -1 };
        self.preference = (self.preference + delta).clamp(-MAX_WEIGHT, MAX_WEIGHT);
        self.clear_pending();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn balanced() -> PolicyState {
        let mut state = PolicyState::default();
        state.set_mode(SupportMode::Balanced);
        state
    }

    #[test]
    fn quiet_always_abstains() {
        let mut p = PolicyState::default();
        assert_eq!(p.on_return(true, 100), Decision::None(AbstainReason::Quiet));
        assert_eq!(p.pending_id(), None);
    }

    #[test]
    fn non_return_contexts_never_trigger() {
        let p = balanced();
        for c in [Context::Inactive, Context::Working, Context::IntentionalBreak, Context::Uncertain] {
            assert_eq!(p.decide(c, 100, true, 100), Decision::None(AbstainReason::NotReturning));
        }
    }

    #[test]
    fn uncertainty_and_missing_checkpoint_abstain() {
        let p = balanced();
        assert_eq!(p.decide(Context::ExplicitReturn, 79, true, 100), Decision::None(AbstainReason::LowConfidence));
        assert_eq!(p.decide(Context::ExplicitReturn, 101, true, 100), Decision::None(AbstainReason::LowConfidence));
        assert_eq!(p.decide(Context::ExplicitReturn, 100, false, 100), Decision::None(AbstainReason::MissingCheckpoint));
    }

    #[test]
    fn cooldown_survives_rollback_and_mode_change() {
        let mut p = balanced();
        assert_eq!(p.on_return(true, 1000), Decision::OfferCheckpoint);
        p.set_mode(SupportMode::Supportive);
        assert_eq!(p.on_return(true, 999), Decision::None(AbstainReason::Cooldown));
        assert_eq!(p.on_return(true, 1000 + COOLDOWN_MS - 1), Decision::None(AbstainReason::Cooldown));
        assert_eq!(p.on_return(true, 1000 + COOLDOWN_MS), Decision::OfferCheckpoint);
    }

    #[test]
    fn negative_feedback_suppresses_and_reset_recovers() {
        let mut p = balanced();
        for now in [0, COOLDOWN_MS] {
            assert_eq!(p.on_return(true, now), Decision::OfferCheckpoint);
            let id = p.pending_id().unwrap();
            p.feedback(id, Feedback::Dismiss).unwrap();
            assert!(p.feedback(id, Feedback::Dismiss).is_err());
        }
        assert_eq!(p.weight(), -2);
        assert_eq!(p.on_return(true, 2 * COOLDOWN_MS), Decision::None(AbstainReason::LowUtility));
        p.reset_preference();
        assert_eq!(p.on_return(true, 2 * COOLDOWN_MS), Decision::OfferCheckpoint);
        assert_eq!(p.pending_id(), Some(3));
    }

    #[test]
    fn useful_feedback_is_bounded() {
        let mut p = balanced();
        for i in 0..10 {
            assert_eq!(p.on_return(true, i * COOLDOWN_MS), Decision::OfferCheckpoint);
            p.feedback(p.pending_id().unwrap(), Feedback::Useful).unwrap();
        }
        assert_eq!(p.weight(), MAX_WEIGHT);
    }

    #[test]
    fn quiet_overrides_positive_history_and_stale_feedback() {
        let mut p = balanced();
        p.on_return(true, 0);
        let first = p.pending_id().unwrap();
        p.feedback(first, Feedback::Useful).unwrap();
        p.on_return(true, COOLDOWN_MS);
        let next = p.pending_id().unwrap();
        assert!(p.feedback(first, Feedback::Useful).is_err());
        p.set_mode(SupportMode::Quiet);
        assert!(p.feedback(next, Feedback::Useful).is_err());
        assert_eq!(p.on_return(true, 2 * COOLDOWN_MS), Decision::None(AbstainReason::Quiet));
    }

    #[test]
    fn replay_is_deterministic() {
        fn replay() -> (Vec<Decision>, i8, Option<u32>) {
            let mut p = balanced();
            let mut log = Vec::new();
            for now in [0, 20, COOLDOWN_MS, 2 * COOLDOWN_MS, 3 * COOLDOWN_MS] {
                log.push(p.on_return(true, now));
                if let Some(id) = p.pending_id() {
                    p.feedback(id, Feedback::NotUseful).unwrap();
                }
            }
            (log, p.weight(), p.pending_id())
        }
        assert_eq!(replay(), replay());
        assert_eq!(replay().0, vec![Decision::OfferCheckpoint, Decision::None(AbstainReason::Cooldown),
            Decision::OfferCheckpoint, Decision::None(AbstainReason::LowUtility), Decision::None(AbstainReason::LowUtility)]);
    }

    #[test]
    fn serializes_local_preferences_and_cooldown() {
        let mut p = balanced();
        p.on_return(true, 500);
        p.feedback(p.pending_id().unwrap(), Feedback::Useful).unwrap();
        let restored: PolicyState = serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        restored.validate().unwrap();
        assert_eq!(restored.mode, SupportMode::Balanced);
        assert_eq!(restored.weight(), 1);
        assert_eq!(restored.decide(Context::ExplicitReturn, 100, true, 501), Decision::None(AbstainReason::Cooldown));
    }

    #[test]
    fn malformed_preference_is_rejected() {
        let p: PolicyState = serde_json::from_str(r#"{"preference":127}"#).unwrap();
        assert!(p.validate().is_err());
    }
}
