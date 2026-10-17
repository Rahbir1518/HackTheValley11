"""Tiny provider interface over free-tier LLM APIs.

Every provider exposes one call: `complete_json(system, user) -> dict`. We ask for JSON
output (JSON mode) and validate with Pydantic in the agents, feeding validation errors
back for a retry. Switch providers with LLM_PROVIDER=gemini|groq|openrouter, and list
backups in LLM_FALLBACKS (e.g. "groq,openrouter") to switch automatically when a free
tier's quota runs out.
"""
import asyncio
import json
import os
import random
import time

import httpx


class LLMError(RuntimeError):
    pass


class LLMConfigError(LLMError):
    """Bad key, unknown model, etc. Retrying won't help, so callers stop immediately."""


class LLMQuotaError(LLMConfigError):
    """Quota used up for a long time (e.g. a free tier's daily limit): switch provider instead of waiting."""


def _retry_seconds(r: httpx.Response) -> float | None:
    """How long the API asks us to wait: Retry-After header or Gemini's RetryInfo.retryDelay ("71451s")."""
    header = r.headers.get("retry-after")
    if header and header.replace(".", "").isdigit():
        return float(header)
    try:
        for d in r.json().get("error", {}).get("details", []):
            if str(d.get("retryDelay", "")).endswith("s"):
                return float(d["retryDelay"][:-1])
    except (ValueError, AttributeError):
        pass
    return None


class LLMProvider:
    name = "base"

    def __init__(self, api_key: str, model: str):
        if not api_key:
            raise LLMConfigError(f"{self.name}: API key missing (set it in .env)")
        self.api_key, self.model = api_key, model

    async def _post(self, url: str, payload: dict, headers: dict) -> dict:
        """POST with retry + exponential backoff on short rate limits and server errors.
        Long waits (daily quotas) raise LLMQuotaError right away so a fallback provider can answer."""
        delay, attempts = 2.0, 4
        for attempt in range(attempts):
            last = attempt == attempts - 1
            try:
                async with httpx.AsyncClient(timeout=90) as client:
                    r = await client.post(url, json=payload, headers=headers)
            except httpx.HTTPError as e:
                if last:
                    raise LLMError(f"{self.name}: network error {e!r}")
                await asyncio.sleep(delay)
                delay *= 2
                continue
            if r.status_code == 429:
                wait = _retry_seconds(r)
                if (wait is not None and wait > 30) or "PerDay" in r.text or last:
                    when = f" (retry in {wait / 3600:.1f} h)" if wait and wait > 3600 else ""
                    raise LLMQuotaError(f"{self.name} ({self.model}): rate limit / quota reached{when}")
                await asyncio.sleep((wait or delay) + random.uniform(0, 0.5))
                delay *= 2
                continue
            if r.status_code >= 500:
                if last:
                    raise LLMError(f"{self.name}: HTTP {r.status_code} after retries: {r.text[:300]}")
                await asyncio.sleep(delay + random.uniform(0, 0.5))
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
    json_mode = True  # some free OpenRouter models reject response_format; they get JSON via the prompt

    async def complete_json(self, system: str, user: str) -> dict:
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system + "\nAnswer with a single JSON object only."},
                         {"role": "user", "content": user}],
            "temperature": 0.1,
        }
        if self.json_mode:
            payload["response_format"] = {"type": "json_object"}
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
    json_mode = False


# Free-tier model IDs change often; override with *_MODEL in .env.
PROVIDERS = {
    "gemini": (GeminiProvider, "GEMINI_API_KEY", "GEMINI_MODEL", "gemini-3.8-flash"),
    "groq": (GroqProvider, "GROQ_API_KEY", "GROQ_MODEL", "openai/gpt-oss-120b"),
    "openrouter": (OpenRouterProvider, "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "google/gemma-4-31b-it:free"),
}


# Providers whose quota ran out, skipped until the given time (process lifetime only).
_exhausted: dict[str, float] = {}
EXHAUSTED_FOR_S = 3600


class ChainProvider(LLMProvider):
    """LLM_PROVIDER first, then each LLM_FALLBACKS entry, moving on when one is out of quota."""

    def __init__(self, providers: list[LLMProvider]):
        self.providers = providers
        self.name = providers[0].name
        self.model = providers[0].model
        self.notes: list[str] = []  # provider switches, surfaced in the agent console

    async def complete_json(self, system: str, user: str) -> dict:
        last: LLMError | None = None
        for p in self.providers:
            if _exhausted.get(p.name, 0) > time.time():
                continue
            try:
                result = await p.complete_json(system, user)
                if p is not self.providers[0]:
                    self.notes.append(f"answered by fallback provider {p.name} ({p.model})")
                return result
            except LLMConfigError as e:  # out of quota, bad key or retired model: try the next one
                _exhausted[p.name] = time.time() + EXHAUSTED_FOR_S
                self.notes.append(f"{str(e)[:200]}; switching provider")
                last = e
        raise last or LLMQuotaError("every configured LLM provider is out of quota")


def _make(name: str) -> LLMProvider:
    if name not in PROVIDERS:
        raise LLMConfigError(f"unknown LLM provider '{name}'; choose from {sorted(PROVIDERS)}")
    cls, key_var, model_var, default_model = PROVIDERS[name]
    return cls(os.getenv(key_var, ""), os.getenv(model_var) or default_model)


def _chain_names() -> list[str]:
    primary = os.getenv("LLM_PROVIDER", "gemini").lower()
    fallbacks = [n.strip().lower() for n in os.getenv("LLM_FALLBACKS", "").split(",") if n.strip()]
    return [primary] + [n for n in fallbacks if n != primary]


def get_provider() -> LLMProvider:
    """The primary provider plus any fallbacks that have a key configured."""
    names = _chain_names()
    providers = [_make(names[0])]  # the primary must be configured
    for n in names[1:]:
        try:
            providers.append(_make(n))
        except LLMConfigError:
            pass  # fallback without a key: skip
    return ChainProvider(providers)


def provider_status() -> dict:
    names = _chain_names()
    entries = [(n, PROVIDERS.get(n)) for n in names]
    configured = [n for n, e in entries if e and os.getenv(e[1])]
    primary = entries[0][1]
    return {
        "provider": names[0],
        "model": (os.getenv(primary[2]) or primary[3]) if primary else None,
        "configured": names[0] in configured,
        "fallbacks": [n for n in configured if n != names[0]],
        "exhausted": [n for n, until in _exhausted.items() if until > time.time()],
    }
