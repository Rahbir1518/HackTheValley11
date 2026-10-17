import asyncio

from backend.agents import qa

SOURCES = {
    "application:X": {"label": "Application X", "url": None, "content": {"description": "A 12-storey building"}},
    "ordis_spec": {"label": "Ordis interpretation", "url": None, "content": {"total_storeys": 12}},
}


class FakeProvider:
    def __init__(self, answers):
        self.answers, self.prompts = list(answers), []

    async def complete_json(self, system, user):
        self.prompts.append(user)
        return self.answers.pop(0)


def test_answer_must_cite_known_sources():
    fake = FakeProvider([
        {"answerable": True, "answer": "12 storeys.", "citations": [{"source": "wikipedia", "quote": "12"}]},
        {"answerable": True, "answer": "12 storeys.", "citations": []},
        {"answerable": True, "answer": "12 storeys.", "citations": [{"source": "application:X", "quote": "12-storey"}]},
    ])
    a = asyncio.run(qa.answer(fake, "How tall?", SOURCES, []))
    assert a.citations[0].source == "application:X"
    assert "unknown citation sources ['wikipedia']" in fake.prompts[1]
    assert "must cite at least one source" in fake.prompts[2]


def test_unanswerable_needs_no_citation():
    fake = FakeProvider([{"answerable": False, "answer": "That isn't in the application.", "citations": []}])
    a = asyncio.run(qa.answer(fake, "Will my rent go up?", SOURCES, []))
    assert not a.answerable
