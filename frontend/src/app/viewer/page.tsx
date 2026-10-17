"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Box, FileDown, Image as ImageIcon, Maximize, MousePointer2, Move, Rotate3d } from "lucide-react";
import * as THREE from "three";
import AppNav from "@/components/AppNav";
import { Ordi, StatusChip } from "@/components/brand";
import {
  AgentProgress,
  BlockPanel,
  ProposalPanel,
  SceneCollection,
  type Section,
  SelectedObject,
  SiteImageryWindow,
  siteLocation,
  StatusBar,
  SunlightPanel,
  SunTimeline,
  storeysLabel,
} from "@/components/viewer/panels";
import type { CameraSync, Layers, Tool } from "@/components/viewer/Viewport";
import { API_URL, getBlock, getBriefing, getSunlight, startRun, type Block, type RunResult, type Spec, type StepEvent, type SunlightStudy } from "@/lib/api";
import { rememberPlace } from "@/lib/places";
import { BLOCK_COLORS, buildTree, findNode, type SceneNode } from "@/lib/scene";
import { minutesOfDayToronto, sunAt, sunTimes, torontoInstant } from "@/lib/sun";

const Viewport = dynamic(() => import("@/components/viewer/Viewport"), { ssr: false });

/** Height of the top of each storey of the tallest part, from the spec (podium floors first). */
function storeyTops(spec: Spec): number[] {
  const podium = spec.towers.length ? spec.podium_storeys : 0;
  const tops: number[] = [];
  let h = 0;
  for (let k = 1; k <= spec.total_storeys; k++) {
    h += k <= podium ? spec.podium_storey_height_m : spec.storey_height_m;
    tops.push(h);
  }
  return tops;
}

function todayToronto() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
}

export default function ViewerPage() {
  return (
    <Suspense fallback={null}>
      <Viewer />
    </Suspense>
  );
}

