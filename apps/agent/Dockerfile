FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV AGENT_LOG_LEVEL=INFO
ENV ENABLE_LOCAL_SMALLWEBRTC=0

WORKDIR /app

COPY apps/agent/pyproject.toml apps/agent/README.md ./
COPY apps/agent/app app

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

EXPOSE 8080

CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
