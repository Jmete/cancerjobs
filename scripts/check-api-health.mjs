#!/usr/bin/env node

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

function printUsage() {
  console.log(`Usage:
  pnpm ops:health-check -- --url <api-url> --token <admin-token>

Options:
  --url                      API base URL, e.g. http://localhost:3002
  --token                    Admin token for /api/admin/status (or env ADMIN_API_TOKEN)
  --max-refresh-age-minutes  Maximum acceptable age for refresh_state.updated_at (default 130)
  --min-active-centers       Minimum active centers expected (default 1)
  --min-links                Minimum center_office links expected (default 0, enables exact link counts)
  --alert-webhook            Optional webhook URL for failure alerts (or env ALERT_WEBHOOK_URL)
  --help                     Show this help
`);
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeBaseUrl(url) {
  return url.trim().replace(/\/$/, "");
}

async function sendWebhookAlert(webhookUrl, payload) {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("Failed to send alert webhook:");
    console.error(error instanceof Error ? error.message : "Unknown webhook error");
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help === "true") {
  printUsage();
  process.exit(0);
}

const apiUrl = args.url ?? process.env.API_URL;
const adminToken = args.token ?? process.env.ADMIN_API_TOKEN;
const maxRefreshAgeMinutes = toPositiveInt(args["max-refresh-age-minutes"], 130);
const minActiveCenters = toPositiveInt(args["min-active-centers"], 1);
const minLinks = toPositiveInt(args["min-links"], 0);
const alertWebhook = args["alert-webhook"] ?? process.env.ALERT_WEBHOOK_URL;

if (!apiUrl || !adminToken) {
  console.error(
    "Missing required --url and --token (or API_URL and ADMIN_API_TOKEN env vars).\n"
  );
  printUsage();
  process.exit(1);
}

const baseUrl = normalizeBaseUrl(apiUrl);

const failures = [];
const context = {
  baseUrl,
  timestamp: new Date().toISOString(),
  checks: {},
};

try {
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  if (!healthResponse.ok) {
    failures.push(`Health endpoint returned ${healthResponse.status}.`);
  } else {
    const healthPayload = await healthResponse.json();
    context.checks.publicHealthOk = Boolean(healthPayload?.ok);
    if (!healthPayload?.ok) {
      failures.push("Health endpoint returned ok=false.");
    }
  }
} catch (error) {
  failures.push(
    `Health endpoint request failed: ${error instanceof Error ? error.message : "unknown error"}`
  );
}

let statusPayload = null;
try {
  const includeCounts = minLinks > 0;
  const statusResponse = await fetch(
    `${baseUrl}/api/admin/status${includeCounts ? "?includeCounts=true" : ""}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    }
  );

  const responseText = await statusResponse.text();
  try {
    statusPayload = JSON.parse(responseText);
  } catch {
    statusPayload = null;
  }

  if (!statusResponse.ok) {
    failures.push(`Admin status endpoint returned ${statusResponse.status}.`);
  }
} catch (error) {
  failures.push(
    `Admin status request failed: ${error instanceof Error ? error.message : "unknown error"}`
  );
}

if (statusPayload) {
  const activeCenters = Number(statusPayload?.metrics?.activeCenters ?? Number.NaN);
  const linksRaw = statusPayload?.metrics?.centerOfficeLinksTotal;
  const linksTotal = typeof linksRaw === "number" ? linksRaw : Number.NaN;
  const refreshAgeMinutes = Number(statusPayload?.refresh?.ageMinutes ?? Number.POSITIVE_INFINITY);
  const exactCounts = Boolean(statusPayload?.metrics?.exactCounts);

  context.checks.activeCenters = activeCenters;
  context.checks.linksTotal = Number.isFinite(linksTotal) ? linksTotal : null;
  context.checks.refreshAgeMinutes = refreshAgeMinutes;
  context.checks.exactCounts = exactCounts;

  if (!Number.isFinite(activeCenters)) {
    failures.push("Active centers metric is missing or invalid.");
  } else if (activeCenters < minActiveCenters) {
    failures.push(
      `Active centers ${activeCenters} is below required minimum ${minActiveCenters}.`
    );
  }

  if (minLinks > 0 && !exactCounts) {
    failures.push("Exact center_office link counts were not returned.");
  } else if (minLinks > 0 && !Number.isFinite(linksTotal)) {
    failures.push("center_office link metric is missing or invalid.");
  } else if (minLinks > 0 && linksTotal < minLinks) {
    failures.push(`center_office links ${linksTotal} is below required minimum ${minLinks}.`);
  }

  if (!Number.isFinite(refreshAgeMinutes)) {
    failures.push("Refresh age is missing or invalid.");
  } else if (refreshAgeMinutes > maxRefreshAgeMinutes) {
    failures.push(
      `Refresh is stale: ${refreshAgeMinutes.toFixed(1)} minutes old (max ${maxRefreshAgeMinutes}).`
    );
  }
}

if (failures.length > 0) {
  console.error("Health check failed.");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  if (alertWebhook) {
    await sendWebhookAlert(alertWebhook, {
      service: "cancer-jobs-api",
      status: "failed",
      failures,
      context,
      statusPayload,
    });
  }

  process.exit(1);
}

console.log("Health check passed.");
console.log(
  JSON.stringify(
    {
      service: "cancer-jobs-api",
      status: "ok",
      context,
      statusPayload,
    },
    null,
    2
  )
);
