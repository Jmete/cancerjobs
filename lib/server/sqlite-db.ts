import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  SqlDatabase,
  SqlPreparedStatement,
  SqlResult,
} from "@/lib/server/core/types";

const DEFAULT_DB_PATH = "data/cancerjobs.sqlite";
const MIGRATIONS_DIR = "db/migrations";
const MIGRATIONS_TABLE = "_local_migrations";

function normalizeBinding(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function toPlainObject<T>(value: Record<string, unknown> | undefined): T | null {
  if (!value) return null;
  return { ...value } as T;
}

class SqlitePreparedStatement implements SqlPreparedStatement {
  constructor(
    private readonly adapter: SqliteDatabaseAdapter,
    private readonly query: string,
    private readonly bindings: unknown[] = []
  ) {}

  bind(...values: unknown[]): SqlPreparedStatement {
    const normalized = values.map(normalizeBinding);
    return new SqlitePreparedStatement(this.adapter, this.query, normalized);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const statement = this.adapter.sqlite.prepare(this.query);
    const row = statement.get(...this.bindings);
    return toPlainObject<T>(row);
  }

  async all<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    const statement = this.adapter.sqlite.prepare(this.query);
    const rows = statement
      .all(...this.bindings)
      .map((row) => ({ ...row } as T));

    return {
      success: true,
      results: rows,
      meta: {
        changes: 0,
      },
    };
  }

  async run<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    const statement = this.adapter.sqlite.prepare(this.query);
    const result = statement.run(...this.bindings);

    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  executeForBatch<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    return this.run<T>();
  }

  belongsTo(adapter: SqliteDatabaseAdapter): boolean {
    return this.adapter === adapter;
  }
}

class SqliteDatabaseAdapter implements SqlDatabase {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(query: string): SqlPreparedStatement {
    return new SqlitePreparedStatement(this, query);
  }

  async batch<T = Record<string, unknown>>(
    statements: SqlPreparedStatement[]
  ): Promise<Array<SqlResult<T>>> {
    if (statements.length === 0) return [];

    const typedStatements = statements.map((statement) => {
      if (!(statement instanceof SqlitePreparedStatement)) {
        throw new Error("Batch statements must come from local SQLite adapter.");
      }

      if (!statement.belongsTo(this)) {
        throw new Error("Batch statements are tied to a different DB instance.");
      }

      return statement;
    });

    this.sqlite.exec("BEGIN");
    try {
      const results: Array<SqlResult<T>> = [];
      for (const statement of typedStatements) {
        results.push(await statement.executeForBatch<T>());
      }
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function resolveDbPath(rawPath: string | undefined): string {
  const candidate = (rawPath ?? DEFAULT_DB_PATH).trim();
  if (path.isAbsolute(candidate)) return candidate;
  return path.join(process.cwd(), candidate);
}

function ensureDirectoryForFile(filePath: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
}

function applyMigrations(sqlite: DatabaseSync): void {
  sqlite.exec(
    [
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (`,
      "  name TEXT PRIMARY KEY,",
      "  applied_at TEXT NOT NULL DEFAULT (datetime('now'))",
      ");",
    ].join("\n")
  );

  const appliedRows = sqlite
    .prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`)
    .all() as Array<Record<string, unknown>>;
  const applied = new Set(
    appliedRows
      .map((row) => row.name)
      .filter((value): value is string => typeof value === "string")
  );

  const migrationsPath = path.join(process.cwd(), MIGRATIONS_DIR);
  const migrationFiles = fs
    .readdirSync(migrationsPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  for (const migrationName of migrationFiles) {
    if (applied.has(migrationName)) continue;

    const migrationSql = fs.readFileSync(
      path.join(migrationsPath, migrationName),
      "utf8"
    );

    sqlite.exec("BEGIN");
    try {
      sqlite.exec(migrationSql);
      sqlite
        .prepare(
          `INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES (?, datetime('now'))`
        )
        .run(migrationName);
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw new Error(
        `Failed applying migration ${migrationName}: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }
}

function createLocalAdapter(): SqliteDatabaseAdapter {
  const dbPath = resolveDbPath(
    process.env.LOCAL_SQLITE_PATH ?? process.env.SQLITE_DB_PATH
  );
  ensureDirectoryForFile(dbPath);

  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA synchronous = NORMAL;");
  applyMigrations(sqlite);

  return new SqliteDatabaseAdapter(sqlite);
}

declare global {
  var __cancerJobsSqliteAdapter: SqliteDatabaseAdapter | undefined;
}

export function getLocalDatabase(): SqlDatabase {
  if (!globalThis.__cancerJobsSqliteAdapter) {
    globalThis.__cancerJobsSqliteAdapter = createLocalAdapter();
  }

  return globalThis.__cancerJobsSqliteAdapter;
}
