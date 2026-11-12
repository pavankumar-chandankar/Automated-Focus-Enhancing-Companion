"""End-to-end check of the API with the offline mock provider. No network access needed."""
import json
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from focusbuddy.api.app import create_app
from focusbuddy.config import Settings


def main():
    with tempfile.TemporaryDirectory() as tmp, TestClient(
        create_app(Settings(db_path=Path(tmp) / "test.sqlite3"))
    ) as client:
        assert client.get("/health").json()["ok"]
        session = client.post("/v1/sessions", json={"consent": {"participate": True}}).json()
        signal = {"elapsed_minutes": 25, "focused_minutes": 15, "idle_minutes": 3, "context_switch_count": 11}
        advice = client.post("/v1/coach", json={"session_id": session["id"], "signal": signal,
                                                "goal": "Finish writing", "prompt_variant": "evidence_v2"})
        assert advice.status_code == 200
        assert advice.json()["automated_action_taken"] is False
        assert client.delete("/v1/sessions/" + session["id"]).json()["deleted"]
        print(json.dumps({"result": "PASS", "provider": advice.json()["suggestion"]["provider"],
                          "session_deleted": True}, indent=2))


if __name__ == "__main__":
    main()
