//! Selected-window OCR and explicitly reviewed Groq analysis.
//! No screenshots or OCR text are persisted or added to chat history.
use crate::{model::Phase, SessionStore};
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}, sync::Mutex, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager, State};
use crate::monitor::{Monitor, Metrics, Relevance};
use std::hash::{Hash, Hasher};

const SAMPLE_INTERVAL: Duration = Duration::from_secs(15);
const FRESHNESS: Duration = Duration::from_secs(60);
const DAILY_ANALYSES: u32 = 20;
const ANALYSIS_INTERVAL: u64 = 60;
const CHAT_INTERVAL: u64 = 5;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct WindowChoice {
    id: u32,
    pid: i32,
    bundle: String,
    app: String,
    title: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScreenStatus {
    supported: bool,
    active: bool,
    app: Option<String>,
    sample_ready: bool,
    detail: String,
    cue: bool,
    cloud_context: bool,
    monitoring: bool,
    relevance: Relevance,
    analysis_detail: String,
}

#[derive(Clone)]
struct Sample {
    id: u32,
    at: Instant,
    text: String,
}

#[derive(Serialize)]
pub struct Preview {
    id: u32,
    excerpt: String,
    goal: String,
    remaining_today: u32,
    valid_for_ms: u64,
}

#[derive(Default)]
struct Observation {
    generation: u64,
    selection: Option<WindowChoice>,
    choices: Vec<WindowChoice>,
    listed_at: Option<Instant>,
    last_attempt: Option<Instant>,
    busy: bool,
    serial: u32,
    latest: Option<Sample>,
    reviewed: Option<(u32, String)>,
    detail: String,
    missing_since: Option<Instant>,
    last_cue: Option<Instant>,
    cues: u8,
    cloud_context: bool,
    monitor: Monitor,
    relevance: Option<Relevance>,
    monitoring_started: Option<Instant>,
    monitoring_elapsed_ms: u64,
    analysis_detail: String,
}
impl Observation {
    fn reset(&mut self) {
        if let Some(started) = self.monitoring_started.take() {
            self.monitoring_elapsed_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        }
        self.generation = self.generation.wrapping_add(1);
        self.selection = None;
        self.cloud_context = false;
        self.monitor.clear_context();
        self.relevance = None;
        self.choices.clear();
        self.listed_at = None;
        self.last_attempt = None;
        self.latest = None;
        self.reviewed = None;
        self.detail.clear(); self.analysis_detail.clear(); self.missing_since = None; self.last_cue = None; self.cues = 0;
        // A worker already in progress must finish before another starts.
    }
    fn fresh(&self, now: Instant) -> Option<&Sample> {
        self.latest.as_ref().filter(|s| now.saturating_duration_since(s.at) < FRESHNESS)
    }
    fn elapsed_ms(&self) -> u64 {
        self.monitoring_started.map(|t| t.elapsed().as_millis().min(u128::from(u64::MAX)) as u64).unwrap_or(self.monitoring_elapsed_ms)
    }
    fn status(&self) -> ScreenStatus {
        ScreenStatus {
            supported: platform::supported(),
            active: self.selection.is_some(),
            app: self.selection.as_ref().map(|w| w.app.clone()),
            sample_ready: self.fresh(Instant::now()).is_some(),
            detail: self.detail.clone(), cue: false, cloud_context: self.cloud_context,
            monitoring: self.cloud_context && !self.monitor.goal.is_empty(), relevance: self.relevance.unwrap_or(Relevance::Unknown),
            analysis_detail: self.analysis_detail.clone(),
        }
    }
}

#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Budget { day: u64, used: u32, last: u64 }
impl Budget {
    fn read(path: &Path) -> Result<Self, String> {
        match fs::read(path) {
            Ok(raw) => {
                let b: Self = serde_json::from_slice(&raw).map_err(|_| "Screen budget file is invalid")?;
                if b.used > DAILY_ANALYSES { return Err("Invalid screen budget".into()); }
                Ok(b)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(_) => Err("Could not read screen budget".into()),
        }
    }
    fn remaining(&self, now: u64) -> u32 {
        if now / 86_400 < self.day || now < self.last { return 0; }
        if now / 86_400 > self.day { DAILY_ANALYSES } else { DAILY_ANALYSES.saturating_sub(self.used) }
    }
    fn reserve(&mut self, now: u64) -> Result<(), String> { self.reserve_with_interval(now, ANALYSIS_INTERVAL) }
    fn reserve_with_interval(&mut self, now: u64, interval: u64) -> Result<(), String> {
        if self.remaining(now) == 0 { return Err("Daily screen-analysis budget exhausted".into()); }
        if self.last != 0 && now.saturating_sub(self.last) < interval {
            return Err("Screen-analysis cooldown is active".into());
        }
        let day = now / 86_400;
        if day > self.day { self.day = day; self.used = 0; }
        self.used += 1;
        self.last = now;
        Ok(())
    }
    fn save(&self, path: &Path) -> Result<(), String> {
        let parent = path.parent().ok_or("Screen budget folder missing")?;
        fs::create_dir_all(parent).map_err(|_| "Could not create screen budget folder")?;
        let temp = path.with_extension("tmp");
        fs::write(&temp, serde_json::to_vec(self).map_err(|_| "Could not encode screen budget")?)
            .map_err(|_| "Could not save screen budget")?;
        fs::rename(&temp, path).map_err(|_| "Could not replace screen budget")?;
        Ok(())
    }
}

pub struct ScreenState { observation: Mutex<Observation>, budget_path: PathBuf }
impl ScreenState {
    pub fn new(budget_path: PathBuf) -> Self {
        Self { observation: Mutex::new(Observation::default()), budget_path }
    }
}
fn wall_seconds() -> Result<u64, String> {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).map_err(|_| "Clock unavailable".into())
}
fn visible_running(app: &AppHandle) -> bool {
    app.state::<SessionStore>().snapshot().is_ok_and(|s| s.phase == Phase::Running) &&
        app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false)
}
fn capture_allowed(app: &AppHandle) -> bool {
    visible_running(app) && app.get_webview_window("drop-zone").is_none()
}
fn compact_running(app: &AppHandle) -> bool {
    visible_running(app) && app.get_webview_window("drop-zone").is_none() &&
        app.get_webview_window("main").is_some_and(|w| {
            match (w.inner_size(), w.scale_factor()) {
                (Ok(size), Ok(scale)) if scale > 0.0 => size.width as f64 / scale < 240.0 && size.height as f64 / scale < 260.0,
                _ => false,
            }
        })
}

