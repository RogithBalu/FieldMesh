# FieldMesh

Offline-first field inspection app.

## Structure
- shared/   -- types, HLC, merge rules, lenses (used by app + server)
- server/  -- Fastify REST + Hocuspocus Yjs sync + tus uploads
- app/     -- PWA (later phase)
- android/ -- Capacitor shell (later phase)

## Dev
    pnpm install
    docker compose up -d
    pnpm build:shared
    pnpm dev:server

## Verify
    curl http://localhost:3000/health
