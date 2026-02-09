# Cloudflare Implementation Guide (TypeScript) — Cancer Centers + Nearby Offices (OSM/Overpass) + D1 + Map UI (mapcn)

This guide defines a minimal, production-oriented architecture on Cloudflare using:
- Cloudflare Worker (TypeScript) for API + scheduled refresh
- Cloudflare D1 (SQLite) for persistence
- Cloudflare Pages for frontend (TypeScript) using mapcn to render markers

The core idea:
1) You maintain a curated list of cancer centers with lat/lon in D1.
2) A scheduled Worker job periodically calls Overpass (OpenStreetMap query API) around each center (e.g., 10–25km), upserts offices into D1, and links offices to centers.
3) The frontend queries the API to display centers and offices on a map.

---

## 0) Repo Structure

repo/
  worker/
    src/
      index.ts
      overpass.ts
      db.ts
      router.ts
    migrations/
      0001_init.sql
      0002_seed_centers.sql   (optional)
    wrangler.toml
    package.json
    tsconfig.json
  web/
    package.json
    vite.config.ts (or next.config.js)
    src/
      main.tsx (or main.ts)
      api.ts
      pages/
        MapPage.tsx
      components/
        MapView.tsx  (mapcn integration)
    wrangler.toml (Pages config optional)

---

## 1) Cloudflare D1 Schema (migrations)

### worker/migrations/0001_init.sql

PRAGMA foreign_keys=ON;

-- Cancer centers (curated)
CREATE TABLE IF NOT EXISTS cancer_centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  tier TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  country TEXT,
  region TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Offices fetched from OSM (dedup by osm_type + osm_id)
CREATE TABLE IF NOT EXISTS offices (
  osm_type TEXT NOT NULL,          -- node | way | relation
  osm_id INTEGER NOT NULL,
  name TEXT,
  brand TEXT,
  operator TEXT,
  website TEXT,
  wikidata TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  tags_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (osm_type, osm_id)
);

-- Link center -> office with precomputed distance (meters)
CREATE TABLE IF NOT EXISTS center_office (
  center_id INTEGER NOT NULL,
  osm_type TEXT NOT NULL,
  osm_id INTEGER NOT NULL,
  distance_m REAL NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (center_id, osm_type, osm_id),
  FOREIGN KEY (center_id) REFERENCES cancer_centers(id) ON DELETE CASCADE,
  FOREIGN KEY (osm_type, osm_id) REFERENCES offices(osm_type, osm_id) ON DELETE CASCADE
);

-- Refresh cursor/state (single-row key/value store)
CREATE TABLE IF NOT EXISTS refresh_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_centers_country ON cancer_centers(country);
CREATE INDEX IF NOT EXISTS idx_center_office_center ON center_office(center_id);
CREATE INDEX IF NOT EXISTS idx_offices_latlon ON offices(lat, lon);

### worker/migrations/0002_seed_centers.sql (optional)
-- Insert a small seed set for testing. Replace with real curated list later.
INSERT INTO cancer_centers (name, tier, lat, lon, country, region, source_url)
VALUES
('Princess Margaret Cancer Centre', 'Tier1', 43.6582, -79.3907, 'CA', 'ON', 'https://www.uhn.ca/PrincessMargaret');

---

## 2) Wrangler Config (Worker + D1 + Cron)

### worker/wrangler.toml

name = "cancer-jobs-worker"
main = "src/index.ts"
compatibility_date = "2026-02-09"

# Bind a D1 database
[[d1_databases]]
binding = "DB"
database_name = "cancer_jobs_db"
database_id = "<fill_after_creation>"

# Scheduled trigger (adjust as needed)
[triggers]
crons = ["0 * * * *"]  # hourly

# Optional: environment variables
[vars]
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
DEFAULT_RADIUS_M = "25000"
BATCH_CENTERS_PER_RUN = "10"
OVERPASS_THROTTLE_MS = "1200"

---

## 3) Worker Implementation

### 3.1) Types and DB Helpers (worker/src/db.ts)

Responsibilities:
- Wrap D1 access
- Provide small helper functions:
  - getCenters(limit, cursor)
  - upsertOffice(...)
  - upsertCenterOffice(...)
  - getCenterById(...)
  - getOfficesForCenter(centerId, radius override)
  - get/set refresh_state cursor

Key patterns:
- Use prepared statements.
- Keep responses small and map-ready.

### 3.2) Overpass Query Builder (worker/src/overpass.ts)

Provide a function:
- buildOfficesQuery(lat, lon, radiusM): string

Recommended Overpass query (start conservative; tune later):
[out:json][timeout:25];
(
  nwr(around:R, LAT, LON)["office"="company"];
  nwr(around:R, LAT, LON)["building"="office"];
);
out center tags;

Implement:
- fetchOverpass(query): JSON with retry/backoff on 429/5xx
- parseElements(elements): normalize to:
  - osm_type, osm_id
  - lat/lon (node lat/lon OR el.center.lat/lon)
  - tags (name/brand/operator/website/wikidata)
- throttle between calls to be polite to public Overpass instances

### 3.3) Distance Helper (Haversine) (worker/src/index.ts or utils)
Compute distance_m between center and office and store in center_office.

### 3.4) Routing (worker/src/router.ts)
Minimal router for:
- GET /api/centers
  - returns centers with id, name, tier, lat, lon
