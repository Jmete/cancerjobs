"use client";

import { useEffect, useMemo, useRef } from "react";

import {
  Map,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerPopup,
  type MapRef,
} from "@/components/ui/map";
import type { CancerCenter, OfficePoint } from "@/lib/types";

interface CentersMapProps {
  centers: CancerCenter[];
  offices: OfficePoint[];
  selectedCenterId: number | null;
  focusedOfficeKey: string | null;
  focusedOfficeRequestId: number;
  onSelectCenter: (centerId: number) => void;
}

function formatDistance(distanceM: number): string {
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

function officePointKey(office: OfficePoint): string {
  return `${office.osmType}-${office.osmId}`;
}

export function CentersMap({
  centers,
  offices,
  selectedCenterId,
  focusedOfficeKey,
  focusedOfficeRequestId,
  onSelectCenter,
}: CentersMapProps) {
  const mapRef = useRef<MapRef | null>(null);

  const selectedCenter = useMemo(
    () => centers.find((center) => center.id === selectedCenterId) ?? null,
    [centers, selectedCenterId]
  );

  useEffect(() => {
    if (!mapRef.current || !selectedCenter) return;

    mapRef.current.flyTo({
      center: [selectedCenter.lon, selectedCenter.lat],
      zoom: 9,
      duration: 900,
    });
  }, [selectedCenter]);

  const focusedOffice = useMemo(
    () =>
      focusedOfficeKey
        ? offices.find((office) => officePointKey(office) === focusedOfficeKey) ?? null
        : null,
    [offices, focusedOfficeKey]
  );

  useEffect(() => {
    if (!mapRef.current || !focusedOffice) return;

    mapRef.current.flyTo({
      center: [focusedOffice.lon, focusedOffice.lat],
      zoom: 13.5,
      duration: 850,
    });
  }, [focusedOffice]);

  return (
    <div className="h-[58vh] min-h-[360px] overflow-hidden rounded-xl border border-border bg-card md:h-[72vh]">
      <Map
        ref={mapRef}
        center={[-98.5795, 39.8283]}
        zoom={3.8}
        maxZoom={16}
        minZoom={2}
      >
        <MapControls
          position="bottom-right"
          showZoom
          showLocate
          showFullscreen
        />

        {centers.map((center) => {
          const selected = center.id === selectedCenterId;

          return (
            <MapMarker
              key={`center-${center.id}`}
              longitude={center.lon}
              latitude={center.lat}
              onClick={() => onSelectCenter(center.id)}
            >
              <MarkerContent>
                <button
                  type="button"
                  aria-label={`Select ${center.name}`}
                  className={[
                    "h-4 w-4 rounded-full border-2 border-white shadow-lg transition-transform",
                    selected ? "scale-125 bg-emerald-500" : "bg-sky-600",
                  ].join(" ")}
                />
              </MarkerContent>
              <MarkerPopup closeButton>
                <div className="max-w-xs space-y-1 text-sm">
                  <p className="font-semibold">{center.name}</p>
                  <p className="text-muted-foreground">
                    {center.region ?? "Unknown region"}
                    {center.country ? `, ${center.country}` : ""}
                  </p>
                  {center.tier ? <p>Tier: {center.tier}</p> : null}
                </div>
              </MarkerPopup>
            </MapMarker>
          );
        })}

        {offices.map((office) => {
          const officeKey = officePointKey(office);
          const focused = officeKey === focusedOfficeKey;

          return (
            <MapMarker
              key={`office-${officeKey}`}
              longitude={office.lon}
              latitude={office.lat}
            >
              <MarkerContent>
                <div
                  className={[
                    "h-3 w-3 rounded-full border border-white shadow-md transition-transform",
                    focused ? "scale-125 bg-fuchsia-600" : "",
                    !focused && office.lowConfidence ? "bg-amber-500" : "",
                    !focused && !office.lowConfidence ? "bg-rose-600" : "",
                  ].join(" ")}
                />
              </MarkerContent>
              <MarkerPopup closeButton open={focused} openTrigger={focusedOfficeRequestId}>
                <div className="max-w-xs space-y-1 text-sm">
                <p className="font-semibold">{office.name ?? "Unnamed office"}</p>
                <p className="text-muted-foreground">{formatDistance(office.distanceM)} away</p>
                {office.linkedCompanyName ? (
                  <p className="text-muted-foreground">
                    Linked company: {office.linkedCompanyName}
                  </p>
                ) : (
                  <p className="text-muted-foreground">Linked company: Unknown</p>
                )}
                {office.website ? (
                  <a
                    href={office.website}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Visit website
                    </a>
                  ) : null}
                  {office.wikidata ? (
                    <a
                      href={`https://www.wikidata.org/wiki/${office.wikidata}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block text-primary underline-offset-4 hover:underline"
                    >
                      View Wikidata
                    </a>
                  ) : null}
                </div>
              </MarkerPopup>
            </MapMarker>
          );
        })}
      </Map>
    </div>
  );
}
