import type { Phase, PreviousTurn } from "./native";

// Four recent completed exchanges. No disk transcript; newest turns win.
export function rememberTurn(history: PreviousTurn[], user: string, reply: string): PreviousTurn[] {
  const bound = (s: string) => Array.from(s.trim().replace(/[\x00-\x09\x0b-\x1f\x7f]/g, " ")).slice(0, 300).join("");
  const turn = { user: bound(user), reply: bound(reply) };
  if (!turn.user || !turn.reply) return history.slice(-4);
  return [...history, turn].slice(-4);
}

// Consent commands stay local, never become AI proposals or enter chat history.
export function awarenessCommand(input: string): "enable" | "disable" | "status" | null {
  const text = input.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/[.!?]+$/, "").trim().replace(/\s+/g, " ");
  if (/^(?:watch my activity|follow my activity|enable activity awareness|help me stay on track|watch for distractions)$/.test(text)) return "enable";
  if (/^(?:stop watching|stop watching my activity|stop activity awareness|disable activity awareness|stop observing|stop monitoring)$/.test(text)) return "disable";
  if (/^(?:what can you see|what are you watching|activity awareness status|are you watching my activity)$/.test(text)) return "status";
  return null;
}

// Screen control is an explicit, local command boundary. The model cannot
// select windows, activate capture, or authorize cloud transmission.
export function screenCommand(input: string): "choose" | "preview" | "stop" | null {
  const text = input.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/[.!?]+$/, "").trim().replace(/\s+/g, " ");
  if (/^(?:watch my screen|read my screen|watch my window|choose a window|enable screen awareness)$/.test(text)) return "choose";
  if (/^(?:what can you read|read my window|analyze my window|analyse my window|show me what you read|what did you read)$/.test(text)) return "preview";
  if (/^(?:stop watching my screen|stop reading my screen|stop screen observation|disable screen awareness|stop watching my window)$/.test(text)) return "stop";
  return null;
}

export type Behaviour = "available" | "working" | "resting" | "attentive" | "encouraging" | "celebrating";
export type Intent = "start" | "pause" | "resume" | "finish" | "quiet" | "hide";
export type Action = "none" | Intent;
export type Plan = { action: Action; reply: string; behaviour: Behaviour; goal?: string; useModel?: boolean };

export function restingBehaviour(phase: Phase): Behaviour {
  return phase === "running" ? "working" : phase === "paused" ? "resting" : "available";
}

export function actionAllowed(action: Intent, phase: Phase): boolean {
  switch (action) {
    case "start": return phase === "idle";
    case "pause": return phase === "running";
    case "resume": return phase === "paused";
    case "finish": return phase !== "idle";
    case "quiet": case "hide": return true;
    default: return false;
  }
}

export function confirmedPlan(action: Intent, phase: Phase): Plan | null {
  if (!actionAllowed(action, phase)) return null;
  switch (action) {
    case "start": return {action, goal: "Focus together", reply: "Let's begin. I'll keep you company.", behaviour:"working"};
    case "pause": return {action, reply:"Take your time. Enjoy your break.", behaviour:"resting"};
    case "resume": return {action, reply:"Welcome back. Let's keep going.", behaviour:"working"};
    case "finish": return {action, reply:"Nice work showing up today.", behaviour:"celebrating"};
    case "quiet": return {action, reply:"I'll keep things quiet.", behaviour:restingBehaviour(phase)};
    case "hide": return {action, reply:"", behaviour:restingBehaviour(phase)};
  }
}

export function proposalQuestion(action: Intent): string {
  return ({start:"Shall we start a focus session?", pause:"Shall I pause our session while you take a break?",
    resume:"Ready to resume our session?", finish:"Shall we end this session?",
    quiet:"Would you like me to stay quiet?", hide:"Would you like me to hide for now?"})[action];
}

export type PendingAction = { action: Intent; phase: Phase; expiresAt: number };

export function resolveConfirmation(input: string, pending: PendingAction | null, phase: Phase, now: number): "accept" | "decline" | "unrelated" | "expired" {
  if (!pending) return "unrelated";
  if (now >= pending.expiresAt || phase !== pending.phase || !actionAllowed(pending.action, phase)) return "expired";
  const text = input.trim().toLowerCase().replace(/[.!?]+$/, "").trim();
  if (/^(?:yes|yes please|yes, please|sure|go ahead|do it|okay|ok|confirm)$/.test(text)) return "accept";
  if (/^(?:no|no thanks|no, thanks|not now|cancel|never mind|nevermind)$/.test(text)) return "decline";
  return "unrelated";
}

