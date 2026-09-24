# ReachInbox — Full-stack Email Job Scheduler

A production-grade **email scheduler service + dashboard**:

- Accepts email send requests via **REST APIs**
- Schedules them to be sent at a **specific time** using **BullMQ delayed jobs** (**no cron anywhere**)
- Sends through **Ethereal Email** (fake SMTP) from **multiple senders**
- Indexes sent/scheduled emails in **Elasticsearch** for search
- Exposes a **live BullMQ dashboard**
- Survives **server restarts** without losing or duplicating jobs
- Enforces **configurable concurrency**, **min-delay between sends** and **hourly rate limits** (multi-worker safe)
- Fires **live Slack notifications** the moment a sender's hourly limit is hit

```
┌──────────────┐   REST    ┌──────────────────────┐         ┌─────────────────┐
│ React (Vite) │ ────────► │ Express API (TS)     │ ───────►│ MySQL 8         │
│  Dashboard   │  JWT/OAuth │  schedule / list /   │         │ (source of truth│
└──────────────┘           │  search / slack      │         └─────────────────┘
                           └─────────┬────────────┘
                                     │ enqueue delayed job (jobId = row.id)
                           ┌─────────▼────────────┐   ┌─────────────────────┐
                           │ BullMQ queue         │◄──│ Redis (persisted)   │
                           │ delayed jobs + board │   └─────────────────────┘
                           └─────────┬────────────┘
                                     │ Worker (concurrency N, BullMQ limiter)
                           ┌─────────▼────────────┐   ┌─────────────────────┐
                           │ Worker process (TS)  │──►│ Redis rate counters │
                           │ claim → gap → limit  │   │ + Slack webhook     │
                           │ → SMTP send          │   └─────────────────────┘
                           └─────────┬────────────┘
                                     │ nodemailer over SMTP
                           ┌─────────▼────────────┐   ┌─────────────────────┐
                           │ Ethereal Email       │   │ Elasticsearch       │
                           │ (fake inbox)         │   │ (search)            │
                           └──────────────────────┘   └─────────────────────┘
```

---

## Tech stack

| Layer    | Technology |
| -------- | ---------- |
| Language | TypeScript |
| Backend  | Express.js |
| Queue    | BullMQ (backed by Redis) |
| Database | MySQL 8 (TypeORM) |
| Search   | Elasticsearch 8 |
| SMTP     | Ethereal Email (nodemailer) |
| Auth     | Google OAuth 2.0 (passport) + JWT |
| Alerts   | Slack OAuth 2.0 + `chat.postMessage` |
| Frontend | React 18 + Vite + Tailwind CSS + TypeScript |
| Infra    | Docker Compose (redis, elasticsearch, mysql) |

---

## Features implemented

### Backend

| Requirement | Implementation |
| ----------- | -------------- |
| Scheduler via API | `POST /api/emails/schedule` — parses CSV/text leads, creates one DB row + one BullMQ delayed job per email |
| **No cron** | Scheduling is purely `BullMQ delayed jobs` (`queue.add(..., { delay })`). No `node-cron`, no agenda, no OS cron. |
| Persistence | MySQL row is written **first** (source of truth); queue job id is stamped back onto the row (`queueJobId`) |
| Restart safety | On API boot, `reconcileQueueOnStartup()` re-enqueues any `scheduled/deferred` row whose exact BullMQ job is missing from Redis, with the correct remaining delay |
| Idempotency | Worker claims the row with an atomic `UPDATE … WHERE id=? AND status IN (scheduled,failed,deferred)` before sending — same email is never sent twice even under BullMQ at-least-once delivery |
| Multiple senders | Ethereal mailbox pool provisioned at boot, stored as `senders` rows; compose form lets you pick one |
| Concurrency | `WORKER_CONCURRENCY` (default **5**) — configured on the BullMQ worker |
| Delay between sends | Redis-based distributed spacing gate — **min `MIN_DELAY_BETWEEN_EMAILS_MS` (default 2000 ms)** between individual sends across all workers |
| Rate limiting | Redis Lua atomic check-and-reserve: per-sender `rl:s:{sender}:{hour}` + global `rl:g:{hour}`, limits from env (and per-sender override) |
| Not dropping jobs | When a limit is hit the job is **deferred** (not failed) to the next hour window, preserving batch order via `batchIndex` |
| Slack alerts | Real OAuth 2.0 flow, token stored per user; **live `chat.postMessage` call** on first limit hit per sender per hour. No token ⇒ silent no-op (no crash) |
| Searchable emails | Elasticsearch index on schedule + re-index on send; `GET /api/search/emails` (substring + fuzzy) |
| Live BullMQ dashboard | `@bull-board/express` at **`/admin/queues`** |
| CSV/text parsing | RFC4180-ish parser extracts unique valid emails from any CSV/TSV/text |

