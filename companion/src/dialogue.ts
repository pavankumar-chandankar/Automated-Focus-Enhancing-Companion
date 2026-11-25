import type { Phase } from "./native";

export type Behaviour = "available" | "working" | "resting" | "attentive" | "encouraging" | "celebrating";
export type Action = "none" | "start" | "pause" | "resume" | "finish" | "quiet";
export type Plan = { action: Action; reply: string; behaviour: Behaviour; goal?: string; useModel?: boolean };

export function restingBehaviour(phase: Phase): Behaviour {
  return phase === "running" ? "working" : phase === "paused" ? "resting" : "available";
}

// Explicit phrases only. No inferred mood, automatic monitoring or generative model.
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
  if (/^(?:just sit with me|keep me company|stay with me|stay quiet|be quiet|don't interrupt me|no reminders|stop reminding me|quiet please)$/.test(text)) {
    return reply("I'll keep things quiet.", restingBehaviour(phase), "quiet");
  }
  if (/^(?:i need a break|i want a break|let's take a break|take a break|pause|break time|i'm taking a break)$/.test(text)) {
    if (phase === "running") return reply("Take your time.", "resting", "pause");
    return reply("Take your time. There's no rush.", restingBehaviour(phase));
  }
  if (/^(?:i'm done|i am done|i finished|i'm finished|finished|end session|finish session|stop session|that's enough for today|done for today)$/.test(text)) {
    return phase === "idle"
      ? reply("Hope the rest of your day goes well.", "available")
      : reply("Nice work showing up today.", "celebrating", "finish");
  }
  if (/^(?:resume|i'm back|i am back|let's get back to work|back to work|let's continue|continue working)$/.test(text)) {
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
