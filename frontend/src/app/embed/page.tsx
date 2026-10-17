"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { storeysLabel } from "@/components/viewer/panels";
import type { Layers } from "@/components/viewer/Viewport";
import { API_URL, type Spec } from "@/lib/api";
import { storeyTops } from "@/lib/scene";
import { sunAt, torontoInstant } from "@/lib/sun";

const Viewport = dynamic(() => import("@/components/viewer/Viewport"), { ssr: false });

/** Phone-sized 3D model for the mobile app (shown in its WebView): the model, touch controls and
 *  an Existing / With proposal toggle, nothing else. Public City data only, so no sign-in. */
export default function EmbedPage() {
  return (
    <Suspense fallback={null}>
      <Embed />
    </Suspense>
  );
}

interface ProposalData {
  application: { address: string; app_number: string };
  scene_key: string | null;
  spec: Spec | null;
}

const LAYERS: Layers = { context: true, trees: true, lots: true, grid: false };
const NO_HIDDEN = new Set<string>();

function Embed() {
  const app = useSearchParams().get("app") ?? "";
  const [data, setData] = useState<{ app: string; proposal?: ProposalData; error?: string } | null>(null);
  const [showProposal, setShowProposal] = useState(true);
  const [rise, setRise] = useState(1);
  const [focusToken, setFocusToken] = useState(0);

  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    fetch(`${API_URL}/api/proposal?app_number=${encodeURIComponent(app)}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json().catch(() => ({}))).detail ?? r.statusText)))
      .then((proposal) => !cancelled && setData({ app, proposal }))
      .catch((e) => !cancelled && setData({ app, error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [app]);

  const current = data?.app === app ? data : null;
  const p = current?.proposal;
  const spec = p?.spec ?? null;
  const tops = useMemo(() => (spec ? storeyTops(spec) : undefined), [spec]);
  // A clear early-afternoon sun today, so the massing reads well on a small screen.
  const sun = useMemo(() => sunAt(torontoInstant(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date()), 13 * 60)), []);
  const onLoaded = useCallback(() => setFocusToken((v) => v + 1), []);

  if (!app) return <Message>No application was given.</Message>;
  if (!current) return <Message>Loading the 3D model…</Message>;
  if (current.error) return <Message>{current.error}</Message>;
  if (!p?.scene_key) return <Message>Ordis hasn&apos;t built a 3D model for this application yet.</Message>;

  return (
    <div className="fixed inset-0 overflow-hidden bg-canvas" style={{ touchAction: "none" }}>
      <Viewport
        id="main"
        glbUrl={`${API_URL}/files/scenes/${p.scene_key}/scene.glb`}
        showProposal={showProposal}
        hidden={NO_HIDDEN}
        selectedId={null}
        onLoaded={onLoaded}
        sun={sun}
        shadows
        layers={LAYERS}
        tool="orbit"
        focusToken={focusToken}
        annotation={spec ? storeysLabel(spec) : null}
        rise={rise}
        storeyTops={tops}
        gizmo={false}
      />
      <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-[11px] text-muted">Drag to orbit · pinch to zoom · two fingers to pan</p>
      <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-white/90 to-white/0 px-4 pb-5 pt-8">
        <div className="mx-auto flex max-w-sm rounded-xl bg-soft p-1">
          {(
            [
              [false, "Existing"],
              [true, "With proposal"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              onClick={() => {
                if (value && !showProposal) setRise((r) => r + 1);
                setShowProposal(value);
              }}
              className={`h-11 flex-1 rounded-lg text-[14px] ${showProposal === value ? "bg-white text-prop-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-center text-[10px] text-muted">Massing approximation among the City&apos;s 3D buildings, not an architectural rendering.</p>
      </div>
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 grid place-items-center bg-canvas p-8">
      <p className="text-center text-[14px] leading-[1.6] text-muted">{children}</p>
    </div>
  );
}
