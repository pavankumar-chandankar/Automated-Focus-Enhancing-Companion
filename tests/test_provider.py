import asyncio
import json

import httpx
import pytest
from focusbuddy.config import Settings
from focusbuddy.llm.provider import (
    MockProvider,
    OpenAICompatibleProvider,
    ProviderError,
    provider_from_settings,
)


def test_mock_is_default():
    assert isinstance(provider_from_settings(Settings()),MockProvider)

def test_live_requires_key_and_model():
    with pytest.raises(ProviderError):
        OpenAICompatibleProvider(Settings(llm_mode='openai_compatible'))

def test_live_requires_tls():
    with pytest.raises(ProviderError):
        OpenAICompatibleProvider(Settings(llm_mode='openai_compatible',llm_api_key='test',
                                          llm_model='demo',llm_base_url='http://example.test/v1'))

def test_openai_compatible_http_contract_without_real_external_call():
    async def run():
        seen=[]
        def transport(req):
            seen.append((req.url.path, json.loads(req.content),req.headers.get('authorization')))
            return httpx.Response(200,json={'choices':[{'message':{'content':'{"title":"Test"}'}}]})
        cfg=Settings(llm_mode='openai_compatible',llm_api_key='TEST_FAKE_KEY',llm_model='demo-model')
        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            provider=OpenAICompatibleProvider(cfg,client=client)
            answer=await provider.complete([{'role':'system','content':'test'},{'role':'user','content':'sample'}])
        assert answer=='{"title":"Test"}'
        assert seen[0][0]=='/v1/chat/completions'
        assert seen[0][1]['model']=='demo-model'
        assert seen[0][2]=='Bearer TEST_FAKE_KEY'
    asyncio.run(run())

def test_openai_compatible_masks_failures():
    async def run():
        cfg=Settings(llm_mode='openai_compatible',llm_api_key='TEST_FAKE_KEY',llm_model='demo')
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req:httpx.Response(500,text='provider sensitive error'))) as c:
            with pytest.raises(ProviderError,match='provider call failed') as error:
                await OpenAICompatibleProvider(cfg,client=c).complete([{'role':'system','content':'x'}])
            assert 'TEST_FAKE_KEY' not in str(error.value)
    asyncio.run(run())
