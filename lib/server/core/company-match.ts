import type { Office } from "./types";

export interface CompanyMatchRecord {
  id: number;
  companyName: string;
  companyNameNormalized: string;
  knownAliases: string | null;
}

interface CompanyVariant {
  companyId: number;
  companyName: string;
  normalizedName: string;
  source: "company_name" | "alias";
  rawValue: string;
  tokens: string[];
}

interface CompanyMatchIndex {
  variants: CompanyVariant[];
  exactIndex: Map<string, number[]>;
  tokenIndex: Map<string, number[]>;
}

export interface CompanyMatchResult {
  companyId: number;
  companyName: string;
  matchedOn: "name" | "brand" | "operator";
  matchedVariant: string;
  source: "company_name" | "alias";
  score: number;
}

const CORPORATE_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "gmbh",
  "sa",
  "ag",
  "nv",
  "bv",
  "sarl",
  "spa",
  "holdings",
  "holding",
]);

const LOW_SIGNAL_TOKENS = new Set([
  "the",
  "of",
  "and",
  "for",
  "to",
  "in",
  "on",
  "at",
  "by",
  "from",
  "with",
  "de",
  "la",
  "le",
  "el",
  "da",
  "do",
  "di",
  "du",
  "del",
  "des",
  "van",
  "von",
  "y",
  "a",
  "an",
]);

const MIN_ACCEPT_SCORE = 0.86;

function normalizeCompanyText(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}+/gu, "")
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) return "";

  const tokens = normalized
    .split(" ")
    .filter(
      (token) =>
        token &&
        !CORPORATE_SUFFIXES.has(token) &&
        !LOW_SIGNAL_TOKENS.has(token)
    );

  return tokens.join(" ");
}

function splitTokens(normalizedValue: string): string[] {
  if (!normalizedValue) return [];
  return Array.from(
    new Set(
      normalizedValue
    .split(" ")
    .map((token) => token.trim())
        .filter(Boolean)
    )
  );
}

function parseAliases(rawAliases: string | null): string[] {
  if (!rawAliases) return [];

  return rawAliases
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
}

function containsPhrase(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  if (haystack === needle) return true;
  if (haystack.startsWith(`${needle} `)) return true;
  if (haystack.endsWith(` ${needle}`)) return true;
  return haystack.includes(` ${needle} `);
}

function sharedTokenCount(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let shared = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      shared += 1;
    }
  }

  return shared;
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);

  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;

    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;

      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + substitutionCost
      );
    }

    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[right.length];
}

function editSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 0;

  const distance = levenshteinDistance(left, right);
  return 1 - distance / maxLength;
}

function computeSimilarity(
  officeNormalized: string,
  officeTokens: string[],
  variantNormalized: string,
  variantTokens: string[]
): number {
  if (officeNormalized === variantNormalized) {
    return 1;
  }

  const shared = sharedTokenCount(officeTokens, variantTokens);
  const tokenUnion = officeTokens.length + variantTokens.length - shared;
  const containmentDenominator = Math.min(officeTokens.length, variantTokens.length);
  const containment = containmentDenominator > 0 ? shared / containmentDenominator : 0;
  const jaccard = tokenUnion > 0 ? shared / tokenUnion : 0;
  const edit = editSimilarity(officeNormalized, variantNormalized);

  let score = containment * 0.5 + jaccard * 0.2 + edit * 0.3;

  const phraseMatch =
    containsPhrase(officeNormalized, variantNormalized) ||
    containsPhrase(variantNormalized, officeNormalized);

  if (phraseMatch) {
    const shortLength = Math.min(officeNormalized.length, variantNormalized.length);
    if (shortLength >= 4) {
      score = Math.max(score, 0.91);
    }
  }

  if (containment === 1 && containmentDenominator >= 2 && edit >= 0.8) {
    score = Math.max(score, 0.9);
  }

  if (officeTokens.length === 1 && variantTokens.length === 1) {
    const officeToken = officeTokens[0];
    const variantToken = variantTokens[0];

    if (officeToken === variantToken) {
      score = 1;
    }
  }

  return score;
}

function addVariant(
  variants: CompanyVariant[],
  companyId: number,
  companyName: string,
  source: CompanyVariant["source"],
  rawValue: string,
  dedupePerCompany: Set<string>
): void {
  const normalizedName = normalizeCompanyText(rawValue);
  if (!normalizedName) return;

  const dedupeKey = `${companyId}|${normalizedName}`;
  if (dedupePerCompany.has(dedupeKey)) {
    return;
  }

  dedupePerCompany.add(dedupeKey);
  variants.push({
    companyId,
    companyName,
    normalizedName,
    source,
    rawValue,
    tokens: splitTokens(normalizedName),
  });
}

