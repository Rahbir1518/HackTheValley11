"use client";

import { useEffect, useRef, useState } from "react";
import {
  Box,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Columns2,
  Eye,
  EyeOff,
  Landmark,
  Layers as LayersIcon,
  ListTree,
  Pause,
  Play,
  Sun as SunIcon,
} from "lucide-react";
import { API_URL, type Agent, type Block, type RunResult, type Spec, type StepEvent, type SunlightStudy } from "@/lib/api";
import { blockColor, type SceneNode } from "@/lib/scene";
import { formatToronto, minutesOfDayToronto, sunTimes, type Sun } from "@/lib/sun";
import { Ordi, StatusChip } from "@/components/brand";

const mono = "mono";

// ------------------------------------------------------------------ helpers

export function storeysLabel(spec: Spec) {
  const towers = spec.towers.map((t) => t.storeys);
  const n = towers.length ? towers.join(" + ") : String(spec.total_storeys);
  const estimated = spec.assumptions.some((a) => a.field === "total_storeys");
  return `${n} storeys · ${estimated ? "estimated" : "stated"}`;
}

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1).replace("-", " ") : s;
}

function estimatedLines(spec: Spec): string[] {
  const out: string[] = [];
  if (!spec.height_stated) {
    if (spec.towers.length) out.push(`Towers ${spec.towers.map((t) => `≈${t.height_m.toFixed(0)} m`).join(" / ")} · ${spec.storey_height_m} m floors`);
    else out.push(`Height ≈${spec.height_m.toFixed(0)} m · ${spec.storey_height_m} m floors`);
  }
  if (spec.assumptions.some((a) => a.field === "podium_storeys")) out.push(`Podium ${spec.podium_storeys} storeys · 4.5 m floors`);
  if (spec.assumptions.some((a) => a.field === "tower_setback_m")) out.push(`Setback ${spec.tower_setback_m} m · model assumption`);
  if (spec.assumptions.some((a) => a.field === "total_storeys")) out.push(`Storeys estimated from the stated height`);
  out.push("Footprint from the property boundary");
  return out;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-[11px]">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-black">{value}</span>
    </div>
  );
}

// ------------------------------------------------------------------ scene collection

const ROLE_ICON: Record<string, typeof Box> = { proposed: Building2, existing_on_site: Landmark, group: LayersIcon };

export function SceneCollection({
  tree,
  title,
  selectedId,
  onSelect,
  hidden,
  onToggle,
  collapsed,
  onCollapsed,
}: {
  tree: SceneNode[];
  title: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  hidden: Set<string>;
  onToggle: (id: string) => void;
  collapsed: boolean;
  onCollapsed: (v: boolean) => void;
}) {
  // Flatten Blender's folders into the three groups residents care about.
  const proposal = tree.find((n) => n.id === "Proposed_Building");
  const context = tree.find((n) => n.id === "Context");
  const site = tree.find((n) => n.id === "Site");
  const existing = context?.children.find((c) => c.id === "Existing_Buildings");
  const onSiteNodes = existing?.children.filter((c) => c.role === "existing_on_site") ?? [];
  const [openContext, setOpenContext] = useState(false);

  const line = (node: SceneNode, label: string, depth: number, Icon: typeof Box, extra?: React.ReactNode) => {
    const sel = node.id === selectedId;
    const off = hidden.has(node.id);
    return (
      <div
        key={`${node.id}:${label}`}
        onClick={() => onSelect(node.id)}
        className={`group flex h-7 cursor-default items-center gap-2 pr-4 text-[11px] ${sel ? "bg-select text-prop-ink" : "text-muted hover:bg-side"}`}
        style={{ paddingLeft: 16 + depth * 20 }}
      >
        {extra}
        <Icon className="size-3 shrink-0" strokeWidth={1.6} />
        <span className={`flex-1 truncate ${off ? "opacity-40" : ""}`}>{label}</span>
        <button
          type="button"
          aria-label={off ? "Show" : "Hide"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.id);
          }}
          className="text-muted hover:text-ink"
        >
          {off ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
        </button>
      </div>
    );
  };

  return (
    <div className="border-b border-line pb-2.5">
      <button onClick={() => onCollapsed(!collapsed)} className="flex h-9 w-full items-center justify-between px-4 text-[11px] text-black">
        <span className={collapsed ? "text-muted" : ""}>{collapsed ? "›  Scene collection" : "Scene collection"}</span>
        <ListTree className="size-3.5 text-muted" />
      </button>
      {!collapsed && (
        <>
          {proposal &&
            line(proposal, title, 0, Box, <ChevronDown className="size-2.5 text-muted" />)}
          {proposal &&
            line(
              proposal,
              proposal.children.filter((c) => c.role === "proposed").length > 1
                ? `Proposed building · ${proposal.children.filter((c) => c.role === "proposed").length} parts`
                : "Proposed building",
              1,
              Building2,
            )}
          {onSiteNodes.length > 0 &&
            line(onSiteNodes[0], `On the site today · ${onSiteNodes.length}`, 1, Landmark)}
          {site?.children[0] && line(site.children[0], "Property boundary", 1, Box)}
          {context &&
            line(
              context,
              "City context",
              0,
              LayersIcon,
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenContext(!openContext);
                }}
                className="w-2.5 text-[10px] text-muted"
              >
                {openContext ? "⌄" : "›"}
              </button>,
            )}
          {openContext &&
            context?.children.map((c) =>
              line(c, c.id === "Existing_Buildings" ? `Existing buildings · ${c.children.length}` : c.name, 1, ROLE_ICON[c.role] ?? LayersIcon),
            )}
        </>
      )}
    </div>
  );
}

