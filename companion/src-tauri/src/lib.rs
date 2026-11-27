mod model;
mod policy;
mod intelligence;
mod overlay;
mod awareness;
mod screen;
mod monitor;
use policy::{Feedback, SupportMode};

use std::{fs, path::PathBuf, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use model::{SessionModel, SessionSnapshot};
use tauri::{Manager, PhysicalPosition, State, WindowEvent, menu::{Menu, MenuItem}, tray::TrayIconBuilder};

struct SessionStore {
    path: PathBuf,
    state: Mutex<SessionModel>,
}

fn clock_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

impl SessionStore {
    fn read(path: PathBuf) -> Result<Self, String> {
        let mut model = if path.exists() {
            let bytes = fs::read(&path).map_err(|e| format!("Cannot read session file: {e}"))?;
            serde_json::from_slice::<SessionModel>(&bytes).map_err(|e| format!("Cannot parse session file: {e}"))?
        } else {
            SessionModel::default()
        };
        model.validate()?;
        // Never resurrect an old offer after process restart.
        model.policy.clear_pending();
        Ok(Self { path, state: Mutex::new(model) })
    }

    fn mutate<F>(&self, action: F) -> Result<SessionSnapshot, String>
    where F: FnOnce(&mut SessionModel, u64) -> Result<(), String> {
        let mut guard = self.state.lock().map_err(|_| "Session state is unavailable")?;
        let mut candidate = guard.clone();
        let now = clock_ms();
        action(&mut candidate, now)?;
        candidate.validate()?;
        let serialized = serde_json::to_vec_pretty(&candidate).map_err(|e| e.to_string())?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Cannot create local folder: {e}"))?;
        }
        // Write before publishing state in memory. Never truncate the existing file.
        let temp = self.path.with_extension("json.tmp");
        fs::write(&temp, serialized).map_err(|e| format!("Cannot save session: {e}"))?;
        fs::rename(&temp, &self.path).map_err(|e| format!("Cannot replace local session: {e}"))?;
        *guard = candidate;
        Ok(guard.snapshot(now))
    }

    fn snapshot(&self) -> Result<SessionSnapshot, String> {
        let guard = self.state.lock().map_err(|_| "Session state is unavailable")?;
        Ok(guard.snapshot(clock_ms()))
    }
}

