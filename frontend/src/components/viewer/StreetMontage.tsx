"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { API_URL, getStreet, type BlockProposal, type StreetView } from "@/lib/api";

const StreetOverlay = dynamic(() => import("@/components/viewer/Viewport").then((m) => m.StreetOverlay), { ssr: false });

const TURN_STEP = 20;

/** From the street: a Google Street View photo facing the site with the 3D proposal drawn on
 *  top from the same camera. An approximate photomontage, labelled as one. */
export default function StreetMontage({
  sceneKey,
  glbUrl,
  showProposal,
  block,
}: {
  sceneKey: string;
  glbUrl: string;
  showProposal: boolean;
  block: BlockProposal[] | null;
}) {
  const [view, setView] = useState(0);
  const [turn, setTurn] = useState(0);
  const key = `${sceneKey}|${view}|${turn}`;
  const [state, setState] = useState<{ key: string; data?: StreetView; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getStreet(sceneKey, view, turn)
      .then((data) => !cancelled && setState({ key, data }))
      .catch((e) => !cancelled && setState({ key, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [sceneKey, view, turn, key]);
  const current = state?.key === key ? state : null;
  const d = current?.data;

  if (!current) return <Centered>Finding a street view of the site…</Centered>;
  if (current.error) return <Centered>{current.error}</Centered>;
  if (!d || !d.available) return <Centered>{d && !d.available ? d.reason : "No street view available."}</Centered>;

  const c = d.camera;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
      <div className="relative w-full max-w-[1100px] overflow-hidden rounded-lg shadow-[0_8px_24px_rgba(35,53,44,0.12)]" style={{ aspectRatio: `${c.width} / ${c.height}` }} data-street-montage>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${API_URL}${d.image_url}`} crossOrigin="anonymous" alt="Street View photo facing the site" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0">
          <StreetOverlay glbUrl={glbUrl} camera={c} showProposal={showProposal} block={block} />
        </div>
        <span className="absolute bottom-0 right-0 bg-black/50 px-1.5 text-[9px] text-white/90">{d.copyright}</span>
      </div>

      <div className="flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-3 text-[11px]">
        <div className="flex items-center gap-1.5">
          {d.views.map((v, i) => (
            <button
              key={v.pano_id}
              onClick={() => {
                setView(i);
                setTurn(0);
              }}
              className={`rounded-md px-2.5 py-1 ${i === d.view ? "bg-white text-prop-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-muted hover:text-ink"}`}
            >
              View {i + 1} · {v.distance_m} m
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          <button onClick={() => setTurn((t) => Math.max(-80, t - TURN_STEP))} aria-label="Turn left" className="grid size-6 place-items-center rounded-md text-muted hover:bg-white hover:text-ink">
            <ChevronLeft className="size-3.5" />
          </button>
          <button onClick={() => setTurn((t) => Math.min(80, t + TURN_STEP))} aria-label="Turn right" className="grid size-6 place-items-center rounded-md text-muted hover:bg-white hover:text-ink">
            <ChevronRight className="size-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-muted">
          Approximate photomontage: Street View photo{d.date ? ` from ${d.date}` : ""}, {d.distance_m} m from the proposal; Ordis massing drawn from the same spot.
          Photo positions can be a few metres off.{d.fits ? "" : " The building is taller than this photo can show."}
        </p>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <p className="max-w-sm text-center text-[12px] leading-[1.6] text-muted">{children}</p>
    </div>
  );
}
