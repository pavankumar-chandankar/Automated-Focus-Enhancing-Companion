# Prompts

There are two versioned system prompts in `backend/focusbuddy/llm/prompts.py`:

- **autonomy_v1**: no pressure, no guessing about feelings, always offer a way to decline.
- **evidence_v2**: the same, plus every suggestion has to point to the numbers it is based on.

Each prompt version is identified by a SHA-256 hash so a change to the text is visible in test output.

## How the prompt is built

The system message holds the rules. The user message is a JSON object with the goal, the numbers, the preferences and the optional note. The note is labelled as untrusted and is never placed in the system message. This helps against prompt injection through the note, but it is not a complete defence.

## Checking the answer

`backend/focusbuddy/llm/guardrails.py` parses the model output and rejects it if:

- it is not a JSON object, or has extra fields
- a field is missing or too long
- there is no dismiss or snooze choice
- it contains pressure phrases ("you must", "no choice"), claims to have seen the user's screen, or labels the user as anxious, lazy etc.
- it contains something that looks like a password or API key

A rejected answer is replaced with a neutral fallback. The system does not retry with more data.

## Fixtures

`evaluations/prompt_contract_cases.jsonl` has 15 hand-written model answers, some valid and some that break the rules above. `focusbuddy evaluate-prompts` runs them through the checks. This tests the checks, not a real model. Testing a live model would mean running real prompts against it and reviewing the answers, which has not been done yet.
