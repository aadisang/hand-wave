FROM python:3.13-slim

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.8.8 /uv /uvx /bin/
COPY pyproject.toml ./
COPY src ./src

RUN uv sync --no-dev

EXPOSE 8000

CMD ["uv", "run", "python", "-m", "uvicorn", "inference.main:app", "--host", "0.0.0.0", "--port", "8000"]
