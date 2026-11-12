"""LLM adapters: deterministic offline mock or explicit OpenAI-compatible endpoint.

No provider request is made unless the caller explicitly opts into external processing.
"""
import json
from typing import Protocol

import httpx

from focusbuddy.config import Settings


class ProviderError(RuntimeError):
    pass


class LLMProvider(Protocol):
    name: str
    async def complete(self, messages: list[dict]) -> str: ...


class MockProvider:
    name = "deterministic_mock_not_an_llm"

    async def complete(self, messages: list[dict]) -> str:
        data = json.loads(messages[-1]["content"])
        if "aggregate" not in data:
            raise ProviderError("The mock provider only answers coaching requests")
        signal = data["aggregate"]
        switches = signal["context_switch_count"]
        if switches >= 8:
            title, advice = "Optional reset", "Several switches were counted. Would a quiet ten-minute block help?"
        else:
            title, advice = "Check in", "You might choose to continue or take a short break."
        return json.dumps({
            "title": title, "message": advice,
            "rationale": "Based on the aggregate numbers you explicitly provided, not observed app content.",
            "choices": ["Try a short focus block", "Dismiss this suggestion", "Snooze"],
            "uncertainty": "Aggregate activity cannot reveal attention, wellbeing, or task quality.",
            "evidence": [f"Context switches: {switches}",
                         f"Elapsed minutes: {signal['elapsed_minutes']}"],
        })


class OpenAICompatibleProvider:
    name = "openai_compatible"

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings = settings
        self.client = client
        if not settings.llm_model or not settings.llm_api_key:
            raise ProviderError("Model and API key are mandatory for live provider mode")
        if not settings.llm_base_url.startswith("https://"):
            raise ProviderError("HTTPS is required for remote LLM providers")

    async def complete(self, messages: list[dict]) -> str:
        endpoint = self.settings.llm_base_url.rstrip("/") + "/chat/completions"
        payload = {"model": self.settings.llm_model, "messages": messages,
                   "temperature": 0.2, "max_tokens": 450,
                   "response_format": {"type": "json_object"}}
        try:
            if self.client is not None:
                response = await self.client.post(endpoint, json=payload, headers={
                    "Authorization": "Bearer " + self.settings.llm_api_key,
                    "Content-Type": "application/json",
                }, timeout=15.0)
            else:
                async with httpx.AsyncClient(follow_redirects=False, trust_env=False) as client:
                    response = await client.post(endpoint, json=payload, headers={
                        "Authorization": "Bearer " + self.settings.llm_api_key,
                        "Content-Type": "application/json",
                    }, timeout=15.0)
            response.raise_for_status()
            body = response.json()
            content = body["choices"][0]["message"]["content"]
            if not isinstance(content, str) or len(content) > 12000:
                raise ProviderError("Invalid model response length")
            return content
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as error:
            # Do not include request, raw model response, API key or submitted user text in logs/errors.
            raise ProviderError("LLM provider call failed or returned invalid JSON") from error


def provider_from_settings(settings: Settings) -> LLMProvider:
    if settings.llm_mode == "mock":
        return MockProvider()
    return OpenAICompatibleProvider(settings)
