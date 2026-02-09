#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

function printUsage() {
  console.log(`Usage:
  pnpm csv:upload -- --url <api-url> --token <admin-token> --file <csv-path>

Examples:
  pnpm csv:upload -- --url http://localhost:3002 --token YOUR_TOKEN --file templates/cancer_centers_template.csv
  pnpm csv:upload -- --url http://localhost:3002 --file templates/cancer_centers_template.csv

Options:
  --url     API base URL or full upload endpoint URL
  --token   Admin token (or set ADMIN_API_TOKEN env var)
  --file    CSV file path
  --help    Show this help
`);
}

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    const [key, valueFromEquals] = arg.split("=");
    const normalizedKey = key.slice(2);

    if (valueFromEquals !== undefined) {
      parsed[normalizedKey] = valueFromEquals;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      parsed[normalizedKey] = next;
      i += 1;
      continue;
    }

    parsed[normalizedKey] = "true";
  }

  return parsed;
}

function normalizeEndpoint(url) {
  const trimmed = url.trim().replace(/\/$/, "");
  const uploadPath = "/api/admin/centers/upload-csv";

  if (trimmed.endsWith(uploadPath)) {
    return trimmed;
  }

  return `${trimmed}${uploadPath}`;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help === "true") {
  printUsage();
  process.exit(0);
}

const apiUrl = args.url ?? process.env.API_URL;
const adminToken = args.token ?? process.env.ADMIN_API_TOKEN;
const csvFile = args.file;

if (!apiUrl || !adminToken || !csvFile) {
  console.error("Missing required argument(s).\n");
  printUsage();
  process.exit(1);
}

const endpoint = normalizeEndpoint(apiUrl);
const resolvedFilePath = path.resolve(csvFile);

let fileBuffer;
try {
  fileBuffer = await readFile(resolvedFilePath);
} catch (error) {
  console.error(`Failed to read CSV file at ${resolvedFilePath}`);
  console.error(error instanceof Error ? error.message : "Unknown file error");
  process.exit(1);
}

const formData = new FormData();
const blob = new Blob([fileBuffer], { type: "text/csv" });
formData.append("file", blob, path.basename(resolvedFilePath));

console.log(`Uploading ${path.basename(resolvedFilePath)} to ${endpoint} ...`);

let response;
try {
  response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    body: formData,
  });
} catch (error) {
  console.error("Request failed.");
  console.error(error instanceof Error ? error.message : "Unknown network error");
  process.exit(1);
}

const responseText = await response.text();
const responseJson = safeJsonParse(responseText);

if (!response.ok) {
  console.error(`Upload failed (${response.status}).`);
  if (responseJson) {
    console.error(JSON.stringify(responseJson, null, 2));
  } else {
    console.error(responseText);
  }
  process.exit(1);
}

console.log("Upload complete.");
if (responseJson) {
  console.log(JSON.stringify(responseJson, null, 2));
} else {
  console.log(responseText);
}
