"""Ask for JSON, validate with Pydantic, feed errors back and retry."""
import json
from typing import Awaitable, Callable, TypeVar

from pydantic import BaseModel, ValidationError

from .providers import LLMError, LLMProvider

T = TypeVar("T", bound=BaseModel)


async def ask_model(
    provider: LLMProvider,
    system: str,
    user: str,
    model: type[T],
    on_attempt: Callable[[int, dict | None, str | None], Awaitable[None]] | None = None,
    extra_check: Callable[[T], None] | None = None,
    attempts: int = 3,
) -> T:
    """Returns a validated `model`. `extra_check` may raise ValueError for semantic problems
    (e.g. a build step that fails geometry validation); its message is sent back too."""
    schema = json.dumps(model.model_json_schema(), separators=(",", ":"))
    prompt = f"{user}\n\nReturn only a JSON object matching this JSON Schema:\n{schema}"
    last_error = None
    for i in range(attempts):
        message = prompt if last_error is None else (
            f"{prompt}\n\nYour previous answer was rejected:\n{last_error}\nFix it and answer again.")
        raw = None
        try:
            raw = await provider.complete_json(system, message)
            result = model.model_validate(raw)
            if extra_check:
                extra_check(result)
            if on_attempt:
                await on_attempt(i + 1, raw, None)
            return result
        except (ValidationError, ValueError, LLMError) as e:
            if isinstance(e, LLMError) and "API key missing" in str(e):
                raise
            last_error = str(e)[:1500]
            if on_attempt:
                await on_attempt(i + 1, raw, last_error)
    raise LLMError(f"no valid answer after {attempts} attempts: {last_error}")
