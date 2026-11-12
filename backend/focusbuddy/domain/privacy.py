"""Data minimization: explicit allowed fields, no raw device telemetry."""
import re

from .schemas import AggregateSignal

FORBIDDEN_KEYS = frozenset({
    "key", "keys", "keystrokes", "keyboard", "clipboard", "screenshot", "window_title",
    "active_window", "app_name", "domain", "url", "email", "password", "typed_text", "web_history",
})


class PrivacyViolation(ValueError):
    pass


def validate_aggregate(payload: dict) -> AggregateSignal:
    if not isinstance(payload, dict):
        raise PrivacyViolation("Aggregate signal must be a JSON object")
    forbidden = {str(key).lower() for key in payload} & FORBIDDEN_KEYS
    if forbidden:
        raise PrivacyViolation("Raw private telemetry is not accepted")
    try:
        signal = AggregateSignal.model_validate(payload)
        signal.check_semantics()
        return signal
    except ValueError as error:
        raise PrivacyViolation("Invalid aggregate signal; review boundaries") from error


def scrub_for_display(value: str) -> str:
    """Do not log raw text; this only strips terminal control characters for UI display."""
    return re.sub(r"[\x00-\x1f\x7f]", " ", value)


def example_allowed_schema() -> dict:
    return {
        "elapsed_minutes": 25,
        "focused_minutes": 18,
        "idle_minutes": 2,
        "context_switch_count": 7,
        "self_report_energy": 3,
    }