### Frontend

| Requirement | Implementation |
| ----------- | -------------- |
| Google login | Real Google OAuth 2.0 (backend redirect + callback → JWT). Header shows **name, email, avatar**; logout in the user menu |
| Dashboard tabs | **Scheduled Emails** / **Sent Emails** with live totals |
| Compose New Email | Modal with subject, body, **CSV/text upload + detected address count**, start time, delay between emails, hourly limit, sender picker |
| Scheduled table | Email, Subject, Scheduled time, Status (+ loading + empty states) |
| Sent table | Email, Subject, Sent time, Status (`sent`/`failed`) (+ loading + empty states) |
| Search | Elasticsearch-backed search bar with debounced results |
| Slack | "Connect Slack" button → real OAuth → connected state / disconnect |
| Quality | Reusable `Button/Modal/Input/TextArea/EmptyState/StatusBadge/Toast` components, shared `EmailTable`, typed API layer, strict TS |

---

## Quick start

### 1. Prerequisites

- Node.js ≥ 20
- Docker (for Redis + Elasticsearch + MySQL)

### 2. Start infrastructure

```bash
docker compose up -d
```

| Service        | URL / creds                              |
| -------------- | ---------------------------------------- |
| Redis          | `redis://localhost:6379`                 |
| Elasticsearch  | `http://localhost:9200`                  |
| MySQL          | `localhost:3307`, `reachinbox` / `reachinbox` / db `reachinbox` |

> Note: MySQL is mapped to host port **3307** to avoid clashing with a
> locally installed MySQL/MariaDB. Change `docker-compose.yml` +
> `DB_PORT` if you prefer 3306.

### 3. Configure the backend

```bash
cd backend
cp .env.example .env.local      # edit as needed
```

Minimum required for local dev (already the defaults in `.env.example`):

```env
PORT=4000
REDIS_URL=redis://localhost:6379
DB_PORT=3307
DB_USER=reachinbox
DB_PASSWORD=reachinbox
DB_NAME=reachinbox
ELASTICSEARCH_URL=http://localhost:9200
JWT_SECRET=change-me-to-a-long-random-string
```

