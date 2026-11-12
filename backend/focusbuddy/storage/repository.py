"""SQLite prototype store: pseudonymous sessions and consent-gated aggregates only.

No raw text, prompts, keystrokes, window names or message bodies are persisted.
"""
import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from focusbuddy.domain.schemas import AggregateSignal, ChoiceEvent, SessionCreate, SessionPublic


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class SessionNotFound(LookupError):
    pass


class SessionExpired(LookupError):
    pass


class Repository:
    def __init__(self, db_path: Path, retention_days: int = 14):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.retention_days = retention_days
        self._init_schema()

    def _connect(self):
        db = sqlite3.connect(self.db_path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=10000")
        return db

    def _init_schema(self):
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    consent_json TEXT NOT NULL,
                    preferences_json TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('active','paused','ended'))
                );
                CREATE TABLE IF NOT EXISTS aggregates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    captured_at TEXT NOT NULL,
                    elapsed_minutes REAL NOT NULL,
                    focused_minutes REAL NOT NULL,
                    idle_minutes REAL NOT NULL,
                    context_switch_count INTEGER NOT NULL,
                    self_report_energy INTEGER,
                    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS choices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    captured_at TEXT NOT NULL,
                    action TEXT NOT NULL,
                    intervention_id TEXT NOT NULL,
                    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
            """)

    def create(self, request: SessionCreate) -> SessionPublic:
        self.purge_expired()
        started = now_utc()
        session = SessionPublic(
            id=str(uuid.uuid4()),
            created_at=started.isoformat(),
            expires_at=(started + timedelta(days=self.retention_days)).isoformat(),
            consent=request.consent, preferences=request.preferences,
        )
        with self._connect() as db:
            db.execute("""INSERT INTO sessions
                (id, created_at, expires_at, consent_json, preferences_json, status)
                VALUES (?, ?, ?, ?, ?, ?)""", (
                session.id, session.created_at, session.expires_at,
                session.consent.model_dump_json(), session.preferences.model_dump_json(), session.status,
            ))
        return session

    def get(self, session_id: str) -> SessionPublic:
        with self._connect() as db:
            row = db.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        if row is None:
            raise SessionNotFound("Session not found")
        if datetime.fromisoformat(row["expires_at"]) <= now_utc():
            self.delete(session_id)
            raise SessionExpired("Session expired and was deleted")
        return SessionPublic.model_validate({
            "id": row["id"], "created_at": row["created_at"],
            "expires_at": row["expires_at"],
            "consent": json.loads(row["consent_json"]),
            "preferences": json.loads(row["preferences_json"]),
            "status": row["status"],
        })

    def update_status(self, session_id: str, status: str) -> SessionPublic:
        if status not in {"active", "paused", "ended"}:
            raise ValueError("Invalid status")
        current = self.get(session_id)
        if current.status == "ended" and status != "ended":
            raise ValueError("Ended sessions cannot restart")
        with self._connect() as db:
            db.execute("UPDATE sessions SET status=? WHERE id=?", (status, session_id))
        return self.get(session_id)

    def add_aggregate(self, session_id: str, signal: AggregateSignal) -> bool:
        current = self.get(session_id)
        if current.status != "active":
            raise ValueError("Only active sessions accept aggregates")
        signal.check_semantics()
        if not current.consent.local_aggregate_storage:
            return False
        with self._connect() as db:
            db.execute("""INSERT INTO aggregates
                (session_id,captured_at,elapsed_minutes,focused_minutes,idle_minutes,
                 context_switch_count,self_report_energy)
                VALUES (?,?,?,?,?,?,?)""", (
                session_id, now_utc().isoformat(), signal.elapsed_minutes,
                signal.focused_minutes, signal.idle_minutes, signal.context_switch_count,
                signal.self_report_energy,
            ))
        return True

    def add_choice(self, session_id: str, event: ChoiceEvent) -> bool:
        current = self.get(session_id)
        if current.status == "ended":
            raise ValueError("Ended session")
        if not current.consent.local_aggregate_storage:
            return False
        with self._connect() as db:
            db.execute("INSERT INTO choices (session_id,captured_at,action,intervention_id) VALUES (?,?,?,?)",
                       (session_id, now_utc().isoformat(), event.action, event.intervention_id))
        return True

    def summary(self, session_id: str) -> dict:
        self.get(session_id)
        with self._connect() as db:
            totals = db.execute("""SELECT COUNT(*) AS n,
                COALESCE(AVG(focused_minutes),0) AS avg_focus,
                COALESCE(SUM(context_switch_count),0) AS switches
                FROM aggregates WHERE session_id=?""", (session_id,)).fetchone()
            rows = db.execute("SELECT action,COUNT(*) AS n FROM choices WHERE session_id=? GROUP BY action",
                              (session_id,)).fetchall()
        return {"aggregate_windows": totals["n"], "mean_focused_minutes": round(totals["avg_focus"], 2),
                "total_context_switches": totals["switches"], "choices": {r["action"]: r["n"] for r in rows}}

    def delete(self, session_id: str) -> bool:
        with self._connect() as db:
            cur = db.execute("DELETE FROM sessions WHERE id=?", (session_id,))
            return cur.rowcount > 0

    def purge_expired(self) -> int:
        with self._connect() as db:
            cur = db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now_utc().isoformat(),))
            return cur.rowcount
