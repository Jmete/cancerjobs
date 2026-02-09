import "server-only";

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getLocalDatabase } from "@/lib/server/sqlite-db";

interface BetterAuthSessionLike {
  user?: {
    id?: string;
    email?: string | null;
    name?: string | null;
  } | null;
}

export interface AdminUserSession {
  userId: string;
  email: string | null;
  name: string | null;
}

async function bootstrapFirstAdmin(userId: string): Promise<boolean> {
  const db = getLocalDatabase();

  const insertResult = await db
    .prepare(
      [
        "INSERT INTO admin_users (user_id, granted_at)",
        "SELECT u.id, datetime('now')",
        'FROM "user" u',
        "WHERE u.id = ?",
        "  AND NOT EXISTS (SELECT 1 FROM admin_users)",
        "  AND u.id = (",
        '    SELECT id FROM "user" ORDER BY "createdAt" ASC, id ASC LIMIT 1',
        "  )",
        "ON CONFLICT(user_id) DO NOTHING",
      ].join("\n")
    )
    .bind(userId)
    .run();

  const inserted = Number(insertResult.meta?.changes ?? 0) > 0;
  if (inserted) return true;

  const existing = await db
    .prepare("SELECT user_id FROM admin_users WHERE user_id = ?")
    .bind(userId)
    .first<{ user_id: string }>();

  return Boolean(existing?.user_id);
}

async function isAdminUser(userId: string): Promise<boolean> {
  const db = getLocalDatabase();
  const row = await db
    .prepare("SELECT user_id FROM admin_users WHERE user_id = ?")
    .bind(userId)
    .first<{ user_id: string }>();

  return Boolean(row?.user_id);
}

async function getSessionFromHeaders(
  requestHeaders: Headers
): Promise<BetterAuthSessionLike | null> {
  try {
    const session = (await auth.api.getSession({
      headers: requestHeaders,
    })) as BetterAuthSessionLike | null;
    return session;
  } catch {
    return null;
  }
}

async function resolveAdminSession(
  requestHeaders: Headers
): Promise<AdminUserSession | null> {
  const session = await getSessionFromHeaders(requestHeaders);
  const userId = session?.user?.id;
  if (!userId) return null;

  const admin =
    (await isAdminUser(userId)) || (await bootstrapFirstAdmin(userId));
  if (!admin) return null;

  return {
    userId,
    email: session?.user?.email ?? null,
    name: session?.user?.name ?? null,
  };
}

export async function getAdminSession(): Promise<AdminUserSession | null> {
  const requestHeaders = await headers();
  return resolveAdminSession(requestHeaders);
}

export async function isAdminSessionAuthenticated(): Promise<boolean> {
  return Boolean(await getAdminSession());
}

export async function isAdminRequestAuthenticated(
  request: Request
): Promise<boolean> {
  return Boolean(await resolveAdminSession(request.headers));
}

function parseAllowedOrigins(rawValue: string | undefined): Set<string> {
  if (!rawValue) return new Set();

  return new Set(
    rawValue
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.replace(/\/$/, ""))
  );
}

function normalizeHostHeader(value: string | null): string | null {
  if (!value) return null;
  return value.split(",")[0]?.trim().toLowerCase() || null;
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const normalizedOrigin = originUrl.origin.replace(/\/$/, "");

    const allowedOrigins = parseAllowedOrigins(process.env.ADMIN_ALLOWED_ORIGINS);
    if (allowedOrigins.has(normalizedOrigin)) {
      return true;
    }

    const requestUrl = new URL(request.url);
    const hostCandidates = new Set<string>();
    hostCandidates.add(requestUrl.host.toLowerCase());

    const forwardedHost = normalizeHostHeader(
      request.headers.get("x-forwarded-host")
    );
    if (forwardedHost) hostCandidates.add(forwardedHost);

    const hostHeader = normalizeHostHeader(request.headers.get("host"));
    if (hostHeader) hostCandidates.add(hostHeader);

    return hostCandidates.has(originUrl.host.toLowerCase());
  } catch {
    return false;
  }
}

export function unauthorizedResponse(): Response {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}
