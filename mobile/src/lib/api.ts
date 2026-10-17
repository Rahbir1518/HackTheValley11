import { useAuth } from "@clerk/expo";
import { useCallback } from "react";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? "http://localhost:3000";

export interface NearbyApplication {
  app_number: string;
  address: string;
  type_name: string;
  status: string;
  distance_m: number;
  modelled: boolean;
  date_submitted: string | null;
  headline: string | null;
  preview_url: string | null;
}

export interface Nearby {
  here: string | null;
  radius_m: number;
  applications: NearbyApplication[];
}

export interface Place {
  address: string;
  app_number: string | null;
  label: string | null;
  watched: boolean;
  changes: string[];
  status?: string | null;
  next_meeting?: string | null;
}

export interface Proposal {
  application: {
    app_number: string;
    address: string;
    type_name: string;
    status: string;
    date_submitted: string | null;
    application_url: string | null;
    description: string | null;
    ward_name: string | null;
  };
  narration: { headline: string; summary: string; key_facts: string[] } | null;
  preview_url: string | null;
  scene_key: string | null;
  spec: {
    use_type: string;
    total_storeys: number;
    height_m: number;
    height_stated: boolean;
    towers: { storeys: number }[];
    units: number | null;
    gfa_m2: number | null;
    assumptions: { field: string }[];
  } | null;
  rentals: { address: string; units: number | null; year_built: number | null; property_type: string | null }[];
  rental_units: number;
  rental_mentions: string[];
  rental_rule: string | null;
  heritage_on_site: { address: string; status_label: string; built: string | null }[];
  involved: {
    planner: { name: string | null; phone: string | null; email: string | null };
    upcoming_meetings: { date: string; time: string | null; location: string | null }[];
    past_meetings: { date: string }[];
    application_url: string | null;
  };
}

export class ApiError extends Error {}

/** fetch() against the Ordis API with the Clerk session token, so saved places are per user. */
export function useApi() {
  const { getToken } = useAuth();
  return useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const token = await getToken();
      let r: Response;
      try {
        r = await fetch(`${API_URL}${path}`, {
          ...init,
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
      } catch {
        throw new ApiError(`Can't reach the Ordis API at ${API_URL}. Is the backend running (and 'npm run ports' done)?`);
      }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new ApiError(data.detail ?? `HTTP ${r.status}`);
      return data as T;
    },
    [getToken],
  );
}

/** "LAST, FIRST" (City data) -> "First Last". */
export function plannerName(raw: string | null): string | null {
  if (!raw) return null;
  const [last, first] = raw.split(",").map((s) => s.trim());
  return first ? `${first} ${last}` : raw;
}

export function storeysText(spec: NonNullable<Proposal["spec"]>): string {
  const n = spec.towers.length ? spec.towers.map((t) => t.storeys).join(" + ") : String(spec.total_storeys);
  const estimated = spec.assumptions.some((a) => a.field === "total_storeys");
  return `${n} storeys · ${estimated ? "estimated" : "stated"}`;
}
