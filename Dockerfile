# One image for the whole app: builds the web app, then runs the backend, which serves
# the built app and /api on the same origin. No volume: records live on Arkiv and files
# on 0G Storage. The container only writes scratch work under /tmp (removed after use).

FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY frontend/web/package.json frontend/web/package-lock.json frontend/web/
RUN cd frontend/web && npm ci --no-audit --no-fund
COPY frontend/design-system/src frontend/design-system/src
COPY frontend/web frontend/web
# The web app imports sample fixtures (JSON) and contract ABIs from the backend at build time.
COPY backend/fixtures backend/fixtures
COPY backend/contracts backend/contracts
RUN cd frontend/web && npm run build

# Backend dependencies (some are native, so this stage has the build tools).
FROM node:22-bookworm-slim AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund
COPY backend/tester/package.json backend/tester/package-lock.json backend/tester/
# Playwright only drives remote (Mozark) browsers, so skip downloading local ones.
RUN cd backend/tester && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
# git: the reviewer clones repos. ffmpeg/ffprobe: demo video audio for transcripts.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend backend
COPY --from=deps /app/backend/node_modules backend/node_modules
COPY --from=deps /app/backend/tester/node_modules backend/tester/node_modules
COPY --from=web /app/frontend/web/dist frontend/web/dist

ENV NODE_ENV=production \
    PORT=8080 \
    TRUST_PROXY=1
EXPOSE 8080
WORKDIR /app/backend
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