pub fn stop(app: &AppHandle) {
    let mut was_active = false;
    if let Some(state) = app.try_state::<ScreenState>() {
        if let Ok(mut observation) = state.observation.lock() {
            was_active = observation.selection.is_some();
            observation.reset();
        }
    }
    if was_active {
        if let Some(window) = app.get_webview_window("main") { let _ = window.emit("oplyra-screen-stopped", ()); }
    }
}
#[tauri::command]
pub fn stop_screen(state: State<'_, ScreenState>) -> Result<(), String> {
    state.observation.lock().map_err(|_| "Screen state unavailable")?.reset();
    Ok(())
}

pub fn monitoring_goal(state: &ScreenState) -> Option<String> {
    let o = state.observation.lock().ok()?;
    if o.selection.is_some() && !o.monitor.goal.is_empty() { Some(o.monitor.goal.clone()) } else { None }
}

pub fn observation_active(state: &ScreenState) -> bool {
    state.observation.lock().map(|o| o.selection.is_some()).unwrap_or(false)
}

#[tauri::command]
pub fn screen_status(state: State<'_, ScreenState>) -> Result<ScreenStatus, String> {
    Ok(state.observation.lock().map_err(|_| "Screen state unavailable")?.status())
}

#[tauri::command]
pub fn request_screen_permission(app: AppHandle) -> Result<(), String> {
    if !visible_running(&app) { return Err("Start a visible focus session first".into()); }
    if !platform::supported() { return Err("Screen observation requires macOS 14 or newer".into()); }
    if !platform::request_permission() {
        return Err("Allow screen recording in System Settings, then relaunch Oplyra if required".into());
    }
    Ok(())
}

