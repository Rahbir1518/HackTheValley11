"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { Badge } from "./ui";

interface Citation {
  source: string;
  quote: string;
}

interface Answer {
  question: string;
  answerable: boolean;
  answer: string;
  citations: Citation[];
  sources: Record<string, { label: string; url: string | null }>;
  cached?: boolean;
}

const SUGGESTIONS = [
  "How tall will it be, and is that stated or estimated?",
  "Is it taller than the buildings around it?",
  "How many homes or how much floor space does it add?",
  "What stage is the application at?",
  "What else is being built nearby?",
];

/** Chat grounded in one application's data. Each answer lists the sources it relied on. */
export default function AskOrdis({ appNumber }: { appNumber: string | null }) {
  const [threads, setThreads] = useState<Record<string, Answer[]>>({});
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const answers = appNumber ? threads[appNumber] ?? [] : [];

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [answers.length, busy]);

  if (!appNumber) return <p className="p-3 text-[11px] text-ed-dim">Run an address, then ask questions about its application.</p>;

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    setQuestion("");
    try {
      const r = await fetch(`${API_URL}/api/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_number: appNumber,
          question: q,
          history: answers.slice(-3).map((a) => ({ q: a.question, a: a.answer })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? r.statusText);
      setThreads((t) => ({ ...t, [appNumber]: [...(t[appNumber] ?? []), data] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col text-[12px] text-ed-text">
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {answers.length === 0 && (
          <div>
            <p className="mb-2 text-ed-dim">
              Ask about application <span className="font-mono text-ed-text">{appNumber}</span>. Answers come only from the
              application text, Ordis&apos;s interpretation and City data, with sources.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-full border border-[#4a4a4a] px-3 py-1 text-[11px] hover:border-permit hover:text-white">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {answers.map((a, i) => (
          <div key={i} className="space-y-1.5">
            <p className="ml-auto w-fit max-w-[80%] rounded-lg rounded-br-none bg-ed-select px-3 py-1.5 text-white">{a.question}</p>
            <div className={`max-w-[90%] rounded-lg rounded-bl-none border px-3 py-2 ${a.answerable ? "border-[#3a3a3a] bg-[#222]" : "border-[#6b3a1f] bg-[#2e2016]"}`}>
              <div className="mb-1 flex items-center gap-2 text-[10px] text-ed-dim">
                <span className="font-semibold text-permit">ASK ORDIS</span>
                {!a.answerable && <Badge tone="warn">not in the data</Badge>}
                {a.cached && <span>⚡ cached</span>}
              </div>
              <p className="leading-relaxed">{a.answer}</p>
              {a.citations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.citations.map((c, j) => {
                    const src = a.sources[c.source];
                    const estimate = c.source === "ordis_spec";
                    const chip = (
                      <span
                        title={`“${c.quote}”`}
                        className={`inline-flex max-w-72 items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10px] ${
                          estimate ? "bg-[#5a3a12] text-permit-soft" : "bg-[#1f3a52] text-[#a9d1ff]"
                        }`}
                      >
                        [{j + 1}] {src?.label ?? c.source}
                      </span>
                    );
                    return src?.url ? (
                      <a key={j} href={src.url} target="_blank" rel="noreferrer">
                        {chip}
                      </a>
                    ) : (
                      <span key={j}>{chip}</span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="animate-pulse text-ed-dim">Ask Ordis is reading the sources…</p>}
        {error && <p className="text-[#ff8b8b]">{error}</p>}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="flex gap-2 border-t border-ed-border p-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about this application…"
          className="h-7 flex-1 rounded border border-ed-border bg-[#1e1e1e] px-2 outline-none focus:border-ed-select"
        />
        <button type="submit" disabled={busy || !question.trim()} className="h-7 rounded bg-ed-select px-3 font-semibold text-white disabled:opacity-50">
          Ask
        </button>
      </form>
    </div>
  );
}
