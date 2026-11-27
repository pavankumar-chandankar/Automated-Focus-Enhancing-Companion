//! Session-scoped, local-only awareness. No screenshots, titles, URLs or event contents.
use crate::{model::Phase, SessionStore};
use serde::Serialize;
use std::{sync::Mutex, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_GAP: Duration = Duration::from_secs(12);
const LEISURE_DWELL: Duration = Duration::from_secs(90);
const IDLE_BEFORE_RETURN: f64 = 120.0;
const ACTIVE_IDLE_LIMIT: f64 = 15.0;
const COOLDOWN: Duration = Duration::from_secs(600);
const MAX_CUES: u8 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Category { Leisure, Browser, Other, Unavailable }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Cue { LeisureCheck, ReturnCheck }

#[derive(Clone, Copy, Debug, Serialize)]
pub struct AwarenessStatus {
    pub enabled: bool,
    pub supported: bool,
    category: Category,
    pub cue: Option<Cue>,
}

fn classify(bundle: &str) -> Category {
    match bundle {
        "com.apple.TV" | "com.valvesoftware.steam" | "com.valvesoftware.steam.helper" => Category::Leisure,
        "com.apple.Safari" | "com.google.Chrome" | "org.mozilla.firefox" |
        "com.microsoft.edgemac" | "com.brave.Browser" | "company.thebrowser.Browser" => Category::Browser,
        "" => Category::Unavailable,
        _ => Category::Other,
    }
}

#[derive(Default)]
struct Policy {
    enabled: bool,
    last_sample: Option<Instant>,
    leisure_since: Option<Instant>,
    idle_seen: bool,
    last_cue: Option<Instant>,
    cues: u8,
    category: Option<Category>,
}

impl Policy {
    fn status(&self, cue: Option<Cue>) -> AwarenessStatus {
        AwarenessStatus { enabled: self.enabled, supported: cfg!(target_os = "macos"),
            category: self.category.unwrap_or(Category::Unavailable), cue }
    }
    fn reset_continuity(&mut self) {
        self.last_sample = None;
        self.leisure_since = None;
        self.idle_seen = false;
        self.category = None;
    }
    fn sample(&mut self, now: Instant, category: Category, idle: Option<f64>) -> Option<Cue> {
        if !self.enabled { return None; }
        let Some(idle) = idle.filter(|v| v.is_finite() && *v >= 0.0) else {
            self.reset_continuity(); return None;
        };
        if category == Category::Unavailable {
            self.reset_continuity(); return None;
        }
        if self.last_sample.is_some_and(|last| now.saturating_duration_since(last) > MAX_GAP) {
            self.reset_continuity();
        }
        self.last_sample = Some(now);
        self.category = Some(category);
        if idle >= IDLE_BEFORE_RETURN {
            self.idle_seen = true;
            self.leisure_since = None;
            return None;
        }
        if idle >= ACTIVE_IDLE_LIMIT {
            self.leisure_since = None;
            return None;
        }
        let returned = std::mem::take(&mut self.idle_seen);
        if category != Category::Leisure { self.leisure_since = None; }
        else { self.leisure_since.get_or_insert(now); }
        if self.cues >= MAX_CUES || self.last_cue.is_some_and(|last| now.saturating_duration_since(last) < COOLDOWN) {
            return None;
        }
        let cue = if returned { Some(Cue::ReturnCheck) }
        else if self.leisure_since.is_some_and(|start| now.saturating_duration_since(start) >= LEISURE_DWELL) {
            Some(Cue::LeisureCheck)
        } else { None };
        if cue.is_some() {
            self.cues += 1;
            self.last_cue = Some(now);
            self.leisure_since = None;
        }
        cue
    }
}

#[derive(Default)]
pub struct AwarenessState(Mutex<Policy>);

pub fn stop(app: &AppHandle) {
    crate::screen::stop(app);
    if let Some(state) = app.try_state::<AwarenessState>() {
        if let Ok(mut policy) = state.0.lock() { *policy = Policy::default(); }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("oplyra-awareness-stopped", ());
    }
}

#[tauri::command]
pub fn set_awareness(app: AppHandle, store: State<'_, SessionStore>, state: State<'_, AwarenessState>, enabled: bool) -> Result<AwarenessStatus, String> {
    let mut policy = state.0.lock().map_err(|_| "Awareness unavailable")?;
    if !enabled {
        *policy = Policy::default();
        return Ok(policy.status(None));
    }
    if !cfg!(target_os = "macos") { return Err("Activity awareness is not supported on this platform yet".into()); }
    if store.snapshot()?.phase != Phase::Running { return Err("Start a focus session before enabling awareness".into()); }
    if !app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false) {
        return Err("Show Oplyra before enabling awareness".into());
    }
    if !policy.enabled { *policy = Policy { enabled: true, ..Default::default() }; }
    Ok(policy.status(None))
}

#[tauri::command]
pub fn awareness_status(state: State<'_, AwarenessState>) -> Result<AwarenessStatus, String> {
    Ok(state.0.lock().map_err(|_| "Awareness unavailable")?.status(None))
}

