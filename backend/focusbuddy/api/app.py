"""FastAPI prototype with consent gates, aggregate-only storage, and injectable providers."""
import hmac
import threading
import time

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from focusbuddy.config import Settings
from focusbuddy.domain.intervention import decide
from focusbuddy.domain.privacy import PrivacyViolation, validate_aggregate
from focusbuddy.domain.schemas import (
    ActionReceipt,
    ChoiceEvent,
    CoachRequest,
    CoachResponse,
    SessionCreate,
    SessionPublic,
    SignalReceipt,
)
from focusbuddy.llm.guardrails import GuardrailViolation, fallback_suggestion, parse_suggestion
from focusbuddy.llm.prompts import build_coach_messages
from focusbuddy.llm.provider import LLMProvider, ProviderError, provider_from_settings
from focusbuddy.storage.repository import Repository, SessionExpired, SessionNotFound


class StatusRequest(BaseModel):
    status: str = Field(pattern=r"^(active|paused|ended)$")


def create_app(settings: Settings | None = None, provider: LLMProvider | None = None) -> FastAPI:
    cfg = settings or Settings.from_env()
    app = FastAPI(title="Focus Buddy", version="0.3.0",
                  description="Consent-based focus assistant prototype with an optional LLM.")
    app.state.settings = cfg
    app.state.repo = Repository(cfg.db_path, cfg.retention_days)
    app.state.provider = provider or provider_from_settings(cfg)
    # Ephemeral, process-local intervention budget; never writes behavior to SQLite.
    # Production multi-replica deployments require a shared expiry-aware rate limiter.
    app.state.nudge_history = {}
    app.state.snooze_until = {}
    app.state.policy_lock = threading.Lock()
    app.add_middleware(CORSMiddleware,
                       allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                       allow_credentials=False, allow_methods=["GET", "POST", "DELETE"],
                       allow_headers=["Content-Type", "X-API-Key"])

    @app.middleware("http")
    async def hardening(request: Request, call_next):
        if request.headers.get("content-length"):
            try:
                if int(request.headers["content-length"]) > 25000:
                    return JSONResponse({"detail": "Request too large"}, status_code=413)
            except ValueError:
                return JSONResponse({"detail": "Malformed request length"}, status_code=400)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    def auth(x_api_key: str | None = Header(default=None)):
        if cfg.api_token and not hmac.compare_digest(x_api_key or "", cfg.api_token):
            raise HTTPException(401, "Invalid API token")

    def load_session(session_id: str) -> SessionPublic:
        try:
            return app.state.repo.get(session_id)
        except (SessionNotFound, SessionExpired):
            raise HTTPException(404, "Unknown or expired session") from None

    @app.get("/health")
    def health():
        return {"ok": True, "mode": cfg.llm_mode, "prototype": True}

    @app.get("/v1/capabilities", dependencies=[Depends(auth)])
    def capabilities():
        return {"contract_version": "2026-11-07", "provider_mode": cfg.llm_mode,
                "external_text_possible": cfg.llm_mode != "mock",
                "session_retention_days": cfg.retention_days,
                "privacy": "no keystrokes, window titles or raw user messages persisted"}

    @app.post("/v1/sessions", response_model=SessionPublic, status_code=201, dependencies=[Depends(auth)])
    def start_session(request: SessionCreate):
        return app.state.repo.create(request)

    @app.get("/v1/sessions/{session_id}", response_model=SessionPublic, dependencies=[Depends(auth)])
    def get_session(session_id: str):
        return load_session(session_id)

    @app.post("/v1/sessions/{session_id}/status", response_model=SessionPublic,
              dependencies=[Depends(auth)])
    def change_session_status(session_id: str, body: StatusRequest):
        load_session(session_id)
        try:
            return app.state.repo.update_status(session_id, body.status)
        except ValueError:
            raise HTTPException(409, "Cannot restart an ended session") from None

    @app.post("/v1/sessions/{session_id}/aggregate", response_model=SignalReceipt,
              dependencies=[Depends(auth)])
    async def submit_aggregate(session_id: str, request: Request):
        load_session(session_id)
        try:
            payload = await request.json()
            signal = validate_aggregate(payload)
            stored = app.state.repo.add_aggregate(session_id, signal)
        except (ValueError, PrivacyViolation):
            # Error must not echo sensitive submitted field names or contents.
            raise HTTPException(422, "Invalid aggregate payload or inactive session") from None
        return SignalReceipt(accepted=True, stored=stored, notice=(
            "Aggregate stored with your explicit consent" if stored else
            "Aggregate validated but NOT stored (local storage consent is disabled)"))

    @app.post("/v1/sessions/{session_id}/choices", response_model=ActionReceipt,
              dependencies=[Depends(auth)])
    def record_choice(session_id: str, event: ChoiceEvent):
        try:
            stored = app.state.repo.add_choice(session_id, event)
        except (SessionNotFound, SessionExpired):
            raise HTTPException(404, "Unknown session") from None
        except ValueError:
            raise HTTPException(409, "Session ended") from None
        if event.action == "snooze":
            snooze_seconds = load_session(session_id).preferences.snooze_minutes * 60
            with app.state.policy_lock:
                app.state.snooze_until[session_id] = time.monotonic() + snooze_seconds
        return ActionReceipt(recorded=stored, message="Recorded" if stored else "Not stored: consent disabled")

    @app.get("/v1/sessions/{session_id}/summary", dependencies=[Depends(auth)])
    def session_summary(session_id: str):
        load_session(session_id)
        return app.state.repo.summary(session_id)

    @app.delete("/v1/sessions/{session_id}", dependencies=[Depends(auth)])
    def delete_session(session_id: str):
        load_session(session_id)
        with app.state.policy_lock:
            app.state.nudge_history.pop(session_id, None)
            app.state.snooze_until.pop(session_id, None)
        return {"deleted": app.state.repo.delete(session_id)}

    @app.post("/v1/coach", response_model=CoachResponse, dependencies=[Depends(auth)])
    async def coach(request: CoachRequest):
        session = load_session(request.session_id)
        if session.status != "active":
            raise HTTPException(409, "Session is not active")
        try:
            request.signal.check_semantics()
        except ValueError:
            raise HTTPException(422, "Invalid aggregate values") from None
        with app.state.policy_lock:
            recent = [t for t in app.state.nudge_history.get(request.session_id, [])
                      if time.monotonic() - t < 3600]
            app.state.nudge_history[request.session_id] = recent
            snoozed = app.state.snooze_until.get(request.session_id, 0) > time.monotonic()
            policy = decide(request.signal, session.preferences, nudges_last_hour=len(recent),
                            snoozed=snoozed)
            if policy.offer:
                # Reserve the budget before asynchronous LLM work to close concurrency races.
                app.state.nudge_history[request.session_id].append(time.monotonic())
        if not policy.offer:
            safe = fallback_suggestion(request.prompt_variant)
            safe.title = "No nudge needed"
            safe.message = "You are in control. No intervention is recommended right now."
            safe.rationale = policy.reason
            return CoachResponse(suggestion=safe, safety_flags=["policy_suppressed"],
                                 text_sent_to_external_provider=False)
        external = cfg.llm_mode != "mock"
        if external and not session.consent.send_text_to_llm:
            raise HTTPException(409, "External LLM processing needs explicit opt-in consent")
        messages = build_coach_messages(request.prompt_variant, request.signal,
                                        request.goal, request.optional_note, session.preferences)
        try:
            raw = await app.state.provider.complete(messages)
            suggestion = parse_suggestion(raw, request.prompt_variant,
                                          app.state.provider.name)
            return CoachResponse(suggestion=suggestion,
                                 text_sent_to_external_provider=external)
        except (GuardrailViolation, ProviderError):
            return CoachResponse(suggestion=fallback_suggestion(request.prompt_variant),
                                 safety_flags=["provider_or_guardrail_fallback"],
                                 text_sent_to_external_provider=external)

    return app


app = create_app()