// Explicit session opt-in, no window chooser. This does not bypass the OS
// permission, app allowlist or running-session/visibility gates.
#[tauri::command]
pub fn start_follow_screen(app: AppHandle, state: State<'_, ScreenState>, cloud: bool, goal: String) -> Result<ScreenStatus, String> {
    let goal = goal.chars().filter(|c| !c.is_control() || *c == '\n').take(160).collect::<String>().trim().to_owned();
    if cloud && goal.is_empty() { return Err("Tell me what you want to focus on first".into()); }
    if cloud && crate::intelligence::configured_provider()? != crate::intelligence::Provider::Groq {
        return Err("AI screen context requires the Groq provider".into());
    }
    let generation = state.observation.lock().map_err(|_| "Screen state unavailable")?.generation;
    request_screen_permission(app.clone())?;
    if !visible_running(&app) { return Err("Screen consent was cancelled".into()); }
    let mut o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
    if o.generation != generation { return Err("Screen consent was cancelled".into()); }
    o.reset();
    o.selection = Some(WindowChoice { id: 0, pid: 0, bundle: String::new(), app: "Foreground work apps".into(), title: String::new() });
    o.cloud_context = cloud;
    o.monitor = Monitor::default();
    o.monitor.goal = goal;
    o.monitoring_started = Some(Instant::now());
    o.monitoring_elapsed_ms = 0;
    o.analysis_detail = if cloud { "Waiting for sustained work context".into() } else { "Cloud relevance checks off".into() };
    o.detail = "Following supported foreground apps".into();
    Ok(o.status())
}

// Read a fresh excerpt on a user-initiated chat turn. Never use a cached
// excerpt from the previous tab, never start capture without consent.
pub struct ChatContext { pub text: String, generation: u64 }

pub async fn chat_context(app: &AppHandle) -> Option<ChatContext> {
    if crate::intelligence::configured_provider().ok()? != crate::intelligence::Provider::Groq || !visible_running(app) { return None; }
    let (choice, generation) = {
        let state = app.state::<ScreenState>();
        let mut o = state.observation.lock().ok()?;
        if !o.cloud_context || o.busy { return None; }
        let choice = o.selection.clone()?;
        let budget = Budget::read(&state.budget_path).ok()?;
        let now = wall_seconds().ok()?;
        if budget.remaining(now) == 0 || (budget.last != 0 && now.saturating_sub(budget.last) < CHAT_INTERVAL) { return None; }
        o.busy = true;
        (choice, o.generation)
    };
    let result = tauri::async_runtime::spawn_blocking(move || platform::capture(&choice)).await;
    let visible = visible_running(app);
    let state = app.state::<ScreenState>();
    let mut o = state.observation.lock().ok()?;
    o.busy = false;
    if o.generation != generation || !o.cloud_context || !visible { return None; }
    let text = match result {
        Ok(Ok(Some(text))) => normalize(&text),
        Ok(Ok(None)) => { o.latest = None; o.reviewed = None; o.detail = "No supported foreground window; switch to Chrome or a document".into(); return None; }
        _ => { o.reset(); drop(o); let _ = app.emit("oplyra-screen-stopped", ()); return None; }
    };
    if text.is_empty() {
        o.latest = None; o.reviewed = None;
        o.detail = "Captured window; no readable text".into();
        return None;
    }
    o.serial = o.serial.checked_add(1)?;
    o.latest = Some(Sample { id: o.serial, at: Instant::now(), text: text.clone() });
    o.reviewed = None;
    o.detail = "Text recognised locally".into();
    let mut budget = Budget::read(&state.budget_path).ok()?;
    budget.reserve_with_interval(wall_seconds().ok()?, CHAT_INTERVAL).ok()?;
    budget.save(&state.budget_path).ok()?;
    Some(ChatContext { text, generation })
}

pub fn cloud_context_active(state: &ScreenState, context: &ChatContext) -> bool {
    state.observation.lock().map(|o| o.cloud_context && o.selection.is_some() && o.generation == context.generation).unwrap_or(false)
}

#[tauri::command]
pub async fn list_screen_windows(app: AppHandle) -> Result<Vec<WindowChoice>, String> {
    if !visible_running(&app) { return Err("Start a visible focus session first".into()); }
    let generation = {
        let state = app.state::<ScreenState>();
        let mut o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
        o.reset();
        o.generation
    };
    let choices = tauri::async_runtime::spawn_blocking(platform::list).await.map_err(|_| "Window listing worker failed")??;
    let visible = visible_running(&app);
    let state = app.state::<ScreenState>();
    let mut o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
    if generation != o.generation || !visible { return Err("Window selection was cancelled".into()); }
    o.choices = choices.clone();
    // Explicit alternative to a single selected window; never capture a full display.
    o.choices.insert(0, WindowChoice { id: 0, pid: 0, bundle: String::new(), app: "Follow supported work apps".into(), title: String::new() });
    o.listed_at = Some(Instant::now());
    Ok(o.choices.clone())
}

