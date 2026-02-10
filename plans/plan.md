# Local SQLite Implementation Guide (TypeScript) — Cancer Centers + Nearby Offices + Map UI

This guide describes the current local-first architecture:
- Next.js server routes for API and admin actions
- Local SQLite for persistence
- Map UI with mapcn + shadcn

Core flow:
1) Curated cancer centers are stored in SQLite.
2) Refresh jobs fetch office data from Overpass and upsert centers/offices/links.
3) Frontend reads `/api/centers` and `/api/centers/:id/offices`.

---

## 0) Repo Structure

repo/
  app/
    api/
      centers/
      admin/
      health/
  lib/
    server/
      core/
        router.ts
        db.ts
        refresh.ts
        overpass.ts
        wikidata.ts
        types.ts
      sqlite-db.ts
      local-api-handler.ts
      local-api-env.ts
  db/
    migrations/
    sql/
  scripts/
    sqlite-migrate.mjs
    sqlite-exec-file.mjs

---

## 1) Database

- SQLite file path is controlled by `LOCAL_SQLITE_PATH` (default `data/cancerjobs.sqlite`).
- Migrations are in `db/migrations`.
- SQL maintenance scripts are in `db/sql`.

---

## 2) API

Server routes:
- `GET /api/centers`
- `GET /api/centers/:id/offices`
- `POST /api/admin/centers/upload-csv`
- `POST /api/admin/companies/upload-csv`
- `POST /api/admin/refresh-center/:id`
- `POST /api/admin/refresh-batch`
- `POST /api/admin/refresh-all`
- `GET /api/admin/status`
- `GET /api/health`

Admin endpoints require `Authorization: Bearer <ADMIN_API_TOKEN>`.

---

## 3) Operations

- Run migrations: `pnpm db:migrate`
- Audit office data: `pnpm db:audit-offices`
- Cleanup duplicates/nameless offices: `pnpm db:cleanup-offices`
- Upload centers CSV: `pnpm csv:upload -- --url <API_URL> --token <ADMIN_API_TOKEN> --file <csv>`
- Upload companies CSV: `POST /api/admin/companies/upload-csv` (admin panel action)
- Health check: `pnpm ops:health-check -- --url <API_URL> --token <ADMIN_API_TOKEN>`

---

## 4) Environment

Required:
- `ADMIN_API_TOKEN`
- `BETTER_AUTH_SECRET`

Common optional:
- `LOCAL_SQLITE_PATH`
- `NEXT_PUBLIC_API_BASE_URL` (empty for same-origin)
- `API_URL` (for CLI scripts)

---

## 5) Deliverables Checklist

- [x] Local SQLite adapter with migration bootstrap
- [x] Next API routes wired to local backend core
- [x] Admin actions routed through local API only
- [x] SQLite scripts for migrate/audit/cleanup
- [x] Legacy remote DB/deploy scripts removed from root workflow
- [x] Local-only API and DB runtime fully in place
- [x] Better Auth + SQLite users/session tables for admin dashboard auth
- [x] Admin UI supports full-center refresh run with configurable throttling
- [x] Radius + max-results controls with optional unlimited office query
- [x] Admin refresh jobs support configurable radius and max offices per center
- [x] Debounced map sidebar search with office filtering and visible office count
- [x] SQLite index added for office name lookups
- [x] Companies table + admin CSV import with normalized-name dedupe and skip-if-existing behavior
- [x] Overpass refresh pre-filters office points by fuzzy-normalized company/alias matching from `companies`
- [x] Admin toggle for full clean refresh (delete points, then rescan all active centers)
- [x] Full refresh retries failed centers with configurable retry count and retry delay
- [x] Right panel office search now respects active office filters and supports click-to-zoom on map
- [x] Users can flag offices for deletion and admins can approve bans that persist across refresh runs
- [x] Map office popup now displays linked company name when available
- [x] Company matcher hardened against low-signal token false positives
