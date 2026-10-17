import asyncio

import pytest

from backend.agents import builder
from backend.agents.spec import Extraction, complete_spec
from backend.llm.structured import ask_model

LOT = [(-40.0, -15.0), (40.0, -15.0), (40.0, 15.0), (-40.0, 15.0)]


def spec(**kw):
    base = dict(proposes_new_building=True, use_type="residential", confidence=0.9)
    return complete_spec(Extraction(**(base | kw)))


def test_fallback_plan_is_valid_and_matches_height():
    s = spec(total_storeys=30, podium_storeys=5, towers=[{"storeys": 30}])
    steps = builder.validate_steps(builder.fallback_steps(s), LOT, s)
    assert steps[0]["args"]["footprint"][0] == list(LOT[0])  # "LOT" resolved
    assert sum(1 for x in steps if x["tool"] == "add_tower") == 1


def test_two_towers_relax_separation_to_fit():
    s = spec(total_storeys=30, podium_storeys=4, towers=[{"storeys": 30}, {"storeys": 24}])
    steps = builder.relax_separation(builder.fallback_steps(s), LOT, s)
    assert sum(1 for x in steps if x["tool"] == "add_tower") == 2


def test_rejects_unknown_base_and_wrong_height():
    s = spec(total_storeys=20, podium_storeys=4, towers=[{"storeys": 20}])
    bad = [{"tool": "add_tower", "args": {"name": "T", "base": "Podium", "storeys": 16, "storey_height": 3}}]
    with pytest.raises(ValueError, match="does not exist"):
        builder.validate_steps(bad, LOT, s)
    short = [{"tool": "create_podium", "args": {"footprint": "LOT", "storeys": 4, "storey_height": 4.5}},
             {"tool": "add_tower", "args": {"name": "T", "base": "Podium", "storeys": 5, "storey_height": 3,
                                            "setback_m": 3}}]
    with pytest.raises(ValueError, match="spec height"):
        builder.validate_steps(short, LOT, s)


def test_rejects_unknown_args():
    s = spec(total_storeys=4)
    with pytest.raises(ValueError, match="unknown arguments"):
        builder.validate_steps([{"tool": "create_podium", "args": {"footprint": "LOT", "storeys": 4,
                                                                    "storey_height": 3, "colour": "red"}}], LOT, s)


class FakeProvider:
    """Returns canned answers in order; records what it was asked."""
    def __init__(self, answers):
        self.answers, self.prompts = list(answers), []

    async def complete_json(self, system, user):
        self.prompts.append(user)
        return self.answers.pop(0)


def test_builder_retries_with_validation_error_feedback():
    s = spec(total_storeys=10)
    bad = {"reasoning": "x", "steps": [{"tool": "create_podium",
                                        "args": {"footprint": "LOT", "storeys": 10, "storey_height": 9}}]}
    good = {"reasoning": "ok", "steps": [{"tool": "create_podium",
                                          "args": {"footprint": "LOT", "storeys": 10, "storey_height": 3.0}}]}
    fake = FakeProvider([bad, good])
    steps, reasoning, fell_back, _ = asyncio.run(builder.plan_proposal(fake, s, LOT, {}))
    assert not fell_back and reasoning == "ok"
    assert "storey_height must be a number between 2.5 and 8" in fake.prompts[1]
    assert steps[0]["args"]["storeys"] == 10


def test_builder_falls_back_when_model_never_valid():
    s = spec(total_storeys=10)
    fake = FakeProvider([{"steps": "nonsense"}] * 3)
    steps, _, fell_back, why = asyncio.run(builder.plan_proposal(fake, s, LOT, {}))
    assert fell_back and why
    assert steps[0]["tool"] == "create_podium"


def test_ask_model_validates_schema():
    fake = FakeProvider([{"app_number": 5}, {"app_number": "A", "reason": "near"}])
    from backend.agents.data_agent import Choice
    choice = asyncio.run(ask_model(fake, "s", "u", Choice))
    assert choice.app_number == "A"