#[tauri::command]
pub fn select_screen_window(app: AppHandle, state: State<'_, ScreenState>, id: u32) -> Result<ScreenStatus, String> {
    if !visible_running(&app) { return Err("Start a visible focus session first".into()); }
    let mut o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
    if !o.listed_at.is_some_and(|at| at.elapsed() < FRESHNESS) { return Err("Choose from a fresh window list".into()); }
    let choice = o.choices.iter().find(|w| w.id == id).cloned().ok_or("Window was not offered")?;
    o.reset();
    o.selection = Some(choice);
    o.detail = "Waiting for first capture".into();
    Ok(o.status())
}

#[tauri::command]
pub async fn sample_screen(app: AppHandle) -> Result<ScreenStatus, String> {
    let visible = visible_running(&app);
    let allowed = visible && capture_allowed(&app);
    let (choice, generation) = {
        let state = app.state::<ScreenState>();
        let mut o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
        if !visible { o.reset(); return Ok(o.status()); }
        let Some(choice) = o.selection.clone() else { return Ok(o.status()); };
        if !allowed { o.monitor.reset_continuity(); return Ok(o.status()); }
        if o.busy ||
            o.last_attempt.is_some_and(|at| at.elapsed() < SAMPLE_INTERVAL) {
            return Ok(o.status());
        }
        if o.last_attempt.is_some_and(|at| at.elapsed() > Duration::from_secs(45)) { o.monitor.reset_continuity(); }
        o.busy = true;
        o.last_attempt = Some(Instant::now());
        (choice, o.generation)
    };
    let result = tauri::async_runtime::spawn_blocking(move || platform::capture(&choice)).await;
    let visible = visible_running(&app);
    let allowed = visible && capture_allowed(&app);
    let compact = visible && compact_running(&app);
    let (status, analysis) = {
    let state = app.state::<ScreenState>();
    let mut o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
    o.busy = false;
    if o.generation != generation { return Ok(o.status()); }
    if !visible { o.reset(); return Ok(o.status()); }
    if !allowed { o.monitor.reset_continuity(); return Ok(o.status()); }
    o.latest = None;
    o.reviewed = None;
    let now = Instant::now();
    let mut cue = false;
    let mut analysis = None;
    match result {
        Ok(Ok(Some(text))) => {
            let text = normalize(&text);
            if !text.is_empty() {
                let key = observation_key(&text);
                if o.cloud_context { o.monitor.anchor_if_requested(key, &text); }
                let relevance = o.monitor.observe(now, key);
                o.relevance = Some(relevance);
                cue = o.cloud_context && o.monitor.should_nudge(now, relevance, compact);
                o.detail = match relevance {
                    Relevance::Related => "Appears related to your goal",
                    Relevance::PossibleDistraction => "Possible diversion",
                    Relevance::Unknown => "Observed · relevance uncertain",
                }.into();
                if o.cloud_context && o.monitor.needs_analysis(now, key) {
                    if let (Ok(mut budget), Ok(seconds)) = (Budget::read(&state.budget_path), wall_seconds()) {
                        // Reserve eight of the existing twenty daily attempts for chat.
                        if budget.remaining(seconds) > 8 && budget.reserve(seconds).is_ok() && budget.save(&state.budget_path).is_ok() {
                            o.monitor.metrics.analyses += 1;
                            analysis = Some((key, o.monitor.reasoning_goal(), text.clone()));
                            o.analysis_detail = "Checking relevance with Groq".into();
                        } else if budget.remaining(seconds) <= 8 { o.analysis_detail = "Background quota reserved for chat; no new relevance checks".into(); }
                        else { o.analysis_detail = "Waiting for analysis cooldown or budget storage".into(); }
                    }
                }
                o.serial = o.serial.checked_add(1).ok_or("Screen sample counter exhausted")?;
                o.latest = Some(Sample { id: o.serial, at: now, text });
            } else {
                o.monitor.gap(); o.relevance = None; o.detail = "No reliable readable text".into();
            }
        }
        Ok(Ok(None)) => { o.monitor.gap(); o.relevance = None; o.detail = "No supported foreground window; switch to Chrome or a document".into(); }
        Ok(Err(err)) => { o.reset(); return Err(err); }
        Err(_) => { o.reset(); return Err("Screen capture worker failed".into()); }
    }
    let mut status = o.status(); status.cue = cue;
    // Do not hold observation lock across inference. Cache only the relevance
    // label; a subsequent fresh sample must still match before any nudge.
    (status, analysis)
    };
    if let Some((key, goal, text)) = analysis {
        let worker_app = app.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let state = worker_app.state::<ScreenState>();
            let allowed = state.observation.lock().map(|o| o.generation == generation && o.cloud_context).unwrap_or(false);
            if !allowed || !visible_running(&worker_app) { return Err("Monitoring stopped".into()); }
            crate::intelligence::classify_activity(&goal, &text)
        }).await.unwrap_or_else(|_| Err("Monitoring worker failed".into()));
        let state = app.state::<ScreenState>();
        let mut o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
        if o.generation == generation && o.cloud_context {
            match result {
                Ok(relevance) => { o.monitor.remember(key, relevance); o.analysis_detail = match relevance { Relevance::Related => "Groq: related", Relevance::PossibleDistraction => "Groq: possibly unrelated", Relevance::Unknown => "Groq: uncertain" }.into(); }
                Err(error) => { o.analysis_detail = format!("Groq check failed: {}", error.chars().take(120).collect::<String>()); }
            }
        }
        // Never publish a stale cue after consent changes.
        if o.generation != generation { return Ok(o.status()); }
        let mut updated = o.status(); updated.cue = status.cue; return Ok(updated);
    }
    Ok(status)
}