The DB schema is created automatically (`synchronize: true` — for production
you'd swap migrations, see *Trade-offs*).

### 4. Run backend + worker (two processes)

```bash
# terminal 1 — API server (also runs the Bull Board)
cd backend
npm run dev

# terminal 2 — BullMQ worker (the actual sender)
cd backend
npm run dev:worker
```

### 5. Run the frontend

```bash
# terminal 3
cd frontend
npm run dev
# open http://localhost:5173
```

> **Windows shortcut:** `pwsh scripts/dev.ps1` starts docker + API + worker + web.

### Useful URLs

| What | URL |
| ---- | --- |
| Dashboard | http://localhost:5173 |
| Health | http://localhost:4000/api/health |
| BullMQ board (live queues) | http://localhost:4000/admin/queues |
| Elasticsearch | http://localhost:9200 |

---

## Environment variables (backend)

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `PORT` | 4000 | API port |
| `BACKEND_URL` | http://localhost:4000 | OAuth callback base |
| `FRONTEND_URL` | http://localhost:5173 | OAuth redirect target |
| `REDIS_URL` | redis://localhost:6379 | BullMQ + counters |
| `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` | localhost/3307/reachinbox/... | MySQL |
| `ELASTICSEARCH_URL` | http://localhost:9200 | search index |
| `ELASTICSEARCH_INDEX` | reachinbox_emails | index name |
| **Scheduler** | | |
| `WORKER_CONCURRENCY` | 5 | BullMQ worker concurrency |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | 2000 | min gap between individual sends |
| `MAX_EMAILS_PER_HOUR` | 200 | global cap |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | 60 | per-sender cap (clamped) |
| `JOB_ATTEMPTS` | 6 | retry attempts (exponential backoff) |
| **Ethereal** | | |
| `ETHEREAL_HOST/PORT/USER/PASS` | *(auto)* | pin a shared mailbox; otherwise accounts are auto-provisioned and cached in `.ethereal-accounts.json` |
| `EMAIL_FROM` | | optional From override |
| **Auth** | | |
| `JWT_SECRET` | *(required)* | JWT signing |
| `GOOGLE_CLIENT_ID/SECRET` | | real Google OAuth |
| `AUTH_DEMO_MODE` | false | **dev-only** non-Google login fallback |
| **Slack** | | |
| `SLACK_CLIENT_ID/SECRET` | | Slack app for rate-limit alerts |
| `SLACK_CHANNEL` | #reachinbox-alerts | default alert channel |

---

## Setting up Ethereal Email

Ethereal needs **zero setup** — on first boot the backend auto-creates
test mailboxes (cached to `.ethereal-accounts.json` so restarts reuse the
same senders) and registers them in the `senders` table.

To inspect sent mail, visit <https://ethereal.email/log-in> and log in with
any of the sender emails shown in the dashboard's sender picker (their
passwords live in `.ethereal-accounts.json`).

To pin a shared mailbox instead:

```env
ETHEREAL_HOST=smtp.ethereal.email
ETHEREAL_PORT=587
ETHEREAL_USER=your.account@ethereal.email
ETHEREAL_PASS=your-password
```

---

## Setting up Google OAuth (required for real login)

1. Go to <https://console.cloud.google.com/apis/credentials>
2. Create an **OAuth client ID** → type **Web application**
3. Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`
4. Put the values into `backend/.env.local`:

```env
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
```

5. Restart the API. "Continue with Google" now runs the real OAuth flow and
   lands on `/auth?token=…` → dashboard (name, email, avatar in the header).

> `AUTH_DEMO_MODE=true` (already set in `.env.example`) additionally
> exposes a `Use demo account` button so the dashboard is browsable without
> Google credentials. It is a **development convenience** — remove it for
> production. Google OAuth itself is fully implemented.

---

## Setting up Slack (live rate-limit alerts)

1. Create an app at <https://api.slack.com/apps> → **OAuth & Permissions**
2. Add bot scopes: `chat:write`, `channels:read`, `groups:read`
3. Add the redirect URL: `http://localhost:4000/api/slack/oauth/callback`
4. Copy **Client ID/Secret** into `backend/.env.local` (`SLACK_CLIENT_ID`,
   `SLACK_CLIENT_SECRET`) and restart the API
5. In the dashboard header click **Connect Slack** → pick a channel/workspace

Behaviour:

- A rate-limit hit sends a **real `chat.postMessage`** to the connected
  workspace (verified live: message contains sender, limit, deferral time)
- Exactly **one notification per sender per hour** (Redis `NX` bell) so a
  1000-email burst does not spam the channel
- If Slack is **not** connected the notification is silently skipped — no
  crash; connecting later starts notifications on the next hit **without a redeploy**
- **Disconnect** just flips a DB flag; reconnect restores it

---

## How scheduling & persistence work

1. **`POST /api/emails/schedule`** validates payload (zod), extracts unique
   emails from `csvText`/`leads`, computes each `scheduledAt = startTime + i × delay`.
2. **Persist first**: all rows are inserted in MySQL with status `scheduled`,
   each carrying a freshly generated `queueJobId`.
3. **Then enqueue**: `queue.add("send-email", data, { jobId: queueJobId, delay })`.
4. **Worker** (`src/queue/worker.ts`):
   - loads the row; ignores the job if `row.queueJobId !== job.id` (**stale copy**)
   - **atomic claim** (`status IN (scheduled,failed,deferred) → processing`)
   - **gap gate** → if busy, defer a few hundred ms
   - **rate limit** → if over, defer to the next hour window + send one Slack alert
   - **send** via Ethereal → `status=sent`, index in Elasticsearch
   - on SMTP error → `status=failed`, rethrow → BullMQ retries with backoff
