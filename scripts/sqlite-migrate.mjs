#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = "data/cancerjobs.sqlite";
const DEFAULT_MIGRATIONS_DIR = "db/migrations";
const MIGRATIONS_TABLE = "_local_migrations";

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const [key, valueFromEquals] = token.split("=");
    const normalizedKey = key.slice(2);

    if (valueFromEquals !== undefined) {
      parsed[normalizedKey] = valueFromEquals;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[normalizedKey] = next;
      index += 1;
      continue;
    }

    parsed[normalizedKey] = "true";
  }

  return parsed;
}

function resolveDbPath(rawPath) {
  const selectedPath =
    rawPath ??
    process.env.LOCAL_SQLITE_PATH ??
    process.env.SQLITE_DB_PATH ??
    DEFAULT_DB_PATH;

  if (path.isAbsolute(selectedPath)) return selectedPath;
  return path.join(process.cwd(), selectedPath);
}

function printUsage() {
  console.log(`Usage:
  node scripts/sqlite-migrate.mjs [--db data/cancerjobs.sqlite]

Optional:
  --migrations db/migrations
`);
}

const args = parseArgs(process.argv.slice(2));

if (args.help === "true") {
  printUsage();
  process.exit(0);
}

const dbPath = resolveDbPath(args.db);
const migrationsDir = path.join(
  process.cwd(),
  args.migrations ?? DEFAULT_MIGRATIONS_DIR
);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new DatabaseSync(dbPath);
sqlite.exec("PRAGMA foreign_keys = ON;");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA synchronous = NORMAL;");

sqlite.exec(
  [
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (`,
    "  name TEXT PRIMARY KEY,",
    "  applied_at TEXT NOT NULL DEFAULT (datetime('now'))",
    ");",
  ].join("\n")
);

const appliedRows = sqlite.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`).all();
const applied = new Set(
  appliedRows
    .map((row) => row.name)
    .filter((value) => typeof value === "string")
);

const migrationFiles = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

if (migrationFiles.length === 0) {
  console.error(`No migration files found in ${migrationsDir}`);
  process.exit(1);
}

let appliedCount = 0;

for (const migrationName of migrationFiles) {
  if (applied.has(migrationName)) continue;

  const migrationSql = fs.readFileSync(
    path.join(migrationsDir, migrationName),
    "utf8"
  );

  console.log(`Applying ${migrationName}...`);
  sqlite.exec("BEGIN");
  try {
    sqlite.exec(migrationSql);
    sqlite
      .prepare(
        `INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES (?, datetime('now'))`
      )
      .run(migrationName);
    sqlite.exec("COMMIT");
    appliedCount += 1;
  } catch (error) {
    sqlite.exec("ROLLBACK");
    console.error(
      `Migration failed (${migrationName}): ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
    process.exit(1);
  }
}

if (appliedCount === 0) {
  console.log("No pending migrations.");
} else {
  console.log(`Applied ${appliedCount} migration(s).`);
}

console.log(`SQLite DB: ${dbPath}`);
