from __future__ import annotations

from datetime import date, time
from typing import Literal

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


class UnavailableResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: str = "unavailable"
    capability: str
    reason: str
    activation_requirements: tuple[str, ...]


class ProfileTrait(BaseModel):
    model_config = ConfigDict(frozen=True)

    domain: str
    statement: str
    source_system: str
    source_rule: str
    calculation_version: str
    stability: str


class ProfileTension(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    side_a: str
    side_b: str
    trait_indexes: tuple[int, int]


class ProfileResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    completeness: str
    numerology: NumerologyResult
    dreamspell: DreamspellResult
    western_astrology: UnavailableResult
    bazi: UnavailableResult
    traits: tuple[ProfileTrait, ...]
    tensions: tuple[ProfileTension, ...]