5. **Restart**:
   - MySQL still holds the full state; Redis (with AOF enabled) still holds
     delayed jobs
   - on boot `reconcileQueueOnStartup()` walks `scheduled/deferred` rows and
     re-enqueues only those whose exact job id is **missing** from Redis,
     with `delay = scheduledAt − now` → **future emails fire at the right
     time, nothing is re-sent**
   - rows already `sent` are never claimed again (idempotency), so emails are
     never duplicated

> **Verified in testing:** flushing the entire Redis keyspace and restarting
> both processes re-enqueued all pending rows and delivered them exactly once.

---

## Rate limiting, concurrency & delay — how it is enforced

| Control | Mechanism | Where |
| ------- | --------- | ----- |
| **Concurrency** | BullMQ worker `concurrency = WORKER_CONCURRENCY` (default 5) | `queue/worker.ts` |
| **Min delay between sends** | Redis key `gap:{senderId}` created with `SET NX PX minDelay` — an extra worker must wait for TTL before claiming the next slot | `rateLimiter.service.ts::acquireSendGap` |
| **Hourly limits** | One **Lua script** does `check + INCR` atomically for both `rl:s:{sender}:{hour}` and `rl:g:{hour}` — safe across any number of workers/instances | `rateLimiter.service.ts::reserveSendSlot` |
| **Global conveyor** | BullMQ built-in worker `limiter` (`maxEmailsPerHour` bucketed over 9s windows) | `queue/worker.ts` |

Limits are **env-configurable** (`MAX_EMAILS_PER_HOUR`,
`MAX_EMAILS_PER_HOUR_PER_SENDER`) and can be **overridden per sender** from
the compose form (clamped to the env cap).

When a limit is reached the job is **not dropped or failed**:

```ts
deferMs = millisecondsUntilNextHourWindow + batchIndex × MIN_DELAY
enqueueNewJob(row.queueJobId = nanoid(), delay = deferMs)
```

…so jobs move into the **next hour window** while keeping their original
order as much as possible.

**Trade-offs**

- The hourly counter is a fixed calendar-hour window (UTC), not a sliding
  window — much cheaper and good enough for cold-email throttling.
- The gap gate serialises sends **per sender** (by design — it mirrors a
  provider throttle) while different senders send in parallel within
  `WORKER_CONCURRENCY`.
- The Lua check uses a read-then-`INCR`; a tiny race between `GET` and the
  script across instances can admit a handful of stragglers over the cap —
  irrelevant at cold-email volume, but replaceable with a pure `INCR`
  compare pattern if strictness matters.

### Behaviour under load (1000+ emails, limit exceeded)

1. All 1000 rows are persisted; 1000 delayed jobs are created in Redis.
2. BullMQ's `limiter` + `concurrency` drain the queue at a bounded rate.
3. The first `MAX_EMAILS_PER_HOUR_PER_SENDER` emails in the window are
   **sent**; every later one is **deferred** to `nextHour + batchIndex × delay`
   (bucketed, order-preserving), never dropped.
4. **One Slack alert per sender per window** fires on the first hit.
5. Nothing is held in memory: state is MySQL + Redis, so a restart mid-burst
   resumes where it left off.

---

## API reference

