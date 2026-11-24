mod model;
mod policy;
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
fn start_session(store: State<'_, SessionStore>, goal: String, next_step: String) -> Result<SessionSnapshot, String> {
    store.mutate(|session, now| session.start(&goal, &next_step, now))
}

#[tauri::command]
fn pause_session(store: State<'_, SessionStore>) -> Result<SessionSnapshot, String> {
    store.mutate(|session, now| session.pause(now))
}

#[tauri::command]
fn resume_session(store: State<'_, SessionStore>) -> Result<SessionSnapshot, String> {
    store.mutate(|session, now| session.resume(now))
}

#[tauri::command]
fn finish_session(store: State<'_, SessionStore>) -> Result<SessionSnapshot, String> {
    store.mutate(|session, now| session.finish(now))
}

#[tauri::command]
fn save_next_step(store: State<'_, SessionStore>, next_step: String) -> Result<SessionSnapshot, String> {
    store.mutate(|session, _now| session.checkpoint(&next_step))
}

#[tauri::command]
fn set_quiet_mode(store: State<'_, SessionStore>, enabled: bool) -> Result<SessionSnapshot, String> {
    store.mutate(|session, _now| { session.set_support_mode(if enabled { SupportMode::Quiet } else { SupportMode::Balanced }); Ok(()) })
}

#[tauri::command]
fn resume_with_assistance(store: State<'_, SessionStore>) -> Result<SessionSnapshot, String> {
    store.mutate(|session, now| session.resume_with_assistance(now))
}

#[tauri::command]
fn set_support_mode(store: State<'_, SessionStore>, mode: SupportMode) -> Result<SessionSnapshot, String> {
    store.mutate(|session, _now| { session.set_support_mode(mode); Ok(()) })
}

#[tauri::command]
fn record_cue_feedback(store: State<'_, SessionStore>, offer_id: u32, response: Feedback) -> Result<SessionSnapshot, String> {
    store.mutate(|session, _now| session.record_feedback(offer_id, response))
}

#[tauri::command]
fn reset_cue_preference(store: State<'_, SessionStore>) -> Result<SessionSnapshot, String> {
    store.mutate(|session, _now| { session.policy.reset_preference(); Ok(()) })
}

// The bin is a separate 112x112 logical-pixel surface, shown *only* while
// the user intentionally holds and drags the companion. No fullscreen layer.
#[tauri::command]
fn begin_companion_drag(app: tauri::AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("Companion window unavailable")?;
    let bin = app.get_webview_window("drop-zone").ok_or("Drop target unavailable")?;
    let monitor = main.current_monitor().map_err(|e| e.to_string())?
        .ok_or("No display available for drop target")?;
    let work = monitor.work_area();
    let bin_width = (112.0 * monitor.scale_factor()).round() as i32;
    let margin = (24.0 * monitor.scale_factor()).round() as i32;
    let x = work.position.x + (work.size.width as i32 - bin_width) / 2;
    let y = work.position.y + work.size.height as i32 - bin_width - margin;
    bin.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    // The target must not steal the mouse-up event from the held character.
    bin.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
    bin.show().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn cancel_companion_drag(app: tauri::AppHandle) -> Result<(), String> {
    let bin = app.get_webview_window("drop-zone").ok_or("Drop target unavailable")?;
    bin.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn finish_companion_drag(app: tauri::AppHandle) -> Result<bool, String> {
    let bin = app.get_webview_window("drop-zone").ok_or("Drop target unavailable")?;
    let pos = bin.outer_position().map_err(|e| e.to_string())?;
    let size = bin.outer_size().map_err(|e| e.to_string())?;
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let dx = cursor.x - (pos.x as f64 + size.width as f64 / 2.0);
    let dy = cursor.y - (pos.y as f64 + size.height as f64 / 2.0);
    let radius = (size.width.min(size.height) as f64) * 0.46;
    let dropped = dx * dx + dy * dy <= radius * radius;
    bin.hide().map_err(|e| e.to_string())?;
    if dropped {
        // Hiding is reversible from the menu bar; never delete work/session data.
        app.get_webview_window("main").ok_or("Companion window unavailable")?
            .hide().map_err(|e| e.to_string())?;
    }
    Ok(dropped)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let path = app.path().app_local_data_dir()?.join("session.json");
            let store = SessionStore::read(path).map_err(std::io::Error::other)?;
            app.manage(store);
            let show = MenuItem::with_id(app, "show", "Show Oplyra", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide Oplyra", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("app icon").clone())
                .tooltip("Oplyra")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(bin) = app.get_webview_window("drop-zone") { let _ = bin.hide(); }
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // The companion continues running and can be reopened from the tray.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot, start_session, pause_session, resume_session, finish_session,
            save_next_step, set_quiet_mode, resume_with_assistance, set_support_mode,
            record_cue_feedback, reset_cue_preference, begin_companion_drag,
            finish_companion_drag, cancel_companion_drag
        ])
        .run(tauri::generate_context!())
        .expect("error while running Oplyra desktop");
}
