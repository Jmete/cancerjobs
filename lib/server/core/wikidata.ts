import type { Env } from "./types";
import { chunk, normalizeWikidataEntityId, sleep } from "./utils";

const DEFAULT_WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php";
const EMPLOYEE_COUNT_PROPERTY = "P1128";
const MARKET_CAP_PROPERTY = "P2226";
const AS_OF_QUALIFIER = "P585";

interface WikidataApiResponse {
  entities?: Record<string, WikidataEntity>;
}

interface WikidataEntity {
  claims?: Record<string, WikidataClaim[]>;
}

interface WikidataClaim {
  rank?: string;
  mainsnak?: WikidataSnak;
  qualifiers?: Record<string, WikidataSnak[]>;
}

interface WikidataSnak {
  snaktype?: string;
  datavalue?: {
    value?: unknown;
  };
}

interface QuantityClaimValue {
  amount: number;
  unitQid: string | null;
  asOf: string | null;
  rankScore: number;
  asOfMs: number;
}

export interface WikidataEnrichment {
  wikidataEntityId: string;
  employeeCount: number | null;
  employeeCountAsOf: string | null;
  marketCap: number | null;
  marketCapCurrencyQid: string | null;
  marketCapAsOf: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function rankScore(rank: string | undefined): number {
  if (rank === "preferred") return 2;
  if (rank === "normal") return 1;
  return 0;
}

function parseIsoDate(value: string): string | null {
  const normalized = value.startsWith("+") ? value.slice(1) : value;
  const parsed = Date.parse(normalized);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }

  // Wikidata qualifiers can contain zeroed month/day for coarse precision.
  const coarseMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!coarseMatch) return null;

  const month = coarseMatch[2] === "00" ? "01" : coarseMatch[2];
  const day = coarseMatch[3] === "00" ? "01" : coarseMatch[3];
  const repaired = `${coarseMatch[1]}-${month}-${day}T00:00:00Z`;
  const repairedParsed = Date.parse(repaired);
  if (!Number.isFinite(repairedParsed)) return null;
  return new Date(repairedParsed).toISOString();
}

function parseAsOfQualifier(claim: WikidataClaim): string | null {
  const qualifiers = claim.qualifiers?.[AS_OF_QUALIFIER];
  if (!Array.isArray(qualifiers) || qualifiers.length === 0) return null;

  let bestAsOf: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;

  for (const qualifier of qualifiers) {
    const rawValue = qualifier.datavalue?.value;
    if (!isRecord(rawValue)) continue;

    const timeValue = rawValue.time;
    if (typeof timeValue !== "string") continue;

    const iso = parseIsoDate(timeValue);
    if (!iso) continue;

    const asOfMs = Date.parse(iso);
    if (asOfMs > bestMs) {
      bestMs = asOfMs;
      bestAsOf = iso;
    }
  }

  return bestAsOf;
}

function parseQuantityFromSnak(snak: WikidataSnak | undefined): {
  amount: number;
  unitQid: string | null;
} | null {
  if (!snak || snak.snaktype !== "value") return null;

  const rawValue = snak.datavalue?.value;
  if (!isRecord(rawValue)) return null;

  const amountRaw = rawValue.amount;
  if (typeof amountRaw !== "string" && typeof amountRaw !== "number") {
    return null;
  }

  const amount = Number.parseFloat(String(amountRaw));
  if (!Number.isFinite(amount)) return null;

  const unitRaw = rawValue.unit;
  const unitQid =
    typeof unitRaw === "string" ? normalizeWikidataEntityId(unitRaw) : null;

  return {
    amount,
    unitQid,
  };
}

