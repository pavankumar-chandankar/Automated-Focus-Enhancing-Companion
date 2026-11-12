# Focus Buddy

A small assistant that helps you get back to work after an interruption. It suggests a next step, says why, and you can always say no.

It started in 2024 as **MayDay**, an HCI course project at the University of Siegen by Azarang Etemadi, Pavankumar Chandankar and Gururaj Shetty. We interviewed people about interruptions at work, built personas and wireframes, and ran an enactment session. The 18-page report is in [`legacy/`](legacy/Autonomous_System_AI_Work_Companion.pdf).

The first code from 2024 was a set of separate scripts, including a keystroke logger. In 2026 I rebuilt it as a proper app: a FastAPI backend, a React UI and an optional LLM, without the logging.

## What the 2024 study found

We did five semi-structured interviews, grouped the answers with affinity mapping, and tested the revised design in one enactment session. The main points:

- People want to decide when they take a break. Fixed reminders annoyed them; they wanted snooze and off.
- Being told "you seem anxious" right before a presentation makes things worse, not better.
- A fixed schedule for checking email does not work when urgent messages can come in.
- After an interruption, a short reminder of where you were helps more than a motivational message.
- Tracking is only acceptable if the person controls what is collected.

All five interviewees were students with part-time jobs, so this is a small first look, not a representative study. More detail is in [research/2024_mayday_study.md](research/2024_mayday_study.md).

## What the app does

1. You start a session and choose two things separately: whether your numbers are saved locally, and whether your text may be sent to an external model.
2. You enter how long you have worked, how much of that was focused or idle, and how often you switched tasks. You can add a goal and a short note.
3. A rule-based policy decides if a suggestion is allowed at all. Quiet mode, snooze and a maximum number of nudges per hour are checked here, in code, not by the model.
4. If a suggestion is allowed, the backend builds a prompt and asks the model. The default model is an offline mock. An OpenAI-compatible endpoint can be configured instead.
5. The answer must be valid JSON with a rationale, the numbers it used, an uncertainty note and a dismiss or snooze option. Anything that fails these checks, or uses pressure like "you must", is replaced by a neutral fallback.
6. You accept, snooze or dismiss. You can delete the session and everything stored with it.

Each design decision, and the 2024 finding it comes from, is listed in [docs/research_to_code_traceability.md](docs/research_to_code_traceability.md).

## How it is built

| Part | What it is |
| --- | --- |
| Backend | Python, FastAPI, Pydantic. Session, coaching, consent and delete endpoints (`backend/focusbuddy/api/app.py`) |
| LLM | Two versioned system prompts, an OpenAI-compatible HTTP client, JSON output checks and a fallback (`backend/focusbuddy/llm/`) |
| UI | React + TypeScript with Vite (`frontend/`) |
| Storage | SQLite, only with consent, sessions expire after 14 days |
| Desktop | A small C# library that keeps the same counters (`desktop/`). It is not connected to the UI yet, so for now the numbers are typed in by hand. |
| Tests | 59 pytest tests for consent, storage, the policy, the prompts and the output checks. GitHub Actions also builds the UI, the C# library and the Docker image. |

## Run it

Needs Python 3.10+ and Node.js.

```bash
git clone https://github.com/pavankumar-chandankar/Automated-Focus-Enhancing-Companion.git
cd Automated-Focus-Enhancing-Companion
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
pytest -q
uvicorn focusbuddy.api.app:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Then open http://127.0.0.1:5173.

To use a real model instead of the mock, set these before starting the backend (see `.env.example`):

```bash
export FOCUSBUDDY_LLM_MODE=openai_compatible
export FOCUSBUDDY_LLM_BASE_URL=https://api.openai.com/v1
export FOCUSBUDDY_LLM_MODEL=<model name>
export FOCUSBUDDY_LLM_API_KEY=<your key>
```

You also have to tick "Allow sending my goal and note to an external model" in the UI. Without it nothing is sent.

## What it is not

- It has not been tested with users. The 2024 study was about the design, not this software.
- The default model is a mock that returns fixed text. I have not evaluated the prompts against a real model yet.
- The output checks are a JSON schema plus regex. They catch obvious problems but are not a full defence against prompt injection.
- It does not track anything in the background, and it does not try to guess how you feel.

## Repository

```
backend/focusbuddy/   API, policy, consent checks, prompts, LLM client, storage
frontend/             React UI
desktop/              C# counter library
tests/                pytest suite
evaluations/          hand-written model answers used to test the output checks
docs/                 API, architecture, prompts, study-to-code mapping
research/             notes on the 2024 MayDay study and personas
legacy/               the 2024 report and original scripts (not used by the app)
```

## Credits

MayDay (2024): Azarang Etemadi, Pavankumar Chandankar, Gururaj Shetty, University of Siegen.
