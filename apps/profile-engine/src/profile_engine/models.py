from __future__ import annotations

from datetime import date, time
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class BirthTimeKind(str, Enum):
    UNKNOWN = "unknown"
    EXACT = "exact"
    APPROXIMATE = "approximate"


class Birthplace(BaseModel):
    model_config = ConfigDict(frozen=True)

    city: str = Field(min_length=1, max_length=120)
    region: str | None = Field(default=None, max_length=120)
    country_code: str = Field(min_length=2, max_length=2)
    time_zone: str = Field(min_length=1, max_length=100)


class BirthTime(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: BirthTimeKind
    exact: time | None = None
    start: time | None = None
    end: time | None = None

    @model_validator(mode="after")
    def validate_kind(self) -> BirthTime:
        if self.kind is BirthTimeKind.UNKNOWN and any((self.exact, self.start, self.end)):
            raise ValueError("Unknown birth time cannot include a time value")
        if self.kind is BirthTimeKind.EXACT and (self.exact is None or self.start or self.end):
            raise ValueError("Exact birth time requires only exact")
        if self.kind is BirthTimeKind.APPROXIMATE:
            if self.start is None or self.end is None or self.exact is not None:
                raise ValueError("Approximate birth time requires only start and end")
            if self.start >= self.end:
                raise ValueError("Approximate end must be later than start on the same day")
        return self


class ProfileRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    full_birth_name: str = Field(min_length=2, max_length=200)
    birth_date: date
    birthplace: Birthplace | None = None
    authoritative_time_zone: str | None = Field(default=None, max_length=100)
    birth_time: BirthTime
    latin_name_rendering: str | None = Field(default=None, min_length=2, max_length=200)

    @model_validator(mode="after")
    def require_context_for_time(self) -> ProfileRequest:
        if self.birth_date > date.today():
            raise ValueError("Birth date cannot be in the future")
        if (
            self.birth_time.kind is not BirthTimeKind.UNKNOWN
            and self.birthplace is None
            and self.authoritative_time_zone is None
        ):
            raise ValueError("Birth time requires birthplace or authoritative timezone context")
        return self


class NumerologyResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    life_path: int
    expression: int
    soul_urge: int
    personality: int
    birthday: int
    name_rendering: str
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


class UnavailableResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: str = "unavailable"
    capability: str
    reason: str
    activation_requirements: tuple[str, ...]


class ProfileResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    completeness: str
    numerology: NumerologyResult
    dreamspell: DreamspellResult
    western_astrology: UnavailableResult
    bazi: UnavailableResult
