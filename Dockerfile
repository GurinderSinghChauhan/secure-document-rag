FROM node:22.22.1-slim AS frontend
ARG APP_COMMIT=development
ARG VITE_VOICE_INPUT_ENABLED=false
ENV VITE_APP_COMMIT=$APP_COMMIT VITE_VOICE_INPUT_ENABLED=$VITE_VOICE_INPUT_ENABLED
WORKDIR /build/frontend
COPY VERSION /build/VERSION
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.6.5 AS uv
FROM python:3.12-slim

ARG APP_COMMIT=unknown
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/service/.venv/bin:$PATH" APP_COMMIT=$APP_COMMIT
LABEL org.opencontainers.image.revision=$APP_COMMIT
WORKDIR /service
COPY --from=uv /uv /uvx /bin/
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project && uv cache clean
COPY VERSION ./
COPY app ./app
COPY --from=frontend /build/app/static/spa ./app/static/spa
COPY alembic.ini ./
COPY migrations ./migrations
COPY tools ./tools
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /service
USER appuser
EXPOSE 8080
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8080 --workers 2 --proxy-headers --forwarded-allow-ips \"${FORWARDED_ALLOW_IPS:-127.0.0.1}\" --no-server-header"]
