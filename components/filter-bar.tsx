"use client";

import { SlidersHorizontal } from "lucide-react";

interface FilterBarProps {
  tierOptions: string[];
  tier: string;
  radiusKm: number;
  resultLimit: string;
  highConfidenceOnly: boolean;
  requireEvidence: boolean;
  onTierChange: (value: string) => void;
  onRadiusChange: (value: number) => void;
  onResultLimitChange: (value: string) => void;
  onHighConfidenceChange: (value: boolean) => void;
  onRequireEvidenceChange: (value: boolean) => void;
}

const radiusOptions = [10, 25, 50, 100];

function ToggleRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
    >
      <span>{label}</span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-border bg-background"
      />
    </label>
  );
}

export function FilterBar({
  tierOptions,
  tier,
  radiusKm,
  resultLimit,
  highConfidenceOnly,
  requireEvidence,
  onTierChange,
  onRadiusChange,
  onResultLimitChange,
  onHighConfidenceChange,
  onRequireEvidenceChange,
}: FilterBarProps) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 text-card-foreground shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4" />
        <h2 className="text-sm font-semibold">Filters</h2>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-xs uppercase tracking-wide text-muted-foreground">
          Tier
          <select
            value={tier}
            onChange={(event) => onTierChange(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            <option value="all">All tiers</option>
            {tierOptions.map((tierOption) => (
              <option key={tierOption} value={tierOption}>
                {tierOption}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs uppercase tracking-wide text-muted-foreground">
          Radius
          <select
            value={radiusKm}
            onChange={(event) => onRadiusChange(Number.parseInt(event.target.value, 10))}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            {radiusOptions.map((radiusOption) => (
              <option key={radiusOption} value={radiusOption}>
                {radiusOption} km
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs uppercase tracking-wide text-muted-foreground">
          Max results
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={resultLimit}
            onChange={(event) => onResultLimitChange(event.target.value)}
            placeholder="Unlimited"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </label>

        <ToggleRow
          id="high-confidence"
          label="High confidence only"
          checked={highConfidenceOnly}
          onChange={onHighConfidenceChange}
        />

        <ToggleRow
          id="evidence-only"
          label="Website or Wikidata"
          checked={requireEvidence}
          onChange={onRequireEvidenceChange}
        />
      </div>
    </section>
  );
}
