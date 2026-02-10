"use client";

import { Loader2, MapPin, Building2, Flag } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { CentersMap } from "@/components/centers-map";
import { FilterBar } from "@/components/filter-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { flagOfficeForDeletion, getCenterOffices, getCenters } from "@/lib/api";
import type { CancerCenter, OfficePoint } from "@/lib/types";

function hasEvidence(office: OfficePoint): boolean {
  return Boolean(office.website || office.wikidata || office.brand || office.operator);
}

function officePointKey(office: OfficePoint): string {
  return `${office.osmType}-${office.osmId}`;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function officeMatchesSearch(office: OfficePoint, query: string): boolean {
  if (!query) return true;

  const searchable = [
    office.name,
    office.brand,
    office.operator,
    office.website,
    office.wikidata,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchable.includes(query);
}

function centerMatchesSearch(center: CancerCenter, query: string): boolean {
  if (!query) return true;

  const searchable = [
    center.name,
    center.country,
    center.region,
    center.tier,
    center.centerCode,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchable.includes(query);
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}

function formatDistance(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

export function MapDashboard() {
  const [centers, setCenters] = useState<CancerCenter[]>([]);
  const [selectedCenterId, setSelectedCenterId] = useState<number | null>(null);
  const [offices, setOffices] = useState<OfficePoint[]>([]);
  const [focusedOfficeKey, setFocusedOfficeKey] = useState<string | null>(null);
  const [focusedOfficeRequestId, setFocusedOfficeRequestId] = useState(0);

  const [tier, setTier] = useState("all");
  const [radiusKm, setRadiusKm] = useState(25);
  const [resultLimit, setResultLimit] = useState("2000");
  const [highConfidenceOnly, setHighConfidenceOnly] = useState(false);
  const [requireEvidence, setRequireEvidence] = useState(false);
  const [officeSearchInput, setOfficeSearchInput] = useState("");
  const [centerSearchInput, setCenterSearchInput] = useState("");

  const [centersLoading, setCentersLoading] = useState(true);
  const [officesLoading, setOfficesLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [officeFlagMessage, setOfficeFlagMessage] = useState<string | null>(null);
  const [flaggingOfficeKey, setFlaggingOfficeKey] = useState<string | null>(null);
  const [flaggedOffices, setFlaggedOffices] = useState<Record<string, string>>({});

  const debouncedOfficeSearch = useDebouncedValue(officeSearchInput, 250);
  const debouncedCenterSearch = useDebouncedValue(centerSearchInput, 250);

  useEffect(() => {
    let cancelled = false;

    async function loadCenters() {
      setCentersLoading(true);
      setErrorMessage(null);

      try {
        const response = await getCenters({
          tier: tier === "all" ? undefined : tier,
          activeOnly: true,
        });

        if (cancelled) return;

        setCenters(response);
        setSelectedCenterId((currentId) => {
          if (currentId && response.some((center) => center.id === currentId)) {
            return currentId;
          }
          return response[0]?.id ?? null;
        });
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "Failed to load centers.");
        setCenters([]);
        setSelectedCenterId(null);
      } finally {
        if (!cancelled) {
          setCentersLoading(false);
        }
      }
    }

    loadCenters();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  useEffect(() => {
    if (!selectedCenterId) {
      setOffices([]);
      return;
    }

    const centerId = selectedCenterId;
    let cancelled = false;

    async function loadOffices() {
      setOfficesLoading(true);
      setErrorMessage(null);

      try {
        const trimmedLimit = resultLimit.trim();
        let parsedLimit: number | undefined;

        if (trimmedLimit.length > 0) {
          const numericLimit = Number.parseInt(trimmedLimit, 10);
          if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
            throw new Error("Max results must be blank or a positive number.");
          }
          parsedLimit = numericLimit;
        }

        const response = await getCenterOffices(centerId, {
          radiusKm,
          limit: parsedLimit,
          highConfidenceOnly,
        });

        if (cancelled) return;
        setOffices(response.offices);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "Failed to load offices.");
        setOffices([]);
      } finally {
        if (!cancelled) {
          setOfficesLoading(false);
        }
      }
    }

    loadOffices();

    return () => {
      cancelled = true;
    };
  }, [
    selectedCenterId,
    radiusKm,
    highConfidenceOnly,
    resultLimit,
  ]);

  const tierOptions = useMemo(() => {
    const uniqueTiers = new Set<string>();
    for (const center of centers) {
      if (center.tier) uniqueTiers.add(center.tier);
    }
    return Array.from(uniqueTiers).sort((left, right) => left.localeCompare(right));
  }, [centers]);

  const selectedCenter = useMemo(
    () => centers.find((center) => center.id === selectedCenterId) ?? null,
    [centers, selectedCenterId]
  );

  const evidenceFilteredOffices = useMemo(() => {
    if (!requireEvidence) return offices;
    return offices.filter(hasEvidence);
  }, [offices, requireEvidence]);

  const searchedOffices = useMemo(() => {
    const normalizedQuery = normalizeSearch(debouncedOfficeSearch);
    if (!normalizedQuery) return evidenceFilteredOffices;
    return evidenceFilteredOffices.filter((office) =>
      officeMatchesSearch(office, normalizedQuery)
    );
  }, [evidenceFilteredOffices, debouncedOfficeSearch]);

  const visibleOffices = useMemo(() => searchedOffices, [searchedOffices]);

  useEffect(() => {
    if (!focusedOfficeKey) return;
    if (visibleOffices.some((office) => officePointKey(office) === focusedOfficeKey)) {
      return;
    }
    setFocusedOfficeKey(null);
    setFocusedOfficeRequestId(0);
  }, [visibleOffices, focusedOfficeKey]);

  useEffect(() => {
    setFocusedOfficeKey(null);
    setFocusedOfficeRequestId(0);
    setOfficeFlagMessage(null);
  }, [selectedCenterId]);

  async function handleFlagOffice(office: OfficePoint) {
    if (!selectedCenterId) return;

    const key = officePointKey(office);
    setFlaggingOfficeKey(key);
    setOfficeFlagMessage(null);

    try {
      const result = await flagOfficeForDeletion({
        centerId: selectedCenterId,
        osmType: office.osmType,
        osmId: office.osmId,
      });

      setFlaggedOffices((current) => ({
        ...current,
        [key]: result.outcome,
      }));
      setOfficeFlagMessage(result.message);
    } catch (error) {
      setOfficeFlagMessage(
        error instanceof Error ? error.message : "Failed to submit deletion flag."
      );
    } finally {
      setFlaggingOfficeKey(null);
    }
  }

  const visibleCentersList = useMemo(() => {
    const normalizedQuery = normalizeSearch(debouncedCenterSearch);
    if (!normalizedQuery) return centers;

    return centers.filter((center) => centerMatchesSearch(center, normalizedQuery));
  }, [centers, debouncedCenterSearch]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
      <header className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Cancer Jobs
          </p>
          <h1 className="text-lg font-semibold md:text-xl">Cancer centers and nearby offices</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin"
            className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Admin
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <FilterBar
        tierOptions={tierOptions}
        tier={tier}
        radiusKm={radiusKm}
        resultLimit={resultLimit}
        highConfidenceOnly={highConfidenceOnly}
        requireEvidence={requireEvidence}
        onTierChange={setTier}
        onRadiusChange={setRadiusKm}
        onResultLimitChange={setResultLimit}
        onHighConfidenceChange={setHighConfidenceOnly}
        onRequireEvidenceChange={setRequireEvidence}
      />

      {errorMessage ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
        <CentersMap
          centers={centers}
          offices={visibleOffices}
          selectedCenterId={selectedCenterId}
          onSelectCenter={setSelectedCenterId}
          focusedOfficeKey={focusedOfficeKey}
          focusedOfficeRequestId={focusedOfficeRequestId}
        />

        <aside className="flex max-h-[72vh] flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Selected center</p>
            {selectedCenter ? (
              <div className="mt-1 space-y-1">
                <p className="font-medium">{selectedCenter.name}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedCenter.region ?? "Unknown region"}
                  {selectedCenter.country ? `, ${selectedCenter.country}` : ""}
                </p>
                {selectedCenter.tier ? (
                  <p className="text-xs text-muted-foreground">Tier: {selectedCenter.tier}</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No center selected.</p>
            )}
          </div>

          <section className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Building2 className="h-4 w-4" />
                Nearby offices
              </h2>
              {officesLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="text-xs text-muted-foreground">
                  Showing {visibleOffices.length} of {evidenceFilteredOffices.length}
                </span>
              )}
            </div>

            {!officesLoading && visibleOffices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No offices found for current filters.</p>
            ) : null}

            <label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
              Search offices
              <input
                type="text"
                value={officeSearchInput}
                onChange={(event) => setOfficeSearchInput(event.target.value)}
                placeholder="Office name..."
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </label>

            {officeFlagMessage ? (
              <p className="mb-2 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground">
                {officeFlagMessage}
              </p>
            ) : null}

            <ul className="space-y-2">
              {visibleOffices.map((office) => {
                const officeKey = officePointKey(office);
                const flaggedState = flaggedOffices[officeKey];
                const isFlagging = flaggingOfficeKey === officeKey;

                return (
                  <li
                    key={officeKey}
                    className={[
                      "rounded-md border px-3 py-2 text-sm transition-colors",
                      focusedOfficeKey === officeKey
                        ? "border-primary/50 bg-primary/5"
                        : "border-border",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFocusedOfficeKey(officeKey);
                          setFocusedOfficeRequestId((current) => current + 1);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="font-medium">{office.name ?? "Unnamed office"}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {formatDistance(office.distanceM)}
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleFlagOffice(office)}
                        disabled={isFlagging}
                        title={
                          flaggedState === "already_banned"
                            ? "Already banned"
                            : flaggedState
                              ? "Deletion flag already submitted"
                              : "Flag for admin deletion review"
                        }
                        className={[
                          "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
                          flaggedState
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
                            : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                          isFlagging ? "cursor-wait opacity-70" : "",
                        ].join(" ")}
                      >
                        {isFlagging ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Flag className="h-4 w-4" />
                        )}
                        <span className="sr-only">Flag office for deletion review</span>
                      </button>
                    </div>

                    {office.website ? (
                      <a
                        href={office.website}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-block text-xs text-primary underline-offset-4 hover:underline"
                      >
                        website
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-lg border border-border bg-background p-3">
            <h2 className="mb-2 text-sm font-semibold">Centers</h2>
            <label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
              Search centers
              <input
                type="text"
                value={centerSearchInput}
                onChange={(event) => setCenterSearchInput(event.target.value)}
                placeholder="Name, country, region, tier..."
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </label>
            {centersLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading centers
              </div>
            ) : (
              <>
                {visibleCentersList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No centers match your search.
                  </p>
                ) : null}
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {visibleCentersList.map((center) => (
                    <li key={center.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedCenterId(center.id)}
                        className={[
                          "w-full rounded-md px-2 py-1 text-left text-sm transition-colors",
                          selectedCenterId === center.id
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-accent hover:text-accent-foreground",
                        ].join(" ")}
                      >
                        {center.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}
