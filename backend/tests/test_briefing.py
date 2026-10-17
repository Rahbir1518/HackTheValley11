import datetime as dt
import re

from backend import briefing

SPEC = {
    "use_type": "residential", "total_storeys": 30, "height_m": 95.0, "height_stated": False, "storey_height_m": 3.0,
    "podium_storeys": 6, "podium_storey_height_m": 4.5, "towers": [{"storeys": 30, "height_m": 95.0, "height_stated": False}],
    "tower_setback_m": 3.0, "units": 412, "gfa_m2": None, "confidence": 0.8,
    "stated_facts": ["a 30-storey residential building with 412 units"],
    "assumptions": [{"field": "podium_storeys", "value": "6", "rule": "typical"},
                    {"field": "towers[0].height_m", "value": "95.0", "rule": "storeys x heights"}],
}


def _facts(**over):
    facts = {
        "application": {"address": "1 Example St", "app_number": "26 000001 STE 10 OZ", "type_name": "Rezoning",
                        "status": "Under Review", "date_submitted": "2026-01-05"},
        "spec": SPEC,
        "narration": {"headline": "A 30-storey residential tower is proposed.", "summary": "It has **412 homes**.\n\nSecond."},
        "involved": {"planner": {"name": "DOE, JANE", "email": "jane.doe@toronto.ca", "phone": None},
                     "upcoming_meetings": [], "past_meetings": [{"date": "2026-03-02", "time": None}],
                     "application_url": "https://example.org/app"},
        "sunlight": {"date": "2026-03-21", "stats": {"area_lost_1h_m2": 1200, "max_hours_lost": 3.5,
                                                    "worst_point": {"sun_today_h": 8.0, "sun_with_h": 4.5}},
                     "affected_parcels": [{"mean_hours_lost": 1.25, "address": "3 Example St"}]},
        "limitations": ["Massing only."],
        "sources": [{"title": "Development Applications"}],
    }
    return facts | over


def test_stated_and_estimated_are_kept_apart():
    rows = dict(briefing.stated_rows(SPEC))
    assert rows["Storeys"] == "30" and rows["Homes"] == "412" and "Height" not in rows  # height was estimated
    lines = briefing.estimated_lines(SPEC)
    assert any("≈95 m" in line for line in lines) and any("Podium of 6" in line for line in lines)


def test_renders_one_page_pdf_with_and_without_optional_parts():
    for facts in (_facts(), _facts(spec=None, narration=None, sunlight=None)):
        pdf = briefing.render(facts, None, today=dt.date(2026, 10, 17))
        assert pdf.startswith(b"%PDF")
        assert len(re.findall(rb"/Type\s*/Page[^s]", pdf)) == 1


def test_planner_name_reads_naturally():
    assert briefing._planner_name("DOE, JANE") == "JANE DOE"
    assert briefing._hours(1.25) == "1 h 15 min" and briefing._hours(0.5) == "30 min"


def test_site_section_quotes_the_application_and_the_rule():
    site = {"rentals": [{"address": "240 Wellesley St E", "units": 554, "year_built": 1971}],
            "heritage": {"on_site": []}, "rental_mentions": ["27 existing rental dwelling units would be replaced."],
            "rental_rule": "Rental homes must be replaced.", "heritage_note": "n/a"}
    pdf = briefing.render(_facts(site=site), None, today=dt.date(2026, 10, 17))
    assert len(re.findall(rb"/Type\s*/Page[^s]", pdf)) == 1
