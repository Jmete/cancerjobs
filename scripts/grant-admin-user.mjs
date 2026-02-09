#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = "data/cancerjobs.sqlite";

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
  pnpm admin:grant -- --email you@example.com

Optional:
  --db data/cancerjobs.sqlite
`);
}

const args = parseArgs(process.argv.slice(2));

if (args.help === "true") {
  printUsage();
  process.exit(0);
}

const email = String(args.email ?? "")
  .trim()
  .toLowerCase();

if (!email) {
  printUsage();
  process.exit(1);
}

const dbPath = resolveDbPath(args.db);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new DatabaseSync(dbPath);
sqlite.exec("PRAGMA foreign_keys = ON;");

const user = sqlite
  .prepare(
    [
      'SELECT id, email FROM "user"',
      "WHERE lower(email) = lower(?)",
      "LIMIT 1",
    ].join("\n")
  )
  .get(email);

if (!user?.id || !user?.email) {
  console.error(`No Better Auth user found for email: ${email}`);
  process.exit(1);
}

sqlite
  .prepare(
    [
      "INSERT INTO admin_users (user_id, granted_at)",
      "VALUES (?, datetime('now'))",
      "ON CONFLICT(user_id) DO UPDATE SET granted_at = excluded.granted_at",
    ].join("\n")
  )
  .run(String(user.id));

console.log(`Granted admin access to ${String(user.email)} (${String(user.id)}).`);
