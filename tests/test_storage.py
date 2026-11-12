import sqlite3

import pytest
from focusbuddy.domain.schemas import AggregateSignal, ChoiceEvent, Consent, SessionCreate
from focusbuddy.storage.repository import Repository, SessionNotFound


def test_session_created_and_deleted(tmp_path):
    repo=Repository(tmp_path/'db.sqlite')
    session=repo.create(SessionCreate(consent=Consent(participate=True)))
    assert repo.get(session.id).id == session.id
    assert repo.delete(session.id)
    with pytest.raises(SessionNotFound): repo.get(session.id)

def test_storage_requires_explicit_consent(tmp_path):
    repo=Repository(tmp_path/'db.sqlite')
    s=repo.create(SessionCreate(consent=Consent(participate=True)))
    sample=AggregateSignal(elapsed_minutes=25,focused_minutes=15,idle_minutes=4,context_switch_count=4)
    assert repo.add_aggregate(s.id,sample) is False
    assert repo.summary(s.id)['aggregate_windows']==0
    assert repo.add_choice(s.id,ChoiceEvent(action='dismiss', intervention_id='v1')) is False

def test_consented_aggregates_and_choices(tmp_path):
    repo=Repository(tmp_path/'db.sqlite')
    s=repo.create(SessionCreate(consent=Consent(participate=True,local_aggregate_storage=True)))
    sample=AggregateSignal(elapsed_minutes=25,focused_minutes=15,idle_minutes=4,context_switch_count=4)
    assert repo.add_aggregate(s.id,sample) is True
    assert repo.add_choice(s.id,ChoiceEvent(action='dismiss',intervention_id='v1'))
    summary=repo.summary(s.id)
    assert summary['aggregate_windows']==1
    assert summary['choices']=={'dismiss':1}
    repo.delete(s.id)
    with sqlite3.connect(repo.db_path) as db:
        assert db.execute('SELECT COUNT(*) FROM aggregates').fetchone()[0]==0
        assert db.execute('SELECT COUNT(*) FROM choices').fetchone()[0]==0

def test_private_user_text_is_never_schema_column(tmp_path):
    repo=Repository(tmp_path/'db.sqlite')
    with sqlite3.connect(repo.db_path) as db:
        all_tables=' '.join(r[0] for r in db.execute("SELECT sql FROM sqlite_master WHERE type='table'") if r[0])
    assert 'keystroke' not in all_tables
    assert 'window_title' not in all_tables
    assert 'prompt_text' not in all_tables

def test_ended_session_rejects_aggregate(tmp_path):
    repo=Repository(tmp_path/'db.sqlite')
    s=repo.create(SessionCreate(consent=Consent(participate=True,local_aggregate_storage=True)))
    repo.update_status(s.id,'ended')
    with pytest.raises(ValueError):repo.add_aggregate(s.id,AggregateSignal(
        elapsed_minutes=5,focused_minutes=3,idle_minutes=1,context_switch_count=1))
    with pytest.raises(ValueError):repo.update_status(s.id,'active')
