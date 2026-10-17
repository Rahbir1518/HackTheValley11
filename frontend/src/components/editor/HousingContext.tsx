"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";

interface Indicator {
  value: number;
  median_of_neighbourhoods: number;
  percentile: number;
}

interface Housing {
  neighbourhood: string;
  households: number;
  owners: number;
  renters: number;
  census_year: number;
  neighbourhood_count: number;
  indicators: Record<string, Indicator>;
  proposal: {
    use_type: string | null;
    units: number | null;
    units_stated: boolean;
    share_of_households_pct: number | null;
    gfa_m2: number | null;
  };
  source: { label: string; url: string };
}

const INDICATORS: { key: string; label: string; fmt: (v: number) => string; hint: string }[] = [
  { key: "renter_share", label: "Households that rent", fmt: (v) => `${v.toFixed(0)}%`, hint: "Share of private households that are tenants." },
  { key: "median_rent", label: "Median monthly rent", fmt: (v) => `$${v.toLocaleString()}`, hint: "Median monthly shelter costs for rented dwellings (rent plus utilities)." },
  { key: "pct_tenant_30", label: "Renters paying 30%+ of income", fmt: (v) => `${v.toFixed(0)}%`, hint: "Tenant households spending 30% or more of income on shelter: a common affordability threshold." },
  { key: "median_value", label: "Median owned-home value", fmt: (v) => `$${(v / 1000).toFixed(0)}k`, hint: "Owner-estimated value of owned dwellings (Census self-report, not sale prices)." },
  { key: "pct_owner_30", label: "Owners paying 30%+ of income", fmt: (v) => `${v.toFixed(0)}%`, hint: "Owner households spending 30% or more of income on shelter." },
  { key: "apartment_share", label: "Households in 5+ storey buildings", fmt: (v) => `${v.toFixed(0)}%`, hint: "How much of the neighbourhood already lives in apartment towers." },
];

export default function HousingContext({ appNumber }: { appNumber: string | null }) {
  const [data, setData] = useState<{ app: string; housing: Housing } | null>(null);
  const [error, setError] = useState<{ app: string; message: string } | null>(null);

  useEffect(() => {
    if (!appNumber) return;
    let cancelled = false;
    fetch(`${API_URL}/api/housing?app_number=${encodeURIComponent(appNumber)}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json()).detail ?? r.statusText)))
      .then((d) => !cancelled && setData({ app: appNumber, housing: d }))
      .catch((e) => !cancelled && setError({ app: appNumber, message: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [appNumber]);

  if (!appNumber) return <p className="p-3 text-[11px] text-ed-dim">Run an address to see housing in its neighbourhood.</p>;
  if (error?.app === appNumber) return <p className="p-3 text-[11px] text-ed-dim">{error.message}</p>;
  if (data?.app !== appNumber) return <p className="p-3 text-[11px] text-ed-dim">Loading…</p>;
  const h = data.housing;
  const p = h.proposal;

  let adds: string;
  if (p.units) {
    adds = `${p.units.toLocaleString()} homes (stated), about ${p.share_of_households_pct}% of the ${h.households.toLocaleString()} households in ${h.neighbourhood} in 2021.`;
  } else if (p.use_type && ["office", "commercial", "industrial", "institutional"].includes(p.use_type)) {
    adds = `This is a ${p.use_type} proposal${p.gfa_m2 ? ` (${p.gfa_m2.toLocaleString()} m² of floor space)` : ""}; it does not add homes.`;
  } else if (p.use_type) {
    adds = "The application text doesn't state how many homes it adds.";
  } else {
    adds = "Run this application to read how many homes it adds.";
  }

  return (
    <div className="grid gap-3 p-3 text-[12px] text-ed-text lg:grid-cols-[1fr_2fr]">
      <div className="space-y-3">
        <div className="rounded border border-[#3a3a3a] bg-[#222] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-permit">Neighbourhood</p>
          <p className="mt-1 text-[16px] font-semibold text-white">{h.neighbourhood}</p>
          <p className="text-ed-dim">
            {h.households.toLocaleString()} households · {h.renters.toLocaleString()} renting · {h.owners.toLocaleString()} owning
          </p>
        </div>
        <div className="rounded border border-[#3a3a3a] bg-[#222] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-permit">What this proposal adds</p>
          <p className="mt-1 leading-relaxed">{adds}</p>
        </div>
        <p className="text-[10px] leading-relaxed text-ed-dim">
          {h.census_year} Census figures from the{" "}
          <a href={h.source.url} target="_blank" rel="noreferrer" className="text-[#7fb6ff] underline">
            {h.source.label}
          </a>
          , compared with all {h.neighbourhood_count} Toronto neighbourhoods. Home values are owners&apos; own estimates, not sale
          prices. Ordis does not predict how a development affects rents or property values.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {INDICATORS.filter((i) => h.indicators[i.key]).map((i) => {
          const ind = h.indicators[i.key];
          return (
            <div key={i.key} className="rounded border border-[#3a3a3a] bg-[#222] p-2.5" title={i.hint}>
              <div className="flex items-baseline justify-between">
                <span className="text-ed-dim">{i.label}</span>
                <span className="text-[16px] font-semibold text-white">{i.fmt(ind.value)}</span>
              </div>
              {/* Where this neighbourhood sits among all of them; the tick marks the median neighbourhood */}
              <div className="relative mt-2 h-1.5 rounded bg-[#1b1b1b]">
                <div className="absolute top-[-3px] h-3 w-px bg-ed-dim" style={{ left: "50%" }} />
                <div
                  className="absolute top-[-3px] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-[#222] bg-permit"
                  style={{ left: `${Math.min(98, Math.max(2, ind.percentile))}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-ed-dim">
                <span>lower than most</span>
                <span>median {i.fmt(ind.median_of_neighbourhoods)}</span>
                <span>higher than most</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