fn observation_key(text: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let first = text.lines().next().unwrap_or("");
    // Native title is stable for a document/tab; if unavailable use bounded
    // content rather than treating all untitled windows as one activity.
    if first.starts_with("Window: ") && first.len() > 12 { first.hash(&mut hasher); }
    else { text.hash(&mut hasher); }
    hasher.finish()
}

#[derive(Serialize)]
pub struct Analytics {
    goal: String,
    elapsed_ms: u64,
    phase: Phase,
    active: bool,
    monitoring: bool,
    metrics: Metrics,
    remaining_today: u32,
    detail: String,
}
#[tauri::command]
pub fn get_analytics(app: AppHandle, state: State<'_, ScreenState>) -> Result<Analytics, String> {
    let session = app.state::<SessionStore>().snapshot()?;
    let o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
    let remaining_today = Budget::read(&state.budget_path).and_then(|b| Ok(b.remaining(wall_seconds()?))).unwrap_or(0);
    Ok(Analytics { goal: if o.monitor.goal.is_empty() { session.goal } else { o.monitor.goal.clone() },
        elapsed_ms: o.elapsed_ms(), phase: session.phase, active: o.selection.is_some(),
        monitoring: o.cloud_context, metrics: o.monitor.metrics.clone(), remaining_today,
        detail: [o.detail.as_str(), o.analysis_detail.as_str()].into_iter().filter(|v| !v.is_empty()).collect::<Vec<_>>().join(" · ") })
}
pub fn reset_analytics(app: &AppHandle) {
    if let Some(state) = app.try_state::<ScreenState>() {
        if let Ok(mut o) = state.observation.lock() { o.monitor = Monitor::default(); o.monitoring_started = None; o.monitoring_elapsed_ms = 0; }
    }
}

// Native scheduler: unaffected by WebKit background timer throttling.
pub fn start_worker(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let active = app.state::<ScreenState>().observation.lock().map(|o| o.selection.is_some()).unwrap_or(false);
        if !active { continue; }
        let result = tauri::async_runtime::block_on(sample_screen(app.clone()));
        if let Some(window) = app.get_webview_window("main") {
            match result {
                Ok(status) => { let _ = window.emit("oplyra-screen-status", status); }
                Err(error) => { let _ = window.emit("oplyra-screen-error", error); }
            }
        }
    });
}

