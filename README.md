# Cancer Jobs

Cancer Jobs helps cancer patients and caretakers discover job opportunities near major cancer centers.

## Architecture

- Next.js app serves the UI and API routes (`/api/*`).
- Data is stored in a local SQLite database file (`data/cancerjobs.sqlite` by default).
- API/refresh/query logic lives in `lib/server/core/*` and is used by Next API handlers.
- Office refresh includes Wikidata enrichment for:
  - Employees (`P1128`)
  - Market capitalization (`P2226`)
- Office refresh saves only points whose name/brand/operator matches a company
  name or alias from the `companies` table.

## Local Development

### 1) Install dependencies

```bash
pnpm install
```

### 2) Configure environment variables

Copy `.env.example` to `.env` and set at minimum:

- `ADMIN_API_TOKEN`
- `BETTER_AUTH_SECRET`

Optional:

- `LOCAL_SQLITE_PATH` (default: `data/cancerjobs.sqlite`)
- `NEXT_PUBLIC_API_BASE_URL` (leave empty for same-origin API)
- `API_URL` (used by CLI scripts, default example: `http://localhost:3002`)
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `ADMIN_ALLOWED_ORIGINS`

### 3) Apply SQLite migrations

```bash
pnpm db:migrate
```

### 4) Run checks

```bash
pnpm lint
```

## API Endpoints

- `GET /api/centers`
- `GET /api/centers/:id/offices?radiusKm=25&limit=500&highConfidenceOnly=false`
- `POST /api/admin/centers/upload-csv` (Bearer token)
- `POST /api/admin/companies/upload-csv` (Bearer token)
- `POST /api/admin/refresh-center/:id` (Bearer token)
- `POST /api/admin/refresh-batch` (Bearer token)
- `POST /api/admin/refresh-all` (Bearer token)
- `GET /api/admin/status` (Bearer token)
- `GET /api/health`

`GET /api/centers/:id/offices` includes optional enrichment fields per office:

- `wikidataEntityId`
- `employeeCount`, `employeeCountAsOf`
- `marketCap`, `marketCapCurrencyQid`, `marketCapAsOf`
- `wikidataEnrichedAt`

For `GET /api/centers/:id/offices`:
- `radiusKm` supports `10`, `25`, `50`, or `100` from the UI.
- `limit` is optional; if omitted/blank, results are unlimited.

## Admin Dashboard Security

Admin UI is available at `/admin` and is protected with:

- Better Auth email/password users + sessions stored in SQLite
- Admin authorization via `admin_users` table
- Same-origin checks on admin mutations
- Server-only admin API bearer token (`ADMIN_API_TOKEN`)

First-time admin bootstrap:

1. Create a user from the `/admin` sign-up form.
2. The first signed-up user is automatically granted admin access.

Refresh controls in `/admin` support:
- Radius options: `10`, `25`, `50`, `100` km
- Max offices per center: blank for unlimited
- Company CSV upload with dedupe by normalized `company_name`
- Company pre-filtering during refresh so only known companies are persisted
- Optional full clean refresh toggle (deletes all saved office points, then rescans)

## CSV Upload for Cancer Centers

Upload curated centers with `POST /api/admin/centers/upload-csv`.

### Required CSV columns

- `center_code` (stable unique key)
- `name`
- `lat`
- `lon`
- `country`
- `region`
- `tier`
- `source_url`

### Behavior

- Rows are upserted by `center_code`.
- Centers missing from latest CSV are soft-disabled (`is_active = 0`).
- No hard deletes of centers.

### Scripted upload

```bash
pnpm csv:upload -- \
  --url http://localhost:3002 \
  --token <ADMIN_API_TOKEN> \
  --file templates/cancer_centers_template.csv
```

## CSV Upload for Companies

Upload companies with `POST /api/admin/companies/upload-csv`.

### Required CSV columns

- `company_name`

### Optional CSV columns

- `known_aliases` (pipe-delimited aliases)
- `hq_country`
- `desc`
- `type`
- `geography`
- `industry`
- `suitability_tier`

### Behavior

- Rows are deduped by normalized `company_name` (case-insensitive, collapsed whitespace).
- Existing companies are skipped (not updated).
- Duplicate company names inside the same CSV are collapsed to one row.

## Health Check

```bash
pnpm ops:health-check -- \
  --url http://localhost:3002 \
  --token <ADMIN_API_TOKEN>
```

## Office Cleanup (nameless + duplicates)

Audit data:

```bash
pnpm db:audit-offices
```

Cleanup:

```bash
pnpm db:cleanup-offices
```

Audit again:

```bash
pnpm db:audit-offices
```
