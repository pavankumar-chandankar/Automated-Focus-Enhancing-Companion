//! I-02: local desktop geometry and explicitly registered global hotkeys.
use std::{fs, path::PathBuf, sync::{Mutex, atomic::{AtomicBool, AtomicU32, Ordering}}};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, LogicalSize, PhysicalPosition, State, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatSize { #[default] Compact, Comfortable, Large }
impl ChatSize {
    fn dimensions(self) -> (u32,u32) { match self {
        Self::Compact => (342,420), Self::Comfortable => (440,520), Self::Large => (560,650)
    } }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="snake_case")]
pub enum CharacterSize { Small, #[default] Standard, Large }
impl CharacterSize { fn dimensions(self)->(u32,u32){match self{Self::Small=>(172,186),Self::Standard=>(192,210),Self::Large=>(232,246)}} }
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="snake_case")]
pub enum CharacterColor { #[default] Lavender, Mint, Peach, Sky }
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Appearance {pub size:CharacterSize,pub color:CharacterColor,pub reduce_motion:bool}
fn enabled() -> bool { true }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct DesktopPrefs {
    pub chat_size: ChatSize,
    pub appearance: Appearance,
    #[serde(default = "enabled")]
    pub always_on_top: bool,
    position: Option<(i32,i32)>,
}
impl Default for DesktopPrefs {
    fn default() -> Self { Self { chat_size: ChatSize::Compact, appearance: Appearance::default(), always_on_top: true, position: None } }
}
pub struct DesktopState {
    path: PathBuf,
    prefs: Mutex<DesktopPrefs>,
    expanded: AtomicBool,
    chat_requested: AtomicBool,
    shortcuts: Mutex<Vec<ShortcutInfo>>,
    stop_shortcut_count: AtomicU32,
}
#[derive(Clone, Serialize)]
pub struct ShortcutInfo { pub label: &'static str, pub keys: &'static str, pub registered: bool }
#[derive(Serialize)]
pub struct DesktopStatus { pub appearance: Appearance, pub chat_size: ChatSize, pub always_on_top: bool, pub shortcuts: Vec<ShortcutInfo>, pub stop_shortcut_count: u32 }
impl DesktopState {
    pub fn new(path: PathBuf) -> Self {
        let prefs = fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Self { path, prefs: Mutex::new(prefs), expanded: AtomicBool::new(false),
            chat_requested: AtomicBool::new(false), shortcuts: Mutex::new(Vec::new()), stop_shortcut_count: AtomicU32::new(0) }
    }
    fn prefs(&self) -> Result<DesktopPrefs,String> {
        Ok(self.prefs.lock().map_err(|_| "Desktop preferences unavailable")?.clone())
    }
    fn save(&self, edit: impl FnOnce(&mut DesktopPrefs)) -> Result<(),String> {
        let mut old = self.prefs.lock().map_err(|_| "Desktop preferences unavailable")?;
        let mut next = old.clone();
        edit(&mut next);
        if let Some(parent) = self.path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        // macOS rename atomically replaces the old settings.
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())?;
        *old = next;
        Ok(())
    }
}
#[derive(Clone, Copy)]
struct Rect { x:i32,y:i32,w:u32,h:u32 }
fn overlap(a:Rect,b:Rect)->i64 {
    let width=(i64::from(a.x)+i64::from(a.w)).min(i64::from(b.x)+i64::from(b.w))-i64::from(a.x.max(b.x));
    let height=(i64::from(a.y)+i64::from(a.h)).min(i64::from(b.y)+i64::from(b.h))-i64::from(a.y.max(b.y));
    width.max(0).saturating_mul(height.max(0))
}
fn clamp_position(pos:(i32,i32), size:(u32,u32), area:Rect)->(i32,i32) {
    let max_x=(i64::from(area.x)+i64::from(area.w.saturating_sub(size.0))).min(i64::from(i32::MAX)) as i32;
    let max_y=(i64::from(area.y)+i64::from(area.h.saturating_sub(size.1))).min(i64::from(i32::MAX)) as i32;
    (pos.0.clamp(area.x,max_x),pos.1.clamp(area.y,max_y))
}
fn area(m:&tauri::Monitor)->Rect {
    let w=m.work_area();
    Rect{x:w.position.x,y:w.position.y,w:w.size.width,h:w.size.height}
}
fn place(window:&WebviewWindow,prefs:&DesktopPrefs,expanded:bool,restore:bool,reset:bool)->Result<(i32,i32),String> {
    let old=window.outer_position().map_err(|e|e.to_string())?;
    let old_size=window.outer_size().map_err(|e|e.to_string())?;
    let desired=if restore {prefs.position.unwrap_or((old.x,old.y))}else{(old.x,old.y)};
    let candidate=Rect{x:desired.0,y:desired.1,w:old_size.width,h:old_size.height};
    let monitors=window.available_monitors().map_err(|e|e.to_string())?;
    let best=monitors.iter().max_by_key(|m|overlap(candidate,area(m))).filter(|m|overlap(candidate,area(m))>0);
    let fallback=window.primary_monitor().map_err(|e|e.to_string())?;
    let monitor=if reset { fallback.as_ref().or(monitors.first()) } else {best.or(fallback.as_ref()).or(monitors.first())}.ok_or("No display available")?;
    let bounds=area(monitor);
    let scale=monitor.scale_factor();
    let (w,h)=if expanded {prefs.chat_size.dimensions()} else {prefs.appearance.size.dimensions()};
    let logical=(f64::from(w).min(f64::from(bounds.w)/scale).floor().max(1.0),f64::from(h).min(f64::from(bounds.h)/scale).floor().max(1.0));
    let physical=((logical.0*scale).ceil() as u32,(logical.1*scale).ceil() as u32);
    let position=if reset || best.is_none() {
        (bounds.x.saturating_add((bounds.w.saturating_sub(physical.0)/2) as i32),bounds.y.saturating_add((bounds.h.saturating_sub(physical.1)/2) as i32))
    }else{clamp_position(desired,physical,bounds)};
    // On mixed-DPI displays move first so the logical resize uses the target scale.
    if (old.x,old.y)!=position {window.set_position(PhysicalPosition::new(position.0,position.1)).map_err(|e|e.to_string())?;}
    if old_size.width!=physical.0||old_size.height!=physical.1 {
        window.set_size(LogicalSize::new(logical.0,logical.1)).map_err(|e|e.to_string())?;
    }
    Ok(position)
}
fn top(window:&WebviewWindow,value:bool)->Result<(),String> {
    #[cfg(target_os="macos")]
    {
        use tauri_nspanel::ManagerExt;
        let panel=window.app_handle().get_webview_panel("main").map_err(|_|"Companion panel unavailable")?;
        panel.set_floating_panel(value);
        panel.set_level(if value {3} else {0});
        Ok(())
    }
    #[cfg(not(target_os="macos"))]
    {window.set_always_on_top(value).map_err(|e|e.to_string())}
}
pub fn restore(window:&WebviewWindow)->Result<(),String> {
    let state=window.app_handle().state::<DesktopState>();
    let prefs=state.prefs()?;
    state.expanded.store(false,Ordering::Release);
    top(window,prefs.always_on_top)?;
    place(window,&prefs,false,true,false)?;
    Ok(())
}
#[tauri::command]
pub fn desktop_status(state:State<'_,DesktopState>)->Result<DesktopStatus,String> {
    let prefs=state.prefs()?;
    Ok(DesktopStatus{appearance:prefs.appearance,chat_size:prefs.chat_size,always_on_top:prefs.always_on_top,
        shortcuts:state.shortcuts.lock().map_err(|_|"Shortcut status unavailable")?.clone(), stop_shortcut_count:state.stop_shortcut_count.load(Ordering::Acquire)})
}
#[tauri::command]
pub fn desktop_layout(app:AppHandle,state:State<'_,DesktopState>,expanded:bool,remember:bool)->Result<(),String> {
    let window=app.get_webview_window("main").ok_or("Companion window unavailable")?;
    let position=place(&window,&state.prefs()?,expanded,false,false)?;
    state.expanded.store(expanded,Ordering::Release);
    if remember {state.save(|p|p.position=Some(position))?;}
    Ok(())
}
#[tauri::command]
pub fn desktop_update(app:AppHandle,state:State<'_,DesktopState>,chat_size:Option<ChatSize>,always_on_top:Option<bool>)->Result<(),String> {
    if app.get_webview_window("drop-zone").is_some(){return Err("Release the companion before changing its layout".into());}
    let mut next=state.prefs()?;
    if let Some(v)=chat_size{next.chat_size=v;}
    if let Some(v)=always_on_top{next.always_on_top=v;}
    if let Some(window)=app.get_webview_window("main"){
        top(&window,next.always_on_top)?;
        next.position=Some(place(&window,&next,state.expanded.load(Ordering::Acquire),false,false)?);
    }
    state.save(|p|*p=next)
}
#[tauri::command]
pub fn appearance_update(app:AppHandle,state:State<'_,DesktopState>,appearance:Appearance)->Result<(),String> {
    if app.get_webview_window("drop-zone").is_some(){return Err("Release the companion before changing appearance".into());}
    let old=state.prefs()?;
    let mut next=old.clone();
    next.appearance=appearance;
    let expanded=state.expanded.load(Ordering::Acquire);
    let window=app.get_webview_window("main");
    if let Some(w)=&window {
        if old.appearance.size!=appearance.size {
            next.position=Some(place(w,&next,expanded,false,false)?);
        }
    }
    if let Err(e)=state.save(|p|{p.appearance=appearance;p.position=next.position;}) {
        if let Some(w)=&window {let _=place(w,&old,expanded,true,false);}
        return Err(e);
    }
    if let Some(w)=window {let _=w.emit("oplyra-appearance-changed",appearance);}
    Ok(())
}
#[tauri::command]
pub fn desktop_reset(app:AppHandle,state:State<'_,DesktopState>)->Result<(),String> {
    if app.get_webview_window("drop-zone").is_some(){return Err("Release the companion before resetting its position".into());}
    if let Some(window)=app.get_webview_window("main"){
        let position=place(&window,&state.prefs()?,state.expanded.load(Ordering::Acquire),false,true)?;
        state.save(|p|p.position=Some(position))?;
    }else{
        state.save(|p|p.position=None)?;
        crate::overlay::request_show(app.clone());
    }
    Ok(())
}
#[tauri::command]
pub fn desktop_cursor(app:AppHandle)->Result<(f64,f64),String> {
    let p=app.cursor_position().map_err(|e|e.to_string())?;
    Ok((p.x,p.y))
}
#[tauri::command]
pub fn desktop_take_chat(state:State<'_,DesktopState>)->bool {
    state.chat_requested.swap(false,Ordering::AcqRel)
}
pub fn request_chat(app:&AppHandle) {
    app.state::<DesktopState>().chat_requested.store(true,Ordering::Release);
    crate::overlay::request_show(app.clone());
    if let Some(window)=app.get_webview_window("main"){let _=window.emit("oplyra-open-chat",());}
}
pub fn clear_chat(app:&AppHandle) {
    if let Some(state)=app.try_state::<DesktopState>(){state.chat_requested.store(false,Ordering::Release);}
}
// Stop on press (not release) for prompt revocation. Other shortcuts retain
// their tested release behavior. A registration failure is visible and has
// a fallback binding, rather than silently pretending the key is active.
fn shortcut_trigger(index:usize, state:ShortcutState)->bool {
    if index==3 {state==ShortcutState::Pressed} else {state==ShortcutState::Released}
}
fn bind_shortcut(app:&AppHandle,index:usize,keys:&'static str)->bool {
    match app.global_shortcut().on_shortcut(keys,move|handle,_,event|{
        if !shortcut_trigger(index,event.state) {return;}
        let app=handle.clone();
        let _=handle.run_on_main_thread(move||match index{
            0=>{if app.get_webview_window("main").and_then(|w|w.is_visible().ok()).unwrap_or(false){
                clear_chat(&app);crate::overlay::request_hide(&app);
            }else{crate::overlay::request_show(app.clone());}},
            1=>request_chat(&app),
            2=>{let handle=app.clone();tauri::async_runtime::spawn(async move{let _=crate::open_control_center(handle).await;});},
            3=>{
                app.state::<DesktopState>().stop_shortcut_count.fetch_add(1,Ordering::AcqRel);
                eprintln!("[Oplyra] stop monitoring shortcut received");
                if let Err(e)=crate::stop_observation(&app){eprintln!("[Oplyra] stop monitoring failed: {e}");}
            },
            _=>{}
        });
    }){
        Ok(())=>true,
        Err(e)=>{eprintln!("[Oplyra] shortcut {keys} unavailable: {e}");false}
    }
}
pub fn register_shortcuts(app:&AppHandle) {
    let shortcuts=[("Show / hide Oplyra","Alt+Shift+O"),("Open conversation","Alt+Shift+C"),
        ("Open Control Center","Alt+Shift+S"),("Stop monitoring","Alt+Shift+M")];
    let mut status=Vec::new();
    for (index,(label,keys)) in shortcuts.into_iter().enumerate(){
        let registered=bind_shortcut(app,index,keys);
        status.push(ShortcutInfo{label,keys,registered});
        if index==3&&!registered{
            let fallback="Alt+Shift+X";
            status.push(ShortcutInfo{label:"Stop monitoring (fallback)",keys:fallback,registered:bind_shortcut(app,index,fallback)});
        }
    }
    if let Ok(mut current)=app.state::<DesktopState>().shortcuts.lock(){*current=status;}
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn stop_hotkey_uses_press_and_other_actions_use_release(){
        assert!(shortcut_trigger(3,ShortcutState::Pressed));
        assert!(!shortcut_trigger(3,ShortcutState::Released));
        for index in 0..3 {assert!(!shortcut_trigger(index,ShortcutState::Pressed));assert!(shortcut_trigger(index,ShortcutState::Released));}
    }
    #[test]fn negative_coordinate_display_clamps(){
        let a=Rect{x:-1920,y:25,w:1920,h:1000};
        assert_eq!(clamp_position((-2000,1100),(342,420),a),(-1920,605));
        assert_eq!(clamp_position((-100,10),(342,420),a),(-342,25));
    }
    #[test]fn overlap_and_oversize(){
        let a=Rect{x:0,y:0,w:100,h:100};
        assert_eq!(overlap(a,Rect{x:90,y:90,w:20,h:20}),100);
        assert_eq!(overlap(a,Rect{x:-400,y:0,w:20,h:20}),0);
        assert_eq!(clamp_position((50,50),(200,200),a),(0,0));
    }
    #[test]fn legacy_appearance_migration(){
        let p:DesktopPrefs=serde_json::from_str(r#"{"chat_size":"large","always_on_top":false,"position":[-42,70]}"#).unwrap();
        assert_eq!(p.chat_size,ChatSize::Large);assert!(!p.always_on_top);assert_eq!(p.position,Some((-42,70)));
        assert_eq!(p.appearance,Appearance::default());
        let next=Appearance{size:CharacterSize::Large,color:CharacterColor::Mint,reduce_motion:true};
        assert_eq!(serde_json::from_str::<Appearance>(&serde_json::to_string(&next).unwrap()).unwrap(),next);
        assert!(serde_json::from_str::<Appearance>(r#"{"size":"giant"}"#).is_err());
    }
    #[test]fn folded_sizes_fit_monitor_gate(){
        for s in [CharacterSize::Small,CharacterSize::Standard,CharacterSize::Large]{let(w,h)=s.dimensions();assert!(w<240&&h<260);}
        assert_eq!(CharacterSize::Standard.dimensions(),(192,210));
    }
    #[test]fn preference_defaults_are_safe(){
        let p:DesktopPrefs=serde_json::from_str("{}").unwrap();
        assert_eq!(p.chat_size,ChatSize::Compact);assert!(p.always_on_top);assert!(p.position.is_none());
    }
}
