import { useAuth } from "@clerk/expo";
import { useCallback, useEffect, useRef } from "react";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? "http://localhost:3000";
/** Free ngrok tunnels answer with a warning page unless this header is sent. */
export const TUNNEL_HEADERS = { "ngrok-skip-browser-warning": "1" };
/** An API-served image (Blender preview), loadable through a tunnel too. */
export const apiImage = (path: string) => ({ uri: `${API_URL}${path}`, headers: TUNNEL_HEADERS });

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
    /** A rezoning / site plan application: a type Ordis can turn into a 3D model. */
    modelled: boolean;
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

/** fetch() against the Ordis API with the Clerk session token, so saved places are per user.
 *  The returned function keeps one identity for the component's life: Clerk's getToken changes
 *  identity between renders, and effects depending on it would otherwise re-run in a loop. */
export function useApi() {
  const { getToken } = useAuth();
  const tokenRef = useRef(getToken);
  useEffect(() => {
    tokenRef.current = getToken;
  });
  return useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const token = await tokenRef.current();
      let r: Response;
      try {
        r = await fetch(`${API_URL}${path}`, {
          ...init,
          headers: { "Content-Type": "application/json", ...TUNNEL_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
      } catch {
        throw new ApiError(`Can't reach the Ordis API at ${API_URL}. Is the backend running (and 'npm run ports' done)?`);
      }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new ApiError(data.detail ?? `HTTP ${r.status}`);
      return data as T;
    },
    [],
  );
}

/** Runs the Ordis agents for one application (the website's /api/run stream) and waits for the
 *  result: about a minute for a new one, seconds when it's saved. */
export async function buildModel(address: string, appNumber: string): Promise<{ ok: boolean; message?: string }> {
  const q = `address=${encodeURIComponent(address)}&app_number=${encodeURIComponent(appNumber)}&include_closed=false`;
  let text: string;
  try {
    const r = await fetch(`${API_URL}/api/run?${q}`, { headers: TUNNEL_HEADERS });
    text = await r.text(); // the stream ends after its "result" event
  } catch {
    return { ok: false, message: `Can't reach the Ordis API at ${API_URL}.` };
  }
  const block = text.split("\n\n").reverse().find((b) => b.startsWith("event: result"));
  const data = block?.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
  try {
    return data ? JSON.parse(data) : { ok: false, message: "The model run ended without a result." };
  } catch {
    return { ok: false, message: "The model run returned something unexpected." };
  }
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