- GET /api/centers/:id/offices?radiusKm=25&limit=500
  - reads from D1 center_office join offices
  - default: return offices already linked for that center (fast)
  - OPTIONAL: if radiusKm differs from stored radius:
      - filter on distance_m <= radiusKm*1000 (if you precomputed distance_m on insert)
- POST /api/admin/centers (optional)
  - add/update curated center list (protect with a secret header)

Return JSON payloads optimized for map display:
- Keep only needed fields + stable identifiers.

### 3.5) Main Worker Entry (worker/src/index.ts)

Implement:
export default {
  async fetch(req, env, ctx) {
    // route requests
  },
  async scheduled(event, env, ctx) {
    // run refresh job in batches
  }
}

Scheduled job algorithm (batching + cursor):
1) Read refresh_state key "center_cursor" (default "0")
2) Select next BATCH_CENTERS_PER_RUN centers where id > cursor ORDER BY id LIMIT N
3) If none, reset cursor to "0" and exit
4) For each center:
   a) call Overpass with radius DEFAULT_RADIUS_M
   b) upsert offices
   c) upsert center_office links with distance + last_seen timestamp
   d) commit progressively (D1 is transactional but keep inserts moderate)
5) Update cursor to last processed center id

Pruning stale links:
- Option: after inserting current batch, delete center_office rows for that center where last_seen < now - X days
  (so removed/moved OSM objects eventually disappear)

---

## 4) Local Development Steps

### 4.1) Install worker dependencies
cd worker
npm i

### 4.2) Create D1 database
wrangler d1 create cancer_jobs_db
- Copy database_id into wrangler.toml

### 4.3) Apply migrations locally
wrangler d1 migrations apply cancer_jobs_db --local

### 4.4) Run worker locally
wrangler dev

### 4.5) Apply migrations to production
wrangler d1 migrations apply cancer_jobs_db

### 4.6) Deploy worker
wrangler deploy

---

## 5) Frontend (Cloudflare Pages) + mapcn

### 5.1) Frontend Responsibilities
- Call GET /api/centers, plot center markers
- On selection, call GET /api/centers/:id/offices and plot office markers
- Provide filters (tier, radius, “only offices with website/wikidata”, etc.)

### 5.2) Suggested API client (web/src/api.ts)
- getCenters()
- getOffices(centerId, radiusKm)

### 5.3) Map rendering (MapPage.tsx)
- Render mapcn map component
- Add:
  - center markers (distinct style)
  - office markers (cluster optional)
  - popup on click showing name + website (if available)
  - link to external map for directions

### 5.4) Hosting
- Deploy web/ to Cloudflare Pages
- Configure environment variable for API base URL (if separate domains)
- Or host under same zone and proxy requests to Worker route.

---

## 6) Data Quality + “Large Company” Pruning (MVP Strategy)

OSM does not reliably encode “large employer.” Implement a conservative filter at first:
- Keep offices where (name exists) AND (website OR wikidata OR brand/operator exists)
- Otherwise store but mark as low_confidence = 1 (add a column if desired)

Phase 2 enrichment (optional):
- If wikidata exists, call Wikidata SPARQL to fetch employees / market cap and store in companies table.
- Then offer “Large employer only” filter based on employees threshold.
Note: Do this as a separate scheduled job or as part of refresh (but keep runtime bounded).

---

## 7) Security / Abuse Controls (minimal)

- Add basic rate limiting to API endpoints (per-IP via Cloudflare rate limiting or simple in-code token bucket if needed).
- Protect admin endpoints with a secret header:
  - env var ADMIN_TOKEN
  - require `Authorization: Bearer <token>`

---

## 8) Example Overpass Turbo Test Query (manual validation)

Use to validate tagging density around a center:
[out:json][timeout:25];
(
  nwr(around:10000, 43.6582, -79.3907)["office"="company"];
  nwr(around:10000, 43.6582, -79.3907)["building"="office"];
);
out center tags;

---

## 9) Minimal Endpoints Spec

GET /api/centers
Response:
[
  { "id": 1, "name": "...", "tier": "Tier1", "lat": 43.65, "lon": -79.39, "country": "CA", "region": "ON" },
  ...
]

GET /api/centers/:id/offices?radiusKm=25&limit=500
Response:
{
  "center": { "id": 1, "name": "...", "lat": ..., "lon": ... },
  "radiusKm": 25,
  "offices": [
    { "osmType":"node", "osmId":123, "name":"...", "lat":..., "lon":..., "website":"...", "distanceM": 1820 },
    ...
  ]
}

---

## 10) Operational Notes

- Start with radius 10–25km to keep Overpass payloads manageable.
- Use batching (N centers per scheduled run).
- Consider multiple Overpass endpoints for resilience (fallback list).
- Keep D1 payload sizes small; paginate offices if needed.
- Add a manual “refresh center now” admin route for debugging.

---

## 11) Deliverables Checklist

- [ ] D1 migrations created and applied
- [ ] Worker routes implemented and returning JSON
- [ ] Scheduled job populates D1 with offices and links
- [ ] Pages frontend displays centers and offices via mapcn
- [ ] Basic filters (tier, radius, confidence)
- [ ] Logging for refresh runs (counts, errors, last cursor)

End of guide.
