# From the 2024 study to the code

| What we found in 2024 | Source | What the code does |
| --- | --- | --- |
| People want to decide when to take breaks | [Report](../legacy/Autonomous_System_AI_Work_Companion.pdf) §4.1, interviews | Quiet mode, snooze, dismiss and a limit on nudges per hour (`domain/intervention.py`, `api/app.py`) |
| Telling someone they seem anxious makes it worse | §4.1, scenario revisions | Prompts forbid guessing feelings; output checks reject it (`llm/prompts.py`, `llm/guardrails.py`) |
| A fixed 25-minute timer does not fit a meeting in 15 minutes | Scenario 1 revision | Focus length is a user setting; suggestions are optional (`domain/schemas.py`) |
| Getting back into the task matters after an interruption | Scenarios, enactment (§6) | The coach takes the user's goal and a short note as context |
| Privacy is acceptable only with control | §4.1 | Separate opt-ins for storing data and sending text to a model; session delete (`domain/privacy.py`, `storage/repository.py`) |
| Users want to know why a suggestion appears | Enactment feedback | Every suggestion has a rationale, the numbers it used and an uncertainty note |

The 2024 interviews and enactment were done by the MayDay team. The software was built afterwards and has not been tested with users.
