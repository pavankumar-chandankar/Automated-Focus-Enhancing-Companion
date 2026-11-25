//! Native overlay lifecycle. Hidden means no native companion or drop window.
//! Only an unsent draft is kept in process memory, never on disk.
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WebviewWindowBuilder};

#[derive(Default)]
struct UiMemory {
    draft: String,
    ready: bool,
}
impl UiMemory {
    fn save(&mut self, draft: String) -> Result<(), String> {
        if draft.encode_utf16().count() > 300 {
            return Err("Draft exceeds input limit".into());
        }
        self.draft = draft;
        self.ready = false;
        Ok(())
    }
}

#[derive(Default)]
pub struct OverlayState {
    memory: Mutex<UiMemory>,
    showing: AtomicBool,
}

#[tauri::command]
pub fn load_overlay_draft(state: State<'_, OverlayState>) -> Result<String, String> {
    let mut memory = state.memory.lock().map_err(|_| "Overlay memory unavailable")?;
    memory.ready = true;
    Ok(memory.draft.clone())
}

fn create_window(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    let config = app.config().app.windows.iter().find(|w| w.label == label)
        .ok_or("Overlay configuration missing")?;
    WebviewWindowBuilder::from_config(app, config).map_err(|e| e.to_string())?
        .build().map_err(|e| e.to_string())
}

pub fn create_bin(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(bin) = app.get_webview_window("drop-zone") { return Ok(bin); }
    create_window(app, "drop-zone")
}

pub fn destroy_bin(app: &AppHandle) -> Result<(), String> {
    if let Some(bin) = app.get_webview_window("drop-zone") {
        // Order out before destruction, so the bin never lingers on screen.
        bin.hide().map_err(|e| e.to_string())?;
        bin.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn destroy_main(app: &AppHandle) -> Result<(), String> {
    destroy_bin(app)?;
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_companion(app: AppHandle, state: State<'_, OverlayState>, draft: String) -> Result<(), String> {
    state.memory.lock().map_err(|_| "Overlay memory unavailable")?.save(draft)?;
    let result = destroy_main(&app);
    if result.is_err() {
        if let Ok(mut memory) = state.memory.lock() { memory.ready = true; }
        if let Some(window) = app.get_webview_window("main") { let _ = window.show(); }
    }
    result
}

pub fn request_hide(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return; };
    let ready = app.state::<OverlayState>().memory.lock().map(|m| m.ready).unwrap_or(false);
    if ready {
        // The live input belongs to the webview. Let it flush the exact current
        // text via hide_companion, including the final keystroke.
        if let Err(e) = window.emit("oplyra-request-hide", ()) {
            eprintln!("Oplyra hide request failed: {e}");
        }
    } else if let Err(e) = destroy_main(app) {
        // Before the frontend has loaded its draft, input is disabled.
        eprintln!("Oplyra window destruction failed: {e}");
    }
}

pub fn request_show(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let state = app.state::<OverlayState>();
    if state.showing.swap(true, Ordering::AcqRel) { return; }
    drop(state);
    // Tauri/WebView2 requires window construction outside synchronous event
    // callbacks on Windows. The same worker path is used on macOS.
    std::thread::spawn(move || {
        let result = create_window(&app, "main");
        app.state::<OverlayState>().showing.store(false, Ordering::Release);
        match result {
            Ok(window) => { let _ = window.set_focus(); }
            Err(e) => eprintln!("Oplyra restore failed: {e}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unsent_draft_survives_window_lifecycle_in_memory() {
        let mut memory = UiMemory { draft: String::new(), ready: true };
        memory.save("I was typing this…".into()).unwrap();
        assert_eq!(memory.draft, "I was typing this…");
        assert!(!memory.ready);
        memory.ready = true;
        assert!(memory.save("x".repeat(301)).is_err());
        assert_eq!(memory.draft, "I was typing this…");
        assert!(memory.ready);
        memory.save(String::new()).unwrap();
        assert!(memory.draft.is_empty());
    }
    #[test]
    fn limit_matches_webview_utf16_input_length() {
        let mut memory = UiMemory::default();
        memory.save("🙂".repeat(150)).unwrap();
        assert!(memory.save("🙂".repeat(151)).is_err());
        assert_eq!(memory.draft.encode_utf16().count(), 300);
    }
}
