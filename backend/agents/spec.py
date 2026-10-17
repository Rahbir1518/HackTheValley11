"""The building spec produced by the Interpreter Agent.

The LLM only extracts what the application text states (`Extraction`). Everything it
leaves out is filled by `complete_spec` using fixed, documented rules, and every
filled value is recorded as an Assumption. Guesses are never presented as facts.
"""
from typing import Literal

from pydantic import BaseModel, Field, model_validator

UseType = Literal["residential", "office", "mixed-use", "commercial", "institutional", "industrial", "other"]

# Estimation rules (shown to the user next to each assumption).
STOREY_HEIGHT = {"residential": 3.0, "office": 4.0, "mixed-use": 3.2, "commercial": 4.5,
                 "institutional": 4.0, "industrial": 6.0, "other": 3.3}
PODIUM_STOREY_HEIGHT = 4.5
DEFAULT_PODIUM_STOREYS = 6
DEFAULT_TOWER_SETBACK_M = 3.0
MAX_FLOORPLATE_M2 = 750.0
MIN_CONFIDENCE = 0.4


class ExtractedTower(BaseModel):
    storeys: int = Field(ge=1, le=120, description="Total storeys of this tower counted from the ground")
    height_m: float | None = Field(None, gt=0, le=600, description="Height in metres only if stated")


class Extraction(BaseModel):
    """What the application text actually says. Use null for anything not stated."""
    proposes_new_building: bool = Field(description="False for e.g. condo registration, lot severance, "
                                        "interior changes or demolition only")
    use_type: UseType
    total_storeys: int | None = Field(None, ge=1, le=120, description="Tallest part of the proposal")
    height_m: float | None = Field(None, gt=0, le=600, description="Overall height in metres only if stated")
    podium_storeys: int | None = Field(None, ge=0, le=20, description="Base building / podium storeys if stated")
    towers: list[ExtractedTower] = Field(default_factory=list, description="One entry per tower; empty for "
                                         "a single mid-rise or low-rise building with no podium/tower split")
    tower_setback_m: float | None = Field(None, ge=0, le=30)
    units: int | None = Field(None, ge=0, description="Dwelling units if stated")
    gfa_m2: float | None = Field(None, ge=0, description="Gross floor area if stated")
    stated_facts: list[str] = Field(default_factory=list, description="Short quotes from the text that support "
                                    "the numbers above")
    confidence: float = Field(ge=0, le=1, description="How sure you are the numbers describe the proposed building")
    notes: str = ""

    @model_validator(mode="after")
    def _consistent(self):
        if self.towers and self.total_storeys and self.total_storeys < max(t.storeys for t in self.towers):
            raise ValueError("total_storeys must be at least the tallest tower's storeys")
        if self.towers and self.podium_storeys and any(t.storeys <= self.podium_storeys for t in self.towers):
            raise ValueError("each tower's storeys must exceed podium_storeys (towers count from the ground)")
        return self


class Assumption(BaseModel):
    field: str
    value: str
    rule: str


class Tower(BaseModel):
    storeys: int
    height_m: float
    height_stated: bool


class BuildingSpec(BaseModel):
    use_type: UseType
    total_storeys: int
    height_m: float
    height_stated: bool
    storey_height_m: float
    podium_storeys: int
    podium_storey_height_m: float
    towers: list[Tower]
    tower_setback_m: float
    max_floorplate_m2: float
    units: int | None
    gfa_m2: float | None
    confidence: float
    stated_facts: list[str]
    assumptions: list[Assumption]


class SpecRejected(ValueError):
    """The application can't be modelled honestly (not a building, or too uncertain)."""