function Viewer() {
  const params = useSearchParams();
  const router = useRouter();
  const address = params.get("address") ?? "";
  const appNumber = params.get("app") ?? undefined;

  // ---------------------------------------------------------------- run
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);
  const runKey = `${address}|${appNumber ?? ""}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    const cancel = startRun(
      { address, appNumber, includeClosed: false },
      (e) => setEvents((prev) => [...prev, { ...e, id: ++counter.current, time: "" }]),
      (r) => {
        setResult(r);
        setLoadedKey(runKey);
        if (r.ok && r.application) rememberPlace({ address: r.geocode?.address_full ?? address, app: r.application.app_number, label: r.narration?.headline ?? "Proposal" });
      },
      (msg) => setError(msg),
    );
    return cancel;
  }, [address, appNumber, runKey]);

  const current = loadedKey === runKey ? result : null;
  const ok = !!current?.ok && !!current.glb_url;
  const glbUrl = ok ? `${API_URL}${current!.glb_url}` : null;

  // ---------------------------------------------------------------- scene state
  const [tree, setTree] = useState<SceneNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"explore" | "sunlight">("explore");
  const [showProposal, setShowProposal] = useState(true);
  const [rise, setRise] = useState(1); // construction animation: plays on load, replays on Existing -> With
  const [split, setSplit] = useState(true);
  const [tool, setTool] = useState<Tool>("select");
  const [layers, setLayers] = useState<Layers>({ context: true, trees: true, lots: true, grid: true });
  const [layersOpen, setLayersOpen] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [section, setSection] = useState<Section>("overview");
  const [sceneCollapsed, setSceneCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imageryOpen, setImageryOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(324);
  const panelDrag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("ordis.panelWidth"));
      if (saved >= 280 && saved <= 640) setPanelWidth(saved); // eslint-disable-line react-hooks/set-state-in-effect -- browser-only storage
    } catch {
      // storage unavailable; keep the default width
    }
  }, []);
  const viewportBox = useRef<HTMLDivElement>(null);
  const sync = useRef<CameraSync>({ pos: new THREE.Vector3(), target: new THREE.Vector3(), version: 0, owner: "a" });

  const onLoaded = useCallback((root: THREE.Object3D) => {
    setTree(buildTree(root));
    setFocusToken((v) => v + 1);
  }, []);

  // ---------------------------------------------------------------- sun
  const [date, setDate] = useState(todayToronto);
  const [minutes, setMinutes] = useState(16 * 60);
  const [playing, setPlaying] = useState(false);
  const sun = useMemo(() => sunAt(torontoInstant(date, minutes)), [date, minutes]);
  useEffect(() => {
    if (!playing) return;
    const { sunrise, sunset } = sunTimes(date);
    const rise = minutesOfDayToronto(sunrise);
    const set = minutesOfDayToronto(sunset);
    const id = setInterval(() => setMinutes((m) => (m + 4 > set || m < rise ? rise : m + 4)), 50);
    return () => clearInterval(id);
  }, [playing, date]);

  // ---------------------------------------------------------------- your block in 5 years
  const sceneKey = ok ? current!.scene_key ?? null : null;
  const [blockOn, setBlockOn] = useState(false);
  const [blockState, setBlockState] = useState<{ key: string; data?: Block; error?: string } | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const blockReq = blockOn ? sceneKey : null;
  useEffect(() => {
    if (!blockReq) return;
    let cancelled = false;
    getBlock(blockReq)
      .then((data) => {
        if (cancelled) return;
        setBlockState({ key: blockReq, data });
        setFocusToken((v) => v + 1); // frame the whole cluster
      })
      .catch((e) => !cancelled && setBlockState({ key: blockReq, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [blockReq]);
  const blockCurrent = blockState && blockState.key === sceneKey ? blockState : null;
  const blockData = blockOn ? blockCurrent?.data ?? null : null;
  const blockProposals = blockData?.proposals ?? null;
  const showBlock = (on: boolean) => {
    setBlockOn(on);
    if (on) setShowProposal(true);
    setSelectedBlock(null);
    setFocusToken((v) => v + 1);
  };

  const [heatOn, setHeatOn] = useState(false);
  const [heat, setHeat] = useState<{ key: string; study?: SunlightStudy; error?: string } | null>(null);
  const heatKey = heatOn && sceneKey && (!blockOn || blockData) ? `${sceneKey}|${date}|${blockData?.key ?? ""}` : null;
  useEffect(() => {
    if (!heatKey || !sceneKey) return;
    let cancelled = false;
    getSunlight(sceneKey, date, heatKey.split("|")[2] !== "")
      .then((study) => !cancelled && setHeat({ key: heatKey, study }))
      .catch((e) => !cancelled && setHeat({ key: heatKey, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [heatKey, sceneKey, date]);
  const heatCurrent = heat && heat.key === heatKey ? heat : null;

  // ---------------------------------------------------------------- briefing PDF
  const [briefing, setBriefing] = useState<"idle" | "busy" | "error">("idle");
  const downloadBriefing = async () => {
    if (!sceneKey || briefing === "busy") return;
    setBriefing("busy");
    try {
      // The view on screen; in a split comparison, the "with proposal" side.
      const canvases = viewportBox.current?.querySelectorAll("canvas");
      let snapshot: string | null = null;
      try {
        snapshot = canvases?.length ? canvases[canvases.length - 1].toDataURL("image/jpeg", 0.9) : null;
      } catch {
        snapshot = null; // the PDF says when no snapshot was included
      }
      const pdf = await getBriefing({ sceneKey, date, block: !!blockData, snapshot });
      const url = URL.createObjectURL(pdf);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ordis-briefing-${(current?.application?.address ?? address).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setBriefing("idle");
    } catch {
      setBriefing("error");
      setTimeout(() => setBriefing("idle"), 3000);
    }
  };
  const heatmap = heatCurrent?.study ? { url: `${API_URL}${heatCurrent.study.png_url}`, extent: heatCurrent.study.extent_m } : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === "t" || e.key === "T") setShowProposal((v) => !v);
      if (e.key === "f" || e.key === "F") setFocusToken((v) => v + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const spec = current?.spec;
  const app = current?.application;
  const selected = findNode(tree, selectedId);
  const annotation = spec ? storeysLabel(spec) : null;
  const tops = useMemo(() => (spec ? storeyTops(spec) : undefined), [spec]);
  const sunlight = mode === "sunlight";
  const splitView = sunlight && split;

  const common = {
    glbUrl: glbUrl!,
    hidden,
    selectedId,
    sun,
    shadows: true,
    layers,
    tool,
    focusToken,
    selectedBlock,
    onSelectBlock: setSelectedBlock,
  };

  const segmented = (options: [string, string][], value: string, onChange: (v: string) => void) => (
    <div className="flex rounded-md bg-soft p-[3px]">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded px-[13px] py-[5px] text-[11px] ${value === v ? "bg-white text-prop-ink shadow-[0_1px_2px_rgba(0,0,0,0.04)]" : "text-muted hover:text-ink"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  // ---------------------------------------------------------------- render
  if (!address) {
    return (
      <div className="flex h-screen flex-col">
        <AppNav active="viewer" />
        <div className="grid flex-1 place-items-center bg-side">
          <div className="max-w-sm text-center">
            <div className="mb-4 flex justify-center">
              <Ordi size={56} track />
            </div>
            <p className="text-[22px] text-black">Pick a proposal first.</p>
            <p className="mt-2 text-[13px] leading-[1.6] text-muted">Ask Ordis about a Toronto address, then choose &quot;View in 3D&quot; on a proposal.</p>
            <Link href="/ask" className="mt-5 inline-block rounded-full bg-ink px-5 py-2.5 text-[13px] text-white">
              Go to Ask Ordis →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      <AppNav active="viewer" viewerHref={`/viewer?${params.toString()}`} />

      {/* Project workspace bar */}
      <div className="relative flex h-12 shrink-0 items-center justify-between border-b border-line bg-side px-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/ask")} aria-label="Back to Ask Ordis">
            <ArrowLeft className="size-[15px]" strokeWidth={1.6} />
          </button>
          <span className="text-[13px] font-semibold text-black">{current?.geocode?.address_full ?? address}</span>
          {app && <StatusChip>{app.status}</StatusChip>}
        </div>
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
          {(["explore", "sunlight"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={!ok}
              className={`h-8 rounded-md px-[18px] text-[12px] disabled:opacity-50 ${mode === m ? "border border-line bg-white text-ink" : "text-muted hover:text-ink"}`}
            >
              {m === "explore" ? "Explore" : "Sunlight study"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-5">
          {ok && (
            <button
              onClick={downloadBriefing}
              disabled={briefing === "busy"}
              title="One-page PDF to bring to a community meeting: this view, the summary, stated vs estimated, sunlight, meetings and the planner"
              className={`flex items-center gap-1.5 text-[12px] ${briefing === "error" ? "text-[#a0331c]" : "text-muted hover:text-ink"}`}
            >
              <FileDown className="size-3.5" strokeWidth={1.5} />
              {briefing === "busy" ? "Preparing…" : briefing === "error" ? "Couldn't make the PDF" : "Briefing PDF"}
            </button>
          )}
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="text-[12px] text-muted hover:text-ink"
          >
            {copied ? "Link copied" : "Share ↗"}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Model viewport */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex h-[42px] shrink-0 items-center justify-between border-b border-line bg-white px-4">
            <button onClick={() => setFocusToken((v) => v + 1)} className="flex items-center gap-[7px] text-[11px] text-black" title="Frame the proposal (F)">
              <Box className="size-3.5" strokeWidth={1.5} />
              Perspective
            </button>
            <div className="absolute left-1/2 -translate-x-1/2">
              {sunlight
                ? segmented([["single", "Single view"], ["split", "Split comparison"]], split ? "split" : "single", (v) => setSplit(v === "split"))
                : segmented(
                    [
                      ["existing", "Existing"],
                      ["with", "With proposal"],
                      ["block", "Block in 5 years"],
                    ],
                    blockOn ? "block" : showProposal ? "with" : "existing",
                    (v) => {
                      if (v === "block") showBlock(true);
                      else {
                        if (blockOn) showBlock(false);
                        if (v === "with" && !showProposal) setRise((r) => r + 1);
                        setShowProposal(v === "with");
                      }
                    },
                  )}
            </div>
            <div className="relative flex items-center gap-4">
              {ok && (
                <button onClick={() => setImageryOpen(!imageryOpen)} className={`flex items-center gap-1.5 text-[11px] ${imageryOpen ? "text-prop-ink" : "text-muted hover:text-ink"}`}>
                  <ImageIcon className="size-3.5" strokeWidth={1.5} />
                  Site imagery
                </button>
              )}
              <button onClick={() => setLayersOpen(!layersOpen)} className="text-[11px] text-muted hover:text-ink">
                Layers⌄
              </button>
              {layersOpen && (
                <div className="absolute right-6 top-7 z-30 w-48 space-y-2 rounded-md border border-line bg-white p-3 text-[11px] shadow-[0_8px_24px_rgba(35,53,44,0.08)]">
                  {(
                    [
                      ["context", "City buildings"],
                      ["trees", "Street trees"],
                      ["lots", "Neighbouring lots"],
                      ["grid", "Ground grid"],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2 text-black">
                      <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} className="accent-prop-ink" />
                      {label}
                    </label>
                  ))}
                </div>
              )}
              <button onClick={() => viewportBox.current?.requestFullscreen()} aria-label="Full screen">
                <Maximize className="size-3.5 text-muted" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          <div ref={viewportBox} className="relative min-h-0 flex-1 bg-canvas">
            {glbUrl && !splitView && (
              <Viewport
                {...common}
                id="main"
                showProposal={sunlight ? true : showProposal}
                onSelect={setSelectedId}
                onLoaded={onLoaded}
                heatmap={sunlight ? heatmap : null}
                annotation={sunlight ? null : annotation}
                block={blockProposals}
                rise={rise}
                storeyTops={tops}
              />
            )}
            {glbUrl && splitView && (
              <div className="flex size-full">
                <div className="relative flex-1 border-r-2 border-white">
                  <Viewport {...common} id="a" showProposal={false} onLoaded={onLoaded} sync={sync} block={blockProposals} />
                  <span className="absolute left-[76px] top-5 flex items-center gap-2 rounded-md bg-white px-3 py-1.5 text-[11px] text-muted">
                    <span className="size-2 bg-context" /> Without proposal
                  </span>
                </div>
                <div className="relative flex-1">
                  <Viewport {...common} id="b" showProposal heatmap={heatmap} sync={sync} block={blockProposals} />
                  <span className="absolute left-5 top-5 flex items-center gap-2 rounded-md bg-white px-3 py-1.5 text-[11px] text-prop-ink">
                    <span className="size-2 bg-prop-ink" /> {blockProposals ? "With all nearby proposals" : "With proposal"}
                  </span>
                </div>
              </div>
            )}

            {ok && (
              <>
                {/* Tool palette */}
                <div className="absolute left-4 top-[18px] flex w-10 flex-col gap-1.5 rounded-md border border-line bg-white/95 p-1">
                  {(
                    [
                      ["select", MousePointer2, "Select (click a building)"],
                      ["pan", Move, "Pan (drag)"],
                      ["orbit", Rotate3d, "Orbit (drag)"],
                    ] as const
                  ).map(([t, Icon, title]) => (
                    <button key={t} title={title} onClick={() => setTool(t)} className={`grid h-[34px] place-items-center rounded ${tool === t ? "bg-select" : "hover:bg-side"}`}>
                      <Icon className="size-[17px]" strokeWidth={1.5} color={tool === t ? "#566f87" : "#202322"} />
                    </button>
                  ))}
                </div>
                {!splitView && (
                  <div className="pointer-events-none absolute left-[76px] top-[22px] space-y-1.5">
                    <p className="mono text-[10px] text-muted">{sunlight ? "SUNLIGHT STUDY" : blockOn ? "YOUR BLOCK IN 5 YEARS · IF ALL ARE BUILT" : showProposal ? "WITH PROPOSAL" : "EXISTING CITY CONTEXT"}</p>
                    <p className="text-[11px] text-prop-ink">
                      {current?.geocode?.address_full ?? address} / {selected ? selected.name : "Nothing selected"}
                    </p>
                  </div>
                )}
                <div className="absolute bottom-5 left-5 flex gap-[22px] rounded-md bg-white/90 px-3.5 py-2.5 text-[10px] text-muted">
                  <span className="flex items-center gap-[7px]">
                    <span className="size-[9px] bg-prop" /> Proposal
                  </span>
                  {blockProposals && (
                    <span className="flex items-center gap-[7px]">
                      <span className="flex">
                        {BLOCK_COLORS.slice(0, Math.min(3, blockProposals.length)).map((c) => (
                          <span key={c} className="size-[9px]" style={{ background: c }} />
                        ))}
                      </span>
                      Other proposals
                    </span>
                  )}
                  <span className="flex items-center gap-[7px]">
                    <span className="size-[9px] bg-context" /> City context
                  </span>
                  <span>┄ Property boundary</span>
                  {heatmap && sunlight && (
                    <span className="flex items-center gap-[7px]">
                      <span className="h-[9px] w-5" style={{ background: "linear-gradient(90deg,#ffd63c,#d7140f)" }} /> Sun lost
                    </span>
                  )}
                </div>
              </>
            )}

            {ok && imageryOpen && current && siteLocation(current) && (
              <SiteImageryWindow
                {...siteLocation(current)!}
                label={current.geocode?.address_full ?? address}
                onClose={() => setImageryOpen(false)}
              />
            )}

            {!ok && (
              <div className="absolute inset-0 grid place-items-center overflow-auto py-6">
                <AgentProgress
                  events={events}
                  failed={error ?? (current && !current.ok ? current.message ?? "No model was built." : null)}
                >
                  {current && !current.ok && (
                    <div className="mt-5 space-y-2 border-t border-line pt-4">
                      {(() => {
                        const shown = current.application?.app_number ?? appNumber;
                        const others = (current.candidates ?? []).filter((c) => c.modelled && c.app_number !== shown).slice(0, 3);
                        return others.length ? (
                          <>
                            <p className="mono text-[9px] text-muted">TRY ANOTHER PROPOSAL NEARBY</p>
                            {others.map((c) => (
                              <Link
                                key={c.app_number}
                                href={`/viewer?address=${encodeURIComponent(address)}&app=${encodeURIComponent(c.app_number)}`}
                                className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[12px] hover:bg-side"
                              >
                                <span className="text-black">{c.address}</span>
                                <span className="text-[10px] text-muted">
                                  {Math.round(c.distance_m)} m · View in 3D →
                                </span>
                              </Link>
                            ))}
                          </>
                        ) : null;
                      })()}
                      <Link href="/ask" className="inline-block pt-1 text-[12px] text-prop-ink">
                        ← Back to Ask Ordis
                      </Link>
                    </div>
                  )}
                </AgentProgress>
              </div>
            )}
          </div>

          {sunlight && ok && (
            <SunTimeline
              date={date}
              minutes={minutes}
              onMinutes={setMinutes}
              playing={playing}
              onPlaying={setPlaying}
              onReset={() => {
                setMinutes(16 * 60);
                setDate(todayToronto());
                setPlaying(false);
              }}
              sun={sun}
            />
          )}
        </div>

        {/* Drag to resize the side panel */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          title="Drag to resize"
          className="w-1.5 shrink-0 cursor-col-resize border-l border-line bg-white transition-colors hover:bg-select active:bg-prop"
          onPointerDown={(e) => {
            panelDrag.current = { x: e.clientX, width: panelWidth };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!panelDrag.current) return;
            setPanelWidth(Math.min(640, Math.max(280, panelDrag.current.width - (e.clientX - panelDrag.current.x))));
          }}
          onPointerUp={() => {
            panelDrag.current = null;
            try {
              localStorage.setItem("ordis.panelWidth", String(panelWidth));
            } catch {
              // storage unavailable; the width just won't be remembered
            }
          }}
        />

        {/* Outline and properties */}
        <aside className="thin-scroll shrink-0 overflow-y-auto bg-white" style={{ width: panelWidth }}>
          {sunlight && current?.ok ? (
            <SunlightPanel
              address={current.geocode?.address_full ?? address}
              date={date}
              onDate={setDate}
              minutes={minutes}
              onMinutes={setMinutes}
              split={split}
              onSplit={setSplit}
              heatOn={heatOn}
              onHeat={setHeatOn}
              study={heatCurrent?.study ?? null}
              studyLoading={heatOn && !heatCurrent}
              studyError={heatCurrent?.error ?? null}
              onBack={() => setMode("explore")}
              blockOn={blockOn}
              onBlock={showBlock}
              blockCount={blockData ? blockData.proposals.length + 1 : null}
              sceneOpen={
                <button onClick={() => setMode("explore")} className="flex w-full items-center justify-between border-b border-line pb-4 text-[11px] text-muted">
                  ›  Scene collection
                </button>
              }
            />
          ) : (
            <>
              {ok && (
                <SceneCollection
                  tree={tree}
                  title={current?.geocode?.address_full ?? address}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  hidden={hidden}
                  onToggle={(id) =>
                    setHidden((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  collapsed={sceneCollapsed}
                  onCollapsed={setSceneCollapsed}
                />
              )}
              <div className="space-y-4 p-5">
                <SelectedObject node={selected} />
                {current?.ok && blockOn ? (
                  <BlockPanel
                    result={current}
                    block={blockData}
                    loading={!blockCurrent}
                    error={blockCurrent?.error ?? null}
                    selected={selectedBlock}
                    onSelect={setSelectedBlock}
                    onSunlight={() => {
                      setMode("sunlight");
                      setHeatOn(true);
                    }}
                    onBack={() => showBlock(false)}
                  />
                ) : current?.ok ? (
                  <ProposalPanel result={current} section={section} onSection={setSection} onOpenImagery={() => setImageryOpen(true)} />
                ) : current?.application ? (
                  // Not modelled, but the application itself is still worth reading.
                  <div className="space-y-3">
                    <StatusChip>{current.application.status}</StatusChip>
                    <p className="text-[18px] leading-tight text-black">{current.application.address}</p>
                    <p className="text-[11px] text-muted">
                      {current.application.type_name} · submitted {(current.application.date_submitted ?? "").slice(0, 10)}
                    </p>
                    <p className="mono text-[10px] text-black">{current.application.app_number}</p>
                    {current.application.description && (
                      <p className="text-[12px] leading-[1.6] text-muted">{current.application.description}</p>
                    )}
                    {current.application.application_url && (
                      <a href={current.application.application_url} target="_blank" rel="noreferrer" className="block text-[11px] text-prop-ink hover:underline">
                        Application Information Centre ↗
                      </a>
                    )}
                    <p className="rounded-md bg-side p-3 text-[11px] leading-[1.6] text-muted">{current.message}</p>
                  </div>
                ) : (
                  <p className="text-[12px] leading-[1.6] text-muted">
                    {current && !current.ok ? current.message : "The proposal's details appear here once the model is ready."}
                  </p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
      <StatusBar />
    </div>
  );
}