#[tauri::command]
fn get_snapshot(store: State<'_, SessionStore>) -> Result<SessionSnapshot, String> { store.snapshot() }

#[tauri::command]
fn start_session(app: tauri::AppHandle, store: State<'_, SessionStore>, goal: String, next_step: String) -> Result<SessionSnapshot, String> {
    let result = store.mutate(|session, now| session.start(&goal, &next_step, now));
    if result.is_ok() { awareness::stop(&app); screen::reset_analytics(&app); }
    result
}

#[tauri::command]
fn pause_session(app: tauri::AppHandle, store: State<'_, SessionStore>) -> Result<SessionSnapshot, String> {
    let result = store.mutate(|session, now| session.pause(now));
    if result.is_ok() { awareness::stop(&app); }
    result
}

#[tauri::command]
fn resume_session(store: State<'_, SessionStore>) -> Result<SessionSnapshot, String> {
    store.mutate(|session, now| session.resume(now))
}

#[tauri::command]
fn finish_session(app: tauri::AppHandle, store: State<'_, SessionStore>) -> Result<SessionSnapshot, String> {
    let result = store.mutate(|session, now| session.finish(now));
    if result.is_ok() { awareness::stop(&app); }
    result
}

#[tauri::command]
fn save_next_step(store: State<'_, SessionStore>, next_step: String) -> Result<SessionSnapshot, String> {
    store.mutate(|session, _now| session.checkpoint(&next_step))
}

#[tauri::command]
fn set_quiet_mode(app: tauri::AppHandle, store: State<'_, SessionStore>, enabled: bool) -> Result<SessionSnapshot, String> {
    let result = store.mutate(|session, _now| { session.set_support_mode(if enabled { SupportMode::Quiet } else { SupportMode::Balanced }); Ok(()) });
    if enabled && result.is_ok() { awareness::stop(&app); }
    result
}

#[tauri::command]
fn resume_with_assistance(store: State<'_, SessionStore>) -> Result<SessionSnapshot, String> {
    store.mutate(|session, now| session.resume_with_assistance(now))
}

#[tauri::command]
fn set_support_mode(app: tauri::AppHandle, store: State<'_, SessionStore>, mode: SupportMode) -> Result<SessionSnapshot, String> {
    let result = store.mutate(|session, _now| { session.set_support_mode(mode); Ok(()) });
    if mode == SupportMode::Quiet && result.is_ok() { awareness::stop(&app); }
    result
}

#[tauri::command]
fn record_cue_feedback(store: State<'_, SessionStore>, offer_id: u32, response: Feedback) -> Result<SessionSnapshot, String> {
    store.mutate(|session, _now| session.record_feedback(offer_id, response))
}

#[tauri::command]
fn reset_cue_preference(store: State<'_, SessionStore>) -> Result<SessionSnapshot, String> {
    store.mutate(|session, _now| { session.policy.reset_preference(); Ok(()) })
}

#[tauri::command]
fn intelligence_provider() -> Result<intelligence::Provider, String> { intelligence::configured_provider() }

// Model output is a reply or a bounded proposal, never a native action.
#[tauri::command]
async fn local_companion_reply(app: tauri::AppHandle, store: State<'_, SessionStore>, screen: State<'_, screen::ScreenState>, message: String, history: Vec<intelligence::PreviousTurn>) -> Result<intelligence::ModelReply, String> {
    // Ordinary emotional conversation must retain functional action proposals.
    // OCR is attached only for screen-related requests, not every chat turn.
    let lower = message.to_lowercase();
    let screen_question = ["screen", "tab", "window", "what am i reading", "what am i working on", "what am i doing", "what do you see", "what can you see", "what can you read", "what is this", "what did you read", "what's this", "summarize", "summarise", "read this"].iter().any(|word| lower.contains(*word));
    let excerpt = if screen_question { screen::chat_context(&app).await } else { None };
    let mut snapshot = store.snapshot()?;
    if let Some(goal) = screen::monitoring_goal(&screen) { snapshot.goal = goal; }
    let screen_active = screen::observation_active(&screen);
    let worker_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = worker_app.state::<screen::ScreenState>();
        let text = excerpt.as_ref().filter(|context| screen::cloud_context_active(&state, context) && snapshot.phase == model::Phase::Running).map(|context| context.text.as_str());
        intelligence::generate(&message, &snapshot, &history, screen_active, text)
    })
        .await.map_err(|_| "Local intelligence worker failed".to_owned())?
}

// The bin is a separate 112x112 logical-pixel surface, shown *only* while
// the user intentionally holds and drags the companion. No fullscreen layer.
#[tauri::command]
async fn begin_companion_drag(app: tauri::AppHandle) -> Result<(), String> {
    screen::dismiss_cue(&app);
    let main = app.get_webview_window("main").ok_or("Companion window unavailable")?;
    let monitor = main.current_monitor().map_err(|e| e.to_string())?
        .ok_or("No display available for drop target")?;
    let work = monitor.work_area();
    let bin_width = (112.0 * monitor.scale_factor()).round() as i32;
    let margin = (24.0 * monitor.scale_factor()).round() as i32;
    let x = work.position.x + (work.size.width as i32 - bin_width) / 2;
    let y = work.position.y + work.size.height as i32 - bin_width - margin;
    // Construct the temporary native surface only during a drag.
    let bin = overlay::create_bin(&app)?;
    let show = (|| -> Result<(), String> {
        bin.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        bin.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
        bin.show().map_err(|e| e.to_string())?;
        Ok(())
    })();
    if show.is_err() { let _ = overlay::destroy_bin(&app); }
    show
}

