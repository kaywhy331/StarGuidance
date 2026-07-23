from fastapi import FastAPI
from pydantic import BaseModel

from profile_engine import __version__


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


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(service="profile-engine", status="ok", version=__version__)
