import { useEffect, useState } from "react";
import { API, setBackendKey } from "./api";
import type { CoachResponse, Consent, Preferences, Session, Signal } from "./types";

type View = "overview" | "coach" | "privacy";

const NAV: [View, string, string][] = [
  ["overview", "Overview", "◈"],
  ["coach", "Focus Coach", "◉"],
  ["privacy", "Privacy & Control", "⌑"],
];

const INITIAL_SIGNAL: Signal = {
  elapsed_minutes: 25,
  focused_minutes: 15,
  idle_minutes: 3,
  context_switch_count: 11,
  self_report_energy: 3,
};

const INITIAL_PREFERENCES: Preferences = {
  intervention_style: "reflective",
  focus_minutes: 25,
  break_minutes: 5,
  maximum_nudges_per_hour: 2,
  snooze_minutes: 15,
  accessibility_reduce_motion: false,
  accessibility_high_contrast: false,
};

const SIGNAL_FIELDS: [keyof Signal, string][] = [
  ["elapsed_minutes", "Elapsed minutes"],
  ["focused_minutes", "Focused minutes"],
  ["idle_minutes", "Idle minutes"],
  ["context_switch_count", "Context switches"],
];

export default function App() {
  const [view, setView] = useState<View>("overview");
  const [session, setSession] = useState<Session | null>(null);
  const [provider, setProvider] = useState("unknown");

  const [storeLocally, setStoreLocally] = useState(false);
  const [allowExternal, setAllowExternal] = useState(false);
  const [quiet, setQuiet] = useState(false);

  const [signal, setSignal] = useState<Signal>(INITIAL_SIGNAL);
  const [goal, setGoal] = useState("Finish the report draft");
  const [note, setNote] = useState("");
  const [variant, setVariant] = useState<"autonomy_v1" | "evidence_v2">("evidence_v2");
  const [advice, setAdvice] = useState<CoachResponse | null>(null);

  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("Nothing is tracked until you start a session.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    API.capabilities()
      .then((caps) => setProvider(caps.provider_mode))
      .catch(() => setProvider("offline"));
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function navigate(next: View) {
    setView(next);
    window.scrollTo({ top: 0 });
  }

  function updateSignal(name: keyof Signal, value: number) {
    setSignal((current) => ({ ...current, [name]: value }));
  }

  async function startSession() {
    const consent: Consent = {
      participate: true,
      local_aggregate_storage: storeLocally,
      send_text_to_llm: allowExternal,
      show_safety_warnings: true,
    };
    const preferences: Preferences = {
      ...INITIAL_PREFERENCES,
      intervention_style: quiet ? "quiet" : "reflective",
    };
    setSession(await API.start(consent, preferences));
    setAdvice(null);
    setMessage("Session started. Only the numbers you enter are used.");
  }

  async function askCoach() {
    if (!session) throw new Error("Start a session first.");
    if (signal.focused_minutes + signal.idle_minutes > signal.elapsed_minutes) {
      throw new Error("Focused + idle minutes cannot be more than elapsed minutes.");
    }
    const result = await API.coach(session.id, signal, goal, note, variant);
    setAdvice(result);
    setMessage(
      result.text_sent_to_external_provider
        ? "Your goal and note were sent to the configured model (you allowed this)."
        : "Nothing was sent to an external model.",
    );
  }

  async function choose(action: "accept" | "dismiss" | "snooze") {
    if (!session || !advice) return;
    await API.choice(session.id, action, "coach_" + advice.suggestion.prompt_version);
    setMessage(`You chose ${action}.`);
  }

  async function deleteSession() {
    if (!session) {
      setMessage("No active session.");
      return;
    }
    await API.delete(session.id);
    setSession(null);
    setAdvice(null);
    setMessage("Session and any stored numbers deleted.");
  }

  return (
    <div className="layout">
      <a href="#content" className="skip">
        Skip to main content
      </a>

      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="logo">F·B</div>
          <div>
            <b>Focus Buddy</b>
            <small>PROTOTYPE</small>
          </div>
        </div>
        <nav>
          {NAV.map(([id, label, glyph]) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              className={view === id ? "selected" : ""}
              onClick={() => navigate(id)}
            >
              <span aria-hidden="true">{glyph}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="aside-note">
          <span className="green-dot" /> Model: {provider === "mock" ? "offline mock" : provider}
        </div>
      </aside>

      <div className="workspace">
        <header className="top">
          <span>{view.toUpperCase()}</span>
        </header>

        <main id="content" tabIndex={-1}>
          <div className="banner" role="status" aria-live="polite">
            {message}
          </div>

          {view === "overview" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="eyebrow">MAYDAY HCI PROJECT · 2024</span>
                  <h1>
                    Your attention.
                    <br />
                    <em>Your choice.</em>
                  </h1>
                  <p>
                    A focus assistant that suggests, explains why, and always lets you say no. Based on
                    interviews about how people deal with interruptions at work.
                  </p>
                  <div className="button-row">
                    <button className="primary" onClick={() => navigate("coach")}>
                      Try the Focus Coach ↗
                    </button>
                  </div>
                </div>
                <div className="hero-art">
                  <div className="ring ring1" />
                  <div className="ring ring2" />
                  <div className="ring ring3" />
                  <div className="dial">
                    25<span>MIN</span>
                  </div>
                </div>
              </section>

              <div className="section-heading">
                <h2>What came out of the interviews</h2>
              </div>
              <div className="cards">
                <article>
                  <span className="glyph">◉</span>
                  <h3>Breaks are personal</h3>
                  <p>Every suggestion can be dismissed or snoozed, and quiet mode turns them off.</p>
                </article>
                <article>
                  <span className="glyph">✳</span>
                  <h3>Don't guess how I feel</h3>
                  <p>The coach only uses the numbers you give it and says what it can't know.</p>
                </article>
                <article>
                  <span className="glyph">⌑</span>
                  <h3>Control over data</h3>
                  <p>Storing data and sending text to a model are two separate opt-ins.</p>
                </article>
              </div>
            </>
          )}

          {view === "coach" && (
            <>
              <PageHeading
                title="Focus Coach"
                description="You enter the numbers, the coach suggests a next step. Nothing runs in the background."
              />
              <div className="columns">
                <section className="panel">
                  <h2>1. Consent</h2>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={storeLocally}
                      onChange={(e) => setStoreLocally(e.target.checked)}
                    />
                    Store my numbers in the local database
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={allowExternal}
                      onChange={(e) => setAllowExternal(e.target.checked)}
                    />
                    Allow sending my goal and note to an external model
                  </label>
                  <label className="toggle">
                    <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
                    Quiet mode (no suggestions)
                  </label>
                  <button className="primary" disabled={busy} onClick={() => run(startSession)}>
                    Start session
                  </button>
                  <p className="note">
                    {session ? `Session ${session.id.slice(0, 8)}…` : "No active session"}
                  </p>
                </section>

                <section className="panel">
                  <h2>2. How is it going?</h2>
                  <div className="metrics">
                    {SIGNAL_FIELDS.map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          type="number"
                          min="0"
                          max="180"
                          value={signal[key] ?? 0}
                          onChange={(e) => updateSignal(key, Number(e.target.value))}
                        />
                      </label>
                    ))}
                  </div>
                  <label>
                    Goal
                    <input value={goal} maxLength={180} onChange={(e) => setGoal(e.target.value)} />
                  </label>
                  <label>
                    Note (optional, not saved)
                    <textarea
                      value={note}
                      maxLength={1000}
                      rows={2}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                  <label>
                    Prompt version
                    <select value={variant} onChange={(e) => setVariant(e.target.value as typeof variant)}>
                      <option value="evidence_v2">evidence_v2</option>
                      <option value="autonomy_v1">autonomy_v1</option>
                    </select>
                  </label>
                  <button className="primary" disabled={busy} onClick={() => run(askCoach)}>
                    Get a suggestion
                  </button>
                </section>
              </div>

              {advice && (
                <section className="panel result" aria-live="polite">
                  <span className="eyebrow">
                    {advice.suggestion.provider} · {advice.suggestion.prompt_version}
                  </span>
                  <h2>{advice.suggestion.title}</h2>
                  <p>{advice.suggestion.message}</p>
                  <h3>Why?</h3>
                  <p>{advice.suggestion.rationale}</p>
                  <div className="hint">{advice.suggestion.uncertainty}</div>
                  {!advice.safety_flags.includes("policy_suppressed") && (
                    <div className="button-row">
                      <button className="primary" onClick={() => run(() => choose("accept"))}>
                        Accept
                      </button>
                      <button className="subtle-btn" onClick={() => run(() => choose("snooze"))}>
                        Snooze
                      </button>
                      <button className="subtle-btn" onClick={() => run(() => choose("dismiss"))}>
                        Dismiss
                      </button>
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          {view === "privacy" && (
            <>
              <PageHeading
                title="Privacy & Control"
                description="What the app uses, what it refuses, and how to delete it."
              />
              <div className="columns">
                <section className="panel">
                  <h2>Used</h2>
                  <p>
                    Elapsed, focused and idle minutes, number of context switches, an optional energy rating,
                    and the goal and note you type in.
                  </p>
                  <h2>Never collected</h2>
                  <p>
                    Keystrokes, clipboard, screenshots, browser history or app names. Typed text is not saved
                    to the database.
                  </p>
                </section>
                <section className="panel">
                  <h2>Delete session</h2>
                  <p>Removes this session and any numbers or choices stored with it.</p>
                  <button className="danger" disabled={busy} onClick={() => run(deleteSession)}>
                    Delete current session
                  </button>
                  <label>
                    Backend API token (only if the server requires one)
                    <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                  </label>
                  <button
                    className="subtle-btn"
                    onClick={() => {
                      setBackendKey(apiKey);
                      setMessage("Token kept in memory for this page only.");
                    }}
                  >
                    Use token
                  </button>
                </section>
              </div>
            </>
          )}
        </main>

        <footer>FOCUS BUDDY · PROTOTYPE · NOT A MEDICAL OR MONITORING TOOL</footer>
      </div>
    </div>
  );
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="page-heading">
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
