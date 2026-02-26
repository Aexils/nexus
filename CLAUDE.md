# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nexus is a self-hosted dashboard to monitor and control home-lab applications (Kodi, Audiobookshelf). It is an **Nx 22.5.2 monorepo** with an Angular 21 frontend and a NestJS 11 backend communicating over WebSocket (Socket.io).

## Common Commands

All commands run from the workspace root.

```sh
# Start both API and dashboard in dev mode (dashboard depends on api:serve)
npx nx serve dashboard

# Start only the API
npx nx serve api

# Build for production
npx nx build dashboard
npx nx build api

# Lint
npx nx lint dashboard
npx nx lint api

# Run unit tests (Jest)
npx nx test dashboard
npx nx test api

# Run a single test file
npx nx test dashboard --testFile=apps/dashboard/src/app/features/dashboard/dashboard.spec.ts

# Run e2e tests (requires api running)
npx nx e2e api-e2e

# Build and run with Docker Compose
docker compose up --build
```

## Environment Setup

Copy `.env.example` to `.env` at the workspace root before running locally. The API reads it via `dotenv/config` in `apps/api/src/main.ts`.

Key env vars: `KODI_URL`, `ABS_URL`, `ABS_TOKEN`, `PORT`.

In Docker, env vars are injected via `docker-compose.yml` (dotenv is not used).

## Architecture

### Monorepo Structure

```
apps/
  api/          — NestJS backend (port 3000)
  api-e2e/      — Jest e2e tests for the API
  dashboard/    — Angular 21 frontend (port 4200 dev / 80 Docker)
libs/
  shared-types/ — shared TypeScript interfaces used by both apps (@nexus/shared-types)
```

### Backend (NestJS)

`AppModule` registers `ScheduleModule.forRoot()` once at the top level, then imports feature modules:

- **`GatewayModule` / `NexusGateway`** — single Socket.io gateway. All services call `NexusGateway.emit*()` methods; it is the only entity that holds `@WebSocketServer()`.
- **`KodiModule`** — `KodiService` polls Kodi JSON-RPC every 2 s (`@Interval`). `KodiController` exposes REST at `/api/kodi/{status,playpause,stop,seek,volume}`.
- **`MetricsModule`** — `MetricsService` collects CPU/RAM/net/disk/GPU/temp every 3 s. In Docker reads `HOST_METRICS_URL` (windows_exporter). Local mode uses Node `os` + `/proc` + `/sys/class/thermal`.
  - RAM: GiB (÷1024³) to match Windows display; disk/VRAM: decimal GB (÷1e9)
  - GPU: `windows_gpu_engine_running_time_percent` (3D), `windows_gpu_adapter_memory_*`, `windows_gpu_temperature_celsius` — requires `--collectors.enabled ...,gpu`
  - CPU temp: `windows_thermalzone_temperature_celsius` (Windows, requires `--collectors.enabled ...,thermalzone`) or `/sys/class/thermal/*/temp` (Linux)
  - All GPU/temp sections are hidden in the UI when the collector is not enabled (graceful fallback)
- **`AbsModule`** — `AbsService` polls Audiobookshelf API every 5 s.

The API prefix is `/api` (set in `main.ts`). CORS allows `http://localhost:4200`.

### Frontend (Angular)

`LayoutComponent` is the persistent shell (topbar + sidebar + metrics panel). All routes are children of it.

Routes (lazy-loaded standalone components):
- `/dashboard` → `Dashboard` — overview cards for Kodi and ABS
- `/kodi` → `KodiPage` — full now-playing UI with controls
- `/audiobookshelf` → `AbsPage` — active sessions list

**`NexusService`** (`providedIn: 'root'`) owns all state as Angular signals:
- `kodiStatus`, `absStatus`, `metrics` — updated from Socket.io events
- REST methods: `playPause()`, `stop()`, `seek()`, `setVolume()`

Dev proxy (`proxy.conf.json`) forwards `/api` and `/socket.io` (WebSocket) to `localhost:3000`.

### Shared Types (`@nexus/shared-types`)

Path alias defined in `tsconfig.base.json`. Import from `@nexus/shared-types` in both apps.

Key types: `AppInfo`, `AppStatus`, `KodiStatus`, `KodiNowPlaying`, `AbsStatus`, `SystemMetrics`, `DiskInfo`, `GpuInfo`, `WS_EVENTS`.

### Styling

- Global entry point: `apps/dashboard/src/styles.scss`
- Theme system: 4 themes (dark, neon, matrix, amber) applied as `[data-theme]` on `<html>`. `:root` defaults = dark ocean.
- CSS custom properties: `--bg`, `--surface`, `--surface2`, `--border`, `--accent`, `--text`, `--text2`, `--text3`, `--green`, `--red`, `--yellow`, `--kodi`
- Fonts: Syne 800w (headings), JetBrains Mono (body)
- `ThemeService` persists selection to localStorage via Angular signals
- New Angular components default to `css` style (set in `nx.json` generators); global styles use `scss`

### Angular Component Conventions

- Standalone components with `OnPush` change detection
- Selector prefix: `nxs-` for layout shell, `app-` for features and shared
- Component files: `.ts` + `.html` + `.css` (or `.scss`)
