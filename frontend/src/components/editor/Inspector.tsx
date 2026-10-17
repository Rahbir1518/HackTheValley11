"use client";

import type { RunResult } from "@/lib/api";
import { ROLE_LABEL, type SceneNode } from "@/lib/scene";
import { Badge, Field, PanelHeader, Section } from "./ui";

const HIDDEN_KEYS = new Set(["role", "name"]);
const LABELS: Record<string, string> = {
  storeys: "Storeys (this part)",
  storey_height_m: "Storey height",
  height_m: "Height",
  base_elevation_m: "Base elevation",
  top_elevation_m: "Top elevation",
  footprint_area_m2: "Footprint area",
  setback_m: "Setback from base",
  approx_storeys: "Approx. storeys",
  height_source: "Height source",
  source_id: "3D Massing row",
  area_m2: "Area",
  on_site: "On the site",
  application_id: "Application",
};

function fmt(key: string, v: unknown): string {
  if (typeof v === "number") {
    if (key.endsWith("_m2")) return `${v.toLocaleString()} m²`;
    if (key.endsWith("_m")) return `${v.toFixed(1)} m`;
    return String(v);
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export default function Inspector({ node, result }: { node: SceneNode | null; result: RunResult | null }) {
  const spec = result?.spec;
  const app = result?.application;
  const showProposal = !node || node.role === "proposed" || node.name === "Proposed Building";
  return (
    <div className="editor flex h-full flex-col bg-ed-panel">
      <PanelHeader title="Inspector" />
      <div className="flex-1 overflow-auto">
        {node && (
          <>
            <div className="flex items-center gap-2 border-b border-ed-border px-2 py-2">
              <input type="checkbox" checked readOnly className="accent-ed-select" />
              <span className="text-[12px] font-semibold text-white">{node.name}</span>
              <span className="ml-auto">
                <Badge>{ROLE_LABEL[node.role] ?? node.role}</Badge>
              </span>
            </div>
            <Section title="Object">
              {Object.entries(node.props)
                .filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && typeof v !== "object")
                .map(([k, v]) => (
                  <Field key={k} label={LABELS[k] ?? k.replace(/_/g, " ")} value={k === "application_url" ? (
                    <a className="text-[#7fb6ff] underline" href={String(v)} target="_blank" rel="noreferrer">open</a>
                  ) : fmt(k, v)} />
                ))}
              {node.children.length > 0 && <Field label="Children" value={node.children.length} />}
            </Section>
          </>
        )}

        {app && showProposal && (
          <Section title="Development application">
            <Field label="Number" value={app.app_number} />
            <Field label="Type" value={app.type_name} />
            <Field label="Status" value={app.status} />
            <Field label="Submitted" value={(app.date_submitted ?? "").slice(0, 10)} />
            <Field label="Address" value={app.address} />
            {app.application_url && (
              <Field
                label="Official record"
                value={
                  <a className="text-[#7fb6ff] underline" href={app.application_url} target="_blank" rel="noreferrer">
                    Application Information Centre
                  </a>
                }
              />
            )}
          </Section>
        )}

        {spec && showProposal && (
          <>
            <Section title="Interpreted spec">
              <Field label="Use" value={spec.use_type} />
              <Field label="Total storeys" value={spec.total_storeys} />
              <Field
                label="Height"
                value={
                  <span className="flex items-center gap-1">
                    {spec.height_m.toFixed(1)} m
                    <Badge tone={spec.height_stated ? "stated" : "estimated"}>{spec.height_stated ? "stated" : "estimated"}</Badge>
                  </span>
                }
              />
              <Field label="Podium storeys" value={spec.podium_storeys} />
              <Field label="Towers" value={spec.towers.map((t) => `${t.storeys} st / ${t.height_m.toFixed(0)} m`).join(", ") || "none"} />
              {spec.towers.length > 0 && <Field label="Tower setback" value={`${spec.tower_setback_m} m`} />}
              {spec.units != null && <Field label="Units" value={spec.units.toLocaleString()} />}
              {spec.gfa_m2 != null && <Field label="Gross floor area" value={`${spec.gfa_m2.toLocaleString()} m²`} />}
              <div className="pt-1">
                <div className="mb-1 flex justify-between text-[11px] text-ed-dim">
                  <span>Confidence</span>
                  <span className="text-ed-text">{Math.round(spec.confidence * 100)}%</span>
                </div>
                <div className="h-1.5 rounded bg-[#1e1e1e]">
                  <div
                    className={`h-1.5 rounded ${spec.confidence >= 0.7 ? "bg-[#4caf6a]" : spec.confidence >= 0.4 ? "bg-permit" : "bg-[#d24b4b]"}`}
                    style={{ width: `${spec.confidence * 100}%` }}
                  />
                </div>
              </div>
            </Section>
            <Section title={`Assumptions (${spec.assumptions.length})`}>
              {spec.assumptions.map((a, i) => (
                <div key={i} className="rounded border border-[#3a3a3a] bg-[#222] p-1.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-ed-text">{a.field}</span>
                    <Badge tone="estimated">{a.value}</Badge>
                  </div>
                  <p className="mt-0.5 text-ed-dim">{a.rule}</p>
                </div>
              ))}
            </Section>
            {spec.stated_facts.length > 0 && (
              <Section title="Stated in the application" defaultOpen={false}>
                {spec.stated_facts.map((f, i) => (
                  <p key={i} className="border-l-2 border-[#4caf6a] pl-2 text-[11px] italic text-ed-text">“{f}”</p>
                ))}
              </Section>
            )}
          </>
        )}

        {!node && !app && <p className="p-3 text-[11px] text-ed-dim">Select an object to inspect it.</p>}
      </div>
    </div>
  );
}
