# Multi-stage Dockerfile for RTKLIB Web UI
# Stage 1: Build RTKLIB from source
# Stage 2: Build frontend
# Stage 3: Build backend with uv
# Stage 4: Runtime

# ================================
# Stage 1: Build RTKLIB from source
# ================================
FROM debian:bookworm-slim AS rtklib-builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    gfortran \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Clone official RTKLIB (tomojitakasu) rtklib_2.4.3 branch
RUN git clone --depth 1 --branch rtklib_2.4.3 https://github.com/tomojitakasu/RTKLIB.git

# Build IERS library (required for rnx2rtkp)
WORKDIR /build/RTKLIB/lib/iers/gcc
RUN make

# Build str2str
WORKDIR /build/RTKLIB/app/consapp/str2str/gcc
RUN make && strip str2str

# Build convbin
WORKDIR /build/RTKLIB/app/consapp/convbin/gcc
RUN make && strip convbin

# Build rnx2rtkp
WORKDIR /build/RTKLIB/app/consapp/rnx2rtkp/gcc
RUN make && strip rnx2rtkp

# Build rtkrcv (optional, for real-time positioning)
WORKDIR /build/RTKLIB/app/consapp/rtkrcv/gcc
RUN make && strip rtkrcv || true

# Collect binaries
RUN mkdir -p /rtklib-bin && \
    cp /build/RTKLIB/app/consapp/str2str/gcc/str2str /rtklib-bin/ && \
    cp /build/RTKLIB/app/consapp/convbin/gcc/convbin /rtklib-bin/ && \
    cp /build/RTKLIB/app/consapp/rnx2rtkp/gcc/rnx2rtkp /rtklib-bin/ && \
    (cp /build/RTKLIB/app/consapp/rtkrcv/gcc/rtkrcv /rtklib-bin/ || true)

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

# Install runtime dependencies for RTKLIB
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgfortran5 \
    && rm -rf /var/lib/apt/lists/*

# Copy RTKLIB binaries from builder
COPY --from=rtklib-builder /rtklib-bin/str2str /usr/local/bin/str2str
COPY --from=rtklib-builder /rtklib-bin/convbin /usr/local/bin/convbin
COPY --from=rtklib-builder /rtklib-bin/rnx2rtkp /usr/local/bin/rnx2rtkp
RUN chmod +x /usr/local/bin/str2str /usr/local/bin/convbin /usr/local/bin/rnx2rtkp

# Verify binaries are installed
RUN ls -la /usr/local/bin/str2str /usr/local/bin/convbin /usr/local/bin/rnx2rtkp

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
CMD ["uvicorn", "rtklib_web_ui.main:app", "--host", "0.0.0.0", "--port", "8000"]
