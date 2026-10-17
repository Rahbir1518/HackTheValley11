"use client";

import type { SunlightStudy } from "@/lib/api";

function hours(h: number) {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return min ? `${whole} h ${min} min` : `${whole} h`;
}

/** Legend + findings for the sunlight-lost heatmap. */
export default function SunlightCard({ study, loading, error }: { study: SunlightStudy | null; loading: boolean; error: string | null }) {
  return (
    <div className="pointer-events-auto w-[320px] rounded border border-ed-border bg-[#282828ee] p-2.5 text-[11px] text-ed-text shadow-lg backdrop-blur">
      <p className="mb-1 font-semibold text-white">Sunlight lost at ground level</p>
      {loading && <p className="animate-pulse text-ed-dim">Tracing shadows every 15 minutes, sunrise to sunset…</p>}
      {error && <p className="text-[#ff8b8b]">{error}</p>}
      {study && !loading && (
        <>
          <div className="my-1.5 h-2 rounded" style={{ background: "linear-gradient(90deg, #ffd63c80, #ff7a1ec0, #d7140fe0)" }} />
          <div className="flex justify-between text-[10px] text-ed-dim">
            <span>15 min</span>
            <span>2 h</span>
            <span>4 h+ of direct sun lost</span>
          </div>
          <p className="mt-2 leading-relaxed">
            On <b className="text-white">{new Date(`${study.date}T12:00:00`).toLocaleDateString("en-CA", { month: "long", day: "numeric" })}</b>, the
            proposal shades <b className="text-white">{study.stats.area_lost_1h_m2.toLocaleString()} m²</b> of ground for at least an hour that is in sun today.
          </p>
          {study.stats.max_hours_lost > 0 && (
            <p className="mt-1 leading-relaxed">
              Most affected spot: about <b className="text-white">{hours(study.stats.worst_point.sun_today_h)}</b> of direct sun today →{" "}
              <b className="text-permit">{hours(Math.max(0, study.stats.worst_point.sun_with_h))}</b> with the proposal.
            </p>
          )}
          {study.affected_parcels.length > 0 && (
            <div className="mt-2 border-t border-[#3a3a3a] pt-1.5">
              <p className="mb-1 uppercase tracking-wide text-ed-dim">Most affected neighbouring lots (average)</p>
              {study.affected_parcels.slice(0, 5).map((p, i) => (
                <div key={i} className="flex justify-between">
                  <span className="truncate">{p.address ?? `Lot ${i + 1}`}</span>
                  <span className="ml-2 shrink-0 font-mono text-permit">−{hours(p.mean_hours_lost)}</span>
                </div>
              ))}
            </div>
          )}
          {study.stats.area_gained_1h_m2 > 0 && (
            <p className="mt-1 text-[#5fd6cc]">Teal: {study.stats.area_gained_1h_m2.toLocaleString()} m² gain sun where today&apos;s buildings are removed.</p>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-ed-dim">
            Clear-sky estimate between {study.first} and {study.last}, ground level only, flat terrain, from the massing model.
            Shadows on walls and windows are not counted.
          </p>
        </>
      )}
    </div>
  );
}