export function SelectedObject({ node }: { node: SceneNode | null }) {
  if (!node || node.role === "group" || node.id === "Proposed_Building") return null;
  const p = node.props;
  const rows: [string, string][] = [];
  if (typeof p.height_m === "number") rows.push(["Height", `${p.height_m.toFixed(1)} m`]);
  if (typeof p.storeys === "number") rows.push(["Storeys (this part)", String(p.storeys)]);
  if (typeof p.approx_storeys === "number") rows.push(["Approx. storeys", String(p.approx_storeys)]);
  if (typeof p.footprint_area_m2 === "number") rows.push(["Footprint", `${p.footprint_area_m2.toLocaleString()} m²`]);
  if (typeof p.area_m2 === "number") rows.push(["Area", `${p.area_m2.toLocaleString()} m²`]);
  if (typeof p.height_source === "string") rows.push(["Height source", p.height_source]);
  if (!rows.length) return null;
  return (
    <div className="space-y-2 rounded-md bg-side p-3">
      <p className={`${mono} text-[9px] uppercase text-muted`}>Selected · {node.name}</p>
      {rows.map(([k, v]) => (
        <Row key={k} label={k} value={v} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ overview / evidence

export type Section = "overview" | "evidence" | "nearby" | "involved";

export function ProposalPanel({
  result,
  section,
  onSection,
  onOpenImagery,
}: {
  result: RunResult;
  section: Section;
  onSection: (s: Section) => void;
  onOpenImagery: () => void;
}) {
  const spec = result.spec;
  const app = result.application;
  const n = result.narration;
  if (section === "nearby") {
    return (
      <div className="space-y-4">
        <button onClick={() => onSection("overview")} className="text-[12px] text-prop-ink">
          ← Back to proposal overview
        </button>
        <p className="text-[18px] text-black">Nearby &amp; ward context</p>
        <NearbyContext result={result} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex gap-5 text-[12px]">
        {(
          [
            ["overview", "Overview"],
            ["evidence", "Evidence & sources"],
            ["involved", "Get involved"],
          ] as const
        ).map(([s, label]) => (
          <button key={s} onClick={() => onSection(s)} className={section === s ? "font-semibold text-ink" : "text-muted hover:text-ink"}>
            {label}
          </button>
        ))}
      </div>

      {section === "involved" && app && <Involved appNumber={app.app_number} />}

      {section === "overview" && spec && (
        <>
          <div className="space-y-2.5">
            <p className="text-[22px] leading-tight text-black">
              {/^[aeiou]/i.test(spec.use_type) ? "An" : "A"} {spec.use_type.replace("-", " ")} proposal.
            </p>
            {n && <p className="text-[13px] leading-[1.6] text-muted">{n.headline}</p>}
          </div>
          <div className="space-y-2.5">
            <StatusChip>Stated in application</StatusChip>
            <Row
              label="Use / height"
              value={`${cap(spec.use_type)} · ${spec.towers.length ? spec.towers.map((t) => t.storeys).join(" & ") : spec.total_storeys} storeys`}
            />
            {spec.height_stated && <Row label="Height" value={`${spec.height_m} m`} />}
            {spec.units != null && <Row label="Homes" value={spec.units.toLocaleString()} />}
            {spec.gfa_m2 != null && <Row label="Floor area" value={`${spec.gfa_m2.toLocaleString()} m²`} />}
          </div>
          <div className="space-y-2 rounded-md bg-select p-3 text-prop-ink">
            <p className={`${mono} text-[9px]`}>ESTIMATED · VISIBLE RULES</p>
            {estimatedLines(spec).map((l) => (
              <p key={l} className="text-[11px] leading-[1.5]">
                {l}
              </p>
            ))}
          </div>
          {app && (
            <div className="space-y-2 border-b border-line pb-3.5">
              <p className="text-[11px] text-muted">
                {app.type_name} · submitted {(app.date_submitted ?? "").slice(0, 10)}
              </p>
              <p className={`${mono} text-[10px] text-black`}>{app.app_number}</p>
              {app.application_url && (
                <a href={app.application_url} target="_blank" rel="noreferrer" className="block text-[11px] text-prop-ink hover:underline">
                  Application Information Centre ↗
                </a>
              )}
            </div>
          )}
          <div>
            {(
              [
                ["evidence", "Evidence & assumptions", "Application text and model rules"],
                ["nearby", "Nearby & ward context", "Applications, housing and your ward"],
                ["imagery", "Site imagery", "Aerial photo and Street View, in a window"],
                ["involved", "Get involved", "How to participate in the process"],
              ] as const
            ).map(([key, title, sub]) => (
              <button
                key={key}
                onClick={() => (key === "imagery" ? onOpenImagery() : onSection(key))}
                className="flex w-full items-center justify-between border-b border-line py-2.5 text-left"
              >
                <span>
                  <span className="block text-[11px] font-medium text-black">{title}</span>
                  <span className="block text-[9px] text-muted">{sub}</span>
                </span>
                <ChevronRight className="size-4 text-muted" />
              </button>
            ))}
          </div>
        </>
      )}

      {section === "evidence" && spec && (
        <div className="space-y-5">
          <div className="space-y-2">
            <p className={`${mono} text-[9px] text-muted`}>STATED IN THE APPLICATION</p>
            {spec.stated_facts.length ? (
              spec.stated_facts.map((f, i) => (
                <p key={i} className="border-l-2 border-prop pl-2.5 text-[12px] italic leading-[1.5] text-black">
                  “{f}”
                </p>
              ))
            ) : (
              <p className="text-[12px] text-muted">No direct quotes were extracted.</p>
            )}
          </div>
          <div className="space-y-2">
            <p className={`${mono} text-[9px] text-muted`}>ESTIMATED BY ORDIS ({spec.assumptions.length})</p>
            {spec.assumptions.map((a, i) => (
              <div key={i} className="rounded-md bg-side p-2.5 text-[11px]">
                <div className="flex justify-between gap-3">
                  <span className={`${mono} text-[10px] text-black`}>{a.field}</span>
                  <span className="text-prop-ink">{a.value}</span>
                </div>
                <p className="mt-1 leading-[1.5] text-muted">{a.rule}</p>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1 text-[11px]">
              <span className="text-muted">How sure is Ordis?</span>
              <span className="text-black">{Math.round(spec.confidence * 100)}%</span>
            </div>
            <div className="h-1 rounded bg-soft">
              <div className="h-1 rounded bg-prop" style={{ width: `${spec.confidence * 100}%` }} />
            </div>
          </div>
          <div className="space-y-1.5">
            <p className={`${mono} text-[9px] text-muted`}>SOURCES</p>
            {result.sources?.map((s) => (
              <a key={s.key} href={s.page_url} target="_blank" rel="noreferrer" className="block text-[11px] text-prop-ink hover:underline">
                {s.title} ↗
              </a>
            ))}
          </div>
          <div className="space-y-1.5">
            <p className={`${mono} text-[9px] text-muted`}>LIMITATIONS</p>
            {[...(result.limitations ?? []), ...(result.site?.notes ?? [])].map((l) => (
              <p key={l} className="text-[11px] leading-[1.5] text-muted">
                · {l}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ block in 5 years

function storeysText(storeys: number, stated: boolean) {
  return `${stated ? "" : "≈"}${storeys} storeys · ${stated ? "stated" : "estimated"}`;
}

/** Every active proposal nearby, keyed to its shade in the 3D view. Neutral: counts and
 *  stated numbers only, with what was estimated marked. */
export function BlockPanel({
  result,
  block,
  loading,
  error,
  selected,
  onSelect,
  onSunlight,
  onBack,
}: {
  result: RunResult;
  block: Block | null;
  loading: boolean;
  error: string | null;
  selected: string | null;
  onSelect: (appNumber: string | null) => void;
  onSunlight: () => void;
  onBack: () => void;
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  const spec = result.spec;
  const app = result.application;
  const address = result.geocode?.address_full ?? "";
  const all = block && spec ? [{ units: spec.units, storeys: spec.total_storeys }, ...block.proposals.map((p) => ({ units: p.spec.units, storeys: p.spec.total_storeys }))] : [];
  const homes = all.reduce((a, p) => a + (p.units ?? 0), 0);
  const noHomes = all.filter((p) => p.units == null).length;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-[22px] leading-tight text-black">Your block in 5 years</p>
        <p className="text-[12px] leading-[1.6] text-muted">
          Every active application within {block?.radius_m ?? 300} m, shown as if built as proposed. Not a forecast: approval and timing are unknown.
        </p>
      </div>

      {loading && (
        <p className="animate-pulse rounded-md bg-side p-3 text-[11px] leading-[1.5] text-muted">
          Reading nearby applications… The first time can take up to a minute; it&apos;s saved after that.
        </p>
      )}
      {error && <p className="rounded-md bg-[#fbe9e4] p-3 text-[11px] text-[#a0331c]">{error}</p>}

      {block && spec && app && (
        <>
          <div className="flex gap-2 text-center">
            {(
              [
                [String(all.length), all.length === 1 ? "proposal" : "proposals"],
                [String(Math.max(...all.map((p) => p.storeys))), "tallest, storeys"],
                [homes ? homes.toLocaleString() : "—", "homes stated"],
              ] as const
            ).map(([v, label]) => (
              <div key={label} className="flex-1 rounded-md bg-side px-2 py-2.5">
                <p className="text-[17px] text-black">{v}</p>
                <p className="text-[9px] text-muted">{label}</p>
              </div>
            ))}
          </div>
          {noHomes > 0 && homes > 0 && (
            <p className="-mt-2 text-[10px] text-muted">
              {noHomes} of {all.length} don&apos;t state a number of homes.
            </p>
          )}

          <div className="border-t border-line">
            <div className="flex items-center gap-2.5 border-b border-line py-2.5">
              <span className="size-2.5 shrink-0 bg-prop-ink" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium text-black">{app.address}</span>
                <span className="block text-[9px] text-muted">This proposal · {storeysLabel(spec)}</span>
              </span>
            </div>
            {block.proposals.map((p, i) => {
              const open = selected === p.app_number;
              return (
                <div key={p.app_number} className={`border-b border-line ${open ? "bg-side" : ""}`}>
                  <button onClick={() => onSelect(open ? null : p.app_number)} className="flex w-full items-center gap-2.5 py-2.5 text-left">
                    <span className="size-2.5 shrink-0" style={{ background: blockColor(i) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-black">{p.address}</span>
                      <span className="block text-[9px] text-muted">
                        {storeysText(p.spec.total_storeys, p.spec.storeys_stated)} · {p.distance_m} m away
                      </span>
                    </span>
                    <ChevronDown className={`size-3.5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && (
                    <div className="space-y-1.5 px-5 pb-3 text-[11px]">
                      <Row label="Status" value={p.status} />
                      {p.spec.height_stated && <Row label="Height" value={`${p.spec.height_m} m · stated`} />}
                      {p.spec.units != null && <Row label="Homes" value={`${p.spec.units.toLocaleString()} · stated`} />}
                      <Row label="Application" value={<span className={`${mono} text-[10px]`}>{p.app_number}</span>} />
                      <p className="text-[10px] leading-[1.5] text-muted">
                        {p.massing === "builder" ? "Massing planned by the Builder Agent when Ordis modelled it." : "Rule-based massing from the stated numbers (not yet modelled on its own)."}
                        {p.replaces.length ? ` Replaces ${p.replaces.length} building${p.replaces.length > 1 ? "s" : ""} on the lot today.` : ""}
                      </p>
                      <div className="flex gap-3 pt-0.5">
                        <a href={`/viewer?address=${encodeURIComponent(address)}&app=${encodeURIComponent(p.app_number)}`} className="text-prop-ink hover:underline">
                          Open on its own →
                        </a>
                        {p.application_url && (
                          <a href={p.application_url} target="_blank" rel="noreferrer" className="text-prop-ink hover:underline">
                            City record ↗
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button onClick={onSunlight} className="flex h-[42px] w-full items-center justify-between rounded-md border border-line px-3 text-[12px] text-black hover:bg-side">
            Combined sun loss
            <SunIcon className="size-4" strokeWidth={1.5} />
          </button>

          {block.skipped.length > 0 && (
            <div className="space-y-1.5">
              <button onClick={() => setShowSkipped(!showSkipped)} className="text-[11px] text-muted hover:text-ink">
                {showSkipped ? "⌄" : "›"} Not shown ({block.skipped.length})
              </button>
              {showSkipped &&
                block.skipped.map((s) => (
                  <p key={s.app_number} className="text-[10px] leading-[1.5] text-muted">
                    <span className="text-black">{s.address}</span> · {s.reason}
                  </p>
                ))}
            </div>
          )}
          <div className="space-y-1">
            {block.limitations.map((l) => (
              <p key={l} className="text-[10px] leading-[1.5] text-muted">
                · {l}
              </p>
            ))}
          </div>
        </>
      )}
      <button onClick={onBack} className="text-[12px] text-prop-ink">
        ← Back to this proposal
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ drill-ins

function useFetch<T>(url: string | null) {
  const [state, setState] = useState<{ url: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetch(url)
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json()).detail ?? r.statusText)))
      .then((data) => !cancelled && setState({ url, data }))
      .catch((e) => !cancelled && setState({ url, error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state?.url === url ? state : null;
}

interface Housing {
  neighbourhood: string;
  households: number;
  indicators: Record<string, { value: number; median_of_neighbourhoods: number; percentile: number }>;
  proposal: { units: number | null; share_of_households_pct: number | null; use_type: string | null };
}

const INDICATORS: [string, string, (v: number) => string][] = [
  ["renter_share", "Households that rent", (v) => `${v.toFixed(0)}%`],
  ["median_rent", "Median monthly rent", (v) => `$${v.toLocaleString()}`],
  ["pct_tenant_30", "Renters paying 30%+ of income", (v) => `${v.toFixed(0)}%`],
  ["median_value", "Median owned-home value", (v) => `$${(v / 1000).toFixed(0)}k`],
];

function NearbyContext({ result }: { result: RunResult }) {
  const app = result.application;
  const housing = useFetch<Housing>(app ? `${API_URL}/api/housing?app_number=${encodeURIComponent(app.app_number)}` : null);
  const others = (result.candidates ?? []).filter((c) => c.app_number !== app?.app_number).slice(0, 5);
  const w = result.ward;
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className={`${mono} text-[9px] text-muted`}>{housing?.data ? `HOUSING · ${housing.data.neighbourhood.toUpperCase()}` : "HOUSING"}</p>
        {housing?.data &&
          INDICATORS.filter(([k]) => housing.data!.indicators[k]).map(([k, label, fmt]) => {
            const ind = housing.data!.indicators[k];
            return (
              <div key={k} className="space-y-1">
                <Row label={label} value={fmt(ind.value)} />
                <div className="relative h-1 rounded bg-soft">
                  <div className="absolute top-[-2px] h-2 w-px bg-muted" style={{ left: "50%" }} />
                  <div className="absolute top-[-3px] size-2.5 -translate-x-1/2 rounded-full bg-prop-ink" style={{ left: `${Math.min(97, Math.max(3, ind.percentile))}%` }} />
                </div>
              </div>
            );
          })}
        {housing?.data && (
          <p className="text-[10px] leading-[1.5] text-muted">
            2021 Census, compared with Toronto&apos;s 158 neighbourhoods (tick = median).{" "}
            {housing.data.proposal.units
              ? `This proposal adds ${housing.data.proposal.units.toLocaleString()} homes, about ${housing.data.proposal.share_of_households_pct}% of today's households.`
              : "Not sale prices; no value predictions."}
          </p>
        )}
        {housing?.error && <p className="text-[11px] text-muted">{housing.error}</p>}
      </div>
      <div className="space-y-2">
        <p className={`${mono} text-[9px] text-muted`}>OTHER APPLICATIONS NEARBY</p>
        {others.length ? (
          others.map((o) => (
            <a
              key={o.app_number}
              href={o.modelled ? `/viewer?address=${encodeURIComponent(result.geocode?.address_full ?? "")}&app=${encodeURIComponent(o.app_number)}` : o.application_url ?? "#"}
              className="block rounded-md border border-line p-2.5 hover:bg-side"
            >
              <div className="flex justify-between text-[11px]">
                <span className="text-black">{o.address}</span>
                <span className="text-muted">{Math.round(o.distance_m)} m</span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted">
                {o.type_name} · {o.status}
                {o.modelled ? " · view in 3D →" : ""}
              </p>
            </a>
          ))
        ) : (
          <p className="text-[11px] text-muted">No other applications within 300 m.</p>
        )}
      </div>
      {w && (
        <div className="space-y-1.5">
          <p className={`${mono} text-[9px] text-muted`}>WARD · {w.ward_name.toUpperCase()}</p>
          <Row label="Applications on record" value={w.total.toLocaleString()} />
          <Row label="Submitted since 2024" value={w.submitted_since_2024.toLocaleString()} />
          <p className="text-[10px] leading-[1.5] text-muted">Toronto votes October 26, 2026. Counts show activity, not whether it is good or bad.</p>
        </div>
      )}
    </div>
  );
}

const EMBED_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY;

export function siteLocation(result: RunResult): { lat: number; lon: number } | null {
  const app = result.application as (RunResult["application"] & { lat?: number; lon?: number }) | undefined;
  const lat = app?.lat ?? result.geocode?.lat;
  const lon = app?.lon ?? result.geocode?.lon;
  return lat != null && lon != null ? { lat, lon } : null;
}

/** Real imagery of the site in a floating window over the 3D view: drag the header to move,
 *  drag the corner to resize, collapse or close. Aerial is keyless (Esri); Street needs a Maps Embed key. */
export function SiteImageryWindow({ lat, lon, label, onClose }: { lat: number; lon: number; label: string; onClose: () => void }) {
  const [tab, setTab] = useState<"aerial" | "street">(EMBED_KEY ? "street" : "aerial");
  const [pos, setPos] = useState({ right: 16, top: 18 });
  const [collapsed, setCollapsed] = useState(false);
  const drag = useRef<{ x: number; y: number; right: number; top: number } | null>(null);
  const dLat = 170 / 111_320;
  const dLon = 170 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const aerial =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?" +
    new URLSearchParams({ bbox: `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`, bboxSR: "4326", imageSR: "3857", size: "640,640", format: "jpg", f: "image" });
  return (
    <div
      className="absolute z-20 flex flex-col overflow-hidden rounded-xl border border-line bg-white shadow-[0_8px_24px_rgba(35,53,44,0.10)]"
      style={{
        right: pos.right,
        top: pos.top,
        width: 300,
        height: collapsed ? "auto" : 300,
        minWidth: 220,
        minHeight: collapsed ? 0 : 180,
        resize: collapsed ? "none" : "both",
        direction: "rtl", // native resize grip on the left, away from the viewport edge
      }}
    >
      <div style={{ direction: "ltr" }} className="flex h-full flex-col">
        <div
          className="flex h-9 shrink-0 cursor-move select-none items-center gap-2 border-b border-line px-3"
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY, ...pos };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            setPos({
              right: Math.max(0, drag.current.right - (e.clientX - drag.current.x)),
              top: Math.max(0, drag.current.top + (e.clientY - drag.current.y)),
            });
          }}
          onPointerUp={() => (drag.current = null)}
        >
          <span className="shrink-0 whitespace-nowrap text-[11px] text-black">Site imagery</span>
          <span className="min-w-0 truncate text-[10px] text-muted">{label}</span>
          <div className="ml-auto flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
            <div className="flex rounded-md bg-soft p-0.5 text-[10px]">
              {(["aerial", "street"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={`rounded px-2 py-0.5 ${tab === t ? "bg-white text-prop-ink" : "text-muted"}`}>
                  {t === "aerial" ? "Aerial" : "Street"}
                </button>
              ))}
            </div>
            <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand" : "Collapse"} className="px-1 text-[11px] text-muted hover:text-ink">
              {collapsed ? "▾" : "▴"}
            </button>
            <button onClick={onClose} aria-label="Close" className="px-1 text-[13px] text-muted hover:text-ink">
              ×
            </button>
          </div>
        </div>
        {!collapsed && (
          <div className="relative min-h-0 flex-1 bg-soft">
            {tab === "aerial" ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={aerial} alt="Aerial photo of the site" className="size-full object-cover" />
                <span className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-prop-ink" />
                <span className="absolute bottom-0 right-0 bg-black/50 px-1.5 text-[9px] text-white/90">Imagery: Esri, Maxar, Earthstar Geographics</span>
              </>
            ) : EMBED_KEY ? (
              <iframe title="Street View" src={`https://www.google.com/maps/embed/v1/streetview?key=${EMBED_KEY}&location=${lat},${lon}&fov=90`} className="size-full border-0" />
            ) : (
              <div className="grid size-full place-items-center p-4 text-center text-[11px] text-muted">
                <div className="space-y-3">
                  <p>Add NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY to show Street View here.</p>
                  <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`} target="_blank" rel="noreferrer" className="inline-block rounded-full bg-ink px-4 py-2 text-white">
                    Open in Street View ↗
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface InvolvedData {
  application_url: string | null;
  address: string;
  app_number: string;
  planner: { name: string | null; phone: string | null; email: string | null };
  upcoming_meetings: { date: string; time: string | null; location: string | null }[];
  past_meetings: { date: string; time: string | null }[];
}

function Involved({ appNumber }: { appNumber: string }) {
  const res = useFetch<InvolvedData>(`${API_URL}/api/involved?app_number=${encodeURIComponent(appNumber)}`);
  const [copied, setCopied] = useState(false);
  const d = res?.data;
  if (!d) return <p className="text-[11px] text-muted">{res?.error ?? "Loading…"}</p>;
  const [last, first] = (d.planner.name ?? "").split(",").map((s) => s.trim());
  const name = first ? `${first} ${last}` : d.planner.name;
  const body = `Hello ${name ?? ""},\n\nI live near ${d.address} and I'm trying to understand development application ${d.app_number}.\n\nMy question is:\n[your question]\n\nThank you,\n[your name]`;
  const subject = `Question about application ${d.app_number} (${d.address})`;
  return (
    <div className="space-y-5 text-[11px]">
      <div className="space-y-1.5">
        <p className={`${mono} text-[9px] text-muted`}>COMMUNITY MEETINGS</p>
        {d.upcoming_meetings.length ? (
          d.upcoming_meetings.map((m) => (
            <p key={m.date} className="text-black">
              {m.date} · {m.time ?? "time TBC"} · {m.location ?? "see the City's page"}
            </p>
          ))
        ) : (
          <p className="leading-[1.5] text-muted">No upcoming meeting is listed in the City&apos;s data{d.past_meetings.length ? ` (last: ${d.past_meetings.at(-1)?.date})` : ""}.</p>
        )}
      </div>
      <div className="space-y-1.5">
        <p className={`${mono} text-[9px] text-muted`}>CITY PLANNER ON THIS FILE</p>
        {name ? (
          <>
            <p className="text-[13px] text-black">{name}</p>
            {d.planner.email && (
              <a href={`mailto:${d.planner.email}`} className="block text-prop-ink hover:underline">
                {d.planner.email}
              </a>
            )}
            {d.planner.phone && <p className="text-muted">{d.planner.phone}</p>}
          </>
        ) : (
          <p className="text-muted">No planner is listed.</p>
        )}
      </div>
      <div className="space-y-2">
        <p className={`${mono} text-[9px] text-muted`}>ASK A QUESTION</p>
        <pre className="whitespace-pre-wrap rounded-md bg-side p-2.5 font-sans text-[11px] leading-[1.5] text-muted">{body}</pre>
        <div className="flex gap-2">
          {d.planner.email && (
            <a href={`mailto:${d.planner.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} className="rounded-full bg-ink px-3 py-1.5 text-white">
              Open in email
            </a>
          )}
          <button
            onClick={() => {
              navigator.clipboard.writeText(body);
              setCopied(true);
            }}
            className="rounded-full border border-line px-3 py-1.5 text-muted"
          >
            {copied ? "Copied" : "Copy text"}
          </button>
        </div>
      </div>
      {d.application_url && (
        <a href={d.application_url} target="_blank" rel="noreferrer" className="block text-prop-ink hover:underline">
          Official application record ↗
        </a>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ sunlight

const SEASONS: [string, string][] = [
  ["Mar", "03-21"],
  ["Jun", "06-21"],
  ["Sep", "09-21"],
  ["Dec", "12-21"],
];

function hhmm(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function hours(h: number) {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  if (!whole) return `${min} min`;
  return min ? `${whole} h ${min} min` : `${whole} h`;
}

export function SunlightPanel({
  address,
  date,
  onDate,
  minutes,
  onMinutes,
  split,
  onSplit,
  heatOn,
  onHeat,
  study,
  studyLoading,
  studyError,
  onBack,
  sceneOpen,
  blockOn,
  onBlock,
  blockCount,
}: {
  address: string;
  date: string;
  onDate: (d: string) => void;
  minutes: number;
  onMinutes: (m: number) => void;
  split: boolean;
  onSplit: (v: boolean) => void;
  heatOn: boolean;
  onHeat: (v: boolean) => void;
  study: SunlightStudy | null;
  studyLoading: boolean;
  studyError: string | null;
  onBack: () => void;
  sceneOpen: React.ReactNode;
  blockOn: boolean;
  onBlock: (v: boolean) => void;
  /** Proposals in the block view including this one, once loaded. */
  blockCount: number | null;
}) {
  const year = date.slice(0, 4);
  return (
    <div className="space-y-6 p-[22px]">
      {sceneOpen}
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <SunIcon className="size-[22px]" strokeWidth={1.5} />
          <p className="text-[23px] text-black">Sunlight study</p>
        </div>
        <p className="text-[13px] leading-[1.6] text-muted">A different way to look at {address}. Compare the same street, at the same moment.</p>
      </div>
      <div className="space-y-4">
        <p className={`${mono} text-[10px] text-muted`}>DAY &amp; TIME</p>
        <label className="flex h-[42px] items-center justify-between rounded-md border border-line px-3">
          <input type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} className="flex-1 bg-transparent text-[13px] text-black outline-none" />
          <CalendarDays className="size-[15px] text-muted" strokeWidth={1.5} />
        </label>
        <label className="flex h-[42px] items-center justify-between rounded-md border border-line px-3">
          <input
            type="time"
            step={300}
            value={hhmm(minutes)}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (!Number.isNaN(h)) onMinutes(h * 60 + m);
            }}
            className={`${mono} bg-transparent text-[13px] text-black outline-none`}
          />
          <span className="text-[10px] text-muted">EDT · TORONTO</span>
        </label>
        <div className="flex gap-1.5">
          {SEASONS.map(([label, md]) => (
            <button
              key={md}
              onClick={() => onDate(`${year}-${md}`)}
              className={`flex-1 rounded py-[7px] text-[11px] ${date.endsWith(md) ? "bg-select text-prop-ink" : "bg-soft text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-3.5">
        <p className={`${mono} text-[10px] text-muted`}>COMPARE</p>
        <button
          onClick={() => onSplit(!split)}
          className={`flex h-[42px] w-full items-center justify-between rounded-md px-3 text-[12px] ${split ? "bg-select text-prop-ink" : "border border-line text-muted"}`}
        >
          Side-by-side views
          <Columns2 className="size-4" strokeWidth={1.5} />
        </button>
        <button
          onClick={() => onHeat(!heatOn)}
          className={`flex h-[42px] w-full items-center justify-between rounded-md px-3 text-[12px] ${heatOn ? "bg-[#fbe9e4] text-[#a0331c]" : "border border-line text-muted"}`}
        >
          Hours of sun lost (whole day)
          {heatOn ? <Check className="size-4" /> : <SunIcon className="size-4" strokeWidth={1.5} />}
        </button>
        <button
          onClick={() => onBlock(!blockOn)}
          className={`flex h-[42px] w-full items-center justify-between rounded-md px-3 text-[12px] ${blockOn ? "bg-select text-prop-ink" : "border border-line text-muted"}`}
        >
          {blockOn && blockCount ? `All ${blockCount} nearby proposals` : "All nearby proposals"}
          {blockOn ? <Check className="size-4" /> : <LayersIcon className="size-4" strokeWidth={1.5} />}
        </button>
        <p className="text-[12px] leading-[1.6] text-muted">
          {heatOn
            ? blockOn
              ? "Ground that loses direct sun if every active proposal nearby were built, sunrise to sunset."
              : "Ground that loses direct sun because of the proposal, sunrise to sunset."
            : "Existing City context on one side. The same context with the proposal on the other."}
        </p>
      </div>
      {heatOn && (
        <div className="space-y-2 rounded-md border border-line p-3.5 text-[11px]">
          {studyLoading && <p className="animate-pulse text-muted">Tracing shadows every 15 minutes…</p>}
          {studyError && <p className="text-[#a0331c]">{studyError}</p>}
          {study && !studyLoading && (
            <>
              <div className="h-1.5 rounded" style={{ background: "linear-gradient(90deg, #ffd63c80, #ff7a1ec0, #d7140fe0)" }} />
              <div className="flex justify-between text-[9px] text-muted">
                <span>15 min</span>
                <span>2 h</span>
                <span>4 h+ lost</span>
              </div>
              <p className="leading-[1.6] text-black">
                {study.stats.area_lost_1h_m2.toLocaleString()} m² of ground loses at least an hour of direct sun.
              </p>
              {study.stats.max_hours_lost > 0 && (
                <p className="leading-[1.6] text-muted">
                  Most affected spot: {hours(study.stats.worst_point.sun_today_h)} today → {hours(Math.max(0, study.stats.worst_point.sun_with_h))} with the proposal.
                </p>
              )}
              {study.affected_parcels.slice(0, 3).map((p, i) => (
                <div key={i} className="flex justify-between">
                  <span className="truncate text-black">{p.address ?? "Neighbouring lot"}</span>
                  <span className={`${mono} text-[#a0331c]`}>−{hours(p.mean_hours_lost)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      <div className="space-y-2.5 rounded-md bg-side p-3.5">
        <p className="text-[12px] text-black">A visual guide, not a verdict.</p>
        <p className="text-[11px] leading-[1.6] text-muted">
          Clear-sky shadows from the massing model at ground level on flat terrain. Not a daylight-compliance study.
        </p>
      </div>
      <button onClick={onBack} className="text-[12px] text-prop-ink">
        ← Back to proposal overview
      </button>
    </div>
  );
}

export function SunTimeline({
  date,
  minutes,
  onMinutes,
  playing,
  onPlaying,
  onReset,
  sun,
}: {
  date: string;
  minutes: number;
  onMinutes: (m: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  onReset: () => void;
  sun: Sun;
}) {
  const { sunrise, sunset } = sunTimes(date);
  const rise = minutesOfDayToronto(sunrise);
  const set = minutesOfDayToronto(sunset);
  const pct = (Math.min(1435, Math.max(0, minutes)) / 1440) * 100;
  return (
    <div className="shrink-0 space-y-5 border-t border-line bg-white px-7 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-[12px] text-black">
          <CalendarDays className="size-4" strokeWidth={1.5} />
          {new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          <span className="text-[10px] text-muted">
            ↑ {formatToronto(sunrise)} · ↓ {formatToronto(sunset)}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={() => onPlaying(!playing)} aria-label={playing ? "Pause" : "Play sunrise to sunset"} className="grid size-6 place-items-center rounded-full border border-line text-prop-ink">
            {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
          </button>
          <SunIcon className="size-4" strokeWidth={1.5} />
          <span className={`${mono} text-[15px] text-prop-ink`}>{hhmm(minutes)}</span>
          <span className="text-[10px] text-muted">{sun.up ? `Toronto local time · sun ${sun.altitudeDeg.toFixed(0)}° high` : "Toronto local time · sun below horizon"}</span>
        </div>
        <button onClick={onReset} className="text-[11px] text-muted hover:text-ink">
          Reset study
        </button>
      </div>
      <div className="space-y-3">
        <div className="relative h-6">
          <div className="absolute inset-x-0 top-[11px] h-[2px] bg-line" />
          <div className="absolute left-0 top-[11px] h-[2px] bg-prop" style={{ width: `${pct}%` }} />
          {/* daylight band */}
          <div className="absolute top-[9px] h-[6px] rounded bg-[#f6e7b8]/60" style={{ left: `${(rise / 1440) * 100}%`, width: `${((set - rise) / 1440) * 100}%` }} />
          {[0, 4, 8, 12, 16, 20, 24].map((h) => (
            <div key={h} className="absolute top-[7px] h-2.5 w-px bg-line" style={{ left: `${(h / 24) * 100}%` }} />
          ))}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/time-handle.svg" alt="" width={18} height={18} className="pointer-events-none absolute top-[3px] size-[18px] -translate-x-1/2" style={{ left: `${pct}%` }} />
          <input
            type="range"
            min={0}
            max={1435}
            step={5}
            value={minutes}
            onChange={(e) => onMinutes(Number(e.target.value))}
            aria-label="Time of day"
            className="absolute inset-0 w-full cursor-pointer opacity-0"
          />
        </div>
        <div className={`${mono} flex justify-between text-[10px] text-muted`}>
          {["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"].map((t) => (
            <span key={t} className={t === hhmm(Math.round(minutes / 240) * 240 % 1440) && t !== "24:00" ? "text-prop-ink" : ""}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-muted">Choose a day and time to explore the sun. Both views share the same camera.</p>
    </div>
  );
}

// ------------------------------------------------------------------ agent progress

const STEPS: [Agent, string][] = [
  ["data", "Find the application"],
  ["interpreter", "Read it"],
  ["builder", "Plan the model"],
  ["blender", "Build in 3D"],
  ["narrator", "Explain"],
];

/** Five agent steps. While running, the current step pulses; when a run stops, the step it
 *  stopped at is marked and the later steps are shown as skipped, so it never looks stuck. */
export function AgentProgress({ events, failed, children }: { events: StepEvent[]; failed: string | null; children?: React.ReactNode }) {
  const [details, setDetails] = useState(false);
  const seen = new Set(events.map((e) => e.agent));
  const done = events.some((e) => e.kind === "done");
  const current = [...STEPS].reverse().find(([a]) => seen.has(a))?.[0];
  const stopIdx = failed ? Math.max(0, STEPS.findIndex(([a]) => a === current)) : -1;
  const stopLabel = stopIdx >= 0 ? STEPS[stopIdx][1] : "";
  return (
    <div className="w-[440px] rounded-xl border border-line bg-white p-6 shadow-[0_8px_24px_rgba(35,53,44,0.06)]">
      <div className="flex items-start gap-3">
        <Ordi size={34} mood={failed ? "tilt" : "thinking"} />
        <div>
          <p className="text-[15px] text-black">{failed ? `Ordis stopped at “${stopLabel}”.` : "Ordis is reading the City's records…"}</p>
          <p className="mt-0.5 text-[11px] leading-[1.5] text-muted">
            {failed ?? "Saved places load in a few seconds; new ones can take a minute."}
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-2.5">
        {STEPS.map(([agent, label], i) => {
          const stopped = failed && i === stopIdx;
          const skipped = failed && i > stopIdx;
          const isDone = done || (failed ? i < stopIdx : seen.has(agent) && agent !== current);
          const active = !failed && !done && agent === current;
          return (
            <div key={agent} className="flex items-center gap-3 text-[12px]">
              <span
                className={`grid size-5 place-items-center rounded-full ${
                  isDone ? "bg-prop-ink text-white" : stopped ? "bg-[#fbe9e4] text-[#a0331c]" : active ? "border border-prop-ink" : "border border-line"
                }`}
              >
                {isDone ? <Check className="size-3" /> : stopped ? <span className="text-[11px]">!</span> : <span className={`text-[9px] ${active ? "text-prop-ink" : "text-muted"}`}>{i + 1}</span>}
              </span>
              <span className={isDone ? "text-black" : stopped ? "text-[#a0331c]" : active ? "text-prop-ink" : skipped ? "text-muted/60 line-through" : "text-muted"}>
                {label}
              </span>
              {active && <span className="ml-auto animate-pulse text-[10px] text-muted">working</span>}
              {stopped && <span className="ml-auto text-[10px] text-[#a0331c]">stopped here</span>}
              {skipped && <span className="ml-auto text-[10px] text-muted/70">skipped</span>}
            </div>
          );
        })}
      </div>
      {children}
      <button onClick={() => setDetails(!details)} className="mt-5 text-[11px] text-muted hover:text-ink">
        {details ? "Hide details" : "Show details"}
      </button>
      {details && (
        <div className="thin-scroll mt-2 max-h-48 overflow-auto rounded-md bg-side p-2.5 font-mono text-[10px] leading-[1.6] text-muted">
          {events.map((e) => (
            <p key={e.id}>
              <span className="text-prop-ink">{e.agent}</span> {e.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatusBar() {
  return (
    <div className="flex h-[26px] shrink-0 items-center justify-between border-t border-line bg-side px-4 text-[10px] text-muted">
      <span>Massing approximation, not an architectural rendering</span>
      <span className="whitespace-pre">{"Drag to orbit   ·   Shift + drag to pan   ·   Scroll to zoom   ·   WASD to fly"}</span>
      <span className={`${mono} text-[9px]`}>TORONTO / METRES</span>
    </div>
  );
}
