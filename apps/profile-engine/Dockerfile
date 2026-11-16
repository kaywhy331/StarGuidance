FROM python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml ./
COPY requirements.lock ./
COPY src ./src

RUN python -m pip install --no-cache-dir --require-hashes -r requirements.lock \
    && python -m pip install --no-cache-dir --no-deps .

USER 65532:65532

EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn profile_engine.main:app --host 0.0.0.0 --port \"${PORT:-8000}\" --no-access-log"]
