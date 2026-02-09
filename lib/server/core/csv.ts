import type { CsvCenterRow, CsvValidationIssue } from "./types";
import { sanitizeText } from "./utils";

const REQUIRED_HEADERS = [
  "center_code",
  "name",
  "lat",
  "lon",
  "country",
  "region",
  "tier",
  "source_url",
] as const;

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let index = 0;
  let inQuotes = false;

  while (index < csvText.length) {
    const char = csvText[index];

    if (inQuotes) {
      if (char === '"') {
        if (csvText[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }

        inQuotes = false;
        index += 1;
        continue;
      }

      value += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ",") {
      row.push(value.trim());
      value = "";
      index += 1;
      continue;
    }

    if (char === "\n") {
      row.push(value.trim());
      rows.push(row);
      row = [];
      value = "";
      index += 1;
      continue;
    }

    if (char === "\r") {
      index += 1;
      continue;
    }

    value += char;
    index += 1;
  }

  if (inQuotes) {
    throw new Error("CSV parsing failed: unterminated quote.");
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.trim());
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((cell) => cell.length > 0));
}

function parseCoordinate(rawValue: string, min: number, max: number): number | null {
  const numeric = Number.parseFloat(rawValue);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    return null;
  }
  return numeric;
}

function sanitizeUrl(url: string | undefined): string | null {
  const cleaned = sanitizeText(url, 500);
  if (!cleaned) return null;
  if (!/^https?:\/\//i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

export function parseCentersCsv(csvText: string): {
  rows: CsvCenterRow[];
  issues: CsvValidationIssue[];
} {
  const parsedRows = parseCsvRows(csvText);
  if (parsedRows.length === 0) {
    throw new Error("CSV parsing failed: no rows found.");
  }

  const headerRow = parsedRows[0].map(normalizeHeader);
  const headerIndex = new Map<string, number>();
  for (let index = 0; index < headerRow.length; index += 1) {
    headerIndex.set(headerRow[index], index);
  }

  for (const requiredHeader of REQUIRED_HEADERS) {
    if (!headerIndex.has(requiredHeader)) {
      throw new Error(`CSV parsing failed: missing required header \"${requiredHeader}\".`);
    }
  }

  const rows: CsvCenterRow[] = [];
  const issues: CsvValidationIssue[] = [];
  const dedupedRows = new Map<string, CsvCenterRow>();

  for (let rowIndex = 1; rowIndex < parsedRows.length; rowIndex += 1) {
    const csvRow = parsedRows[rowIndex];
    const getValue = (header: (typeof REQUIRED_HEADERS)[number]): string => {
      const cellIndex = headerIndex.get(header) ?? -1;
      if (cellIndex < 0) return "";
      return csvRow[cellIndex]?.trim() ?? "";
    };

    const centerCode = sanitizeText(getValue("center_code"), 120);
    const name = sanitizeText(getValue("name"), 300);
    const lat = parseCoordinate(getValue("lat"), -90, 90);
    const lon = parseCoordinate(getValue("lon"), -180, 180);
    const country = sanitizeText(getValue("country"), 100);
    const region = sanitizeText(getValue("region"), 120);
    const tier = sanitizeText(getValue("tier"), 80);
    const sourceUrl = sanitizeUrl(getValue("source_url"));

    if (!centerCode) {
      issues.push({ row: rowIndex + 1, reason: "center_code is required." });
      continue;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(centerCode)) {
      issues.push({
        row: rowIndex + 1,
        reason:
          "center_code contains invalid characters. Use letters, numbers, underscore, or hyphen.",
      });
      continue;
    }

    if (!name) {
      issues.push({ row: rowIndex + 1, reason: "name is required." });
      continue;
    }

    if (lat === null || lon === null) {
      issues.push({
        row: rowIndex + 1,
        reason: "lat/lon must be valid coordinates.",
      });
      continue;
    }

    if (getValue("source_url") && !sourceUrl) {
      issues.push({
        row: rowIndex + 1,
        reason: "source_url must start with http:// or https://",
      });
      continue;
    }

    dedupedRows.set(centerCode, {
      centerCode,
      name,
      tier,
      lat,
      lon,
      country,
      region,
      sourceUrl,
    });
  }

  rows.push(...dedupedRows.values());
  return { rows, issues };
}
