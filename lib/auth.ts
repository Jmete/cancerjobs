import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";

import { getLocalDatabase } from "@/lib/server/sqlite-db";

const DEFAULT_DB_PATH = "data/cancerjobs.sqlite";
const MIN_SECRET_LENGTH = 32;

function resolveDbPath(rawPath: string | undefined): string {
  const selectedPath = (rawPath ?? DEFAULT_DB_PATH).trim();
  if (path.isAbsolute(selectedPath)) return selectedPath;
  return path.join(process.cwd(), selectedPath);
}

function ensureDirectoryForFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function getBetterAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      "Missing BETTER_AUTH_SECRET (minimum 32 characters required)."
    );
  }

  return secret;
}

function parseTrustedOrigins(rawValue: string | undefined): string[] {
  if (!rawValue) return [];

  return rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/\/$/, ""));
}

declare global {
  var __cancerJobsBetterAuthDb: DatabaseSync | undefined;
}

function getBetterAuthDatabase(): DatabaseSync {
  if (globalThis.__cancerJobsBetterAuthDb) {
    return globalThis.__cancerJobsBetterAuthDb;
  }

  // Ensures app migrations are applied before Better Auth touches tables.
  getLocalDatabase();

  const dbPath = resolveDbPath(
    process.env.LOCAL_SQLITE_PATH ?? process.env.SQLITE_DB_PATH
  );
  ensureDirectoryForFile(dbPath);

  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA synchronous = NORMAL;");

  globalThis.__cancerJobsBetterAuthDb = sqlite;
  return sqlite;
}

export const auth = betterAuth({
  secret: getBetterAuthSecret(),
  database: getBetterAuthDatabase(),
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: parseTrustedOrigins(
    process.env.BETTER_AUTH_TRUSTED_ORIGINS ??
      process.env.ADMIN_ALLOWED_ORIGINS
  ),
  plugins: [nextCookies()],
});
