"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import type { Health } from "@/lib/api";
import { clerkEnabled } from "@/lib/auth-config";
import { ToolButton } from "./ui";

interface Props {
  address: string;
  onAddress: (a: string) => void;
  onRun: () => void;
  running: boolean;
  includeClosed: boolean;
  onIncludeClosed: (v: boolean) => void;
  showProposal: boolean;
  onShowProposal: (v: boolean) => void;
  showGrid: boolean;
  onShowGrid: (v: boolean) => void;
  onFocus: () => void;
  health: Health | null;
  hasScene: boolean;
}

export default function Toolbar(p: Props) {
  const llm = p.health?.llm;
  const ok = !!p.health && llm?.configured && p.health.database && p.health.blender;
  const statusText = !p.health
    ? "API offline"
    : `${llm?.provider ?? "?"} · ${llm?.model ?? "?"}${llm?.configured ? "" : " (no key)"}${p.health.blender ? "" : " · no Blender"}`;
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-ed-border bg-ed-header px-2 text-[11px] text-ed-text">
      <Link href="/" className="flex items-center gap-1.5 pr-2 font-semibold tracking-wide text-white">
        <span className="grid h-5 w-5 place-items-center rounded-sm bg-permit text-[11px] font-black text-black">O</span>
        ORDIS
      </Link>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          p.onRun();
        }}
      >
        <input
          value={p.address}
          onChange={(e) => p.onAddress(e.target.value)}
          placeholder="Toronto address, e.g. 135 Liberty St"
          className="h-6 w-72 rounded border border-ed-border bg-[#1e1e1e] px-2 text-ed-text outline-none focus:border-ed-select"
        />
        <button
          type="submit"
          disabled={p.running || !p.address.trim()}
          className="flex h-6 items-center gap-1 rounded border border-[#1d4466] bg-ed-select px-3 font-semibold text-white disabled:opacity-50"
          title="Run the agents"
        >
          {p.running ? "■ Running" : "▶ Run"}
        </button>
      </form>
      <label className="flex items-center gap-1 text-ed-dim" title="Include closed, refused and withdrawn applications">
        <input type="checkbox" checked={p.includeClosed} onChange={(e) => p.onIncludeClosed(e.target.checked)} className="accent-ed-select" />
        closed apps
      </label>

      <div className="mx-2 h-5 w-px bg-ed-border" />
      <div className="flex overflow-hidden rounded border border-ed-border" title="Toggle the proposal (T)">
        <button
          onClick={() => p.onShowProposal(false)}
          disabled={!p.hasScene}
          className={`h-6 px-2 ${!p.showProposal ? "bg-ed-select text-white" : "bg-[#4a4a4a] hover:bg-[#565656]"}`}
        >
          Without proposal
        </button>
        <button
          onClick={() => p.onShowProposal(true)}
          disabled={!p.hasScene}
          className={`h-6 px-2 ${p.showProposal ? "bg-permit text-black" : "bg-[#4a4a4a] hover:bg-[#565656]"}`}
        >
          With proposal
        </button>
      </div>
      <ToolButton active={p.showGrid} onClick={() => p.onShowGrid(!p.showGrid)} title="Grid">
        # Grid
      </ToolButton>
      <ToolButton onClick={p.onFocus} disabled={!p.hasScene} title="Frame the proposal (F)">
        ⌖ Focus
      </ToolButton>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-ed-dim xl:inline">Orbit: drag · Pan: right-drag · Fly: WASD/QE (+Shift)</span>
        <span className="flex items-center gap-1.5" title="LLM provider / backend status">
          <span className={`h-2 w-2 rounded-full ${ok ? "bg-[#4caf6a]" : p.health ? "bg-permit" : "bg-[#d24b4b]"}`} />
          {statusText}
        </span>
        {clerkEnabled && <UserButton />}
      </div>
    </div>
  );
}
