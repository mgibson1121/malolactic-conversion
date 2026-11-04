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

# Debian's Chromium, with its system libraries resolved by apt, instead of
# Puppeteer's downloaded Chrome plus `--install-deps`: that step failed on
# the first two Fly builds (2026-11-01), the second time even after
# `apt-get update`. Puppeteer reads PUPPETEER_EXECUTABLE_PATH and then skips
# its own download. bookworm-security tracks Chrome stable, close to the
# build Puppeteer pins; the launch check below proves the pair works.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
 && rm -rf /var/lib/apt/lists/* \
 && chromium --version

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY web/package.json web/
RUN npm ci --omit=dev -w backend && npm cache clean --force

# Fail the build, not the first scan, if Puppeteer cannot drive this Chromium.
# Same flags as shared/utils/render-gate.ts CHROMIUM_ARGS.
RUN node -e "require('puppeteer').launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] }).then(async b => { console.log('Puppeteer launched', await b.version()); await b.close() }).catch(e => { console.error(e); process.exit(1) })"

# Litestream (WI-4): continuous backup of the database to Cloudflare R2.
# Pinned release with its published SHA-256 (checksums.txt of v0.5.17).
ARG LITESTREAM_VERSION=0.5.17
ADD --checksum=sha256:cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d \
    https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-x86_64.tar.gz \
    /tmp/litestream.tar.gz
RUN tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin litestream \
 && rm /tmp/litestream.tar.gz \
 && litestream version
COPY litestream.yml /etc/litestream.yml
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/web/dist web/dist

ENV PORT=8080 \
    WEB_DIST_DIR=/app/web/dist
EXPOSE 8080
# Restore-if-needed, then the server under Litestream (docker-entrypoint.sh).
CMD ["/app/docker-entrypoint.sh"]
