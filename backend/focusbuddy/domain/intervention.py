"""Deterministic intervention policy independent of LLM obedience."""
from dataclasses import dataclass

from .schemas import AggregateSignal, Preferences


@dataclass(frozen=True)
class PolicyDecision:
    offer: bool
    reason: str
    signal_summary: list[str]
    respects_snooze: bool = True


def decide(signal: AggregateSignal, preferences: Preferences, nudges_last_hour: int,
           snoozed: bool = False) -> PolicyDecision:
    signal.check_semantics()
    evidence = [
        f"Elapsed {signal.elapsed_minutes:.0f} min",
        f"Focus time {signal.focused_minutes:.0f} min",
        f"Context switches {signal.context_switch_count}",
    ]
    if snoozed:
        return PolicyDecision(False, "User snoozed coaching", evidence)
    if preferences.maximum_nudges_per_hour == 0 or preferences.intervention_style == "quiet":
        return PolicyDecision(False, "Quiet mode is enabled", evidence)
    if nudges_last_hour >= preferences.maximum_nudges_per_hour:
        return PolicyDecision(False, "Hourly nudge budget reached", evidence)
    if signal.elapsed_minutes < 5:
        return PolicyDecision(False, "Insufficient observation window", evidence)
    if signal.idle_minutes >= max(5, 0.35 * signal.elapsed_minutes):
        return PolicyDecision(True, "Extended idle interval", evidence)
    if signal.context_switch_count >= 8 and signal.useful_ratio < 0.7:
        return PolicyDecision(True, "Frequent context switches", evidence)
    if signal.elapsed_minutes >= preferences.focus_minutes:
        return PolicyDecision(True, "User-defined focus interval complete", evidence)
    return PolicyDecision(False, "No intervention needed", evidence)
