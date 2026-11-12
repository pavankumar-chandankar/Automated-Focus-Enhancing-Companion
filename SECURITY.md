# Security

This is a prototype, not a production service. Do not use it to monitor other people.

- User notes are passed to the model as data inside the user message, not as instructions.
- The model has no tools. It cannot run commands, open links or send anything.
- Consent checks and the nudge policy run in normal code, outside the model. The regex and schema checks on model output are not a complete defence against prompt injection.
- Error responses do not include provider errors, keys or submitted text.
- Calls to a real LLM need HTTPS, a server-side key and the user's opt-in.
- The keystroke logger in `legacy/` is kept only as history and should not be run.
- Session IDs are random UUIDs, not authentication.

If you find a security problem, please contact me privately instead of opening a public issue.
