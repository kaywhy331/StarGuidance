from __future__ import annotations

from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProfileRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    full_birth_name: str = Field(min_length=1, max_length=200)
    birth_date: date
    birthplace: str | None = Field(default=None, min_length=2, max_length=200)
    birth_time: time | None = None

    @model_validator(mode="after")
    def validate_birth_date(self) -> ProfileRequest:
        if self.birth_date > date.today():
            raise ValueError("Birth date cannot be in the future")
        return self


class NumerologyResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    name_calculation_status: Literal["available", "unavailable"]
    life_path: int
    expression: int | None
    soul_urge: int | None
    personality: int | None
    birthday: int
    name_rendering: str | None
    transformation: str
    algorithm_version: str


class DreamspellResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    kin: int
    tone: int
    tone_name: str
    solar_seal: int
    solar_seal_name: str
    color: str
    algorithm_version: str
    certification_status: str


class NineStarKiStar(BaseModel):
    model_config = ConfigDict(frozen=True)

    number: int = Field(ge=1, le=9)
    phase: Literal["water", "earth", "wood", "metal", "fire"]


class NineStarKiResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    principal_star: NineStarKiStar
    character_star: NineStarKiStar
    energy_star: NineStarKiStar
    boundary_convention: str
    third_star_convention: str
    algorithm_version: str
    interpretation_version: str
    certification_status: str


class UnavailableResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: Literal["unavailable"] = "unavailable"
    capability: str
    reason: str
    calculation_version: str
    activation_requirements: tuple[str, ...]


class WesternAstrologyUnavailable(UnavailableResult):
    capability: Literal["western_astrology"] = "western_astrology"
    calculation_version: Literal["western-astrology-contract-v1"] = "western-astrology-contract-v1"


class BaziUnavailable(UnavailableResult):
    capability: Literal["bazi_four_pillars"] = "bazi_four_pillars"
    calculation_version: Literal["bazi-contract-v1"] = "bazi-contract-v1"


class PlanetaryAngularityUnavailable(UnavailableResult):
    capability: Literal["planetary_angularity_map"] = "planetary_angularity_map"
    calculation_version: Literal["planetary-angularity-contract-v1"] = (
        "planetary-angularity-contract-v1"
    )


class CalculationEvidence(BaseModel):
    model_config = ConfigDict(frozen=True)

    engine_name: str
    engine_version: str
    data_version: str
    convention_version: str
    source_attribution: tuple[str, ...] = Field(min_length=1)