def complete_spec(x: Extraction) -> BuildingSpec:
    if not x.proposes_new_building:
        raise SpecRejected("The application text does not describe a new building to model.")
    if not x.total_storeys and not x.towers and not x.height_m:
        raise SpecRejected("The application text does not state a height or number of storeys.")
    if x.confidence < MIN_CONFIDENCE:
        raise SpecRejected(f"Confidence in the extracted numbers is too low ({x.confidence:.2f}).")

    assumptions: list[Assumption] = []
    storey_h = STOREY_HEIGHT[x.use_type]
    total = x.total_storeys or (max(t.storeys for t in x.towers) if x.towers else None)
    if total is None:  # only a height was stated
        total = max(1, round(x.height_m / storey_h))
        assumptions.append(Assumption(field="total_storeys", value=str(total),
                                      rule=f"stated height {x.height_m} m / {storey_h} m per storey"))

    towers_in = list(x.towers)
    if not towers_in and total >= 15:
        # Tall single buildings in Toronto are almost always podium + tower.
        towers_in = [ExtractedTower(storeys=total, height_m=x.height_m)]
        assumptions.append(Assumption(field="towers", value="1",
                                      rule="15+ storeys with no tower described: modelled as one tower on a podium"))

    podium = x.podium_storeys
    if towers_in and podium is None:
        podium = min(DEFAULT_PODIUM_STOREYS, min(t.storeys for t in towers_in) - 1)
        assumptions.append(Assumption(field="podium_storeys", value=str(podium),
                                      rule="not stated; typical Toronto podium of up to 6 storeys"))
    if not towers_in:
        podium = total  # a single mid/low-rise mass
    podium_h = PODIUM_STOREY_HEIGHT if towers_in else storey_h
    if towers_in:
        assumptions.append(Assumption(field="podium_storey_height_m", value=str(PODIUM_STOREY_HEIGHT),
                                      rule="taller ground floors are typical for podiums"))
    assumptions.append(Assumption(field="storey_height_m", value=str(storey_h),
                                  rule=f"typical floor-to-floor height for {x.use_type} buildings"))

    towers: list[Tower] = []
    for i, t in enumerate(towers_in):
        if t.height_m:
            towers.append(Tower(storeys=t.storeys, height_m=t.height_m, height_stated=True))
        else:
            h = round(podium * podium_h + (t.storeys - podium) * storey_h, 1)
            towers.append(Tower(storeys=t.storeys, height_m=h, height_stated=False))
            assumptions.append(Assumption(field=f"towers[{i}].height_m", value=f"{h}",
                                          rule="estimated from storeys x storey heights"))

    if x.height_m:
        height, stated = x.height_m, True
    elif towers:
        height, stated = max(t.height_m for t in towers), False
    else:
        height, stated = round(total * storey_h, 1), False
        assumptions.append(Assumption(field="height_m", value=f"{height}",
                                      rule=f"{total} storeys x {storey_h} m"))

    setback = x.tower_setback_m
    if towers and setback is None:
        setback = DEFAULT_TOWER_SETBACK_M
        assumptions.append(Assumption(field="tower_setback_m", value=str(setback),
                                      rule="Toronto Tall Building Guidelines: towers step back at least 3 m "
                                           "from the podium edge"))
    if towers:
        assumptions.append(Assumption(field="max_floorplate_m2", value=str(MAX_FLOORPLATE_M2),
                                      rule="Toronto Tall Building Guidelines: tower floorplates of about 750 m2"))
    assumptions.append(Assumption(field="footprint", value="property boundary",
                                  rule="the base building fills the lot; real setbacks from the street are unknown"))

    return BuildingSpec(
        use_type=x.use_type, total_storeys=total, height_m=height, height_stated=stated,
        storey_height_m=storey_h, podium_storeys=podium or 0, podium_storey_height_m=podium_h,
        towers=towers, tower_setback_m=setback or 0.0, max_floorplate_m2=MAX_FLOORPLATE_M2,
        units=x.units, gfa_m2=x.gfa_m2, confidence=x.confidence, stated_facts=x.stated_facts,
        assumptions=assumptions,
    )
