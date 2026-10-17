"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, MapPin, Plus } from "lucide-react";
import AppNav from "@/components/AppNav";
import { Ordi, StatusChip } from "@/components/brand";
import { API_URL } from "@/lib/api";
import { loadPlaces, rememberPlace, type Place } from "@/lib/places";

interface Proposal {
  app_number: string;
  type_name: string;
  status: string;
  address: string;
  distance_m: number;
  modelled: boolean;
  closed: boolean;
  application_url: string | null;
  description: string | null;
}

interface ProposalsReply {
  type: "proposals";
  place: { address: string; ward: string | null; neighbourhood: string | null };
  intro: string;
  featured: {
    headline: string | null;
    summary: string | null;
    app_number: string;
    type_name: string;
    status: string;
    address: string;
    facts: { value: string; label: string }[];
  } | null;
  applications: Proposal[];
}

interface AnswerReply {
  type: "answer";
  general: boolean;
  answerable: boolean;
  answer: string;
  citations: { source: string; quote: string }[];
  sources: Record<string, { label: string; url: string | null }>;
}

type Turn = { q: string; reply?: ProposalsReply | AnswerReply; error?: string };

const SUGGESTIONS = ["What's proposed near 135 Liberty St?", "Show me proposals near 5250 Yonge St", "What does a rezoning application mean?"];

const viewerHref = (address: string, app: string) => `/viewer?address=${encodeURIComponent(address)}&app=${encodeURIComponent(app)}`;