All `/api/*` routes except `/auth/google*` and `/slack/oauth/callback` require `Authorization: Bearer <jwt>`.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/health` | liveness |
| GET | `/api/auth/google` | start Google OAuth |
| GET | `/api/auth/google/callback` | OAuth callback → JWT → frontend |
| POST | `/api/auth/demo` | dev-only demo token (`AUTH_DEMO_MODE`) |
| GET | `/api/auth/me` | current user |
| POST | `/api/emails/schedule` | schedule a batch |
| GET | `/api/emails/scheduled` | pending/deferred jobs |
| GET | `/api/emails/sent` | sent + failed jobs |
| GET | `/api/emails/:id` | single job |
| GET | `/api/search/senders` | sender pool |
| GET | `/api/search/emails?q=` | Elasticsearch search |
| POST | `/api/search/reindex` | rebuild index from DB |
| GET | `/api/slack/connect` | start Slack OAuth |
| GET | `/api/slack/oauth/callback` | Slack callback |
| GET | `/api/slack/status` | connected? |
| POST | `/api/slack/disconnect` | disconnect |
| GET | `/admin/queues` | **live BullMQ dashboard** |

Example schedule request:

```bash
TOKEN=...
curl -X POST http://localhost:4000/api/emails/schedule \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "subject": "Quick intro",
    "body": "<p>Hi {{name}}</p>",
    "csvText": "alice@example.com,bob@acme.com\ncarol@corp.io",
    "startTime": "2026-09-24T20:00:00.000Z",
    "delayBetweenEmails": 3,
    "hourlyLimit": 60
  }'
```

---

## Demo video (≤5 minutes) — suggested script

1. **Schedule** (0:00–0:45) — open dashboard → *Compose New Email* → upload a
   CSV (show "N emails detected") → subject/body → start time = now+1 min →
   *Schedule* → toast + rows in **Scheduled Emails**.
2. **Bull board** (0:45–1:10) — open `/admin/queues`, show delayed jobs
   counting down.
3. **Sent** (1:10–1:45) — switch to **Sent Emails** after delivery, open an
   Ethereal message link to prove real SMTP delivery. Show Elasticsearch
   search box finding an email by address.
4. **Restart scenario** (1:45–3:00) — schedule more emails ~2 minutes out →
   `Ctrl+C` the API **and** worker → show nothing lost → restart both →
   Bull Board shows the jobs again → they deliver on time, **exactly once**
   (can additionally `docker exec -it reachinbox-redis redis-cli flushdb`
   before restart to show DB-driven reconciliation).
5. **Rate limit / delay under load** (3:00–4:15) — set
   `MAX_EMAILS_PER_HOUR_PER_SENDER=3`, schedule 6 emails → first 3 sent,
   remaining 3 show `deferred → next hour` (order preserved) and **one Slack
   message** appears in your workspace.
6. **Google login** (4:15–5:00) — logout → real Google sign-in → header shows
   name/email/avatar.

---

## Optional automated smoke test (frontend)

```bash
cd frontend
npm i -D playwright
npx playwright install chromium
$env:SHOT_DIR="$env:TEMP\reachinbox-shots"; New-Item -ItemType Directory -Force $env:SHOT_DIR | Out-Null
node e2e/smoke.mjs
```

Walks the full UI flow (login → compose → CSV upload → schedule → search →
sent tab) and writes screenshots to `$SHOT_DIR`.

---

## Assumptions, shortcuts & trade-offs

- **MySQL chosen** over PostgreSQL (compose ships MySQL 8 on host port 3307).
- **`synchronize: true`** for schema bootstrap so the demo runs with zero
  migration setup; production should switch to TypeORM migrations.
- **Schema on one "hour window"** (UTC calendar hour) rather than a sliding
  window — cheaper and matches "next available hour window" semantics.
- **Auth**: Google OAuth is implemented with passport JWT issuance and no
  server session store; a clearly-marked `AUTH_DEMO_MODE` fallback exists for
  local work without Google credentials (disabled by default in real deploys).
- **Slack** is app-level (bot token per user) rather than incoming-webhooks,
  because the assignment explicitly asks for a real OAuth authorize flow.
- **Ethereal account sharing**: Ethereal sometimes returns the same account
  for rapid successive calls; provisioning retries with spacing and
  de-duplicates (typically 2–3 distinct mailboxes on a fresh boot).
- **Ordering**: BullMQ gives no global FIFO for delayed jobs; we preserve
  relative order by `batchIndex` offsets on deferral and by `scheduledAt`
  spacing at enqueue time — "as much as possible", as the spec allows.
- **Retention**: old `sent/failed` rows are cleaned after 30 days
  (`cleanupExpiredRows`, scheduled via a lazy call — not a cron job).
- **No Docker images** for the API/worker themselves — they run as plain
  `npm` processes so the demo needs only Redis/MySQL/ES containers. Adding
  Dockerfiles would be a trivial follow-up.
