FROM python:3.11-slim

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.8.8 /uv /uvx /bin/
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
COPY models ./models
COPY src ./src

RUN uv sync --no-dev

EXPOSE 8000

CMD ["uv", "run", "python", "-m", "uvicorn", "inference.main:app", "--host", "0.0.0.0", "--port", "8000"]
