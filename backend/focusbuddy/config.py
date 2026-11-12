"""Runtime settings; local and no-network modes are defaults."""
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    db_path: Path = Path("./var/focusbuddy.sqlite3")
    llm_mode: str = "mock"  # mock or openai_compatible
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = ""  # explicit provider/model selection; never hardcode a model version
    llm_api_key: str = ""
    api_token: str = ""  # optional for localhost dev; required in container deployment
    retention_days: int = 14
    max_concurrent_llm: int = 2

    @classmethod
    def from_env(cls) -> "Settings":
        mode = os.getenv("FOCUSBUDDY_LLM_MODE", "mock")
        if mode not in {"mock", "openai_compatible"}:
            raise ValueError("Invalid FOCUSBUDDY_LLM_MODE")
        days = int(os.getenv("FOCUSBUDDY_RETENTION_DAYS", "14"))
        if not 1 <= days <= 90:
            raise ValueError("Retention must be 1-90 days")
        return cls(
            db_path=Path(os.getenv("FOCUSBUDDY_DB_PATH", "./var/focusbuddy.sqlite3")),
            llm_mode=mode,
            llm_base_url=os.getenv("FOCUSBUDDY_LLM_BASE_URL", "https://api.openai.com/v1"),
            llm_model=os.getenv("FOCUSBUDDY_LLM_MODEL", ""),
            llm_api_key=os.getenv("FOCUSBUDDY_LLM_API_KEY", ""),
            api_token=os.getenv("FOCUSBUDDY_API_TOKEN", ""),
            retention_days=days,
        )
