"""Tiny provider interface over free-tier LLM APIs.

Every provider exposes one call: `complete_json(system, user) -> dict`. We ask for JSON
output (JSON mode) and validate with Pydantic in the agents, feeding validation errors
back for a retry. Switch providers with LLM_PROVIDER=gemini|groq|openrouter.
"""
import asyncio
import json
import os
import random

import httpx


class LLMError(RuntimeError):
    pass


class LLMConfigError(LLMError):
    """Bad key, unknown model, etc. Retrying won't help, so callers stop immediately."""


class LLMProvider:
    name = "base"

    def __init__(self, api_key: str, model: str):
        if not api_key:
            raise LLMConfigError(f"{self.name}: API key missing (set it in .env)")
        self.api_key, self.model = api_key, model

    async def _post(self, url: str, payload: dict, headers: dict) -> dict:
        """POST with retry + exponential backoff on rate limits and server errors."""
        delay = 2.0
        for attempt in range(6):
            try:
                async with httpx.AsyncClient(timeout=90) as client:
                    r = await client.post(url, json=payload, headers=headers)
            except httpx.HTTPError as e:
                if attempt == 5:
                    raise LLMError(f"{self.name}: network error {e!r}")
                await asyncio.sleep(delay)
                delay *= 2
                continue
            if r.status_code == 429 or r.status_code >= 500:
                if attempt == 5:
                    raise LLMError(f"{self.name}: HTTP {r.status_code} after retries: {r.text[:300]}")
                retry_after = r.headers.get("retry-after")
                wait = float(retry_after) if retry_after and retry_after.replace(".", "").isdigit() else delay
                await asyncio.sleep(min(wait, 60) + random.uniform(0, 0.5))
                delay *= 2
                continue
            if r.status_code in (401, 403, 404):
                raise LLMConfigError(f"{self.name} ({self.model}): HTTP {r.status_code}: {r.text[:500]}")
            if r.status_code >= 400:
                raise LLMError(f"{self.name}: HTTP {r.status_code}: {r.text[:500]}")
            return r.json()
        raise LLMError(f"{self.name}: retries exhausted")

    async def complete_json(self, system: str, user: str) -> dict:
        raise NotImplementedError

    @staticmethod
    def parse_json(text: str) -> dict:
        text = (text or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            text = text[text.find("{"):]
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start, end = text.find("{"), text.rfind("}")
            if start >= 0 and end > start:
                return json.loads(text[start:end + 1])
            raise LLMError(f"model did not return JSON: {text[:200]}")


class GeminiProvider(LLMProvider):
    name = "gemini"

    async def complete_json(self, system: str, user: str) -> dict:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1},
        }
        data = await self._post(url, payload, {"x-goog-api-key": self.api_key})
        try:
            text = "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
        except (KeyError, IndexError):
            raise LLMError(f"gemini: unexpected response {json.dumps(data)[:300]}")
        return self.parse_json(text)


class OpenAICompatibleProvider(LLMProvider):
    """Groq and OpenRouter both speak the OpenAI chat-completions protocol."""
    base_url = ""

    async def complete_json(self, system: str, user: str) -> dict:
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
        }
        data = await self._post(f"{self.base_url}/chat/completions", payload,
                                {"Authorization": f"Bearer {self.api_key}"})
        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError):
            raise LLMError(f"{self.name}: unexpected response {json.dumps(data)[:300]}")
        return self.parse_json(text)


class GroqProvider(OpenAICompatibleProvider):
    name = "groq"
    base_url = "https://api.groq.com/openai/v1"


class OpenRouterProvider(OpenAICompatibleProvider):
    name = "openrouter"
    base_url = "https://openrouter.ai/api/v1"


PROVIDERS = {
    "gemini": (GeminiProvider, "GEMINI_API_KEY", "GEMINI_MODEL", "gemini-3.8-flash"),
    "groq": (GroqProvider, "GROQ_API_KEY", "GROQ_MODEL", "llama-3.3-70b-versatile"),
    "openrouter": (OpenRouterProvider, "OPENROUTER_API_KEY", "OPENROUTER_MODEL",
                   "meta-llama/llama-3.3-70b-instruct:free"),
}


def get_provider() -> LLMProvider:
    name = os.getenv("LLM_PROVIDER", "gemini").lower()
    if name not in PROVIDERS:
        raise LLMError(f"unknown LLM_PROVIDER '{name}'; choose one of {sorted(PROVIDERS)}")
    cls, key_var, model_var, default_model = PROVIDERS[name]
    return cls(os.getenv(key_var, ""), os.getenv(model_var) or default_model)


def provider_status() -> dict:
    name = os.getenv("LLM_PROVIDER", "gemini").lower()
    entry = PROVIDERS.get(name)
    if not entry:
        return {"provider": name, "model": None, "configured": False}
    _, key_var, model_var, default_model = entry
    return {"provider": name, "model": os.getenv(model_var) or default_model, "configured": bool(os.getenv(key_var))}
