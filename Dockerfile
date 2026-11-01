# syntax=docker/dockerfile:1
#
# Phase 13 WI-2 — one image serving the API and the built web app (spec D3),
# run on Fly.io with SQLite on a volume at /data. See fly.toml and
# docs/ops/runbook.md. Node 22: Puppeteer 25 requires >= 22.12.

ARG NODE_VERSION=22

# ── Build: compile the backend to JavaScript and bundle the web app ─────────
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
# Chromium is installed in the runtime stage only.
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY web/package.json web/
RUN npm ci

COPY shared shared
COPY backend backend
COPY web web
RUN npm run build -w web && npm run build -w backend

# ── Runtime: production dependencies, Chromium, and the two build outputs ───
FROM node:${NODE_VERSION}-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY web/package.json web/
# The Chrome build Puppeteer pins, plus the system libraries it needs (apt).
RUN npm ci --omit=dev -w backend \
 && npx puppeteer browsers install chrome --install-deps \
 && npm cache clean --force \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/web/dist web/dist

ENV PORT=8080 \
    WEB_DIST_DIR=/app/web/dist
EXPOSE 8080
CMD ["node", "backend/dist/backend/server.js"]
