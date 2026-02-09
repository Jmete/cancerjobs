export function toPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function toBoolean(
  value: string | null,
  defaultValue: boolean
): boolean {
  if (value === null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function haversineMeters(
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number
): number {
  const R = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(endLat - startLat);
  const dLon = toRadians(endLon - startLon);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(startLat)) *
      Math.cos(toRadians(endLat)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function sanitizeText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

const WIKIDATA_ENTITY_PATTERN = /\bQ[1-9]\d*\b/i;

export function normalizeWikidataEntityId(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const match = normalized.match(WIKIDATA_ENTITY_PATTERN);
  if (!match) return null;
  return match[0].toUpperCase();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function chunk<T>(values: T[], size: number): T[][] {
  if (size <= 0) return [values];
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
