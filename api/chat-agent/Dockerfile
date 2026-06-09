# Lightweight LLM agent (FastAPI -> OpenRouter). Replaces the Maestro server.
FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml ./
RUN uv pip install --system .

COPY agent.py ./
COPY system-prompt.md ./

ENV AGENT_MODE=chat

EXPOSE 8000

CMD ["uvicorn", "agent:app", "--host", "0.0.0.0", "--port", "8000"]
