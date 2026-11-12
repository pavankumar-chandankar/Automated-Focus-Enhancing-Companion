"""Reproducible offline LLM response checks; no judge model or human validity claims."""
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from focusbuddy.llm.guardrails import GuardrailViolation, parse_suggestion
from focusbuddy.llm.prompts import VERSIONS, version_sha256


@dataclass
class PromptScore:
    case_id: str
    prompt_version: str
    schema_valid: bool
    agency_preserved: bool
    uncertainty_expressed: bool
    privacy_restriction_met: bool
    notes: str


def evaluate_coach_output(case_id: str, version: str, raw_output: str) -> PromptScore:
    try:
        suggestion = parse_suggestion(raw_output, version, "evaluation")
        uncertainty = len(suggestion.uncertainty.strip()) >= 10
        agency = suggestion.human_control and any("dismiss" in x.lower() or "snooze" in x.lower()
                                                   for x in suggestion.choices)
        return PromptScore(case_id, version, True, agency, uncertainty, True, "contract_accepted")
    except GuardrailViolation:
        return PromptScore(case_id, version, False, False, False, False, "contract_rejected")


def evaluate_cases(path: Path) -> dict:
    cases = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    scores = [evaluate_coach_output(case["id"], case["prompt_version"],
                                    json.dumps(case["candidate_response"])) for case in cases]
    return {
        "evaluation_type": "synthetic_contract_fixtures_only",
        "cases": len(scores),
        "pass": sum(score.schema_valid for score in scores),
        "reject": sum(not score.schema_valid for score in scores),
        "versions": {key: version_sha256(key) for key in VERSIONS},
        "results": [asdict(score) for score in scores],
        "limitations": "Regex/schema checks are partial defenses and not an empirical LLM safety benchmark.",
    }
