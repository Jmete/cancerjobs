"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth-client";

const REFRESH_RADIUS_OPTIONS_KM = [10, 25, 50, 100] as const;

interface AdminPanelProps {
  adminEmail?: string | null;
}

interface PendingOfficeDeletionFlag {
  id: number;
  centerId: number | null;
  centerName: string | null;
  osmType: "node" | "way" | "relation";
  osmId: number;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  reviewedAt: string | null;
  officeName: string | null;
  officeWebsite: string | null;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function AdminPanel({ adminEmail = null }: AdminPanelProps) {
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [companyUploadFile, setCompanyUploadFile] = useState<File | null>(null);
  const [companyUploadStatus, setCompanyUploadStatus] = useState<string | null>(
    null
  );
  const [companyUploadLoading, setCompanyUploadLoading] = useState(false);

  const [centerId, setCenterId] = useState("");
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [refreshRadiusKm, setRefreshRadiusKm] = useState("100");
  const [refreshMaxOffices, setRefreshMaxOffices] = useState("");

  const [refreshAllDelayMs, setRefreshAllDelayMs] = useState("1200");
  const [refreshAllBatchSize, setRefreshAllBatchSize] = useState("10");
  const [refreshAllCenterRetryCount, setRefreshAllCenterRetryCount] = useState("3");
  const [refreshAllRetryDelayMs, setRefreshAllRetryDelayMs] = useState("2000");
  const [refreshAllFullClean, setRefreshAllFullClean] = useState(false);
  const [refreshAllStatus, setRefreshAllStatus] = useState<string | null>(null);
  const [refreshAllLoading, setRefreshAllLoading] = useState(false);

  const [logoutLoading, setLogoutLoading] = useState(false);

  const [statusLoading, setStatusLoading] = useState(false);
  const [statusPayload, setStatusPayload] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [deletionFlagsLoading, setDeletionFlagsLoading] = useState(false);
  const [deletionFlags, setDeletionFlags] = useState<PendingOfficeDeletionFlag[]>([]);
  const [deletionFlagsError, setDeletionFlagsError] = useState<string | null>(null);
  const [deletionFlagsStatus, setDeletionFlagsStatus] = useState<string | null>(null);
  const [deletionReviewLoadingId, setDeletionReviewLoadingId] = useState<number | null>(
    null
  );

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!uploadFile) {
      setUploadStatus("Select a CSV file first.");
      return;
    }

    setUploadLoading(true);
    setUploadStatus(null);