// Direct actions use narrow complete phrases; model proposals always require confirmation.
// Keep language handling separate from the native session and policy engines.
export function planMessage(input: string, phase: Phase): Plan {
  const raw = input.trim();
  const text = raw.toLowerCase().replace(/[’‘]/g, "'").replace(/[.!?]+$/, "").trim().replace(/\s+/g, " ");
  const reply = (message: string, behaviour: Behaviour = "attentive", action: Action = "none"): Plan =>
    ({ reply: message, behaviour, action });
  const conversational = (message: string, behaviour: Behaviour = "attentive"): Plan => ({ ...reply(message, behaviour), useModel: true });
  if (!text) return reply("You can tell me when you're ready.");
  // This companion is not a mental-health service. Never turn explicit danger
  // into a productivity nudge or an invitation to depend on the character.
  if (/\b(?:kill myself|end my life|hurt myself|suicidal)\b/.test(text)) {
    return reply("Your safety matters more than work. Please reach out to someone you trust or local crisis support. If you might act on this now, contact emergency services.");
  }
  if (/^(?:hide|hide yourself|hide oplyra|go away|leave me alone for now)$/.test(text)) {
    return reply("", restingBehaviour(phase), "hide");
  }
  if (/^(?:just sit with me|keep me company|stay with me|stay quiet|be quiet|don't interrupt me|no reminders|stop reminding me|quiet please)$/.test(text)) {
    return reply("I'll keep things quiet.", restingBehaviour(phase), "quiet");
  }
  if (/^(?:i need a break|i want a break|let's take a break|take a break|pause|break time|i'm taking a break|i am taking a break|i'm going to take a break|i am going to take a break|(?:please )?pause (?:the |our |my )?session(?:,? (?:i'm|i am) taking a break)?|(?:please )?pause,? (?:i'm|i am) taking a break)$/.test(text)) {
    if (phase === "running") return reply("Take your time.", "resting", "pause");
    return reply("Take your time. There's no rush.", restingBehaviour(phase));
  }
  if (/^(?:i'm done|i am done|i finished|i'm finished|finished|end session|finish session|stop session|that's enough for today|done for today|i'm finished for today|i am finished for today|(?:please )?end (?:the |our |my )session)$/.test(text)) {
    return phase === "idle"
      ? reply("Hope the rest of your day goes well.", "available")
      : reply("Nice work showing up today.", "celebrating", "finish");
  }
  if (/^(?:resume|i'm back|i am back|let's get back to work|back to work|let's continue|continue working|(?:please )?resume (?:the |our |my )?session|alright,? let's get going again|let's get going again)$/.test(text)) {
    if (phase === "paused") return reply("Welcome back. One step at a time.", "working", "resume");
    if (phase === "running") return reply("One step at a time.", "working");
    return reply("Ready when you are. Say “let's focus” to begin.");
  }
  if (/^(?:i(?:'m| am) (?:getting )?distracted|i can't focus|i keep getting distracted|i lost focus|i'm struggling to focus|i(?:'m| am) procrastinating)$/.test(text)) {
    return conversational("How about coming back to just one small step?", "encouraging");
  }
  if (/^(?:i(?:'m| am) (?:tired|stressed|overwhelmed|frustrated)|this is hard|i need encouragement|encourage me|motivate me|i don't feel like working)$/.test(text)) {
    return conversational("It's okay to slow down. One small step or a break is enough for now.", "encouraging");
  }
  if (/^(?:thanks|thank you|that helped|good job|nice)$/.test(text)) {
    return conversational("You're welcome.", "attentive");
  }
  if (/^(?:hi|hello|hey|hey oplyra|hello oplyra)$/.test(text)) {
    return conversational("Hey. Ready whenever you are.");
  }
  if (/^(?:what can you do|help|how do you work)$/.test(text)) {
    return reply("I'm a focus companion. Try “let's focus”, “I'm distracted”, “I need a break” or “I'm done”.");
  }
  // Do not turn a negated or mixed work declaration into a session start.
  if (/\b(?:don't|do not|not|never|unless|if|but)\b/.test(text)) return conversational("Tell me what you'd like to do.");
  // Only explicitly declared work is stored. No free-form transcript is saved.
  const goalMatch = raw.match(/^(?:i (?:need|want) to (?:work on|study)|let's work on|focus on|start focusing on)\s+(.+)$/i);
  const start = /^(?:let's (?:focus|study|work)(?: together)?|start(?: a)? focus session|start focusing|focus time)$/.test(text);
  if (start || goalMatch) {
    if (phase === "running") return reply("We're already in a focus session. Let's keep going.", "working");
    if (phase === "paused") return reply("You're on a break. Say “I'm back” to resume, or “I'm done” to end this session.", "resting");
    const goal = goalMatch?.[1]?.trim() || "Focus together";
    if (Array.from(goal).length > 160 || /[\x00-\x1f\x7f]/.test(goal)) {
      return reply("Could you say that goal in a few words?");
    }
    return { action: "start", goal, reply: "Let's begin. I'll keep you company.", behaviour: "working" };
  }
  // Do not pretend to understand arbitrary prompts or answer research questions.
  return conversational("I'm here for focus and company. Try “let's focus”, “I'm distracted” or “I need a break”.");
}
