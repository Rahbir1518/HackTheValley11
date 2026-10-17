export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Agent = "data" | "interpreter" | "builder" | "blender" | "narrator" | "system";

export interface StepEvent {
  id: number;
  time: string;
  agent: Agent;
  kind: string; // start | tool | tool_call | llm | retry | result | cache | warn | error | stop | step | done
  message: string;
  data: unknown;
}

export interface Application {
  app_number: string;
  app_type: string;
  type_name: string;
  status: string;
  address: string;
  distance_m: number;
  modelled: boolean;
  closed: boolean;
  date_submitted: string | null;
  application_url: string | null;
  description: string | null;
}

export interface Assumption {
  field: string;
  value: string;
  rule: string;
}

export interface Spec {
  use_type: string;
  total_storeys: number;
  height_m: number;
  height_stated: boolean;
  storey_height_m: number;
  podium_storeys: number;
  podium_storey_height_m: number;
  towers: { storeys: number; height_m: number; height_stated: boolean }[];
  tower_setback_m: number;
  units: number | null;
  gfa_m2: number | null;
  confidence: number;
  stated_facts: string[];
  assumptions: Assumption[];
}

export interface Narration {
  headline: string;
  summary: string;
  key_facts: string[];
  how_to_learn_more: string;
  template?: boolean;
}

export interface Source {
  key: string;
  title: string;
  page_url: string;
  resource_url: string;
  last_refreshed: string | null;
}

export interface WardSummary {
  ward_name: string;
  total: number;
  submitted_since_2024: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
}

export interface RunResult {
  ok: boolean;
  message?: string;
  address?: string;
  geocode?: { address_full: string; lat: number; lon: number; ward_name: string | null; exact: boolean };
  candidates?: Application[];
  application?: Application & {
    ward_name?: string;
    meeting_date?: string | null;
    meeting_location?: string | null;
    parent_folder?: string | null;
  };
  spec?: Spec;
  site?: {
    lot_area_m2: number;
    parcel_ids: number[];
    notes: string[];
    neighbours: { count: number; median_m?: number; tallest_m?: number; radius_m?: number };
  };
  narration?: Narration;
  glb_url?: string;
  preview_url?: string;
  ward?: WardSummary;
  sources?: Source[];
  limitations?: string[];
  provider?: { provider: string; model: string | null; configured: boolean };
  seconds?: number;
  cached?: boolean;
  scene_key?: string;
}

export interface SunlightStudy {
  date: string;
  first: string | null;
  last: string | null;
  extent_m: number;
  png_url: string;
  stats: {
    max_hours_lost: number;
    area_lost_1h_m2: number;
    area_lost_2h_m2: number;
    area_lost_any_m2: number;
    area_gained_1h_m2: number;
    worst_point: { x: number; y: number; sun_today_h: number; sun_with_h: number };
  };
  affected_parcels: { mean_hours_lost: number; max_hours_lost: number; area_m2: number; address?: string }[];
}

export async function getSunlight(sceneKey: string, date: string, block = false): Promise<SunlightStudy> {
  const r = await fetch(`${API_URL}/api/sunlight?scene_key=${encodeURIComponent(sceneKey)}&date=${date}${block ? "&block=true" : ""}`);
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail ?? r.statusText);
  return data;
}

/** Parks, transit and schools within a walk, today and with the proposal(s) (GET /api/capacity). */
export interface Capacity {
  radius_m: number;
  residents_today: number;
  neighbourhoods: string[];
  new_residents: number;
  proposals_counted: { app_number: string; address: string; units: number; household_size: number; residents: number }[];
  proposals_not_counted: { app_number: string; address: string }[];
  parks: {
    area_m2: number;
    largest: { name: string; area_m2: number }[];
    per_resident_today: number | null;
    per_resident_with: number | null;
    city_per_resident: number | null;
    rule: string;
  };
  transit: {
    stops_within_walk: number;
    station: { name: string; distance_m: number; mode: string; lines: string[] } | null;
    routes: Record<string, string[]>;
  };
  schools: { count: number; by_type: Record<string, number>; nearest: { name: string; type: string | null; distance_m: number }[]; note: string };
  rules: string[];
  block: boolean;
}

export interface HeritageEntry {
  address: string;
  status: string;
  status_label: string;
  district: string | null;
  building_type: string | null;
  built: string | null;
  description: string | null;
  distance_m: number;
}

