"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { Object3D } from "three";
import BottomPanel from "@/components/editor/BottomPanel";
import Hierarchy from "@/components/editor/Hierarchy";
import Inspector from "@/components/editor/Inspector";
import ShadowTools from "@/components/editor/ShadowTools";
import SiteImagery from "@/components/editor/SiteImagery";
import Toolbar from "@/components/editor/Toolbar";
import {
  API_URL,
  getCached,
  getHealth,
  startRun,
  type CachedRun,
  type Health,
  type RunResult,
  type StepEvent,
} from "@/lib/api";
import { buildTree, type SceneNode } from "@/lib/scene";
import { sunAt, torontoInstant } from "@/lib/sun";

// WebGL only runs in the browser.
const Viewport = dynamic(() => import("@/components/editor/Viewport"), { ssr: false });

function todayToronto() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
}

function findNode(nodes: SceneNode[], id: string | null): SceneNode | null {
  if (!id) return null;
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

const Handle = ({ vertical }: { vertical?: boolean }) => (
  <Separator className={`${vertical ? "h-1" : "w-1"} bg-ed-border transition-colors hover:bg-ed-select data-[separator=active]:bg-ed-select`} />
);

export default function ViewerPage() {
  const [address, setAddress] = useState("135 Liberty St");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [cached, setCached] = useState<CachedRun[]>([]);

  const [tree, setTree] = useState<SceneNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showProposal, setShowProposal] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [focusToken, setFocusToken] = useState(0);

  const [date, setDate] = useState(todayToronto);
  const [minutes, setMinutes] = useState(15 * 60);
  const [playing, setPlaying] = useState(false);
  const [shadows, setShadows] = useState(true);
  const sun = useMemo(() => sunAt(torontoInstant(date, minutes)), [date, minutes]);

  const counter = useRef(0);
  const cancel = useRef<(() => void) | null>(null);

  useEffect(() => {
    getHealth().then(setHealth);
    getCached().then(setCached);
  }, []);

  // T toggles the proposal, F frames it (ignored while typing).
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

  const run = useCallback(
    (appNumber?: string, opts: { address?: string; includeClosed?: boolean; fresh?: boolean } = {}) => {
      const addr = opts.address ?? address;
      const closed = opts.includeClosed ?? includeClosed;
      if (!addr.trim()) return;
      cancel.current?.();
      setRunning(true);
      setSelectedId(null);
      const push = (e: Omit<StepEvent, "id" | "time">) =>
        setEvents((prev) => [
          ...prev,
          { ...e, id: ++counter.current, time: new Date().toLocaleTimeString("en-CA", { hour12: false }) },
        ]);
      push({
        agent: "system",
        kind: "start",
        message: `Run for "${addr}"${appNumber ? ` (${appNumber})` : ""}${opts.fresh ? " (fresh, ignoring saved result)" : ""}`,
        data: null,
      });
      cancel.current = startRun(
        { address: addr, appNumber, includeClosed: closed, fresh: opts.fresh },
        push,
        (r) => {
          setResult(r);
          setRunning(false);
          if (r.ok) {
            setHidden(new Set());
            setShowProposal(true);
            getCached().then(setCached);
          }
        },
        (msg) => {
          push({ agent: "system", kind: "error", message: msg, data: null });
          setRunning(false);
        },
      );
    },
    [address, includeClosed],
  );

  const onLoaded = useCallback((root: Object3D) => {
    setTree(buildTree(root));
    setFocusToken((v) => v + 1);
  }, []);

  const glbUrl = result?.ok && result.glb_url ? `${API_URL}${result.glb_url}` : null;
  const selected = findNode(tree, selectedId);
  const app = result?.application as (RunResult["application"] & { lat?: number; lon?: number }) | undefined;
  const site = app?.lat && app?.lon ? { lat: app.lat, lon: app.lon } : result?.geocode;

  return (
    <div className="editor flex h-screen flex-col overflow-hidden bg-ed-bg text-ed-text">
      <Toolbar
        address={address}
        onAddress={setAddress}
        onRun={() => run()}
        onRunFresh={() => run(undefined, { fresh: true })}
        cached={cached}
        onPickCached={(c) => {
          setAddress(c.address);
          setIncludeClosed(c.include_closed);
          run(c.app_number ?? undefined, { address: c.address, includeClosed: c.include_closed });
        }}
        running={running}
        includeClosed={includeClosed}
        onIncludeClosed={setIncludeClosed}
        showProposal={showProposal}
        onShowProposal={setShowProposal}
        showGrid={showGrid}
        onShowGrid={setShowGrid}
        onFocus={() => setFocusToken((v) => v + 1)}
        health={health}
        hasScene={!!glbUrl}
      />
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize="17" minSize="10">
          <Hierarchy
            tree={glbUrl ? tree : []}
            title={app ? app.app_number : "Scene"}
            selectedId={selectedId}
            onSelect={setSelectedId}
            hidden={hidden}
            onToggleHidden={(id) =>
              setHidden((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
        </Panel>
        <Handle />
        <Panel defaultSize="61" minSize="30">
          <Group orientation="vertical">
            <Panel defaultSize="66" minSize="25">
              <div className="flex h-full flex-col">
                <div className="flex h-7 shrink-0 items-center gap-2 border-b border-ed-border bg-ed-header px-2 text-[11px]">
                  <span className="rounded-t border-x border-t border-ed-border bg-ed-panel px-2 py-0.5 font-medium">Scene</span>
                  {glbUrl && (
                    <span className={`rounded px-1.5 text-[10px] font-semibold ${showProposal ? "bg-permit text-black" : "bg-[#4a4a4a]"}`}>
                      {showProposal ? "AFTER: with proposal" : "BEFORE: today"}
                    </span>
                  )}
                  <span className="ml-auto text-ed-dim">Massing approximation, not an architectural rendering</span>
                </div>
                <div className="relative min-h-0 flex-1">
                  <Viewport
                    glbUrl={glbUrl}
                    showProposal={showProposal}
                    hidden={hidden}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onLoaded={onLoaded}
                    sun={sun}
                    shadows={shadows}
                    showGrid={showGrid}
                    focusToken={focusToken}
                  />
                  <div className="pointer-events-none absolute left-3 top-3">
                    <ShadowTools
                      date={date}
                      minutes={minutes}
                      onDate={setDate}
                      onMinutes={setMinutes}
                      playing={playing}
                      onPlaying={setPlaying}
                      sun={sun}
                      shadows={shadows}
                      onShadows={setShadows}
                    />
                  </div>
                  {site && (
                    <SiteImagery key={`${site.lat},${site.lon}`} lat={site.lat} lon={site.lon} label={app?.address ?? result?.geocode?.address_full ?? ""} />
                  )}
                  {!glbUrl && (
                    <div className="pointer-events-none absolute inset-0 grid place-items-center">
                      <div className="max-w-md rounded border border-ed-border bg-[#202020e6] p-5 text-center text-[12px]">
                        {running ? (
                          <p className="animate-pulse text-ed-text">Agents are working. Watch the Console below.</p>
                        ) : result && !result.ok ? (
                          <>
                            <p className="mb-1 font-semibold text-permit">No model built</p>
                            <p className="text-ed-text">{result.message}</p>
                          </>
                        ) : (
                          <>
                            <p className="mb-1 text-[14px] font-semibold text-white">What&apos;s being built near you?</p>
                            <p className="text-ed-dim">
                              Enter a Toronto address and press Run. Ordis finds nearby development applications, reads
                              them with AI and builds a 3D massing model among the real buildings around it.
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Panel>
            <Handle vertical />
            <Panel defaultSize="34" minSize="12">
              <BottomPanel
                events={events}
                result={result}
                running={running}
                onClear={() => setEvents([])}
                onModel={(n) => run(n)}
                includeClosed={includeClosed}
              />
            </Panel>
          </Group>
        </Panel>
        <Handle />
        <Panel defaultSize="22" minSize="14">
          <Inspector node={selected} result={result} />
        </Panel>
      </Group>
    </div>
  );
}
