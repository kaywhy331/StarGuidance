import hmac
import os
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from profile_engine import __version__
from profile_engine.dreamspell import calculate_dreamspell
from profile_engine.models import BirthTimeKind, ProfileRequest, ProfileResponse, UnavailableResult
from profile_engine.numerology import calculate_numerology
from profile_engine.traits import synthesize_traits


class HealthResponse(BaseModel):
    service: str
    status: str
    version: str


app = FastAPI(
    title="StarGuidance Profile Engine",
    version=__version__,
    docs_url=None,
    redoc_url=None,
)


def require_service_authorization(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = os.getenv("PROFILE_ENGINE_SHARED_SECRET")
    if expected and (
        authorization is None
        or not hmac.compare_digest(authorization, f"Bearer {expected}")
    ):
        raise HTTPException(status_code=401, detail="Service authentication required")


ServiceAuthorization = Annotated[None, Depends(require_service_authorization)]


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(service="profile-engine", status="ok", version=__version__)


@app.post("/v1/profile/compute", response_model=ProfileResponse)
def compute_profile(
    request: ProfileRequest, _: ServiceAuthorization
) -> ProfileResponse:
    if request.birth_time.kind is BirthTimeKind.EXACT:
        completeness = "complete"
    elif request.birth_time.kind is BirthTimeKind.APPROXIMATE:
        completeness = "approximateTime"
    elif request.birthplace:
        completeness = "locationEnhanced"
    else:
        completeness = "core"

    numerology = calculate_numerology(
        request.full_birth_name, request.birth_date, request.latin_name_rendering
    )
    dreamspell = calculate_dreamspell(request.birth_date)
    traits, tensions = synthesize_traits(numerology, dreamspell)

    return ProfileResponse(
        completeness=completeness,
        numerology=numerology,
        dreamspell=dreamspell,
        western_astrology=UnavailableResult(
            capability="western_astrology",
            reason="unlicensed_and_unvalidated",
            activation_requirements=(
                "commercially compatible ephemeris license",
                "approved conventions",
                "golden reference dataset",
            ),
        ),
        bazi=UnavailableResult(
            capability="bazi_four_pillars",
            reason="unvalidated_conventions",
            activation_requirements=(
                "approved year/month/day/hour boundary conventions",
                "golden reference dataset",
                "domain expert sign-off",
            ),
        ),
        traits=traits,
        tensions=tensions,
    )
