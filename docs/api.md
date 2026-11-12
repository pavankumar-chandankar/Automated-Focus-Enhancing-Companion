# API

Backend: `http://127.0.0.1:8000`. React UI: `http://127.0.0.1:5173`.

| Verb | Route | Function | Raw text persisted? |
|---|---|---|---|
| GET | `/health` | Runtime liveness | No |
| GET | `/v1/capabilities` | Provider mode, retention and limits | No |
| POST | `/v1/sessions` | Begin pseudonymous session with explicit flags | No |
| GET | `/v1/sessions/{id}` | Review consent/preferences | No |
| POST | `/v1/sessions/{id}/status` | Active/paused/ended | No |
| POST | `/v1/sessions/{id}/aggregate` | Validate and optionally store numeric metrics | No |
| POST | `/v1/sessions/{id}/choices` | Opt-in accept/dismiss/snooze metadata | No |
| GET | `/v1/sessions/{id}/summary` | Counts from locally consented records | No |
| DELETE | `/v1/sessions/{id}` | Delete session and dependent aggregates | No |
| POST | `/v1/coach` | Non-coercive suggestion with rationale, choices and uncertainty | No |

## Example: create opt-in session

```bash
curl -sS -X POST http://127.0.0.1:8000/v1/sessions \
  -H 'content-type: application/json' \
  -d '{"consent":{"participate":true,"local_aggregate_storage":false,"send_text_to_llm":false}}'
```

Copy the returned `id` into a coach request. When `FOCUSBUDDY_API_TOKEN` is set, all `/v1/*` routes need an `X-API-Key` header. The UI lets you enter that backend token; never put an LLM provider key in the browser.

## JSON safety

`/v1/coach` expects explicit numerical signal values; no text is stored. A model response is an object with `title`, `message`, `rationale`, `choices`, `uncertainty` and `evidence`. The backend guarantees `automated_action_taken=false`; it does not guarantee safe advice. Invalid model outputs trigger a neutral fallback.

OpenAPI docs at `/docs` and `/openapi.json` when the server runs.