export function buildCompanyMatchIndex(records: CompanyMatchRecord[]): CompanyMatchIndex {
  const variants: CompanyVariant[] = [];
  const dedupePerCompany = new Set<string>();

  for (const record of records) {
    addVariant(
      variants,
      record.id,
      record.companyName,
      "company_name",
      record.companyName,
      dedupePerCompany
    );

    for (const alias of parseAliases(record.knownAliases)) {
      addVariant(
        variants,
        record.id,
        record.companyName,
        "alias",
        alias,
        dedupePerCompany
      );
    }
  }

  const exactIndex = new Map<string, number[]>();
  const tokenIndex = new Map<string, number[]>();

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];

    const exactBucket = exactIndex.get(variant.normalizedName) ?? [];
    exactBucket.push(index);
    exactIndex.set(variant.normalizedName, exactBucket);

    for (const token of variant.tokens) {
      const tokenBucket = tokenIndex.get(token) ?? [];
      tokenBucket.push(index);
      tokenIndex.set(token, tokenBucket);
    }
  }

  return {
    variants,
    exactIndex,
    tokenIndex,
  };
}

function preferredVariant(current: CompanyVariant, challenger: CompanyVariant): CompanyVariant {
  if (challenger.source === current.source) return challenger;
  if (challenger.source === "company_name") return challenger;
  return current;
}

function uniqueOfficeNames(office: Office): Array<{ value: string; from: "name" | "brand" | "operator" }> {
  const candidates: Array<{ value: string; from: "name" | "brand" | "operator" }> = [];
  const seen = new Set<string>();

  const pushCandidate = (value: string | null, from: "name" | "brand" | "operator") => {
    if (!value) return;
    const normalized = normalizeCompanyText(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push({ value, from });
  };

  pushCandidate(office.name, "name");
  pushCandidate(office.brand, "brand");
  pushCandidate(office.operator, "operator");

  return candidates;
}

export function matchOfficeToCompany(
  office: Office,
  companyIndex: CompanyMatchIndex
): CompanyMatchResult | null {
  if (companyIndex.variants.length === 0) return null;

  let bestMatch:
    | (CompanyMatchResult & {
        variantIndex: number;
      })
    | null = null;

  const officeCandidates = uniqueOfficeNames(office);

  for (const candidate of officeCandidates) {
    const officeNormalized = normalizeCompanyText(candidate.value);
    if (!officeNormalized) continue;

    const officeTokens = splitTokens(officeNormalized);
    if (officeTokens.length === 0) continue;

    const exactVariantIndexes = companyIndex.exactIndex.get(officeNormalized) ?? [];

    for (const variantIndex of exactVariantIndexes) {
      const variant = companyIndex.variants[variantIndex];
      const match: CompanyMatchResult & { variantIndex: number } = {
        companyId: variant.companyId,
        companyName: variant.companyName,
        matchedOn: candidate.from,
        matchedVariant: variant.rawValue,
        source: variant.source,
        score: 1,
        variantIndex,
      };

      if (!bestMatch || match.score > bestMatch.score) {
        bestMatch = match;
      } else if (bestMatch && match.score === bestMatch.score) {
        const currentVariant = companyIndex.variants[bestMatch.variantIndex];
        const preferred = preferredVariant(currentVariant, variant);
        if (preferred === variant) {
          bestMatch = match;
        }
      }
    }

    const shortlistIndexes = new Set<number>();
    for (const token of officeTokens) {
      const tokenMatches = companyIndex.tokenIndex.get(token);
      if (!tokenMatches) continue;
      for (const variantIndex of tokenMatches) {
        shortlistIndexes.add(variantIndex);
      }
    }

    for (const variantIndex of shortlistIndexes) {
      const variant = companyIndex.variants[variantIndex];
      const score = computeSimilarity(
        officeNormalized,
        officeTokens,
        variant.normalizedName,
        variant.tokens
      );

      if (score < MIN_ACCEPT_SCORE) {
        continue;
      }

      const candidateMatch: CompanyMatchResult & { variantIndex: number } = {
        companyId: variant.companyId,
        companyName: variant.companyName,
        matchedOn: candidate.from,
        matchedVariant: variant.rawValue,
        source: variant.source,
        score,
        variantIndex,
      };

      if (!bestMatch || candidateMatch.score > bestMatch.score) {
        bestMatch = candidateMatch;
      } else if (bestMatch && candidateMatch.score === bestMatch.score) {
        const currentVariant = companyIndex.variants[bestMatch.variantIndex];
        const preferred = preferredVariant(currentVariant, variant);
        if (preferred === variant) {
          bestMatch = candidateMatch;
        }
      }
    }
  }

  if (!bestMatch) return null;

  return {
    companyId: bestMatch.companyId,
    companyName: bestMatch.companyName,
    matchedOn: bestMatch.matchedOn,
    matchedVariant: bestMatch.matchedVariant,
    source: bestMatch.source,
    score: bestMatch.score,
  };
}

export function filterOfficesWithKnownCompanies(
  offices: Office[],
  companyIndex: CompanyMatchIndex
): {
  matchedOffices: Office[];
  matchedCount: number;
  filteredOutCount: number;
} {
  if (offices.length === 0) {
    return {
      matchedOffices: [],
      matchedCount: 0,
      filteredOutCount: 0,
    };
  }

  const matchedOffices: Office[] = [];

  for (const office of offices) {
    const match = matchOfficeToCompany(office, companyIndex);
    if (match) {
      matchedOffices.push(office);
    }
  }

  return {
    matchedOffices,
    matchedCount: matchedOffices.length,
    filteredOutCount: Math.max(0, offices.length - matchedOffices.length),
  };
}
