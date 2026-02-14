# Firecrawl — Railway Deployment Guide

Reference for deploying Firecrawl on Railway. Covers architecture, required services, environment variables, and common issues.

---

## Architecture Overview

```
                    +-----------------+
                    |   API Service   |
                    | (apps/api)      |
                    +--------+--------+
                             |
         +-------------------+-------------------+------------------+
         |                   |                   |                  |
+--------v-------+  +--------v-------+  +--------v-------+  +------v---------+
|  nuq-postgres  |  |     Redis      |  |   RabbitMQ     |  | playwright-svc |
|  (job queue)   |  |  (cache/rate)  |  | (notifications)|  | (browser)      |
+----------------+  +----------------+  +----------------+  +----------------+
                                                              +----------------+
                                                              |    searxng     |
                                                              |   (search)    |
                                                              +----------------+
```

### Services (6 total)

| Service | Image / Build | Purpose |
|---------|--------------|---------|
| **api** | `apps/api` (custom build) | Main API server + workers. Entrypoint: `node dist/src/harness.js --start-docker` |
| **nuq-postgres** | `apps/nuq-postgres` (Postgres 17 + pg_cron) | NuQ job queue database. Stores scrape jobs, crawl backlogs, group crawl state |
| **redis** | `redis:alpine` | Rate limiting, caching, BullMQ queues (llmstxt, deep-research, billing, precrawl) |
| **rabbitmq** | `rabbitmq:3-management` | NuQ job completion notifications via AMQP |
| **playwright-service** | `apps/playwright-service-ts` (custom build) | Headless browser scraping via Patchright (Playwright fork with stealth) |
| **searxng** | `searxng/searxng` (or similar) | Meta-search engine for search endpoints |

### Database Architecture

Firecrawl uses **two separate database systems** (not two Postgres instances):

1. **nuq-postgres** (Postgres 17 + pg_cron) — Internal job queue
   - Connected via: `NUQ_DATABASE_URL` (raw `pg` Pool)
   - Schema: `nuq` schema with tables `queue_scrape`, `queue_scrape_backlog`, `queue_crawl_finished`, `group_crawl`
   - Auto-initialized on first container start via `/docker-entrypoint-initdb.d/010-nuq.sql`
   - Cron jobs handle cleanup, stall detection, and group crawl completion

2. **Supabase** (external hosted service) — Auth, billing, user data
   - Connected via: `SUPABASE_URL` + `SUPABASE_SERVICE_TOKEN` (Supabase JS SDK)
   - Only used when `USE_DB_AUTHENTICATION=true`
   - Not a raw Postgres connection — uses the Supabase REST API
   - **Not needed for self-hosted / no-auth deployments**

> **Important:** Do NOT add extra Postgres database services expecting the API to connect to them. The API only connects to `nuq-postgres` directly. All other database access goes through Supabase's SDK.

---

## Railway Setup

### Step 1: Create Services

Add these services to your Railway project:

1. **api** — GitHub repo, build from `apps/api`, root directory: `/`
2. **nuq-postgres** — GitHub repo, build from `apps/nuq-postgres`
3. **redis** — Docker image: `redis:alpine`, start command: `redis-server --bind 0.0.0.0`
4. **rabbitmq** — Docker image: `rabbitmq:3-management`, start command: `rabbitmq-server`
5. **playwright-service** — GitHub repo, build from `apps/playwright-service-ts`
6. **searxng** — Docker image: `searxng/searxng` (optional, for search endpoints)

### Step 2: Connect Services

Draw reference connections in the Railway canvas:

```
nuq-postgres  ──>  api
redis         ──>  api
rabbitmq      ──>  api
playwright-service ──> api
searxng       ──>  api  (optional)
```

All services must be on the same private network so they can communicate via internal hostnames.

### Step 3: Environment Variables

#### nuq-postgres

| Variable | Value |
|----------|-------|
| `POSTGRES_USER` | `postgres` |
| `POSTGRES_PASSWORD` | (generate a secure password) |
| `POSTGRES_DB` | `postgres` |