#[tauri::command]
fn cancel_companion_drag(app: tauri::AppHandle) -> Result<(), String> {
    overlay::destroy_bin(&app)
}

#[tauri::command]
fn finish_companion_drag(app: tauri::AppHandle) -> Result<bool, String> {
    let bin = app.get_webview_window("drop-zone").ok_or("Drop target unavailable")?;
    let dropped = (|| -> Result<bool, String> {
        let pos = bin.outer_position().map_err(|e| e.to_string())?;
        let size = bin.outer_size().map_err(|e| e.to_string())?;
        let cursor = app.cursor_position().map_err(|e| e.to_string())?;
        let dx = cursor.x - (pos.x as f64 + size.width as f64 / 2.0);
        let dy = cursor.y - (pos.y as f64 + size.height as f64 / 2.0);
        let radius = (size.width.min(size.height) as f64) * 0.46;
        Ok(dx * dx + dy * dy <= radius * radius)
    })();
    overlay::destroy_bin(&app)?;
    // The frontend supplies its exact unsent draft before destroying main.
    dropped
}

#[tauri::command]
async fn open_analytics(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("analytics") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let config = app.config().app.windows.iter().find(|w| w.label == "analytics").ok_or("Analytics config missing")?;
    tauri::WebviewWindowBuilder::from_config(&app, config).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    builder
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            // A second launch must not resurrect a companion hidden in the tray.
            let _ = app;
        }))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            app.manage(overlay::OverlayState::default());
            app.manage(awareness::AwarenessState::default());
            app.manage(screen::ScreenState::new(app.path().app_local_data_dir()?.join("screen-budget.json")));
            let path = app.path().app_local_data_dir()?.join("session.json");
            let store = SessionStore::read(path).map_err(std::io::Error::other)?;
            app.manage(store);
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") { overlay::configure_panel(&window).map_err(std::io::Error::other)?; }
            screen::start_worker(app.handle().clone());
            let show = MenuItem::with_id(app, "show", "Show Oplyra", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide Oplyra", true, None::<&str>)?;
            let stop_awareness = MenuItem::with_id(app, "stop-awareness", "Stop activity awareness", true, None::<&str>)?;
            let stop_screen = MenuItem::with_id(app, "stop-screen", "Stop screen observation", true, None::<&str>)?;
            let analytics = MenuItem::with_id(app, "analytics", "Open analytics", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &analytics, &stop_awareness, &stop_screen, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("app icon").clone())
                .tooltip("Oplyra")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => overlay::request_show(app.clone()),
                    "hide" => overlay::request_hide(app),
                    "stop-awareness" => awareness::stop(app),
                    "stop-screen" => screen::stop(app),
                    "analytics" => { let handle = app.clone(); tauri::async_runtime::spawn(async move { let _ = open_analytics(handle).await; }); },
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    overlay::request_hide(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot, start_session, pause_session, resume_session, finish_session,
            save_next_step, set_quiet_mode, resume_with_assistance, set_support_mode,
            record_cue_feedback, reset_cue_preference, local_companion_reply, intelligence_provider, begin_companion_drag,
            finish_companion_drag, cancel_companion_drag,
            overlay::load_overlay_draft, overlay::hide_companion, overlay::panel_keyboard,
            awareness::set_awareness, awareness::awareness_status, awareness::sample_awareness, awareness::suspend_awareness,
            screen::screen_status, screen::request_screen_permission, screen::start_follow_screen, screen::list_screen_windows,
            screen::select_screen_window, screen::sample_screen, screen::stop_screen,
            screen::preview_screen, screen::analyze_screen, screen::get_analytics, screen::dismiss_focus_cue, open_analytics
        ])
        .build(tauri::generate_context!())
        .expect("error while building Oplyra desktop")
        .run(|_app, event| {
            // Closing the final native surface must not quit the tray utility.
            // Explicit menu-bar Quit uses app.exit(0), with Some(0).
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event {
                api.prevent_exit();
            }
        });
}
