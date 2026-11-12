from fastapi.testclient import TestClient
from focusbuddy.api.app import create_app
from focusbuddy.config import Settings
from focusbuddy.llm.provider import MockProvider


class RecordingProvider(MockProvider):
    def __init__(self):self.calls=[]
    async def complete(self,messages):
        self.calls.append(messages)
        return await super().complete(messages)

def test_live_mode_cannot_send_text_without_consent(tmp_path):
    cfg=Settings(db_path=tmp_path/'a.sqlite3',llm_mode='openai_compatible',
                 llm_api_key='TEST_DUMMY',llm_model='fake_model')
    provider=RecordingProvider()
    with TestClient(create_app(cfg,provider=provider)) as client:
        session=client.post('/v1/sessions',json={'consent':{'participate':True,'send_text_to_llm':False}}).json()
        sid=session['id']
        signal={'elapsed_minutes':25,'focused_minutes':10,'idle_minutes':3,'context_switch_count':11}
        response=client.post('/v1/coach',json={'session_id':sid,'signal':signal,
                                                 'optional_note':'private notes','goal':'study'})
        assert response.status_code==409
        assert provider.calls==[]

def test_live_mode_consent_sends_only_explicitly_submitted_text(tmp_path):
    cfg=Settings(db_path=tmp_path/'a.sqlite3',llm_mode='openai_compatible',
                 llm_api_key='TEST_DUMMY',llm_model='fake_model')
    provider=RecordingProvider()
    with TestClient(create_app(cfg,provider=provider)) as client:
        session=client.post('/v1/sessions',json={'consent':{'participate':True,'send_text_to_llm':True}}).json()
        signal={'elapsed_minutes':25,'focused_minutes':10,'idle_minutes':3,'context_switch_count':11}
        response=client.post('/v1/coach',json={'session_id':session['id'],'signal':signal,
                                            'optional_note':'I like quiet work','goal':'Study'})
        assert response.status_code==200
        assert response.json()['text_sent_to_external_provider']
        assert len(provider.calls)==1
        assert 'I like quiet work' in provider.calls[0][-1]['content']
        assert 'I like quiet work' not in provider.calls[0][0]['content']