fn normalize(text: &str) -> String {
    let text = text.chars().filter(|c| !c.is_control() || *c == '\n').take(600).collect::<String>().trim().to_owned();
    let lower = text.to_lowercase();
    // Conservative additional content gate, not comprehensive secret redaction.
    if ["enter your password", "verification code", "one-time password", "credit card number", "seed phrase", "private key", "api key:", "api key =", "passwort eingeben"].iter().any(|term| lower.contains(*term)) {
        return String::new();
    }
    text
}

#[tauri::command]
pub fn preview_screen(app: AppHandle, state: State<'_, ScreenState>) -> Result<Preview, String> {
    if !visible_running(&app) { return Err("No active visible session".into()); }
    let goal = app.state::<SessionStore>().snapshot()?.goal;
    let mut o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
    let Some(sample) = o.fresh(Instant::now()).cloned() else {
        o.latest = None;
        o.reviewed = None;
        return Err("No fresh text yet. Close the bubble, use the chosen window, then try again.".into());
    };
    let remaining_today = Budget::read(&state.budget_path)?.remaining(wall_seconds()?);
    o.reviewed = Some((sample.id, goal.clone()));
    let valid_for_ms = FRESHNESS.saturating_sub(sample.at.elapsed()).as_millis() as u64;
    Ok(Preview { id: sample.id, excerpt: sample.text, goal, remaining_today, valid_for_ms })
}

