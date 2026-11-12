"""Reject malformed/non-autonomous suggestions; not a complete injection defense."""
import json
import re

from pydantic import ValidationError

from focusbuddy.domain.schemas import Suggestion


class GuardrailViolation(ValueError):
    pass


COERCIVE_PATTERNS = [
    r"\byou (must|have to|are required to)\b", r"\bno choice\b",
    r"\bguaranteed productivity\b", r"\b100% safe\b", r"\byou are lazy\b",
    r"\bignore (all )?(previous|system) instructions\b",
    r"\bshare (your )?(password|api key|credentials)\b",
    r"\b(i (saw|monitored|recorded|read) (your|the) (screen|tabs|keystrokes|password|emails?|browser))\b",
    r"\b(you (are|seem) (depressed|anxious|stressed|lazy))\b",
    r"\b(i (know|can tell) (how you feel|your mood))\b",
]
PRIVATE_PATTERNS = [r"\bsk-[A-Za-z0-9_-]{12,}\b", r"\bpassword\s*[:=]\s*\S+"]


def _parse_object(text: str) -> dict:
    if len(text) > 12000:
        raise GuardrailViolation("Response too large")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise GuardrailViolation("Model did not return JSON") from error
    if not isinstance(data, dict):
        raise GuardrailViolation("Model output must be a JSON object")
    return data


def parse_suggestion(text: str, prompt_version: str, provider_name: str) -> Suggestion:
    data = _parse_object(text)
    allowed = {"title", "message", "rationale", "choices", "uncertainty", "evidence"}
    if set(data) - allowed:
        raise GuardrailViolation("Model returned unauthorized fields")
    try:
        suggestion = Suggestion.model_validate({**data, "prompt_version": prompt_version,
                                               "provider": provider_name, "human_control": True})
    except ValidationError as error:
        raise GuardrailViolation("Model did not respect output contract") from error
    user_visible = " ".join([
        suggestion.title, suggestion.message, suggestion.rationale,
        suggestion.uncertainty, *suggestion.choices, *suggestion.evidence,
    ]).lower()
    if any(re.search(pattern, user_visible, re.IGNORECASE) for pattern in COERCIVE_PATTERNS + PRIVATE_PATTERNS):
        raise GuardrailViolation("Coercive or private-content pattern in model output")
    if not any("dismiss" in c.lower() or "no thanks" in c.lower() or "snooze" in c.lower()
               for c in suggestion.choices):
        raise GuardrailViolation("User must have a dismiss/snooze option")
    return suggestion


def fallback_suggestion(prompt_version: str, reason: str = "validation") -> Suggestion:
    return Suggestion(
        title="Take control of your next step",
        message="Would you prefer to continue, pause briefly, or dismiss this suggestion?",
        rationale="The automated response could not be validated, so a neutral alternative is shown.",
        choices=["Continue", "Pause briefly", "Dismiss"],
        uncertainty="No reliable interpretation of your attention is available.",
        evidence=[], prompt_version=prompt_version, provider="local_fallback", human_control=True,
    )
