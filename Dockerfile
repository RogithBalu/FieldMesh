# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
# pnpm.patchedDependencies (package.json) references patches/*.patch; install fails without them.
COPY patches ./patches

RUN pnpm install --frozen-lockfile

COPY shared ./shared
COPY server ./server

RUN pnpm --filter @fieldmesh/shared build
RUN pnpm --filter @fieldmesh/server build

# Stage 2: Runtime
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOCUSPOCUS_PORT=1234
ENV DATABASE_URL=/data/fieldmesh.db
ENV UPLOADS_DIR=/data/uploads

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY patches ./patches

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/dist ./server/dist

RUN mkdir -p /data/uploads

VOLUME ["/data"]

EXPOSE 3000 1234

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server/dist/index.js"]
