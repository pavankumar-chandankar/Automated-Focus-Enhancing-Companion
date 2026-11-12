"""Privacy-constrained HTTP data contracts."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class Consent(StrictModel):
    participate: Literal[True]
    local_aggregate_storage: bool = False
    send_text_to_llm: bool = False
    show_safety_warnings: bool = True


class Preferences(StrictModel):
    intervention_style: Literal["quiet", "supportive", "reflective"] = "reflective"
    focus_minutes: int = Field(25, ge=5, le=120)
    break_minutes: int = Field(5, ge=1, le=30)
    maximum_nudges_per_hour: int = Field(2, ge=0, le=6)
    snooze_minutes: int = Field(15, ge=1, le=120)
    accessibility_reduce_motion: bool = False
    accessibility_high_contrast: bool = False


class SessionCreate(StrictModel):
    consent: Consent
    preferences: Preferences = Field(default_factory=Preferences)


class SessionPublic(StrictModel):
    id: str
    created_at: str
    expires_at: str
    consent: Consent
    preferences: Preferences
    status: Literal["active", "paused", "ended"] = "active"


class AggregateSignal(StrictModel):
    """No keystrokes, app names, URLs, screen content, or window titles."""
    elapsed_minutes: float = Field(ge=0, le=180)
    focused_minutes: float = Field(ge=0, le=180)
    idle_minutes: float = Field(ge=0, le=180)
    context_switch_count: int = Field(ge=0, le=1000)
    self_report_energy: int | None = Field(default=None, ge=1, le=5)

    @field_validator("context_switch_count")
    @classmethod
    def switches_int(cls, value: int) -> int:
        return value

    @property
    def useful_ratio(self) -> float:
        return self.focused_minutes / self.elapsed_minutes if self.elapsed_minutes else 0.0

    def check_semantics(self) -> None:
        if self.focused_minutes + self.idle_minutes > self.elapsed_minutes + 1e-6:
            raise ValueError("focused + idle minutes exceeds elapsed")


class SignalReceipt(StrictModel):
    accepted: bool
    stored: bool
    notice: str


class CoachRequest(StrictModel):
    session_id: str
    signal: AggregateSignal
    goal: str = Field("Make steady progress", min_length=1, max_length=180)
    optional_note: str = Field("", max_length=1000)
    prompt_variant: Literal["autonomy_v1", "evidence_v2"] = "evidence_v2"


class Suggestion(StrictModel):
    title: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=450)
    rationale: str = Field(min_length=1, max_length=350)
    choices: list[str] = Field(min_length=2, max_length=4)
    uncertainty: str = Field(min_length=1, max_length=200)
    evidence: list[str] = Field(default_factory=list, max_length=6)
    prompt_version: str = ""
    provider: str = ""
    human_control: bool = True


class CoachResponse(StrictModel):
    suggestion: Suggestion
    safety_flags: list[str] = Field(default_factory=list)
    automated_action_taken: Literal[False] = False
    text_sent_to_external_provider: bool = False


class ChoiceEvent(StrictModel):
    action: Literal["accept", "dismiss", "snooze", "details"]
    intervention_id: str = Field(min_length=1, max_length=70, pattern=r"^[a-zA-Z0-9_-]+$")


class ActionReceipt(StrictModel):
    recorded: bool
    message: str