#[tauri::command]
pub async fn analyze_screen(app: AppHandle, id: u32) -> Result<String, String> {
    // Never use the paid DeepSeek provider or fall back to another service.
    if crate::intelligence::configured_provider()? != crate::intelligence::Provider::Groq {
        return Err("Window analysis requires the Groq developer provider".into());
    }
    let visible = visible_running(&app);
    let goal = app.state::<SessionStore>().snapshot()?.goal;
    let (goal, text, generation) = {
        let state = app.state::<ScreenState>();
        let mut o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
        if !visible || o.selection.is_none() { return Err("Screen observation is off".into()); }
        let sample = o.fresh(Instant::now()).cloned().ok_or("Reviewed text has expired")?;
        if sample.id != id || o.reviewed.as_ref() != Some(&(id, goal.clone())) {
            return Err("Review the current excerpt and goal before sharing".into());
        }
        // Consume authorization and persist an attempt before dispatch. No retry.
        let mut budget = Budget::read(&state.budget_path)?;
        budget.reserve(wall_seconds()?)?;
        budget.save(&state.budget_path)?;
        o.reviewed = None;
        (goal, sample.text, o.generation)
    };
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        // Recheck immediately before the network call. An already dispatched
        // request cannot be recalled; a revocation discards its result.
        {
            let visible = visible_running(&worker_app);
            let state = worker_app.state::<ScreenState>();
            let o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
            if o.generation != generation || o.selection.is_none() || !visible {
                return Err("Screen observation was stopped".into());
            }
        }
        crate::intelligence::analyze_reviewed_window(&goal, &text)
    }).await.map_err(|_| "Screen analysis worker failed")?;
    let visible = visible_running(&app);
    let state = app.state::<ScreenState>();
    let o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
    if o.generation != generation || !visible { return Err("Screen observation was stopped".into()); }
    result
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::ffi::{CStr, CString, c_char};
    extern "C" {
        fn oplyra_screen_supported() -> i32;
        fn oplyra_screen_request_permission() -> i32;
        fn oplyra_screen_list() -> *mut c_char;
        fn oplyra_screen_capture(id: u32, pid: i32, bundle: *const c_char) -> *mut c_char;
        fn oplyra_screen_free(value: *mut c_char);
    }
    #[derive(Deserialize)]
    struct ResultData { error: Option<String>, windows: Option<Vec<WindowChoice>>, text: Option<String>, inactive: Option<bool> }
    fn decode(ptr: *mut c_char) -> Result<ResultData, String> {
        if ptr.is_null() { return Err("Native capture unavailable".into()); }
        let result = unsafe {
            let bytes = CStr::from_ptr(ptr).to_bytes();
            let parsed = if bytes.len() <= 65_536 { serde_json::from_slice::<ResultData>(bytes).map_err(|_| "Invalid native capture result".to_owned()) } else { Err("Native capture result exceeded limit".into()) };
            oplyra_screen_free(ptr);
            parsed
        }?;
        if let Some(ref error) = result.error { return Err(error.clone()); }
        Ok(result)
    }
    pub fn supported() -> bool { unsafe { oplyra_screen_supported() != 0 } }
    pub fn request_permission() -> bool { unsafe { oplyra_screen_request_permission() != 0 } }
    pub fn list() -> Result<Vec<WindowChoice>, String> {
        decode(unsafe { oplyra_screen_list() })?.windows.ok_or("Window list missing".into())
    }
    pub fn capture(choice: &WindowChoice) -> Result<Option<String>, String> {
        let bundle = CString::new(choice.bundle.as_str()).map_err(|_| "Invalid application identifier")?;
        let result = decode(unsafe { oplyra_screen_capture(choice.id, choice.pid, bundle.as_ptr()) })?;
        if result.inactive == Some(true) { Ok(None) } else { result.text.map(Some).ok_or("Capture text missing".into()) }
    }
}
#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;
    pub fn supported() -> bool { false }
    pub fn request_permission() -> bool { false }
    pub fn list() -> Result<Vec<WindowChoice>, String> { Err("Screen observation is macOS-only".into()) }
    pub fn capture(_: &WindowChoice) -> Result<Option<String>, String> { Err("Screen observation is macOS-only".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn budget_counts_attempts_and_resists_rollback() {
        let mut b = Budget::default();
        let start = 10 * 86_400;
        for i in 0..DAILY_ANALYSES {
            b.reserve(start + u64::from(i) * 60).unwrap();
            assert!(b.reserve(start + u64::from(i) * 60 + 1).is_err());
        }
        assert_eq!(b.remaining(start + 3600), 0);
        assert!(b.reserve(start + 3600).is_err());
        assert_eq!(b.remaining(start - 1), 0);
        b.reserve(start + 86_400).unwrap();
        assert_eq!(b.used, 1);
    }
    #[test]
    fn chat_and_review_share_daily_budget() {
        let mut b = Budget::default();
        let start = 10 * 86_400;
        b.reserve_with_interval(start, CHAT_INTERVAL).unwrap();
        assert!(b.reserve_with_interval(start + 4, CHAT_INTERVAL).is_err());
        b.reserve_with_interval(start + 5, CHAT_INTERVAL).unwrap();
        assert!(b.reserve(start + 6).is_err());
        b.reserve(start + 65).unwrap();
        assert_eq!(b.remaining(start + 65), DAILY_ANALYSES - 3);
    }
    #[test]
    fn revocation_removes_sample_and_review_but_not_inflight_guard() {
        let mut o = Observation::default();
        o.busy = true;
        o.serial = 5;
        o.latest = Some(Sample { id: 5, at: Instant::now(), text: "Mechanics".into() });
        o.reviewed = Some((5, "Study".into()));
        o.reset();
        assert!(o.latest.is_none() && o.reviewed.is_none());
        assert!(o.busy);
        assert_eq!(o.serial, 5);
        assert_eq!(o.generation, 1);
    }
    #[test]
    fn monitoring_timer_is_independent_of_old_focus_session() {
        let mut o = Observation::default();
        o.monitoring_started = Some(Instant::now() - Duration::from_secs(3));
        assert!(o.elapsed_ms() >= 3000 && o.elapsed_ms() < 5000);
        o.reset();
        assert!(o.monitoring_started.is_none());
        assert!(o.elapsed_ms() >= 3000);
    }
    #[test]
    fn expires_and_bounds_ocr() {
        let mut o = Observation::default();
        let t = Instant::now();
        o.latest = Some(Sample { id: 1, at: t, text: "Test".into() });
        assert!(o.fresh(t).is_some());
        assert!(o.fresh(t + FRESHNESS).is_none());
        assert_eq!(normalize("A\u{0000}B\nC"), "AB\nC");
        assert_eq!(normalize(&"x".repeat(900)).len(), 600);
        assert!(normalize("Window: Account\nEnter your password").is_empty());
        assert_eq!(observation_key("Window: Reliability textbook\npage 1"), observation_key("Window: Reliability textbook\npage 2"));
        assert_ne!(observation_key("Window: Reliability textbook\npage 1"), observation_key("Window: Music videos\npage 1"));
    }
}