    try {
      const formData = new FormData();
      formData.append("file", uploadFile, uploadFile.name);

      const response = await fetch("/api/admin/actions/upload-csv", {
        method: "POST",
        body: formData,
      });

      const payload = await response.text();
      if (!response.ok) {
        throw new Error(payload || "CSV upload failed.");
      }

      setUploadStatus(payload);
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : "CSV upload failed.");
    } finally {
      setUploadLoading(false);
    }
  }

  async function handleCompanyUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!companyUploadFile) {
      setCompanyUploadStatus("Select a CSV file first.");
      return;
    }

    setCompanyUploadLoading(true);
    setCompanyUploadStatus(null);

    try {
      const formData = new FormData();
      formData.append("file", companyUploadFile, companyUploadFile.name);

      const response = await fetch("/api/admin/actions/upload-companies-csv", {
        method: "POST",
        body: formData,
      });

      const payload = await response.text();
      if (!response.ok) {
        throw new Error(payload || "Company CSV upload failed.");
      }

      setCompanyUploadStatus(payload);
    } catch (error) {
      setCompanyUploadStatus(
        error instanceof Error ? error.message : "Company CSV upload failed."
      );
    } finally {
      setCompanyUploadLoading(false);
    }
  }

  function parseRefreshSearchSettings(): {
    radiusKm: number;
    maxOffices: number | null;
  } | null {
    const radiusKm = Number.parseInt(refreshRadiusKm, 10);
    if (!REFRESH_RADIUS_OPTIONS_KM.includes(radiusKm as (typeof REFRESH_RADIUS_OPTIONS_KM)[number])) {
      return null;
    }

    const maxOfficesRaw = refreshMaxOffices.trim();
    if (!maxOfficesRaw) {
      return { radiusKm, maxOffices: null };
    }

    const parsedMaxOffices = Number.parseInt(maxOfficesRaw, 10);
    if (!Number.isFinite(parsedMaxOffices) || parsedMaxOffices <= 0) {
      return null;
    }

    return {
      radiusKm,
      maxOffices: parsedMaxOffices,
    };
  }

  async function handleRefresh(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const numericCenterId = Number(centerId);
    if (!Number.isFinite(numericCenterId) || numericCenterId <= 0) {
      setRefreshStatus("Enter a valid center ID.");
      return;
    }

    const refreshSettings = parseRefreshSearchSettings();
    if (!refreshSettings) {
      setRefreshStatus(
        "Refresh settings are invalid. Use radius 10/25/50/100 and blank or positive max offices."
      );
      return;
    }

    setRefreshLoading(true);
    setRefreshStatus(null);

    try {
      const response = await fetch("/api/admin/actions/refresh-center", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          centerId: numericCenterId,
          radiusKm: refreshSettings.radiusKm,
          maxOffices: refreshSettings.maxOffices,
        }),
      });

      const payload = await response.text();
      if (!response.ok) {
        throw new Error(payload || "Refresh failed.");
      }

      setRefreshStatus(payload);
    } catch (error) {
      setRefreshStatus(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setRefreshLoading(false);
    }
  }

  async function handleLogout() {
    setLogoutLoading(true);

    try {
      await authClient.signOut();
    } finally {
      window.location.reload();
    }
  }

  async function handleRefreshAll(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const delayMs = Number(refreshAllDelayMs);
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 15000) {
      setRefreshAllStatus("Delay must be between 0 and 15000 ms.");
      return;
    }

    const batchSize = Number(refreshAllBatchSize);
    if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > 200) {
      setRefreshAllStatus("Batch size must be between 1 and 200.");
      return;
    }
    const centerRetryCount = Number(refreshAllCenterRetryCount);
    if (
      !Number.isFinite(centerRetryCount) ||
      centerRetryCount < 0 ||
      centerRetryCount > 5
    ) {
      setRefreshAllStatus("Center retry count must be between 0 and 5.");
      return;
    }
    const retryDelayMs = Number(refreshAllRetryDelayMs);
    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 60000) {
      setRefreshAllStatus("Retry delay must be between 0 and 60000 ms.");
      return;
    }

    const refreshSettings = parseRefreshSearchSettings();
    if (!refreshSettings) {
      setRefreshAllStatus(
        "Refresh settings are invalid. Use radius 10/25/50/100 and blank or positive max offices."
      );
      return;
    }

    setRefreshAllLoading(true);
    setRefreshAllStatus(null);

    try {
      const response = await fetch("/api/admin/actions/refresh-all", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          delayMs: Math.trunc(delayMs),
          batchSize: Math.trunc(batchSize),
          radiusKm: refreshSettings.radiusKm,
          maxOffices: refreshSettings.maxOffices,
          fullClean: refreshAllFullClean,
          centerRetryCount: Math.trunc(centerRetryCount),
          retryDelayMs: Math.trunc(retryDelayMs),
        }),
      });

      const payload = await response.text();
      if (!response.ok) {
        throw new Error(payload || "Refresh all failed.");
      }

      setRefreshAllStatus(payload);
    } catch (error) {
      setRefreshAllStatus(
        error instanceof Error ? error.message : "Refresh all failed."
      );
    } finally {
      setRefreshAllLoading(false);
    }
  }

  async function handleStatusCheck() {
    setStatusLoading(true);
    setStatusError(null);

    try {
      const response = await fetch("/api/admin/actions/status?includeCounts=1", {
        method: "GET",
      });

      const payloadText = await response.text();
      if (!response.ok) {
        throw new Error(payloadText || "Status check failed.");
      }

      setStatusPayload(payloadText);
    } catch (error) {
      setStatusError(
        error instanceof Error ? error.message : "Status check failed."
      );
      setStatusPayload(null);
    } finally {
      setStatusLoading(false);
    }
  }

  async function loadPendingDeletionFlags() {
    setDeletionFlagsLoading(true);
    setDeletionFlagsError(null);

    try {
      const response = await fetch(
        "/api/admin/actions/offices/deletion-flags?status=pending&limit=100",
        {
          method: "GET",
        }
      );

      const payloadText = await response.text();
      if (!response.ok) {
        throw new Error(payloadText || "Failed to load pending deletion flags.");
      }

      const payload = JSON.parse(payloadText) as {
        items?: PendingOfficeDeletionFlag[];
      };
      setDeletionFlags(payload.items ?? []);
    } catch (error) {
      setDeletionFlagsError(
        error instanceof Error ? error.message : "Failed to load pending deletion flags."
      );
      setDeletionFlags([]);
    } finally {
      setDeletionFlagsLoading(false);
    }
  }

  async function handleDeletionDecision(
    flagId: number,
    decision: "approve" | "reject"
  ) {
    setDeletionReviewLoadingId(flagId);
    setDeletionFlagsError(null);
    setDeletionFlagsStatus(null);

    try {
      const response = await fetch(
        `/api/admin/actions/offices/deletion-flags/${flagId}/decision`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ decision }),
        }
      );

      const payloadText = await response.text();
      if (!response.ok) {
        throw new Error(payloadText || `Failed to ${decision} flag.`);
      }

      setDeletionFlagsStatus(payloadText);
      await loadPendingDeletionFlags();
    } catch (error) {
      setDeletionFlagsError(
        error instanceof Error ? error.message : `Failed to ${decision} flag.`
      );
    } finally {
      setDeletionReviewLoadingId(null);
    }
  }

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <article className="rounded-xl border border-border bg-card p-4 shadow-sm lg:col-span-2">
        <h2 className="text-base font-semibold">Operational status</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Checks cron freshness and key worker metrics.
        </p>

        <div className="mt-3">
          <button
            type="button"
            onClick={handleStatusCheck}
            disabled={statusLoading}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {statusLoading ? "Checking..." : "Check status now"}
          </button>
        </div>

        {statusError ? (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {statusError}
          </p>
        ) : null}

        {statusPayload ? (
          <pre className="mt-3 max-h-52 overflow-auto rounded-md border border-border bg-background p-3 text-xs">
            {statusPayload}
          </pre>
        ) : null}
      </article>

      <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-base font-semibold">Upload centers CSV</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a complete CSV snapshot to add, update, and soft-disable centers.
        </p>

        <form className="mt-4 space-y-3" onSubmit={handleUpload}>
          <label className="grid gap-1 text-sm">
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setUploadFile(selected);
              }}
              className="h-10 rounded-md border border-border bg-background px-3 pt-2"
            />
          </label>

          <button
            type="submit"
            disabled={uploadLoading}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploadLoading ? "Uploading..." : "Upload CSV"}
          </button>
        </form>

        {uploadStatus ? (
          <pre className="mt-3 max-h-52 overflow-auto rounded-md border border-border bg-background p-3 text-xs">
            {uploadStatus}
          </pre>
        ) : null}
      </article>

      <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-base font-semibold">Refresh office search settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Applied to both single-center and refresh-all jobs.
        </p>

        <div className="mt-4 space-y-3">
          <label className="grid gap-1 text-sm">
            Radius (km)
            <select
              value={refreshRadiusKm}
              onChange={(event) => setRefreshRadiusKm(event.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3"
            >
              {REFRESH_RADIUS_OPTIONS_KM.map((radiusKm) => (
                <option key={radiusKm} value={radiusKm}>
                  {radiusKm} km
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            Max offices per center
            <input
              type="number"
              min={1}
              step={1}
              value={refreshMaxOffices}
              onChange={(event) => setRefreshMaxOffices(event.target.value)}
              placeholder="Unlimited"
              className="h-10 rounded-md border border-border bg-background px-3 placeholder:text-muted-foreground"
            />
          </label>
        </div>
      </article>

      <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-base font-semibold">Refresh one center</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Trigger Overpass refresh immediately for a specific center id using
          the configured search settings.
        </p>

        <form className="mt-4 space-y-3" onSubmit={handleRefresh}>
          <label className="grid gap-1 text-sm">
            Center ID
            <input
              type="number"
              min={1}
              step={1}
              value={centerId}
              onChange={(event) => setCenterId(event.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3"
            />
          </label>

          <button
            type="submit"
            disabled={refreshLoading}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshLoading ? "Refreshing..." : "Refresh center"}
          </button>
        </form>

        {refreshStatus ? (
          <pre className="mt-3 max-h-52 overflow-auto rounded-md border border-border bg-background p-3 text-xs">
            {refreshStatus}
          </pre>
        ) : null}
      </article>

      <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-base font-semibold">Upload companies CSV</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Adds company records and skips existing names after normalized-name
          dedupe.
        </p>

        <form className="mt-4 space-y-3" onSubmit={handleCompanyUpload}>
          <label className="grid gap-1 text-sm">
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setCompanyUploadFile(selected);
              }}
              className="h-10 rounded-md border border-border bg-background px-3 pt-2"
            />
          </label>

          <button
            type="submit"
            disabled={companyUploadLoading}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {companyUploadLoading ? "Uploading..." : "Upload CSV"}
          </button>
        </form>

        {companyUploadStatus ? (
          <pre className="mt-3 max-h-52 overflow-auto rounded-md border border-border bg-background p-3 text-xs">
            {companyUploadStatus}
          </pre>
        ) : null}
      </article>

      <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-base font-semibold">Refresh all centers</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Runs Overpass refresh across all active centers sequentially using
          the configured search settings.
        </p>

        <form className="mt-4 space-y-3" onSubmit={handleRefreshAll}>
          <label className="grid gap-1 text-sm">
            Delay per center (ms)
            <input
              type="number"
              min={0}
              max={15000}
              step={100}
              value={refreshAllDelayMs}
              onChange={(event) => setRefreshAllDelayMs(event.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3"
            />
          </label>

          <label className="grid gap-1 text-sm">
            Retry count per center
            <input
              type="number"
              min={0}
              max={5}
              step={1}
              value={refreshAllCenterRetryCount}
              onChange={(event) => setRefreshAllCenterRetryCount(event.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3"
            />
          </label>

          <label className="grid gap-1 text-sm">
            Retry delay on error (ms)
            <input
              type="number"
              min={0}
              max={60000}
              step={100}
              value={refreshAllRetryDelayMs}
              onChange={(event) => setRefreshAllRetryDelayMs(event.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3"
            />
          </label>

          <label className="grid gap-1 text-sm">
            Batch size
            <input
              type="number"
              min={1}
              max={200}
              step={1}
              value={refreshAllBatchSize}
              onChange={(event) => setRefreshAllBatchSize(event.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3"
            />
          </label>

          <label className="flex items-start gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={refreshAllFullClean}
              onChange={(event) => setRefreshAllFullClean(event.target.checked)}
              className="mt-1 size-4 rounded border-border accent-primary"
            />
            <span className="text-sm">
              Full clean refresh: delete all saved office points first, then rescan
              every active center.
            </span>
          </label>

          <button
            type="submit"
            disabled={refreshAllLoading}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshAllLoading
              ? refreshAllFullClean
                ? "Running full clean refresh..."
                : "Refreshing all..."
              : refreshAllFullClean
                ? "Run full clean refresh"
                : "Refresh all centers"}
          </button>
        </form>

        {refreshAllStatus ? (
          <pre className="mt-3 max-h-52 overflow-auto rounded-md border border-border bg-background p-3 text-xs">
            {refreshAllStatus}
          </pre>
        ) : null}
      </article>

      <article className="rounded-xl border border-border bg-card p-4 shadow-sm lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Office deletion flags</h2>
            <p className="text-sm text-muted-foreground">
              Review user-submitted office removals and approve bans to block
              these points from future refresh runs.
            </p>
          </div>

          <button
            type="button"
            onClick={loadPendingDeletionFlags}
            disabled={deletionFlagsLoading}
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deletionFlagsLoading ? "Loading..." : "Refresh pending flags"}
          </button>
        </div>

        {deletionFlagsError ? (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {deletionFlagsError}
          </p>
        ) : null}

        {deletionFlagsStatus ? (
          <pre className="mt-3 max-h-52 overflow-auto rounded-md border border-border bg-background p-3 text-xs">
            {deletionFlagsStatus}
          </pre>
        ) : null}

        {!deletionFlagsLoading && deletionFlags.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No pending office deletion flags.
          </p>
        ) : null}

        {deletionFlags.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {deletionFlags.map((flag) => (
              <li
                key={flag.id}
                className="rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {flag.officeName ?? `${flag.osmType}/${flag.osmId}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Center: {flag.centerName ?? `#${flag.centerId ?? "unknown"}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      OSM: {flag.osmType}/{flag.osmId}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Submitted: {formatTimestamp(flag.submittedAt)}
                    </p>
                    {flag.reason ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Reason: {flag.reason}
                      </p>
                    ) : null}
                    {flag.officeWebsite ? (
                      <a
                        href={flag.officeWebsite}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-block text-xs text-primary underline-offset-4 hover:underline"
                      >
                        website
                      </a>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleDeletionDecision(flag.id, "approve")}
                      disabled={deletionReviewLoadingId === flag.id}
                      className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletionReviewLoadingId === flag.id ? "Saving..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeletionDecision(flag.id, "reject")}
                      disabled={deletionReviewLoadingId === flag.id}
                      className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </article>

      <article className="rounded-xl border border-border bg-card p-4 shadow-sm lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Session controls</h2>
            <p className="text-sm text-muted-foreground">
              {adminEmail
                ? `Signed in as ${adminEmail}. Sign out to invalidate your current admin browser session.`
                : "Sign out to invalidate your current admin browser session."}
            </p>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            disabled={logoutLoading}
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {logoutLoading ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </article>
    </section>
  );
}
