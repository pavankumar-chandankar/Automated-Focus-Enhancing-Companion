import { useEffect, useRef, useState } from "react";
import { companion, type ControlStatus, type ControlAction } from "./native";
import { sessionActions, elapsedLabel } from "./controlLogic";
import "./control-center.css";

type Page = "overview" | "focus" | "monitoring" | "about";
const nav: {id: Page; label: string; icon: string}[] = [
  {id:"overview",label:"Overview",icon:"overview"},
  {id:"focus",label:"Focus session",icon:"focus"},
  {id:"monitoring",label:"Monitoring",icon:"shield"},
  {id:"about",label:"About",icon:"info"},
];
function Icon({name}: {name:string}) {
  const paths: Record<string,string> = {
    overview:"M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    focus:"M12 8v5l3 2 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20",
    shield:"M12 3 4 6v6c0 5 5 8 8 9 3-1 8-4 8-9V6z M9 12l2 2 4-4",
    info:"M12 11v6 M12 7h.01 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20",
    chart:"M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16V5",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
export function ControlCenter() {
  const [page,setPage]=useState<Page>("overview");
  const [status,setStatus]=useState<ControlStatus|null>(null);
  const [goal,setGoal]=useState("");
  const [step,setStep]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [stale,setStale]=useState(false);
  const [quitConfirm,setQuitConfirm]=useState(false);
  const lock=useRef(false);
  const pollGeneration=useRef(0);
  useEffect(()=>{
    let mounted=true, inFlight=false;
    const refresh=async()=>{
      if (!mounted || inFlight || lock.current || document.hidden) return;
      inFlight=true; const generation=pollGeneration.current;
      try {
        const value=await companion.controlStatus();
        if(mounted && generation===pollGeneration.current){setStatus(value);setStale(false);}
      } catch {
        if(mounted && generation===pollGeneration.current){setStale(true);}
      } finally {inFlight=false;}
    };
    void refresh();
    const timer=window.setInterval(()=>void refresh(),1000);
    document.addEventListener("visibilitychange",refresh);
    return ()=>{mounted=false;window.clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};
  },[]);
  async function run(operation:()=>Promise<unknown>, success?:string) {
    if(lock.current)return;
    lock.current=true;pollGeneration.current++;setBusy(true);setError("");setNotice("");
    try {await operation();setStatus(await companion.controlStatus());setStale(false);if(success)setNotice(success);}
    catch(e){setError(String(e));try {setStatus(await companion.controlStatus());setStale(false);}catch{setStale(true);}}
    finally{lock.current=false;setBusy(false);}
  }
  async function changeVisibility(visible:boolean) {
    await run(async()=>{
      await companion.controlVisibility(visible);
      for(let i=0;i<30;i++){
        const state=await companion.controlStatus();
        if(state.visible===visible)return;
        await new Promise(resolve=>window.setTimeout(resolve,100));
      }
      throw new Error("Companion did not confirm the requested visibility. Try again from the menu bar.");
    });
  }
  const session=status?.session;
  const phase=session?.phase;
  const phaseLabel=phase==="running"?"Working":phase==="paused"?"Paused":phase==="idle"?"Ready":"Unknown";
  const active=!!(status?.screen.active||status?.awareness.enabled);
  const monitorLabel=!status?"Unknown":status.screen.tab_reminders&&status.screen.active?(status.screen.reference_set?"Chrome tab reminders":"Finding focus tab"):status.screen.monitoring&&status.screen.active?"Semantic monitoring":status.screen.active?"Local screen observation":status.awareness.enabled?"Activity awareness":"Off";
  const providerLabel=!status?"Unknown":status.provider==="groq"?(status.gateway?"Groq via gateway":"Groq direct"):status.provider==="local"?"Local model":status.provider==="deepseek"?"DeepSeek":"Not configured";
  const disabled=busy||!status||stale;
  function action(action:ControlAction) {
    void run(()=>companion.controlAction(action,action==="start"?goal:undefined,action==="start"?step:undefined),action==="stop_monitoring"?"Observation stopped.":undefined);
  }
  const focusControls=<>
    <div className="cc-session-heading"><div><span className="cc-kicker">SESSION ELAPSED</span><div className="cc-time">{elapsedLabel(phase==="idle"?0:session?.elapsed_ms??0)}</div></div><span className="cc-chip">{phaseLabel}</span></div>
    {phase==="idle"?<form className="cc-form" onSubmit={e=>{e.preventDefault();if(!disabled&&goal.trim())action("start");}}>
      <label>What are you working on?<input value={goal} onChange={e=>setGoal(e.target.value)} maxLength={160} placeholder="e.g. Read chapter 3" disabled={disabled}/></label>
      <label>Next step (optional)<input value={step} onChange={e=>setStep(e.target.value)} maxLength={240} placeholder="e.g. Start with section 3.1" disabled={disabled}/></label>
      <button className="cc-primary" disabled={disabled||!goal.trim()} type="submit">Start focus session</button>
    </form>:phase?<><p className="cc-goal">{session?.goal}</p><p className="cc-muted">Next step: {session?.next_step}</p><div className="cc-actions">{sessionActions(phase).filter(a=>a!=="start").map(a=><button key={a} type="button" className={a==="finish"?"cc-secondary":"cc-primary"} disabled={disabled} onClick={()=>action(a)}>{a==="pause"?"Pause":a==="resume"?"Resume":"Finish session"}</button>)}</div></>:<p className="cc-muted">Loading native session…</p>}
  </>;
  const monitorControls=<><div className="cc-line"><div><strong>{monitorLabel}</strong><p>{status?.screen.active?status.screen.detail||"Observation authorized for this session.":status?.awareness.enabled?"Local app-category and inactivity awareness.":"No active observation."}</p></div><button className="cc-secondary" disabled={disabled||!active} onClick={()=>action("stop_monitoring")}>Stop monitoring</button></div><p className="cc-muted">Starting a focus session does not grant observation permission. Enable monitoring using the existing companion consent controls. Pausing, finishing or hiding stops observation.</p></>;
  return <main className="cc">
    <aside className="cc-sidebar">
      <div className="cc-brand"><span className="cc-brandmark">o</span><div><strong>Oplyra</strong><small>CONTROL CENTER</small></div></div>
      <nav aria-label="Control Center">{nav.map(item=><button key={item.id} aria-current={page===item.id?"page":undefined} onClick={()=>setPage(item.id)}><Icon name={item.icon}/>{item.label}</button>)}<button onClick={()=>void run(companion.openAnalytics)} disabled={busy}><Icon name="chart"/>Analytics <span className="cc-external">↗</span></button></nav>
      <div className="cc-side-bottom"><span>Infrastructure · I-01</span><button className="cc-quit" onClick={()=>setQuitConfirm(true)}>Quit Oplyra</button></div>
    </aside>
    <section className="cc-content">
      <header className="cc-header"><span className="cc-kicker">YOUR WORKSPACE</span><h1>{nav.find(n=>n.id===page)?.label}</h1><p>{page==="overview"?"A quiet space to manage your companion.":page==="focus"?"Set an intention and control your session.":page==="monitoring"?"See and control what Oplyra observes.":"Application and connection information."}</p></header>
      {stale&&<p role="alert" className="cc-alert">Live status unavailable. Controls are disabled until refreshed.</p>}
      {error&&<p role="alert" className="cc-alert">{error}</p>}
      {notice&&<p role="status" className="cc-notice">{notice}</p>}
      {page==="overview"&&<>
        <div className="cc-card cc-companion"><div><span className="cc-kicker">DESKTOP COMPANION</span><h2>{status?.visible?"Oplyra is here":status?"Oplyra is hidden":"Checking companion…"}</h2><p>Keep your companion nearby or put it away.</p></div><button className="cc-secondary" disabled={disabled} onClick={()=>void changeVisibility(!status?.visible)}>{status?.visible?"Hide companion":"Show companion"}</button></div>
        <div className="cc-stats"><div className="cc-card"><span>Focus session</span><strong>{phaseLabel}</strong></div><div className="cc-card"><span>Observation</span><strong>{monitorLabel}</strong></div><div className="cc-card"><span>AI configuration</span><strong>{providerLabel}</strong><small>Connectivity not checked</small></div></div>
        <section className="cc-card"><h2>Focus session</h2>{focusControls}</section>
        <section className="cc-card"><h2>Observation</h2>{monitorControls}</section>
      </>}
      {page==="focus"&&<section className="cc-card">{focusControls}<p className="cc-muted">Sessions completed: {session?.sessions_completed??"—"}</p></section>}
      {page==="monitoring"&&<section className="cc-card"><h2>Current observation</h2>{monitorControls}<div className="cc-divider"/><p className="cc-muted">Screen context: {status?.screen.cloud_context?"Cloud sharing authorized for this session":"Cloud sharing off"}. No observation is started by opening this window.</p></section>}
      {page==="about"&&<section className="cc-card"><h2>Oplyra · v0.14.3</h2><p>Infrastructure milestone I-01. Native controls are independent of AI.</p><div className="cc-divider"/><div className="cc-line"><strong>AI transport</strong><span>{providerLabel}</span></div><p className="cc-muted">This is the configured provider, not a live connectivity test. No credentials are shown or requested here.</p><div className="cc-divider"/><p>Settings, shortcuts, permissions and connection diagnostics are planned for later milestones.</p></section>}
    </section>
    {quitConfirm&&<div className="cc-modal-backdrop"><section className="cc-modal" role="dialog" aria-modal="true" aria-labelledby="cc-quit-title"><h2 id="cc-quit-title">Quit Oplyra?</h2><p>Closes all Oplyra windows and stops observation. Your saved session is retained.</p><div className="cc-actions"><button autoFocus className="cc-secondary" onClick={()=>setQuitConfirm(false)}>Cancel</button><button className="cc-primary" onClick={()=>{setQuitConfirm(false);void run(companion.controlQuit);}}>Quit</button></div></section></div>}
  </main>;
}