function selectBestQuantityClaim(claims: WikidataClaim[] | undefined): {
  amount: number;
  unitQid: string | null;
  asOf: string | null;
} | null {
  if (!Array.isArray(claims) || claims.length === 0) return null;

  const candidates: QuantityClaimValue[] = [];

  for (const claim of claims) {
    if (claim.rank === "deprecated") continue;

    const quantity = parseQuantityFromSnak(claim.mainsnak);
    if (!quantity) continue;

    const asOf = parseAsOfQualifier(claim);
    const asOfMs = asOf ? Date.parse(asOf) : Number.NEGATIVE_INFINITY;

    candidates.push({
      amount: quantity.amount,
      unitQid: quantity.unitQid,
      asOf,
      rankScore: rankScore(claim.rank),
      asOfMs,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    if (right.rankScore !== left.rankScore) {
      return right.rankScore - left.rankScore;
    }
    return right.asOfMs - left.asOfMs;
  });

  const best = candidates[0];
  return {
    amount: best.amount,
    unitQid: best.unitQid,
    asOf: best.asOf,
  };
}

function toEmployeeCount(value: number): number | null {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded) || rounded < 0) return null;
  return rounded;
}

function mergeEntityClaims(entityId: string, entity: WikidataEntity | undefined): WikidataEnrichment {
  const employeeClaim = selectBestQuantityClaim(
    entity?.claims?.[EMPLOYEE_COUNT_PROPERTY]
  );
  const marketCapClaim = selectBestQuantityClaim(
    entity?.claims?.[MARKET_CAP_PROPERTY]
  );

  return {
    wikidataEntityId: entityId,
    employeeCount: employeeClaim ? toEmployeeCount(employeeClaim.amount) : null,
    employeeCountAsOf: employeeClaim?.asOf ?? null,
    marketCap: marketCapClaim?.amount ?? null,
    marketCapCurrencyQid: marketCapClaim?.unitQid ?? null,
    marketCapAsOf: marketCapClaim?.asOf ?? null,
  };
}

async function fetchEntitiesChunk(
  apiUrl: string,
  entityIds: string[],
  maxRetries: number
): Promise<WikidataApiResponse> {
  const params = new URLSearchParams({
    action: "wbgetentities",
    format: "json",
    props: "claims",
    ids: entityIds.join("|"),
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}?${params.toString()}`, {
        method: "GET",
        headers: {
          accept: "application/json",
        },
      });

      if (response.ok) {
        return (await response.json()) as WikidataApiResponse;
      }

      if (response.status === 429 || response.status >= 500) {
        const waitMs = 300 * (attempt + 1);
        await sleep(waitMs);
        continue;
      }

      throw new Error(`Wikidata request failed with status ${response.status}`);
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("Unknown Wikidata error");
      const waitMs = 300 * (attempt + 1);
      await sleep(waitMs);
    }
  }

  throw lastError ?? new Error("Wikidata request failed after retries");
}

export async function fetchWikidataEnrichment(
  env: Env,
  wikidataEntityIds: string[],
  options?: { chunkSize?: number; throttleMs?: number; maxRetries?: number }
): Promise<WikidataEnrichment[]> {
  const uniqueEntityIds = Array.from(
    new Set(
      wikidataEntityIds
        .map((value) => normalizeWikidataEntityId(value))
        .filter((value): value is string => Boolean(value))
    )
  );

  if (uniqueEntityIds.length === 0) return [];

  const configuredApiUrl = (env.WIKIDATA_API_URL ?? "").trim();
  const apiUrl = configuredApiUrl || DEFAULT_WIKIDATA_API_URL;
  const chunkSize = Math.max(1, options?.chunkSize ?? 30);
  const throttleMs = Math.max(0, options?.throttleMs ?? 0);
  const maxRetries = Math.max(1, options?.maxRetries ?? 3);

  const byId = new Map<string, WikidataEnrichment>(
    uniqueEntityIds.map((entityId) => [
      entityId,
      {
        wikidataEntityId: entityId,
        employeeCount: null,
        employeeCountAsOf: null,
        marketCap: null,
        marketCapCurrencyQid: null,
        marketCapAsOf: null,
      },
    ])
  );

  const groupedIds = chunk(uniqueEntityIds, chunkSize);

  for (let index = 0; index < groupedIds.length; index += 1) {
    const idsChunk = groupedIds[index];
    const payload = await fetchEntitiesChunk(apiUrl, idsChunk, maxRetries);
    const entities = payload.entities ?? {};

    for (const entityId of idsChunk) {
      byId.set(entityId, mergeEntityClaims(entityId, entities[entityId]));
    }

    if (throttleMs > 0 && index < groupedIds.length - 1) {
      await sleep(throttleMs);
    }
  }

  return Array.from(byId.values());
}
