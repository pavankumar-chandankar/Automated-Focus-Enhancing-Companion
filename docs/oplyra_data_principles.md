# Oplyra data principles — draft for product design

**This is an engineering policy, not legal advice.** Any paid workplace deployment needs local-law review and appropriate worker notification, consultation and contractual arrangements.

## Defaults
- Collect nothing unless the user explicitly starts a personal session.
- Store minimal, task-relevant data locally; no secret screenshot, audio, clipboard, webcam or keystroke logging.
- Separate opt-in to transmitting text to an external AI model.
- Allow delete, export, pause, quiet mode and a way to see exactly what has been shared.
- Short retention by default; no external ad tracking.

## B2B model constraints (planned)
- Measure **process** and **work output**, not apparent busyness. Do not infer job quality from active-window time or typing rates.
- Employees must be informed about data categories, purpose, recipients, access and retention before any collection.
- Work/task system integration should prefer normalized aggregate events (ticket closed, case resolved, rework flag) over desktop behavioral surveillance.
- Manager insights should prioritize team-level and workflow-level summaries with safeguards against re-identification for small groups.
- If individually identifiable data is necessary for legitimate workflow assignment, restrict access to need-to-know roles and maintain audit logs.
- Never produce automated termination, discipline, promotion or compensation recommendations from a model score.
- Use human-reviewable evidence and clearly identify confounders and measurement limitations.
- Do not treat purportedly weaker local enforcement as permission for invasive tracking.

## Preconditions for a pilot
Document lawful basis and purpose, relevant worker notices/rights, potential labor consultation requirements, DPIA/impact assessment where appropriate, data retention, incident procedures, subprocessors, RBAC, tenant isolation, security testing and a non-retaliation feedback route.
