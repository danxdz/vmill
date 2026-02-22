# API Docs Plan (OpenAPI)

Short answer: yes, OpenAPI is a good fit if you add a backend service layer.

Today the app is local React + WASM core (`MachineBrain`) without HTTP endpoints.
To generate proper API docs, add a thin service API and describe it with OpenAPI.

## Recommended architecture

- UI: React (existing)
- Motion core: Rust/WASM (existing)
- Control service: HTTP/WebSocket wrapper around the core (new)

This gives:
- stable contracts for external integrations
- machine commands over network (or localhost)
- generated docs/SDKs

## Suggested split

- REST for control/config/program CRUD
- WebSocket/SSE for real-time state stream

## Existing starter spec

Use `docs/openapi.v1.yaml` as a starting point.

## How to publish docs quickly

Option A: Redoc static page

```bash
npx redoc-cli build docs/openapi.v1.yaml -o docs/api.html
```

Option B: Swagger UI (dev)

```bash
npx swagger-ui-watcher docs/openapi.v1.yaml
```

## Better than OpenAPI alone

Use both:
- OpenAPI: request/response contracts
- AsyncAPI: WebSocket/event contracts (`state.update`, `alarm`, `program.line`)

For CNC/controller apps, this combo is usually best.

## What to document first

1. `GET /api/v1/state`
2. `POST /api/v1/command`
3. `POST /api/v1/program/load`
4. `POST /api/v1/program/control`
5. `GET/PUT /api/v1/config/scene`
6. `GET/PUT /api/v1/config/view`
