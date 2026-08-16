FROM python:3.12-slim@sha256:646fb0bca3dd3ea1bcc6feb72c17ed16eed6e10cffc732fcc1478bd3e7f02d7b AS runtime

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
