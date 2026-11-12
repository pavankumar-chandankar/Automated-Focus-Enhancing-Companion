import pytest
from fastapi.testclient import TestClient
from focusbuddy.api.app import create_app
from focusbuddy.config import Settings
from focusbuddy.llm.provider import MockProvider


@pytest.fixture
def settings(tmp_path):
    return Settings(db_path=tmp_path / 'state.db', retention_days=14, llm_mode='mock')


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings, MockProvider())) as client:
        yield client


@pytest.fixture
def session_payload():
    return {'consent': {'participate': True, 'local_aggregate_storage': False,
                        'send_text_to_llm': False, 'show_safety_warnings': True},
            'preferences': {'intervention_style': 'reflective',
                            'focus_minutes':25, 'break_minutes':5,
                            'maximum_nudges_per_hour':2, 'snooze_minutes':15,
                            'accessibility_reduce_motion':False,
                            'accessibility_high_contrast':False}}


@pytest.fixture
def signal_payload():
    return {'elapsed_minutes':25, 'focused_minutes':15, 'idle_minutes':3,
            'context_switch_count':11, 'self_report_energy':3}
