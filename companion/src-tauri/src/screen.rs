//! Selected-window OCR and explicitly reviewed Groq analysis.
//! No screenshots or OCR text are persisted or added to chat history.
use crate::{model::Phase, SessionStore};
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}, sync::Mutex, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager, State};

const SAMPLE_INTERVAL: Duration = Duration::from_secs(15);
const FRESHNESS: Duration = Duration::from_secs(60);
const DAILY_ANALYSES: u32 = 20;
const ANALYSIS_INTERVAL: u64 = 60;

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
}
impl Observation {
    fn reset(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.selection = None;
        self.choices.clear();
        self.listed_at = None;
        self.last_attempt = None;
        self.latest = None;
        self.reviewed = None;
        self.detail.clear(); self.missing_since = None; self.last_cue = None; self.cues = 0;
        // A worker already in progress must finish before another starts.
    }
    fn fresh(&self, now: Instant) -> Option<&Sample> {
        self.latest.as_ref().filter(|s| now.saturating_duration_since(s.at) < FRESHNESS)
    }
    fn status(&self) -> ScreenStatus {
        ScreenStatus {
            supported: platform::supported(),
            active: self.selection.is_some(),
            app: self.selection.as_ref().map(|w| w.app.clone()),
            sample_ready: self.fresh(Instant::now()).is_some(),
            detail: self.detail.clone(), cue: false,
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
    fn reserve(&mut self, now: u64) -> Result<(), String> {
        if self.remaining(now) == 0 { return Err("Daily screen-analysis budget exhausted".into()); }
        if self.last != 0 && now.saturating_sub(self.last) < ANALYSIS_INTERVAL {
            return Err("Wait at least one minute between screen analyses".into());
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
    if let Some(state) = app.try_state::<ScreenState>() {
        if let Ok(mut observation) = state.observation.lock() { observation.reset(); }
    }
    if let Some(window) = app.get_webview_window("main") { let _ = window.emit("oplyra-screen-stopped", ()); }
}
#[tauri::command]
pub fn stop_screen(state: State<'_, ScreenState>) -> Result<(), String> {
    state.observation.lock().map_err(|_| "Screen state unavailable")?.reset();
    Ok(())
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
    let compact = visible && compact_running(&app);
    let (choice, generation) = {
        let state = app.state::<ScreenState>();
        let mut o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
        if !visible { o.reset(); return Ok(o.status()); }
        let Some(choice) = o.selection.clone() else { return Ok(o.status()); };
        if !compact { o.missing_since = None; return Ok(o.status()); }
        if o.busy ||
            o.last_attempt.is_some_and(|at| at.elapsed() < SAMPLE_INTERVAL) {
            return Ok(o.status());
        }
        if o.last_attempt.is_some_and(|at| at.elapsed() > Duration::from_secs(45)) { o.missing_since = None; }
        o.busy = true;
        o.last_attempt = Some(Instant::now());
        (choice, o.generation)
    };
    let result = tauri::async_runtime::spawn_blocking(move || platform::capture(&choice)).await;
    let visible = visible_running(&app);
    let compact = visible && compact_running(&app);
    let state = app.state::<ScreenState>();
    let mut o = state.observation.lock().map_err(|_| "Screen state unavailable")?;
    o.busy = false;
    if o.generation != generation { return Ok(o.status()); }
    if !visible { o.reset(); return Ok(o.status()); }
    if !compact { return Ok(o.status()); }
    o.latest = None;
    o.reviewed = None;
    let mut cue = false;
    match result {
        Ok(Ok(Some(text))) => {
            let text = normalize(&text);
            if !text.is_empty() {
                let now = Instant::now();
                // Only a neutral return cue, never a claim of distraction.
                let returned = o.missing_since.take().is_some_and(|t| t.elapsed() >= Duration::from_secs(120));
                if returned && o.cues < 2 && o.last_cue.is_none_or(|t| t.elapsed() >= Duration::from_secs(600)) {
                    o.cues += 1; o.last_cue = Some(now); cue = true;
                }
                o.detail = "Text recognised locally".into();
                o.serial = o.serial.checked_add(1).ok_or("Screen sample counter exhausted")?;
                o.latest = Some(Sample { id: o.serial, at: Instant::now(), text });
            } else { o.detail = "Captured window; no readable text".into(); o.missing_since = None; }
        }
        Ok(Ok(None)) => { o.detail = "No eligible foreground work window".into(); o.missing_since.get_or_insert(Instant::now()); }
        Ok(Err(err)) => { o.reset(); return Err(err); }
        Err(_) => { o.reset(); return Err("Screen capture worker failed".into()); }
    }
    let mut status = o.status(); status.cue = cue; Ok(status)
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
    text.chars().filter(|c| !c.is_control() || *c == '\n').take(600).collect::<String>().trim().to_owned()
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
    fn expires_and_bounds_ocr() {
        let mut o = Observation::default();
        let t = Instant::now();
        o.latest = Some(Sample { id: 1, at: t, text: "Test".into() });
        assert!(o.fresh(t).is_some());
        assert!(o.fresh(t + FRESHNESS).is_none());
        assert_eq!(normalize("A\u{0000}B\nC"), "AB\nC");
        assert_eq!(normalize(&"x".repeat(900)).len(), 600);
    }
}
