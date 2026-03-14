# Multi-stage Dockerfile for MRTKLIB Web UI
# Stage 1: Build MRTKLIB from source
# Stage 2: Build frontend
# Stage 3: Build backend with uv
# Stage 4: Runtime

# ================================
# Stage 1: Build MRTKLIB from source
# ================================
FROM debian:bookworm-slim AS mrtklib-builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ca-certificates \
    liblapack-dev \
    libopenblas-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Clone MRTKLIB
RUN git clone --depth 1 https://github.com/h-shiono/MRTKLIB.git

# Build MRTKLIB with CMake
WORKDIR /build/MRTKLIB
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release && \
    cmake --build build -j$(nproc)

# Collect unified mrtk binary
RUN mkdir -p /mrtklib-bin && \
    strip build/mrtk && cp build/mrtk /mrtklib-bin/

# ================================
# Stage 2: Build Frontend
# ================================
FROM node:22-slim AS frontend-builder

WORKDIR /app/frontend

# Copy frontend source
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ================================
# Stage 3: Build Backend with uv
# ================================
FROM ghcr.io/astral-sh/uv:python3.12-bookworm AS backend-builder

# Version injected at build time (from git tag)
ARG MRTKLIB_VERSION=0.0.0
ENV SETUPTOOLS_SCM_PRETEND_VERSION=${MRTKLIB_VERSION}

WORKDIR /app

# Copy pyproject.toml, lock file, README, and source
COPY pyproject.toml uv.lock* README.md ./
COPY src/ ./src/

# Install dependencies (frozen if lock exists)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev || uv sync --no-dev

# ================================
# Stage 4: Runtime
# ================================
FROM python:3.12-slim-bookworm AS runtime

WORKDIR /app

# Install runtime dependencies for MRTKLIB
RUN apt-get update && apt-get install -y --no-install-recommends \
    liblapack3 \
    libopenblas0 \
    && rm -rf /var/lib/apt/lists/*

# Copy MRTKLIB unified binary from builder
COPY --from=mrtklib-builder /mrtklib-bin/mrtk /usr/local/bin/mrtk
RUN chmod +x /usr/local/bin/mrtk

# Verify mrtk is installed
RUN mrtk --version

# Copy virtual environment from backend builder
COPY --from=backend-builder /app/.venv /app/.venv

# Copy backend source
COPY --from=backend-builder /app/src /app/src

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist /app/static

# Set PATH to use venv
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/src"

# Create workspace directory for bind mount
RUN mkdir -p /workspace

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

# Run the application
CMD ["uvicorn", "mrtklib_web_ui.main:app", "--host", "0.0.0.0", "--port", "8000"]
