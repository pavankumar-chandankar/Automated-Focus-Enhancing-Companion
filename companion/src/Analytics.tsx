import { useEffect, useState } from "react";
import { companion, type AnalyticsSnapshot } from "./native";

export function AnalyticsWindow() {
  const [data, setData] = useState<AnalyticsSnapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (!active || inFlight || document.hidden) return;
      inFlight = true;
      try { const snapshot = await companion.analytics(); if (active) { setData(snapshot); setError(""); } }
      catch (e) { if (active) setError(String(e)); }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const m = data?.metrics;
  const seconds = Math.floor((data?.elapsed_ms ?? 0) / 1000);
  const duration = Math.floor(seconds/60) + "m " + String(seconds % 60).padStart(2,"0") + "s";
  const portions = m ? [
    {label:"Related", value:m.related, cls:"related"},
    {label:"Possible diversion", value:m.possible_distraction, cls:"diversion"},
    {label:"Uncertain / unavailable", value:m.unknown, cls:"unknown"},
  ] : [];
  return <main className="analytics-page">
    <header className="analytics-header"><div><span className="analytics-eyebrow">OPLYRA / SESSION INSIGHTS</span><h1>Your focus session</h1><p>Understand your activity without grading yourself.</p></div><span className="analytics-state">{data?.monitoring ? "Monitoring on" : data?.active ? "Local observation" : "Observation off"}</span></header>
    {error && <p role="alert">{error}</p>}
    <section className="analytics-goal"><span className="analytics-eyebrow">YOUR INTENTION</span><h2>{data?.goal || "No goal declared yet"}</h2><p>{data?.detail || "Start or resume a session in the floating companion."}</p></section>
    <div className="analytics-grid">
      {[["Monitoring elapsed",duration],["Observed samples",m?.samples ?? 0],["Check-ins offered",m?.check_ins ?? 0],["Returns observed",m?.returns ?? 0]].map(([label,value]) => <section key={label} className="analytics-metric"><span>{label}</span><strong>{value}</strong></section>)}
    </div>
    <section className="analytics-card"><h2>Activity relevance</h2><p>Sample counts, not measured attention or time percentages.</p>
      <div className="analytics-bar" role="img" aria-label="Distribution of classified samples">{portions.map(p => <div key={p.cls} className={p.cls} style={{width: m?.samples ? (100*p.value/m.samples)+"%" : "0%"}} />)}</div>
      <div className="analytics-legend">{portions.map(p => <div key={p.cls}><i className={p.cls}/><span>{p.label}</span><strong>{p.value}</strong></div>)}</div>
    </section>
    <section className="analytics-card"><h2>Observation and AI budget</h2><div className="analytics-legend"><div><span>Observed context changes</span><strong>{m?.changes ?? 0}</strong></div><div><span>Background analysis attempts</span><strong>{m?.analyses ?? 0}</strong></div><div><span>Screen-context attempts left today</span><strong>{data?.remaining_today ?? "—"}</strong></div></div><p>Only current-process session counters are retained. No screenshot or OCR history. Unknown does not mean distracted. Groq account limits also apply.</p></section>
  </main>;
}