export default function AskPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPlaces(loadPlaces()); // browser-only storage, read after mount
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  // The proposal being discussed, so follow-ups like "how tall is it?" have context.
  const lastProposals = [...turns].reverse().find((t) => t.reply?.type === "proposals")?.reply as ProposalsReply | undefined;
  const placeHeading = lastProposals?.place;
  const context = lastProposals?.featured
    ? { address: lastProposals.place.address, app_number: lastProposals.featured.app_number }
    : lastProposals?.applications.find((a) => a.modelled)
      ? { address: lastProposals.place.address, app_number: lastProposals.applications.find((a) => a.modelled)!.app_number }
      : null;

  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    setText("");
    setBusy(true);
    const idx = turns.length;
    setTurns((t) => [...t, { q }]);
    try {
      const history = turns
        .filter((t) => t.reply?.type === "answer")
        .slice(-3)
        .map((t) => ({ q: t.q, a: (t.reply as AnswerReply).answer }));
      const r = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, place: context, history }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? r.statusText);
      setTurns((t) => t.map((x, i) => (i === idx ? { ...x, reply: data } : x)));
      if (data.type === "proposals") {
        rememberPlace({ address: data.place.address, label: data.featured?.headline ?? "What's proposed here?" });
        setPlaces(loadPlaces());
      }
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === idx ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)));
    } finally {
      setBusy(false);
    }
  };

  const empty = turns.length === 0;

  return (
    <div className="flex h-screen flex-col bg-white">
      <AppNav active="ask" />
      <div className="flex min-h-0 flex-1">
        {/* Conversation navigation */}
        <aside className="relative flex w-[244px] shrink-0 flex-col gap-8 border-r border-line bg-side p-6">
          <button onClick={() => setTurns([])} className="flex h-10 items-center gap-2.5 text-[13px] text-black">
            <Plus className="size-4" strokeWidth={1.5} />
            Ask something new
          </button>
          {places.length > 0 && (
            <div className="space-y-4">
              <p className="mono text-[10px] text-muted">YOUR RECENT PLACES</p>
              <div className="space-y-1.5">
                {places.map((p) => (
                  <button
                    key={p.address}
                    onClick={() => send(`What's proposed near ${p.address}?`)}
                    className={`block w-full rounded-md p-[13px] text-left ${placeHeading?.address === p.address ? "bg-soft" : "hover:bg-soft"}`}
                  >
                    <span className="block text-[13px] text-black">{p.address}</span>
                    <span className="mt-1.5 block truncate text-[11px] text-muted">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="absolute bottom-7 left-6 w-[195px] space-y-3">
            <MapPin className="size-[18px] text-ink" strokeWidth={1.5} />
            <p className="text-[12px] leading-[1.6] text-muted">Start with a Toronto address. You don&apos;t need to know an application number.</p>
          </div>
        </aside>

        {/* Conversation */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[900px] px-12 pt-10">
              {empty ? (
                <div className="flex flex-col items-center pt-[12vh] text-center">
                  <Ordi size={96} track mood={busy ? "thinking" : text ? "happy" : "idle"} />
                  <p className="mt-6 text-[30px] leading-tight text-black">What&apos;s being built near you?</p>
                  <p className="mt-3 text-[15px] text-muted">Ask about a Toronto address. Ordis reads the City&apos;s records for you.</p>
                </div>
              ) : (
                <div className="space-y-8 pb-8">
                  {placeHeading && (
                    <div className="flex items-center justify-between">
                      <p className="text-[14px] text-black">{placeHeading.address}</p>
                      <p className="mono text-[10px] uppercase text-muted">
                        Toronto{placeHeading.neighbourhood ? ` / ${placeHeading.neighbourhood}` : ""}
                      </p>
                    </div>
                  )}
                  {turns.map((t, i) => (
                    <div key={i} className="space-y-6">
                      <div className="flex justify-end">
                        <p className="rounded-[24px] bg-soft px-[22px] py-4 text-[16px] text-black">{t.q}</p>
                      </div>
                      {t.reply ? <Reply reply={t.reply} /> : t.error ? <p className="text-[13px] text-[#a0331c]">{t.error}</p> : <Thinking />}
                    </div>
                  ))}
                  <div ref={end} />
                </div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="mx-auto w-full max-w-[900px] space-y-3 px-12 pb-6">
            {empty && (
              <div className="flex flex-wrap justify-center gap-2.5">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-full border border-line px-3.5 py-2.5 text-[12px] text-muted hover:text-ink">
                    {s}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(text);
              }}
              className="flex flex-col gap-5 rounded-[24px] border border-line bg-white p-[18px]"
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Ask about an address or a proposal…"
                className="text-[14px] text-black outline-none placeholder:text-muted"
                autoFocus
              />
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted">
                  {context ? `Follow-up questions are about ${context.app_number}.` : "A simple question is a good start."}
                </p>
                <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="grid size-[30px] place-items-center rounded-full bg-ink text-white disabled:opacity-40">
                  <ArrowUp className="size-4" />
                </button>
              </div>
            </form>
            <p className="text-center text-[10px] text-muted">Ordis can make mistakes. Check important details in the official City record.</p>
          </div>
        </main>
      </div>
    </div>
  );
}

function Identity({ note }: { note: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Ordi size={28} />
      <span className="text-[13px] text-black">Ordis</span>
      <span className="text-[11px] text-muted">{note}</span>
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-2.5">
      <Ordi size={28} mood="thinking" />
      <span className="animate-pulse text-[13px] text-muted">Reading the City&apos;s records…</span>
    </div>
  );
}

function Reply({ reply }: { reply: ProposalsReply | AnswerReply }) {
  if (reply.type === "answer") return <Answer reply={reply} />;
  return <Proposals reply={reply} />;
}

function Answer({ reply }: { reply: AnswerReply }) {
  const [open, setOpen] = useState(false);
  const cited = [...new Set(reply.citations.map((c) => c.source))];
  return (
    <div className="space-y-4">
      <Identity note={reply.general ? "General planning information" : reply.answerable ? "From the City's records" : "Not in the City's data"} />
      <p className="text-[16px] leading-[1.7] text-black">{reply.answer}</p>
      {cited.length > 0 && (
        <div>
          <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[12px] text-muted hover:text-ink">
            Sources ({cited.length}) <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <div className="mt-2 flex flex-wrap gap-2">
              {cited.map((k) => {
                const s = reply.sources[k];
                const estimate = k === "ordis_spec";
                const cls = `rounded-full border px-3 py-1.5 text-[11px] ${estimate ? "border-prop bg-select text-prop-ink" : "border-line text-muted hover:text-ink"}`;
                return s?.url ? (
                  <a key={k} href={s.url} target="_blank" rel="noreferrer" className={cls}>
                    {s.label} ↗
                  </a>
                ) : (
                  <span key={k} className={cls}>
                    {s?.label ?? k}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Proposals({ reply }: { reply: ProposalsReply }) {
  const [showAll, setShowAll] = useState(false);
  const f = reply.featured;
  const others = reply.applications.filter((a) => a.app_number !== f?.app_number);
  const visible = showAll ? others : others.slice(0, 4);
  return (
    <div className="space-y-[22px]">
      <Identity note="From the City's application record" />
      {f?.headline ? (
        <>
          <p className="max-w-[640px] text-[30px] leading-[1.2] text-black">{f.headline}</p>
          {f.summary && <p className="text-[16px] leading-[1.7] text-muted">{f.summary.split("\n\n")[0].replace(/\*\*/g, "")}</p>}
          <div className="space-y-5 rounded-xl border border-line p-6">
            <div className="flex items-center justify-between">
              <p className="text-[18px] text-black">{f.address}</p>
              <StatusChip>{f.status}</StatusChip>
            </div>
            <div className="flex flex-wrap gap-[35px]">
              {f.facts.map((x) => (
                <div key={x.label + x.value} className="space-y-[7px]">
                  <p className="text-[15px] text-black">{x.value}</p>
                  <p className="text-[11px] text-muted">{x.label}</p>
                </div>
              ))}
            </div>
            <div className="h-px bg-line" />
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-muted">{f.type_name}</p>
              <Link href={viewerHref(reply.place.address, f.app_number)} className="flex h-9 items-center rounded-full bg-ink px-4 text-[13px] text-white">
                View in 3D →
              </Link>
            </div>
          </div>
          <p className="text-[12px] leading-[1.5] text-muted">
            The 3D view separates stated facts from estimates. It is a massing approximation, not an architectural rendering.
          </p>
        </>
      ) : (
        <p className="text-[22px] leading-[1.3] text-black">{reply.intro}</p>
      )}

      {others.length > 0 && (
        <div className="space-y-2.5">
          {f && <p className="mono text-[10px] text-muted">{`ALSO NEARBY · ${others.length}`}</p>}
          {visible.map((a) => (
            <div key={a.app_number} className="flex items-center justify-between gap-6 rounded-xl border border-line px-5 py-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-3">
                  <p className="text-[15px] text-black">{a.address}</p>
                  <span className="text-[11px] text-muted">{Math.round(a.distance_m)} m away</span>
                </div>
                <p className="line-clamp-1 text-[12px] text-muted">
                  {a.type_name} · {a.status}
                  {a.description ? ` · ${a.description}` : ""}
                </p>
              </div>
              {a.modelled ? (
                <Link href={viewerHref(reply.place.address, a.app_number)} className="shrink-0 rounded-full border border-line px-3.5 py-2 text-[12px] text-ink hover:bg-soft">
                  View in 3D →
                </Link>
              ) : (
                <a href={a.application_url ?? "#"} target="_blank" rel="noreferrer" className="shrink-0 text-[12px] text-muted hover:text-ink">
                  Info only ↗
                </a>
              )}
            </div>
          ))}
          {others.length > 4 && (
            <button onClick={() => setShowAll(!showAll)} className="text-[12px] text-muted hover:text-ink">
              {showAll ? "Show fewer" : `Show ${others.length - 4} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
