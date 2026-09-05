# syntax=docker/dockerfile:1.7
#
# XRSPS game server image (WebSocket game server + OSRS cache over HTTP).
#
# Build context = repository root (the server imports shared code from ../client).
# The OSRS cache is downloaded from OpenRS2 and the collision data is precomputed
# at image build time, so a fresh machine boots in seconds. Expect the first
# build to take 10-20 minutes (collision build); later builds reuse the cached
# layers unless server/target.txt, server/src or client/rs change.
#
# Player saves (SQLite) live in XRSPS_DATA_DIR (default /data) — mount a volume there.

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare yarn@4.12.0 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# Server dependencies only (small: ws, pako, tsx, ...).
FROM base AS deps
COPY .yarnrc.yml ./
COPY server/package.json server/yarn.lock ./server/
RUN cd server && yarn install --immutable

# ---------------------------------------------------------------------------
# OSRS cache download (only re-runs when server/target.txt changes).
FROM deps AS cache
COPY server/target.txt ./server/target.txt
COPY server/scripts/ensure-cache.ts ./server/scripts/ensure-cache.ts
RUN cd server && yarn tsx scripts/ensure-cache.ts --server \
    && rm -f caches/.cache-download.lock

# ---------------------------------------------------------------------------
# Precomputed collision data (needs the cache + engine sources).
FROM cache AS collision
COPY client/common ./client/common
COPY client/rs ./client/rs
COPY client/custom ./client/custom
COPY server/src ./server/src
COPY server/data ./server/data
COPY server/scripts ./server/scripts
COPY server/tsconfig.json ./server/tsconfig.json
# Shared client code resolves its deps (pako, gl-matrix, @foxglove/wasm-bz2, ...)
# from client/node_modules; the server package declares the same deps, so alias it.
RUN ln -s /app/server/node_modules /app/client/node_modules \
    && cd server && NODE_OPTIONS=--max-old-space-size=4096 \
    yarn tsx scripts/build-collision-cache.ts --force

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=43594 \
    XRSPS_DATA_DIR=/data \
    SERVE_CACHE=true

COPY .yarnrc.yml ./
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=cache /app/server/caches ./server/caches
COPY --from=collision /app/server/cache ./server/cache

# Shared engine code the server imports from the client package.
COPY client/common ./client/common
COPY client/rs ./client/rs
COPY client/custom ./client/custom
COPY client/ui/fonts.ts ./client/ui/fonts.ts
RUN ln -s /app/server/node_modules /app/client/node_modules

# Server sources, gamemodes, extrascripts and static data.
COPY server/package.json server/yarn.lock server/tsconfig.json server/tsconfig.quests.json \
     server/config.json server/target.txt ./server/
COPY server/src ./server/src
COPY server/data ./server/data
COPY server/gamemodes ./server/gamemodes
COPY server/extrascripts ./server/extrascripts
COPY server/scripts ./server/scripts

# Save directory (mount a persistent volume here). The process stays root on
# purpose: Fly.io/Railway mount volumes root-owned, and the container is already
# an isolated microVM.
RUN mkdir -p /data
VOLUME ["/data"]

WORKDIR /app/server
EXPOSE 43594

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||43594)+'/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# V8 heap cap for a 2 GB machine (cache buffers live off-heap). Raise with the VM size.
ENV NODE_OPTIONS=--max-old-space-size=1536

# The cache is baked in, so skip the ensure-cache step and boot straight into the server.
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
