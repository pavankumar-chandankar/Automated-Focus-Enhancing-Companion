//! Pure, conservative session monitoring policy. No I/O or raw activity history.
use serde::Serialize;
use std::{collections::VecDeque, time::{Duration, Instant}};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Relevance { Related, PossibleDistraction, Unknown }

pub fn parse_relevance(s: &str) -> Relevance {
    match s.trim() { "RELATED" => Relevance::Related, "POSSIBLY_UNRELATED" => Relevance::PossibleDistraction, _ => Relevance::Unknown }
}

#[derive(Clone, Default, Serialize)]
pub struct Metrics {
    pub samples: u32,
    pub related: u32,
    pub possible_distraction: u32,
    pub unknown: u32,
    pub changes: u32,
    pub analyses: u32,
    pub check_ins: u32,
    pub returns: u32,
}
#[derive(Default)]
pub struct Monitor {
    pub metrics: Metrics,
    pub goal: String,
    key: Option<u64>,
    since: Option<Instant>,
    last_sample: Option<Instant>,
    cache: VecDeque<(u64, Relevance)>,
    last_cue: Option<Instant>,
    nudged: bool,
    awaiting_return: bool,
    reference: Option<String>,
}
impl Monitor {
    pub fn reset_continuity(&mut self) {
        self.key = None; self.since = None; self.last_sample = None; self.nudged = false;
    }
    pub fn gap(&mut self) {
        self.reset_continuity();
        self.metrics.samples += 1; self.metrics.unknown += 1;
    }
    pub fn clear_context(&mut self) {
        self.reset_continuity(); self.cache.clear(); self.awaiting_return = false; self.last_cue = None; self.reference = None;
    }
    // "This document" needs a real reference. The user is told to start on
    // the intended page; the first titled sample becomes that reference.
    pub fn anchor_if_requested(&mut self, key: u64, text: &str) {
        let lower = self.goal.to_lowercase();
        if self.reference.is_some() || !["this document", "this pdf", "this page", "this article", "current document", "this textbook"].iter().any(|p| lower.contains(*p)) { return; }
        let Some(title) = text.lines().next().and_then(|line| line.strip_prefix("Window: ")).filter(|t| t.chars().count() > 5) else { return; };
        self.reference = Some(title.chars().take(100).collect());
        self.remember(key, Relevance::Related);
    }
    pub fn reasoning_goal(&self) -> String {
        match &self.reference {
            Some(title) => format!("Study the reference window: {}. {}", title, self.goal).chars().take(160).collect(),
            None => self.goal.clone(),
        }
    }
    pub fn observe(&mut self, now: Instant, key: u64) -> Relevance {
        if self.last_sample.is_some_and(|last| now.saturating_duration_since(last) > Duration::from_secs(60)) { self.reset_continuity(); }
        if self.key != Some(key) {
            if self.key.is_some() { self.metrics.changes += 1; }
            self.key = Some(key); self.since = Some(now); self.nudged = false;
        }
        self.last_sample = Some(now);
        self.metrics.samples += 1;
        let relevance = self.cache.iter().find(|(k,_)| *k == key).map(|(_,r)| *r).unwrap_or(Relevance::Unknown);
        match relevance {
            Relevance::Related => { self.metrics.related += 1; if self.awaiting_return { self.metrics.returns += 1; self.awaiting_return = false; } }
            Relevance::PossibleDistraction => self.metrics.possible_distraction += 1,
            Relevance::Unknown => self.metrics.unknown += 1,
        }
        relevance
    }
    pub fn needs_analysis(&self, now: Instant, key: u64) -> bool {
        !self.goal.trim().is_empty() && self.key == Some(key) &&
        self.since.is_some_and(|t| now.saturating_duration_since(t) >= Duration::from_secs(30)) &&
        !self.cache.iter().any(|(k,_)| *k == key)
    }
    pub fn remember(&mut self, key: u64, result: Relevance) {
        if self.cache.len() >= 64 { self.cache.pop_front(); }
        self.cache.push_back((key, result));
    }
    pub fn should_nudge(&mut self, now: Instant, relevance: Relevance, compact: bool) -> bool {
        if !compact || relevance != Relevance::PossibleDistraction || self.nudged ||
            self.metrics.check_ins >= 4 ||
            !self.since.is_some_and(|t| now.saturating_duration_since(t) >= Duration::from_secs(45)) ||
            self.last_cue.is_some_and(|t| now.saturating_duration_since(t) < Duration::from_secs(180)) { return false; }
        self.nudged = true; self.awaiting_return = true; self.last_cue = Some(now);
        self.metrics.check_ins += 1; true
    }
}

