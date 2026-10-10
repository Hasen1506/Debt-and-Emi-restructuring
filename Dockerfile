# RightDue as ONE Render web service: FastAPI + Next.js in one container, so a
# visit wakes one free instance instead of two and the API is already warm
# when the page loads. See DEPLOY.md ("Single service") and render.yaml.
#
#   browser ──▶ Cloudflare ──▶ Render ──▶ Next.js  0.0.0.0:$PORT
#                                            │ /api/* not served by Next
#                                            ▼ (next.config.mjs rewrites.fallback)
#                                         uvicorn 127.0.0.1:8000 (FastAPI)

# ── 1. Build the web app (Node 24) ───────────────────────────────────────────
FROM node:24-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
# NEXT_PUBLIC_* values are compiled into the bundle, so they must be present
# at build time. Render passes a service's environment variables to a Docker
# build as build args when they are declared here.
ARG NEXT_PUBLIC_DISABLE_AUTH=false
# Left empty on purpose: the browser calls the API on its own origin.
ARG NEXT_PUBLIC_API_BASE_URL=
ENV NEXT_PUBLIC_DISABLE_AUTH=$NEXT_PUBLIC_DISABLE_AUTH \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_OUTPUT_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build \
 && cp -r public .next/standalone/ \
 && mkdir -p .next/standalone/.next \
 && cp -r .next/static .next/standalone/.next/static

# ── 2. Runtime: Python 3.12 + the Node 24 binary ─────────────────────────────
FROM python:3.12-slim-bookworm AS runtime
# The node binary needs libstdc++ (already in most slim images; cheap if not).
RUN apt-get update \
 && apt-get install -y --no-install-recommends libstdc++6 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=web-build /usr/local/bin/node /usr/local/bin/node

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    # Keep the pair inside the 512 MB free plan: cap V8's heap.
    NODE_OPTIONS=--max-old-space-size=256 \
    API_INTERNAL_URL=http://127.0.0.1:8000 \
    PORT=10000

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY engine/ engine/
COPY api/ api/
# engine/market_data.py reads this snapshot from the web tree.
COPY web/src/lib/market-data.json web/src/lib/market-data.json
COPY --from=web-build /app/web/.next/standalone/ web-server/
COPY deploy/start.sh deploy/start.sh

# Run unprivileged; api/data must stay writable (live rates, outcome reports
# when no DATABASE_URL is set).
RUN useradd --create-home --uid 10001 rightdue \
 && chmod +x deploy/start.sh \
 && chown -R rightdue:rightdue /app/api/data
USER rightdue

EXPOSE 10000
CMD ["/app/deploy/start.sh"]