#[tauri::command]
pub fn sample_awareness(app: AppHandle, store: State<'_, SessionStore>, state: State<'_, AwarenessState>) -> Result<AwarenessStatus, String> {
    let mut policy = state.0.lock().map_err(|_| "Awareness unavailable")?;
    // Check native consent and actual phase before reading any OS signal.
    if !policy.enabled { return Ok(policy.status(None)); }
    if store.snapshot()?.phase != Phase::Running ||
        !app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false) {
        *policy = Policy::default();
        return Ok(policy.status(None));
    }
    if app.get_webview_window("drop-zone").is_some() {
        policy.reset_continuity();
        return Ok(policy.status(None));
    }
    let (category, idle) = platform_sample();
    let cue = policy.sample(Instant::now(), category, idle);
    Ok(policy.status(cue))
}

#[tauri::command]
pub fn suspend_awareness(state: State<'_, AwarenessState>) -> Result<(), String> {
    state.0.lock().map_err(|_| "Awareness unavailable")?.reset_continuity();
    Ok(())
}

#[cfg(target_os = "macos")]
fn platform_sample() -> (Category, Option<f64>) {
    use objc2_app_kit::NSWorkspace;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" { fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64; }
    // NSWorkspace only identifies the foreground application. No window enumeration.
    let workspace = NSWorkspace::sharedWorkspace();
    let Some(app) = workspace.frontmostApplication() else { return (Category::Unavailable, None); };
    if app.processIdentifier() == std::process::id() as i32 { return (Category::Unavailable, None); }
    let category = app.bundleIdentifier().map(|id| classify(&id.to_string())).unwrap_or(Category::Unavailable);
    // Combined login-session state (0), any input event (u32::MAX).
    // Only seconds since input; no event taps, keycodes or cursor data.
    let idle = unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
    (category, Some(idle))
}
#[cfg(not(target_os = "macos"))]
fn platform_sample() -> (Category, Option<f64>) { (Category::Unavailable, None) }

#[cfg(test)]
mod tests {
    use super::*;
    fn active() -> Policy { Policy { enabled: true, ..Default::default() } }
    #[test]
    fn consent_and_ambiguous_apps_abstain() {
        let t = Instant::now();
        let mut p = Policy::default();
        assert_eq!(p.sample(t, Category::Leisure, Some(0.0)), None);
        p = active();
        for sec in (0..=180).step_by(5) {
            assert_eq!(p.sample(t + Duration::from_secs(sec), Category::Browser, Some(0.0)), None);
        }
        assert_eq!(classify("com.google.Chrome"), Category::Browser);
        assert_eq!(classify("com.apple.TV"), Category::Leisure);
        assert_eq!(classify("com.unknown.app"), Category::Other);
    }
    #[test]
    fn sustained_leisure_not_a_single_switch() {
        let t = Instant::now();
        let mut p = active();
        for sec in (0..90).step_by(5) {
            assert_eq!(p.sample(t + Duration::from_secs(sec), Category::Leisure, Some(0.0)), None);
        }
        assert_eq!(p.sample(t + Duration::from_secs(90), Category::Leisure, Some(0.0)), Some(Cue::LeisureCheck));
        assert_eq!(p.sample(t + Duration::from_secs(95), Category::Leisure, Some(0.0)), None);
    }
    #[test]
    fn gaps_and_unavailable_samples_reset_dwell() {
        let t = Instant::now();
        let mut p = active();
        p.sample(t, Category::Leisure, Some(0.0));
        assert_eq!(p.sample(t + Duration::from_secs(100), Category::Leisure, Some(0.0)), None);
        assert_eq!(p.sample(t + Duration::from_secs(105), Category::Unavailable, None), None);
        assert!(p.leisure_since.is_none());
        assert_eq!(p.sample(t + Duration::from_secs(110), Category::Leisure, Some(f64::NAN)), None);
    }
    #[test]
    fn idle_is_not_a_distraction_and_return_is_neutral() {
        let t = Instant::now();
        let mut p = active();
        assert_eq!(p.sample(t, Category::Other, Some(150.0)), None);
        assert_eq!(p.sample(t + Duration::from_secs(5), Category::Other, Some(1.0)), Some(Cue::ReturnCheck));
        assert_eq!(p.sample(t + Duration::from_secs(10), Category::Other, Some(0.0)), None);
    }
    #[test]
    fn cooldown_and_budget_bound_checkins() {
        let t = Instant::now();
        let mut p = active();
        for sec in [0, 100, 700, 1400] {
            p.sample(t + Duration::from_secs(sec), Category::Other, Some(150.0));
            let got = p.sample(t + Duration::from_secs(sec + 5), Category::Other, Some(0.0));
            assert_eq!(got, if sec == 0 || sec == 700 { Some(Cue::ReturnCheck) } else { None });
        }
        assert_eq!(p.cues, MAX_CUES);
        p = Policy::default();
        assert!(!p.status(None).enabled);
        assert_eq!(p.status(None).category, Category::Unavailable);
    }
}
