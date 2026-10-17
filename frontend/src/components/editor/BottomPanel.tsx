"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Application, RunResult, StepEvent } from "@/lib/api";
import GetInvolved from "./GetInvolved";
import { Badge, ToolButton } from "./ui";

const AGENT_STYLE: Record<string, string> = {
  data: "text-[#5ec8e5]",
  interpreter: "text-[#c79cff]",
  builder: "text-[#ffc66d]",
  blender: "text-[#6fa8ff]",
  narrator: "text-[#7fd88f]",
  system: "text-ed-dim",
};
const KIND_ICON: Record<string, string> = {
  start: "▶",
  tool: "⚙",
  tool_call: "ƒ",
  llm: "✦",
  retry: "↻",
  result: "✓",
  cache: "⚡",
  warn: "⚠",
  error: "✖",
  stop: "■",
  step: "·",
  done: "★",
};

type Tab = "console" | "summary" | "involved" | "applications" | "ward";

interface Props {
  events: StepEvent[];
  result: RunResult | null;
  running: boolean;
  onClear: () => void;
  onModel: (appNumber: string) => void;
  includeClosed: boolean;
}

export default function BottomPanel({ events, result, running, onClear, onModel, includeClosed }: Props) {
  const [tab, setTab] = useState<Tab>("console");
  // Jump to the summary when a new result arrives (adjusting state during render, not in an effect).
  const [seenResult, setSeenResult] = useState(result);
  if (result !== seenResult) {
    setSeenResult(result);
    if (result?.ok) setTab("summary");
    else if (result?.candidates?.length) setTab("applications");
  }

  const tabs: [Tab, string][] = [
    ["console", `Console${events.length ? ` (${events.length})` : ""}`],
    ["summary", "Summary"],
    ["involved", "Get involved"],
    ["applications", `Applications${result?.candidates ? ` (${result.candidates.length})` : ""}`],
    ["ward", "Ward"],
  ];
  return (
    <div className="editor flex h-full flex-col bg-ed-panel">
      <div className="flex h-7 shrink-0 items-end gap-px border-b border-ed-border bg-ed-header px-1">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-t px-3 py-1 text-[11px] ${
              tab === key ? "bg-ed-panel text-white" : "text-ed-dim hover:text-ed-text"
            }`}
          >
            {label}
          </button>
        ))}
        {tab === "console" && (
          <div className="mb-0.5 ml-auto flex items-center gap-2 pr-1">
            {running && <span className="animate-pulse text-[11px] text-permit">agents working…</span>}
            <ToolButton onClick={onClear}>Clear</ToolButton>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "console" && <Console events={events} />}
        {tab === "summary" && <Summary result={result} />}
        {tab === "involved" && <GetInvolved appNumber={result?.ok ? result.application?.app_number ?? null : null} />}
        {tab === "applications" && <Applications result={result} onModel={onModel} running={running} includeClosed={includeClosed} />}
        {tab === "ward" && <Ward result={result} />}
      </div>
    </div>
  );
}

function Console({ events }: { events: StepEvent[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [events.length]);
  if (!events.length)
    return <p className="p-3 font-mono text-[11px] text-ed-dim">Agent activity will stream here when you run an address.</p>;
  return (
    <div className="font-mono text-[11px] leading-5">
      {events.map((e) => (
        <details key={e.id} className="group border-b border-[#232323] px-2 hover:bg-[#2e2e2e]">
          <summary className={`flex cursor-default list-none items-start gap-2 ${e.data ? "cursor-pointer" : ""}`}>
            <span className="w-14 shrink-0 text-ed-dim">{e.time}</span>
            <span className={`w-20 shrink-0 font-semibold ${AGENT_STYLE[e.agent] ?? ""}`}>
              {KIND_ICON[e.kind] ?? "·"} {e.agent}
            </span>
            <span
              className={`min-w-0 flex-1 break-words ${
                e.kind === "error" || e.kind === "stop" ? "text-[#ff8b8b]" : e.kind === "warn" || e.kind === "retry" ? "text-[#ffc66d]" : "text-ed-text"
              }`}
            >
              {e.kind === "tool_call" ? <span className="text-[#ffc66d]">{e.message}(…)</span> : e.message}
            </span>
            {e.data != null && <span className="shrink-0 text-ed-dim group-open:rotate-90">▸</span>}
          </summary>
          {e.data != null && (
            <pre className="mb-1 ml-36 max-h-64 overflow-auto rounded bg-[#1b1b1b] p-2 text-[10.5px] text-[#b5cea8]">
              {JSON.stringify(e.data, null, 2)}
            </pre>
          )}
        </details>
      ))}
      <div ref={end} />
    </div>
  );
}

function Summary({ result }: { result: RunResult | null }) {
  if (!result) return <p className="p-3 text-[11px] text-ed-dim">Run an address to see a plain-language summary.</p>;
  const n = result.narration;
  return (
    <div className="grid gap-4 p-3 text-[12px] text-ed-text lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-3">
        {!result.ok && (
          <div className="rounded border border-[#6b3a1f] bg-[#3a2414] p-3 text-[#ffcfa8]">
            <p className="font-semibold">No model built</p>
            <p className="mt-1">{result.message}</p>
          </div>
        )}
        {n && (
          <>
            <h3 className="text-[15px] font-semibold text-white">{n.headline}</h3>
            <div className="prose-invert space-y-2 leading-relaxed [&_a]:text-[#7fb6ff] [&_a]:underline [&_strong]:text-white">
              <ReactMarkdown>{n.summary}</ReactMarkdown>
            </div>
            <ul className="space-y-1">
              {n.key_facts.map((f, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-permit">■</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <p className="text-ed-dim">{n.how_to_learn_more}</p>
            {n.template && <Badge tone="warn">Template summary: the AI narrator was unavailable</Badge>}
          </>
        )}
      </div>
      <div className="space-y-3">
        {result.limitations && (
          <div className="rounded border border-[#4a4a4a] bg-[#222] p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-permit">Limitations</p>
            <ul className="list-disc space-y-1 pl-4 text-[11px] text-ed-dim">
              {result.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
              {result.site?.notes.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
        )}
        {result.sources && (
          <div className="rounded border border-[#4a4a4a] bg-[#222] p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ed-dim">Data sources (City of Toronto Open Data)</p>
            <ul className="space-y-1 text-[11px]">
              {result.sources.map((s) => (
                <li key={s.key}>
                  <a href={s.page_url} target="_blank" rel="noreferrer" className="text-[#7fb6ff] underline">
                    {s.title}
                  </a>
                  {s.last_refreshed && <span className="text-ed-dim"> · refreshed {s.last_refreshed.slice(0, 10)}</span>}
                </li>
              ))}
              {result.application?.application_url && (
                <li>
                  <a href={result.application.application_url} target="_blank" rel="noreferrer" className="text-[#7fb6ff] underline">
                    Official application record ({result.application.app_number})
                  </a>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Applications({
  result,
  onModel,
  running,
  includeClosed,
}: {
  result: RunResult | null;
  onModel: (n: string) => void;
  running: boolean;
  includeClosed: boolean;
}) {
  const apps: Application[] = result?.candidates ?? [];
  if (!result) return <p className="p-3 text-[11px] text-ed-dim">Nearby applications appear here after a run.</p>;
  if (!apps.length)
    return (
      <p className="p-3 text-[11px] text-ed-dim">
        No development applications nearby{includeClosed ? "" : " (closed applications are hidden; toggle them in the toolbar)"}.
      </p>
    );
  return (
    <table className="w-full text-left text-[11px] text-ed-text">
      <thead className="sticky top-0 bg-[#303030] text-ed-dim">
        <tr>
          <th className="px-2 py-1 font-medium">Distance</th>
          <th className="px-2 py-1 font-medium">Application</th>
          <th className="px-2 py-1 font-medium">Type</th>
          <th className="px-2 py-1 font-medium">Status</th>
          <th className="px-2 py-1 font-medium">Address</th>
          <th className="px-2 py-1 font-medium">Description</th>
          <th className="px-2 py-1" />
        </tr>
      </thead>
      <tbody>
        {apps.map((a) => {
          const current = a.app_number === result.application?.app_number;
          return (
            <tr key={a.app_number} className={`border-b border-[#232323] align-top ${current ? "bg-[#2c3b4a]" : "hover:bg-[#2e2e2e]"}`}>
              <td className="px-2 py-1 whitespace-nowrap">{Math.round(a.distance_m)} m</td>
              <td className="px-2 py-1 whitespace-nowrap font-mono">
                {a.application_url ? (
                  <a href={a.application_url} target="_blank" rel="noreferrer" className="text-[#7fb6ff] underline">
                    {a.app_number}
                  </a>
                ) : (
                  a.app_number
                )}
              </td>
              <td className="px-2 py-1">{a.type_name}</td>
              <td className="px-2 py-1 whitespace-nowrap">
                {a.status} {a.closed && <Badge tone="warn">closed</Badge>}
              </td>
              <td className="px-2 py-1 whitespace-nowrap">{a.address}</td>
              <td className="max-w-md px-2 py-1 text-ed-dim">
                <span className="line-clamp-2" title={a.description ?? ""}>
                  {a.description}
                </span>
              </td>
              <td className="px-2 py-1 whitespace-nowrap">
                {current ? (
                  <Badge>shown</Badge>
                ) : a.modelled ? (
                  <ToolButton disabled={running} onClick={() => onModel(a.app_number)}>
                    Model this
                  </ToolButton>
                ) : (
                  <span className="text-ed-dim" title="Ordis models rezoning and site plan applications">
                    not modelled
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const TYPE_NAMES: Record<string, string> = {
  OZ: "Rezoning / Official Plan",
  SA: "Site Plan",
  CD: "Condominium",
  SB: "Subdivision",
  PL: "Part Lot Control",
};

function Ward({ result }: { result: RunResult | null }) {
  const w = result?.ward;
  if (!w) return <p className="p-3 text-[11px] text-ed-dim">Run an address to see development activity in its ward.</p>;
  const maxType = Math.max(...Object.values(w.by_type), 1);
  const maxStatus = Math.max(...Object.values(w.by_status), 1);
  return (
    <div className="grid gap-4 p-3 text-[11px] text-ed-text md:grid-cols-[1fr_1fr_1.1fr]">
      <div>
        <p className="text-[13px] font-semibold text-white">{w.ward_name}</p>
        <p className="mt-1 text-[28px] font-semibold leading-none text-white">{w.total.toLocaleString()}</p>
        <p className="text-ed-dim">development applications on record (2008 to today, closed ones {""}
          {Object.keys(w.by_status).some((s) => /closed/i.test(s)) ? "included" : "excluded"})</p>
        <p className="mt-2 text-[20px] font-semibold leading-none text-white">{w.submitted_since_2024.toLocaleString()}</p>
        <p className="text-ed-dim">submitted since January 2024</p>
        <p className="mt-3 rounded border border-[#3a3a3a] bg-[#222] p-2 text-ed-dim">
          Toronto votes in the municipal election on <span className="text-ed-text">October 26, 2026</span>. Development
          is decided by City Council and the Ontario Land Tribunal; these counts show activity, not whether it is good or
          bad. See the{" "}
          <a className="text-[#7fb6ff] underline" href="https://www.toronto.ca/city-government/elections/" target="_blank" rel="noreferrer">
            City of Toronto elections page
          </a>
          .
        </p>
      </div>
      <Bars title="By type" data={w.by_type} max={maxType} label={(k) => TYPE_NAMES[k] ?? k} />
      <Bars title="By status" data={w.by_status} max={maxStatus} label={(k) => k} />
    </div>
  );
}

function Bars({ title, data, max, label }: { title: string; data: Record<string, number>; max: number; label: (k: string) => string }) {
  return (
    <div>
      <p className="mb-1 font-semibold uppercase tracking-wide text-ed-dim">{title}</p>
      <div className="space-y-1">
        {Object.entries(data).slice(0, 10).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[45%_1fr_auto] items-center gap-2">
            <span className="truncate" title={label(k)}>{label(k)}</span>
            <div className="h-2 rounded bg-[#1e1e1e]">
              <div className="h-2 rounded bg-[#9a9a96]" style={{ width: `${(v / max) * 100}%` }} />
            </div>
            <span className="w-10 text-right tabular-nums text-ed-dim">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