// Explicit reference-tab guard. A title change is not proof of distraction.
#[derive(Default)]
pub struct SwitchGuard {
    anchor: Option<u64>,
    last: Option<u64>,
    since: Option<Instant>,
    last_seen: Option<Instant>,
    last_cue: Option<Instant>,
    reminded: bool,
}
#[derive(Default)]
pub struct SwitchUpdate { pub anchored: bool, pub changed: bool, pub returned: bool, pub cue: bool }
impl SwitchGuard {
    pub fn gap(&mut self) { self.last = None; self.since = None; self.last_seen = None; }
    pub fn sample(&mut self, now: Instant, key: u64) -> SwitchUpdate {
        let mut u = SwitchUpdate::default();
        if self.last_seen.is_some_and(|t| now.saturating_duration_since(t) > Duration::from_secs(12)) { self.gap(); }
        self.last_seen = Some(now);
        if self.anchor.is_none() {
            self.anchor = Some(key); self.last = Some(key); self.since = Some(now);
            u.anchored = true; return u;
        }
        if self.last != Some(key) {
            u.changed = self.last.is_some();
            self.last = Some(key); self.since = Some(now);
        }
        if self.anchor == Some(key) {
            u.returned = self.reminded;
            self.reminded = false;
            return u;
        }
        if !self.reminded && self.since.is_some_and(|t| now.saturating_duration_since(t) >= Duration::from_secs(4)) &&
            self.last_cue.is_none_or(|t| now.saturating_duration_since(t) >= Duration::from_secs(30)) {
            self.reminded = true; self.last_cue = Some(now); u.cue = true;
        }
        u
    }
    pub fn on_reference(&self) -> bool { self.anchor.is_some() && self.anchor == self.last }
    pub fn anchored(&self) -> bool { self.anchor.is_some() }
    pub fn away(&self) -> bool { self.anchor.is_some() && self.last.is_some() && self.anchor != self.last }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn switch_guard_reminds_without_classifier_and_rearms_on_return() {
        let t = Instant::now(); let at = |s| t + Duration::from_secs(s);
        let mut g = SwitchGuard::default();
        let initial = g.sample(at(0), 1); assert!(initial.anchored); assert!(!initial.cue);
        assert!(g.on_reference());
        assert!(!g.sample(at(2), 2).cue);
        assert!(!g.sample(at(4), 2).cue);
        assert!(g.sample(at(6), 2).cue);
        assert!(!g.sample(at(8), 3).cue);
        assert!(g.sample(at(12), 1).returned);
        assert!(!g.sample(at(14), 2).cue);
        assert!(!g.sample(at(18), 2).cue);
        assert!(!g.sample(at(28), 2).cue);
        assert!(g.sample(at(36), 2).cue);
    }
    #[test]
    fn switch_guard_ignores_brief_switches_and_gaps() {
        let t = Instant::now(); let at = |s| t + Duration::from_secs(s);
        let mut g = SwitchGuard::default();
        g.sample(at(0), 1); g.sample(at(2), 2);
        assert!(!g.sample(at(3), 1).cue);
        g.sample(at(5), 2); g.gap();
        assert!(!g.sample(at(20), 2).cue);
        assert!(!g.sample(at(21), 2).cue);
        assert!(g.sample(at(24), 2).cue);
        assert!(!g.sample(at(26), 2).cue);
    }
    #[test]
    fn sustained_diversion_then_return() {
        let start = Instant::now(); let at = |s| start + Duration::from_secs(s);
        let mut m = Monitor { goal: "Read reliability textbook".into(), ..Default::default() };
        assert_eq!(m.observe(at(0), 1), Relevance::Unknown);
        m.observe(at(15), 1); m.observe(at(30), 1);
        assert!(m.needs_analysis(at(30), 1)); m.remember(1, Relevance::Related);
        assert_eq!(m.observe(at(45), 1), Relevance::Related);
        m.observe(at(60), 2); m.observe(at(75), 2);
        assert!(!m.needs_analysis(at(75), 2));
        m.observe(at(90), 2); assert!(m.needs_analysis(at(90), 2));
        m.remember(2, Relevance::PossibleDistraction);
        let r = m.observe(at(105), 2);
        assert!(!m.should_nudge(at(105), r, false));
        assert!(m.should_nudge(at(105), r, true));
        assert!(!m.should_nudge(at(106), r, true));
        m.observe(at(120), 1); assert_eq!(m.metrics.returns, 1);
        assert_eq!(m.metrics.samples, m.metrics.related + m.metrics.possible_distraction + m.metrics.unknown);
    }
    #[test]
    fn deictic_goal_anchors_to_initial_document_only() {
        let t = Instant::now();
        let mut m = Monitor { goal: "Read this document".into(), ..Default::default() };
        m.anchor_if_requested(1, "Window: Reliability theory\nChapter one");
        assert_eq!(m.observe(t, 1), Relevance::Related);
        m.anchor_if_requested(2, "Window: Music videos");
        assert_eq!(m.observe(t + Duration::from_secs(15), 2), Relevance::Unknown);
        assert!(m.reasoning_goal().contains("Reliability theory"));
        assert!(!m.reasoning_goal().contains("Music videos"));
    }
    #[test]
    fn brief_switch_unknown_and_gap_abstain() {
        let t = Instant::now();
        let mut m = Monitor { goal: "Study".into(), ..Default::default() };
        m.observe(t, 1); m.observe(t + Duration::from_secs(15), 2);
        assert!(!m.needs_analysis(t + Duration::from_secs(20), 2));
        m.gap(); m.observe(t + Duration::from_secs(60), 2);
        assert!(!m.needs_analysis(t + Duration::from_secs(61), 2));
        assert!(!m.should_nudge(t + Duration::from_secs(120), Relevance::Unknown, true));
        assert_eq!(parse_relevance("PROPOSE PAUSE"), Relevance::Unknown);
        assert_eq!(parse_relevance("POSSIBLY_UNRELATED because"), Relevance::Unknown);
    }
}
