# Personas and interaction journeys

## From the original MayDay project (2024)

Our [September 2024 report](../legacy/Autonomous_System_AI_Work_Companion.pdf) describes **three personas** derived during the design phase and documents a final financial-analyst persona (section 4.2, figure 7). The final persona, called **Sarah Ritter** in the report, is a 30-year-old financial analyst managing competing deadlines, fatigue and other health-related challenges.

The report's detailed Sarah scenario is a *design narrative*. We did not test a biometric or medical inference system with her, and we do not treat the persona's sensitive attributes as actual participant records.

### The meeting deadline

An earlier scenario follows **Taylor**, who is preparing for a presentation while also handling urgent meetings and interruptions. A fixed 25-minute focus suggestion is inappropriate when the next meeting is near. The revised design uses shorter, editable work intervals, an explicit accept/cancel choice, and the ability to suppress further notifications.

### The workload and resumption problem

Sarah's scenario explores long reports, context switching and pressure from an imminent deadline. The envisioned assistant breaks work into smaller tasks and remembers where to resume after interruption. The original scenario includes suggested health and device integrations that were not implemented as medical technology; the newer Focus Buddy deliberately narrows its data collection.

### Evidence from the enactment

One enacted interruption/resumption session is documented in section 6 of the report. The participant liked summaries and resumption cues but wanted greater control over intervention timing. We use that feedback to prioritize dismiss, snooze, quiet mode and transparent reasoning.

## Traceable interaction choices

| User need | Design decision | Code |
| --- | --- | --- |
| Choose break timing | Configurable focus interval and quiet/snooze | `domain/intervention.py`, `domain/schemas.py` |
| Minimize unsolicited interpretation | Aggregate counters; no emotion diagnosis | `domain/privacy.py` |
| Understand the recommendation | Show evidence, rationale, uncertainty | `llm/prompts.py`, `llm/guardrails.py` |
| Decline without penalty | Explicit dismiss/quiet choice and capped nudges | `api/app.py` |
| Remain informed about personal data | Separate storage and provider consent flags | `storage/repository.py`, `domain/schemas.py` |

The original interview sample and enactment support *why* these affordances were chosen, not claims that the current software produced validated improvements.