class CalculationUncertainty(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: Literal["stable", "uncertain"]
    reasons: tuple[str, ...]


class ResolvedCalculationContext(BaseModel):
    model_config = ConfigDict(frozen=True)

    instant_utc: datetime
    timezone_id: str
    utc_offset_seconds: int = Field(ge=-64_800, le=64_800)
    latitude_degrees: float = Field(ge=-90, le=90)
    longitude_degrees: float = Field(ge=-180, le=180)
    resolution_method: str


type ZodiacSign = Literal[
    "aries",
    "taurus",
    "gemini",
    "cancer",
    "leo",
    "virgo",
    "libra",
    "scorpio",
    "sagittarius",
    "capricorn",
    "aquarius",
    "pisces",
]
type CelestialBody = Literal[
    "sun",
    "moon",
    "mercury",
    "venus",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
    "pluto",
    "north_node",
    "south_node",
    "chiron",
]


class EclipticPoint(BaseModel):
    model_config = ConfigDict(frozen=True)

    longitude_degrees: float = Field(ge=0, lt=360)
    sign: ZodiacSign
    degree_in_sign: float = Field(ge=0, lt=30)


class WesternPlanetaryPosition(EclipticPoint):
    body: CelestialBody
    latitude_degrees: float = Field(ge=-90, le=90)
    retrograde: bool


class WesternAspect(BaseModel):
    model_config = ConfigDict(frozen=True)

    body_a: CelestialBody
    body_b: CelestialBody
    aspect: Literal["conjunction", "opposition", "trine", "square", "sextile", "quincunx"]
    exact_angle_degrees: float = Field(ge=0, le=180)
    orb_degrees: float = Field(ge=0, le=30)
    applying: bool | None


class HouseCusp(EclipticPoint):
    house: int = Field(ge=1, le=12)


class WholeSignHouses(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: Literal["available"] = "available"
    system: Literal["whole_sign"] = "whole_sign"
    cusps: tuple[HouseCusp, ...] = Field(min_length=12, max_length=12)


class PlacidusHousesAvailable(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: Literal["available"] = "available"
    system: Literal["placidus"] = "placidus"
    cusps: tuple[HouseCusp, ...] = Field(min_length=12, max_length=12)


class PlacidusHousesUnavailable(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: Literal["unavailable"] = "unavailable"
    system: Literal["placidus"] = "placidus"
    reason: Literal["unsupported_latitude", "calculation_failed"]


type PlacidusHousesResult = Annotated[
    PlacidusHousesAvailable | PlacidusHousesUnavailable,
    Field(discriminator="status"),
]


class WesternHouseSystems(BaseModel):
    model_config = ConfigDict(frozen=True)

    whole_sign: WholeSignHouses
    placidus: PlacidusHousesResult


class WesternAngles(BaseModel):
    model_config = ConfigDict(frozen=True)

    ascendant: EclipticPoint
    midheaven: EclipticPoint


class WesternAstrologyAvailable(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: Literal["available"] = "available"
    capability: Literal["western_astrology"] = "western_astrology"
    calculation_version: Literal["western-astrology-contract-v1"] = "western-astrology-contract-v1"
    evidence: CalculationEvidence
    uncertainty: CalculationUncertainty
    resolved_context: ResolvedCalculationContext
    zodiac: Literal["tropical"] = "tropical"
    planetary_positions: tuple[WesternPlanetaryPosition, ...] = Field(min_length=1)
    aspects: tuple[WesternAspect, ...]
    angles: WesternAngles
    house_systems: WesternHouseSystems


type WesternAstrologyResult = Annotated[
    WesternAstrologyUnavailable | WesternAstrologyAvailable,
    Field(discriminator="status"),
]


type HeavenlyStem = Literal["jia", "yi", "bing", "ding", "wu", "ji", "geng", "xin", "ren", "gui"]
type EarthlyBranch = Literal[
    "zi", "chou", "yin", "mao", "chen", "si", "wu", "wei", "shen", "you", "xu", "hai"
]


class BaziPillar(BaseModel):
    model_config = ConfigDict(frozen=True)

    heavenly_stem: HeavenlyStem
    earthly_branch: EarthlyBranch


class BaziPillars(BaseModel):
    model_config = ConfigDict(frozen=True)

    year: BaziPillar
    month: BaziPillar
    day: BaziPillar
    hour: BaziPillar


class BaziConventions(BaseModel):
    model_config = ConfigDict(frozen=True)

    calendar_input: Literal["proleptic_gregorian", "proleptic_julian"]
    year_boundary: Literal["li_chun", "lunar_new_year"]
    month_boundary: Literal["jie_solar_terms"]
    solar_term_model: Literal["apparent_solar_longitude", "mean_solar_longitude"]
    timezone_handling: Literal["historical_civil_time"]
    true_solar_time: Literal["applied", "not_applied"]
    zi_hour_day_boundary: Literal["23:00", "00:00"]


class SolarTermContext(BaseModel):
    model_config = ConfigDict(frozen=True)

    previous_name: str
    previous_instant_utc: datetime
    next_name: str
    next_instant_utc: datetime


class BaziAvailable(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: Literal["available"] = "available"
    capability: Literal["bazi_four_pillars"] = "bazi_four_pillars"
    calculation_version: Literal["bazi-contract-v1"] = "bazi-contract-v1"
    evidence: CalculationEvidence
    uncertainty: CalculationUncertainty
    resolved_context: ResolvedCalculationContext
    pillars: BaziPillars
    conventions: BaziConventions
    solar_term_context: SolarTermContext


type BaziResult = Annotated[
    BaziUnavailable | BaziAvailable,
    Field(discriminator="status"),
]


class GeographicPoint(BaseModel):
    model_config = ConfigDict(frozen=True)

    latitude_degrees: float = Field(ge=-90, le=90)
    longitude_degrees: float = Field(ge=-180, le=180)


type GeographicSegment = Annotated[tuple[GeographicPoint, ...], Field(min_length=2)]


class AngularityLine(BaseModel):
    model_config = ConfigDict(frozen=True)

    line_id: str
    body: CelestialBody
    angle: Literal["rising", "setting", "culminating", "anti_culminating"]
    segments: tuple[GeographicSegment, ...] = Field(min_length=1)


class AngularityCrossing(BaseModel):
    model_config = ConfigDict(frozen=True)

    line_a_id: str
    line_b_id: str
    point: GeographicPoint


class PlanetaryAngularityAvailable(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: Literal["available"] = "available"
    capability: Literal["planetary_angularity_map"] = "planetary_angularity_map"
    calculation_version: Literal["planetary-angularity-contract-v1"] = (
        "planetary-angularity-contract-v1"
    )
    evidence: CalculationEvidence
    uncertainty: CalculationUncertainty
    resolved_context: ResolvedCalculationContext
    coordinate_reference_system: Literal["WGS84"] = "WGS84"
    orb_policy_degrees: float = Field(ge=0, le=30)
    interpretation_policy_version: str
    lines: tuple[AngularityLine, ...] = Field(min_length=1)
    crossings: tuple[AngularityCrossing, ...]


type PlanetaryAngularityResult = Annotated[
    PlanetaryAngularityUnavailable | PlanetaryAngularityAvailable,
    Field(discriminator="status"),
]


type TraitDomain = Literal[
    "coreMotivation",
    "emotionalProcessing",
    "communicationStyle",
    "decisionStyle",
    "socialOrientation",
    "relationshipNeeds",
    "riskOrientation",
    "stabilityVsChange",
    "conflictResponse",
    "workStyle",
    "creativeExpression",
    "repeatingTension",
    "growthLever",
]
type LifeDomain = Literal["general", "career", "relationships", "change", "creativity"]
type SourceSystem = Literal[
    "numerology",
    "dreamspell",
    "westernAstrology",
    "bazi",
    "planetaryAngularity",
    "nineStarKi",
]
type TraitDirection = Literal["supportive", "challenging", "mixed"]
type TraitConfidence = Literal["low", "medium", "high"]


class ProfileTrait(BaseModel):
    model_config = ConfigDict(frozen=True)

    domain: TraitDomain
    statement: str
    source_system: SourceSystem
    source_rule: str
    calculation_version: str
    stability: Literal["stable", "uncertain", "unavailable"]
    direction: TraitDirection
    strength: float = Field(ge=0, le=1)
    confidence: TraitConfidence
    life_domains: tuple[LifeDomain, ...] = Field(min_length=1)


class ProfileTension(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    side_a: str
    side_b: str
    trait_indexes: tuple[int, int]
    life_domains: tuple[LifeDomain, ...] = Field(min_length=1)


class ProfileConvergence(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    domain: TraitDomain
    summary: str
    trait_indexes: tuple[int, ...] = Field(min_length=2)
    source_systems: tuple[SourceSystem, ...] = Field(min_length=2)
    confidence: TraitConfidence


class ProfileResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    completeness: str
    ontology_version: Literal["profile-traits-v4"]
    numerology: NumerologyResult
    dreamspell: DreamspellResult
    nine_star_ki: NineStarKiResult
    western_astrology: WesternAstrologyResult
    bazi: BaziResult
    planetary_angularity: PlanetaryAngularityResult
    traits: tuple[ProfileTrait, ...]
    tensions: tuple[ProfileTension, ...]
    convergences: tuple[ProfileConvergence, ...]