#### api (main service)

**Required:**

| Variable | Value | Description |
|----------|-------|-------------|
| `NUQ_DATABASE_URL` | `postgresql://postgres:<password>@nuq-postgres.railway.internal:5432/postgres` | NuQ Postgres connection string. Use the Railway internal hostname for `nuq-postgres`. |
| `REDIS_URL` | `redis://redis.railway.internal:6379` | Redis connection string |
| `REDIS_RATE_LIMIT_URL` | `redis://redis.railway.internal:6379` | Redis for rate limiting (can be same as REDIS_URL) |
| `NUQ_RABBITMQ_URL` | `amqp://rabbitmq.railway.internal:5672` | RabbitMQ connection string |
| `PLAYWRIGHT_MICROSERVICE_URL` | `http://playwright-service.railway.internal:3000/scrape` | Playwright service URL |
| `HOST` | `0.0.0.0` | Bind to all interfaces |
| `PORT` | `3002` | API port (expose this in Railway) |
| `USE_DB_AUTHENTICATION` | `false` | Set `false` for self-hosted (no Supabase). Set `true` only if you have a Supabase project. |

**Optional (self-hosted without auth):**

| Variable | Value | Description |
|----------|-------|-------------|
| `TEST_API_KEY` | `fc-...` | API key for testing (used when auth is disabled) |
| `NUM_WORKERS_PER_QUEUE` | `8` | Workers per queue (default: 8) |
| `MAX_CONCURRENT_JOBS` | `5` | Max concurrent scrape jobs (default: 5) |
| `CRAWL_CONCURRENT_REQUESTS` | `10` | Max concurrent crawl requests (default: 10) |
| `BROWSER_POOL_SIZE` | `5` | Browser pool size (default: 5) |
| `BULL_AUTH_KEY` | (any string) | Auth key for Bull dashboard at `/admin/<key>/queues` |

**Optional (AI features):**

| Variable | Value | Description |
|----------|-------|-------------|
| `OPENAI_API_KEY` | `sk-...` | OpenAI API key for extract/LLM features |
| `OPENAI_BASE_URL` | (url) | Custom OpenAI-compatible API base URL |
| `MODEL_NAME` | (model id) | Model name for LLM operations |
| `OLLAMA_BASE_URL` | (url) | Ollama base URL for local LLM |

**Optional (search):**

| Variable | Value | Description |
|----------|-------|-------------|
| `SEARXNG_ENDPOINT` | `http://searxng.railway.internal:8080` | SearXNG endpoint |
| `SEARXNG_ENGINES` | (comma-separated) | SearXNG engines to use |
| `SEARXNG_CATEGORIES` | (comma-separated) | SearXNG categories |

**Optional (proxy):**

| Variable | Value | Description |
|----------|-------|-------------|
| `PROXY_SERVER` | `http://proxy:port` | Proxy server URL |
| `PROXY_USERNAME` | (string) | Proxy auth username |
| `PROXY_PASSWORD` | (string) | Proxy auth password |

**Required ONLY if `USE_DB_AUTHENTICATION=true`:**

| Variable | Value | Description |
|----------|-------|-------------|
| `SUPABASE_URL` | `https://xxx.supabase.co` | Supabase project URL |
| `SUPABASE_SERVICE_TOKEN` | `eyJ...` | Supabase service role key |
| `SUPABASE_REPLICA_URL` | `https://xxx.supabase.co` | Supabase read replica URL |
| `SUPABASE_ANON_TOKEN` | `eyJ...` | Supabase anon key |

#### playwright-service

| Variable | Value |
|----------|-------|
| `PORT` | `3000` |
| `PROXY_SERVER` | (optional, same as api) |
| `PROXY_USERNAME` | (optional) |
| `PROXY_PASSWORD` | (optional) |
| `BLOCK_MEDIA` | `false` (or `true` to block images/video) |
| `MAX_CONCURRENT_PAGES` | `10` |
| `STEALTH_ENABLED` | `true` (enables anti-detection, default: true) |

