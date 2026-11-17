# Hosted private-beta analysis service. Cloudflare Pages builds React separately.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl ffmpeg libglib2.0-0 libgl1 nodejs \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt backend/requirements-ravel.txt backend/requirements-jersey.txt backend/requirements-youtube.txt /app/backend/
RUN python -m pip install --upgrade pip && \
    python -m pip install -r backend/requirements-ravel.txt -r backend/requirements-jersey.txt -r backend/requirements-youtube.txt
# The tested release tag contains OpenVINO RAVEL-VB-013 XML/BIN/JSON weights (MIT upstream).
RUN mkdir -p /app/external && \
    curl -fsSL --retry 3 --max-time 180 https://github.com/asigatchov/fast-volleyball-tracking-inference/archive/refs/tags/v0.2.0.tar.gz \
    | tar xz -C /app/external && \
    mv /app/external/fast-volleyball-tracking-inference-0.2.0 /app/external/fast-volleyball-tracking-inference && \
    test -s /app/external/fast-volleyball-tracking-inference/ov/RAVEL-VB-013-9f.xml && \
    test -s /app/external/fast-volleyball-tracking-inference/ov/RAVEL-VB-013-9f.bin && \
    test -s /app/external/fast-volleyball-tracking-inference/ov/RAVEL-VB-013-9f.json
COPY backend /app/backend
ENV PYTHONPATH=/app \
    VBSTATS_PUBLIC_MODE=1 \
    VBSTATS_RAVEL_HOME=/app/external/fast-volleyball-tracking-inference \
    VBSTATS_DATA_DIR=/app/analysis-data \
    VBSTATS_MAX_UPLOAD_MB=384 \
    VBSTATS_MAX_VIDEO_SECONDS=7200
RUN mkdir -p /app/analysis-data && python -m compileall -q /app/backend
EXPOSE 8000
# Railway provides PORT and HTTPS ingress. One worker keeps the in-memory queue coherent.
CMD ["sh","-c","exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
