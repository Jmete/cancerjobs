export interface CancerCenter {
  id: number;
  centerCode: string;
  name: string;
  tier: string | null;
  lat: number;
  lon: number;
  country: string | null;
  region: string | null;
}

export interface OfficePoint {
  osmType: "node" | "way" | "relation";
  osmId: number;
  name: string | null;
  brand: string | null;
  operator: string | null;
  website: string | null;
  wikidata: string | null;
  wikidataEntityId: string | null;
  employeeCount: number | null;
  employeeCountAsOf: string | null;
  marketCap: number | null;
  marketCapCurrencyQid: string | null;
  marketCapAsOf: string | null;
  wikidataEnrichedAt: string | null;
  lat: number;
  lon: number;
  lowConfidence: boolean;
  distanceM: number;
  linkedCompanyId: number | null;
  linkedCompanyName: string | null;
}

export interface CenterOfficesResponse {
  center: {
    id: number;
    centerCode: string;
    name: string;
    lat: number;
    lon: number;
  };
  radiusKm: number;
  offices: OfficePoint[];
}
