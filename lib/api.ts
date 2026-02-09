import type { CancerCenter, CenterOfficesResponse } from "@/lib/types";

interface GetCentersOptions {
  tier?: string;
  activeOnly?: boolean;
}

interface GetCenterOfficesOptions {
  radiusKm?: number;
  limit?: number | null;
  highConfidenceOnly?: boolean;
  search?: string;
}

function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
}

function endpoint(path: string): string {
  const base = apiBaseUrl();
  if (!base) return path;
  return `${base}${path}`;
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Request failed (${response.status}): ${payload}`);
  }
  return (await response.json()) as T;
}

export async function getCenters(
  options: GetCentersOptions = {}
): Promise<CancerCenter[]> {
  const params = new URLSearchParams();

  if (options.tier) {
    params.set("tier", options.tier);
  }

  params.set("activeOnly", String(options.activeOnly ?? true));

  const response = await fetch(
    endpoint(`/api/centers?${params.toString()}`),
    {
      method: "GET",
      cache: "no-store",
    }
  );

  return parseJsonOrThrow<CancerCenter[]>(response);
}

export async function getCenterOffices(
  centerId: number,
  options: GetCenterOfficesOptions = {}
): Promise<CenterOfficesResponse> {
  const params = new URLSearchParams();
  params.set("radiusKm", String(options.radiusKm ?? 25));
  if (typeof options.limit === "number" && Number.isFinite(options.limit)) {
    params.set("limit", String(options.limit));
  }
  if (options.search?.trim()) {
    params.set("search", options.search.trim());
  }
  params.set(
    "highConfidenceOnly",
    String(options.highConfidenceOnly ?? false)
  );

  const response = await fetch(
    endpoint(`/api/centers/${centerId}/offices?${params.toString()}`),
    {
      method: "GET",
      cache: "no-store",
    }
  );

  return parseJsonOrThrow<CenterOfficesResponse>(response);
}