---

## How the API Resolves Database Connections

The `harness.ts` startup logic (`apps/api/src/harness.ts:499-567`) resolves `NUQ_DATABASE_URL` in this order:

1. **`NUQ_DATABASE_URL` env var is set** → Use it directly (Railway should use this path)
2. **`POSTGRES_HOST` is not `localhost`** → Construct URL from `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (docker-compose path)
3. **`POSTGRES_HOST` is `localhost`** → Build and start a local `nuq-postgres` Docker container (local dev path)

**For Railway: Always set `NUQ_DATABASE_URL` explicitly.** This skips container management and uses your Railway Postgres directly.

---

## Common Issues

### "Two Postgres databases are disconnected in Railway canvas"
Those extra Postgres services are unnecessary. Firecrawl only needs `nuq-postgres`. The other database (Supabase) is an external hosted service, not a Railway Postgres instance. Remove the disconnected databases.

### API starts before Postgres is ready
The `docker-compose.yaml` now includes `nuq-postgres` in `depends_on`. For Railway, ensure `nuq-postgres` deploys and initializes before the API service starts (Railway handles this via service dependencies when connected in the canvas).

### "Supabase client is not configured" errors
This is expected when `USE_DB_AUTHENTICATION=false`. The API runs in self-hosted mode without Supabase. Auth is disabled and a `TEST_API_KEY` is used instead.

### nuq-postgres schema not initialized
The `nuq.sql` init script runs **only on first container start** (when the data volume is empty). If you need to re-initialize:
- Delete the Postgres volume/data and restart the service, OR
- Run the SQL from `apps/nuq-postgres/nuq.sql` manually against the database

### Playwright service can't scrape / gets blocked
Ensure `STEALTH_ENABLED=true` is set on the playwright-service. The service uses Patchright (Playwright fork) with stealth evasion scripts to bypass anti-bot detection.

---

## API Endpoints

When `USE_DB_AUTHENTICATION=false`, the API exposes v2 endpoints only:

- `GET /` — Health check / info
- `GET /e2e-test` — E2E test endpoint
- `POST /v2/scrape` — Scrape a single URL
- `POST /v2/crawl` — Start a crawl
- `GET /v2/crawl/:id` — Check crawl status
- `POST /v2/extract` — Extract structured data
- `POST /v2/search` — Search the web
- `GET /admin/<BULL_AUTH_KEY>/queues` — Bull dashboard

> Note: v0 and v1 routes are disabled in the current build. Only v2 is active.

---

## Local Development (docker-compose)

```bash
# Clone and build
git clone <repo>
cd firecrawl

# Start all services
docker compose up --build

# API available at http://localhost:3002
# Bull dashboard at http://localhost:3002/admin/<BULL_AUTH_KEY>/queues
# RabbitMQ management at http://localhost:15672
```

The `docker-compose.yaml` handles all service orchestration. The harness detects `POSTGRES_HOST=nuq-postgres` (set by compose) and constructs the database URL automatically.

---

## File Reference

| Path | Purpose |
|------|---------|
| `docker-compose.yaml` | Service orchestration, env var defaults |
| `apps/api/Dockerfile` | API image build (Node 22 + Go + Rust) |
| `apps/api/src/harness.ts` | Startup orchestrator, DB/Redis/RabbitMQ setup |
| `apps/api/src/config.ts` | Zod-validated config schema, all env vars |
| `apps/api/src/index.ts` | Express server, route registration |
| `apps/api/src/services/worker/nuq.ts` | NuQ job queue (Postgres-backed) |
| `apps/api/src/services/supabase.ts` | Supabase client initialization |
| `apps/nuq-postgres/Dockerfile` | Postgres 17 + pg_cron image |
| `apps/nuq-postgres/nuq.sql` | NuQ schema, indexes, cron jobs |
| `apps/playwright-service-ts/api.ts` | Playwright/Patchright scraping service |
| `apps/playwright-service-ts/stealth.ts` | Anti-bot evasion scripts |
