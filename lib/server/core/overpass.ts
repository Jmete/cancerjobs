import type { Env, Office } from "./types";
import { normalizeWikidataEntityId, sanitizeText, sleep } from "./utils";

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

function getOverpassUrls(raw: string | undefined): string[] {
  if (!raw) return ["https://overpass-api.de/api/interpreter"];
  const urls = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return urls.length > 0 ? urls : ["https://overpass-api.de/api/interpreter"];
}

export function buildOfficesQuery(
  latitude: number,
  longitude: number,
  radiusM: number
): string {
  return [
    "[out:json][timeout:25];",
    "(",
    `  nwr(around:${radiusM}, ${latitude}, ${longitude})[\"office\"];`,
    `  nwr(around:${radiusM}, ${latitude}, ${longitude})[\"building\"=\"office\"];`,
    ");",
    "out center tags;",
  ].join("\n");
}

export async function fetchOverpassElements(
  env: Env,
  query: string
): Promise<OverpassElement[]> {
  const urls = getOverpassUrls(env.OVERPASS_URL);
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (const url of urls) {
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          body: query,
          headers: {
            "content-type": "text/plain; charset=utf-8",
          },
        });

        if (response.ok) {
          const payload = (await response.json()) as OverpassResponse;
          return payload.elements ?? [];
        }

        if (response.status === 429 || response.status >= 500) {
          const waitMs = 400 * (attempt + 1);
          await sleep(waitMs);
          continue;
        }

        lastError = new Error(
          `Overpass request failed with status ${response.status}`
        );
        break;
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error("Unknown Overpass error");
        const waitMs = 400 * (attempt + 1);
        await sleep(waitMs);
      }
    }
  }

  throw lastError ?? new Error("Overpass request failed after retries");
}

function getCoordinates(
  element: OverpassElement
): { lat: number; lon: number } | null {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lon: element.lon };
  }

  if (
    typeof element.center?.lat === "number" &&
    typeof element.center.lon === "number"
  ) {
    return { lat: element.center.lat, lon: element.center.lon };
  }

  return null;
}

function isLowConfidence(tags: Record<string, string>): boolean {
  const name = sanitizeText(tags.name, 300);
  const hasEvidence = Boolean(
    sanitizeText(tags.website, 500) ||
      sanitizeText(tags.wikidata, 200) ||
      sanitizeText(tags.brand, 250) ||
      sanitizeText(tags.operator, 250)
  );

  return !(name && hasEvidence);
}

function normalizeNameForKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function coordinateKey(value: number): string {
  return value.toFixed(6);
}

function officeScore(office: Office): number {
  let score = 0;
  if (office.website) score += 4;
  if (office.wikidata) score += 3;
  if (office.brand) score += 2;
  if (office.operator) score += 1;
  return score;
}

export function normalizeOverpassElements(elements: OverpassElement[]): Office[] {
  const dedupedByNameAndCoords = new Map<string, Office>();

  for (const element of elements) {
    if (!["node", "way", "relation"].includes(element.type)) {
      continue;
    }

    const coords = getCoordinates(element);
    if (!coords) continue;

    const tags = element.tags ?? {};
    const name = sanitizeText(tags.name, 300);
    if (!name) {
      continue;
    }

    const normalized: Office = {
      osmType: element.type,
      osmId: element.id,
      name,
      brand: sanitizeText(tags.brand, 250),
      operator: sanitizeText(tags.operator, 250),
      website: sanitizeText(tags.website, 500),
      wikidata: normalizeWikidataEntityId(sanitizeText(tags.wikidata, 200)),
      lat: coords.lat,
      lon: coords.lon,
      lowConfidence: isLowConfidence(tags),
      tagsJson: JSON.stringify(tags),
    };

    const dedupeKey = [
      normalizeNameForKey(name),
      coordinateKey(normalized.lat),
      coordinateKey(normalized.lon),
    ].join("|");

    const existing = dedupedByNameAndCoords.get(dedupeKey);
    if (!existing || officeScore(normalized) > officeScore(existing)) {
      dedupedByNameAndCoords.set(dedupeKey, normalized);
    }
  }

  return Array.from(dedupedByNameAndCoords.values());
}
