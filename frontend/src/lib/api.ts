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
}

export interface Health {
  llm: { provider: string; model: string | null; configured: boolean };
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

/** Starts a pipeline run; returns a function that cancels it. */
export function startRun(
  params: { address: string; appNumber?: string; includeClosed: boolean },
  onStep: (e: Omit<StepEvent, "id" | "time">) => void,
  onResult: (r: RunResult) => void,
  onError: (msg: string) => void,
): () => void {
  const q = new URLSearchParams({ address: params.address, include_closed: String(params.includeClosed) });
  if (params.appNumber) q.set("app_number", params.appNumber);
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