/** What stands on a proposal's lot today (GET /api/site). */
export interface SiteFacts {
  heritage: { on_site: HeritageEntry[]; nearby_count: number; nearby: HeritageEntry[]; districts: string[]; radius_m: number };
  heritage_note: string;
  rentals: { address: string; units: number | null; storeys: number | null; year_built: number | null; property_type: string | null }[];
  rental_units: number;
  /** Sentences quoted from the application text (stated). */
  rental_mentions: string[];
  rental_rule: string | null;
  rental_links: { label: string; url: string }[];
  registry_note: string;
}

/** One other active proposal placed in the current scene ("your block in 5 years"). */
export interface BlockProposal {
  app_number: string;
  related: string[];
  address: string;
  status: string;
  type_name: string;
  date_submitted: string | null;
  application_url: string | null;
  distance_m: number;
  spec: {
    use_type: string;
    total_storeys: number;
    storeys_stated: boolean;
    towers: number[];
    height_m: number;
    height_stated: boolean;
    units: number | null;
    gfa_m2: number | null;
    confidence: number;
  };
  /** "builder": the Builder Agent's plan from an earlier run; "rules": rule-based from the stated numbers. */
  massing: "builder" | "rules";
  /** Local metres (x east, y north), same frame as the scene. */
  masses: { ring: [number, number][]; z0: number; top: number; storeys: number; part: string }[];
  /** Scene objects standing on this lot today (shown as replaced). */
  replaces: string[];
  /** Homes in registered rental buildings on the lot today (RentSafeTO). */
  rental_units: number;
  /** Heritage Register status of entries on the lot. */
  heritage: string[];
}

export interface Block {
  main: string;
  main_rental_units: number;
  radius_m: number;
  key: string;
  proposals: BlockProposal[];
  skipped: { app_number: string; address: string; reason: string }[];
  limitations: string[];
  cached?: boolean;
}

export async function getBlock(sceneKey: string): Promise<Block> {
  const r = await fetch(`${API_URL}/api/block?scene_key=${encodeURIComponent(sceneKey)}`);
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail ?? r.statusText);
  return data;
}

/** One-page PDF for a community meeting. `snapshot` is a data URL of the 3D view; everything
 *  else is assembled by the API from its own records for this scene. */
export async function getBriefing(params: { sceneKey: string; date: string; block: boolean; snapshot: string | null }): Promise<Blob> {
  const r = await fetch(`${API_URL}/api/briefing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scene_key: params.sceneKey, date: params.date, block: params.block, snapshot: params.snapshot }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? r.statusText);
  return r.blob();
}

export interface Health {
  llm: { provider: string; model: string | null; configured: boolean; fallbacks?: string[]; exhausted?: string[] };
  database: boolean;
  blender: boolean;
}

export async function getHealth(): Promise<Health | null> {
  try {
    const r = await fetch(`${API_URL}/api/health`);
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

export interface CachedRun {
  address: string;
  app_number: string | null;
  include_closed: boolean;
  application: string | null;
  headline: string | null;
  saved_at: string;
}

export async function getCached(): Promise<CachedRun[]> {
  try {
    const r = await fetch(`${API_URL}/api/cached`);
    return r.ok ? r.json() : [];
  } catch {
    return [];
  }
}

/** Starts a pipeline run; returns a function that cancels it. */
export function startRun(
  params: { address: string; appNumber?: string; includeClosed: boolean; fresh?: boolean },
  onStep: (e: Omit<StepEvent, "id" | "time">) => void,
  onResult: (r: RunResult) => void,
  onError: (msg: string) => void,
): () => void {
  const q = new URLSearchParams({ address: params.address, include_closed: String(params.includeClosed) });
  if (params.appNumber) q.set("app_number", params.appNumber);
  if (params.fresh) q.set("fresh", "true");
  const es = new EventSource(`${API_URL}/api/run?${q}`);
  let finished = false;
  es.addEventListener("step", (ev) => onStep(JSON.parse((ev as MessageEvent).data)));
  es.addEventListener("result", (ev) => {
    finished = true;
    es.close();
    onResult(JSON.parse((ev as MessageEvent).data));
  });
  es.onerror = () => {
    if (!finished) onError(`Lost connection to the Ordis API at ${API_URL}. Is the backend running?`);
    es.close();
  };
  return () => es.close();
}
