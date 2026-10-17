"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { Badge } from "./ui";

interface Meeting {
  date: string;
  time: string | null;
  location: string | null;
  app_number: string;
}

interface Involved {
  app_number: string;
  address: string;
  status: string;
  ward_name: string | null;
  application_url: string | null;
  planner: { name: string | null; phone: string | null; email: string | null };
  upcoming_meetings: Meeting[];
  past_meetings: Meeting[];
}

/** "Doe, Jane" -> "Jane Doe" */
function plannerName(raw: string | null) {
  if (!raw) return null;
  const [last, first] = raw.split(",").map((s) => s.trim());
  return first ? `${first} ${last}` : raw;
}

function niceDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/** "7:00pm", "6:30 p.m.", "7:00" -> [hours, minutes] in 24h (evening assumed for bare times). */
function parseTime(t: string | null): [number, number] {
  const m = t?.toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/);
  if (!m) return [19, 0];
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]?.startsWith("p") && h < 12) h += 12;
  if (!m[3] && h < 9) h += 12;
  return [h, min];
}

function downloadIcs(m: Meeting, info: Involved) {
  const [h, min] = parseTime(m.time);
  const d = m.date.replace(/-/g, "");
  const start = `${d}T${String(h).padStart(2, "0")}${String(min).padStart(2, "0")}00`;
  const end = `${d}T${String(Math.min(h + 2, 23)).padStart(2, "0")}${String(min).padStart(2, "0")}00`;
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ordis//Toronto development meetings//EN",
    "BEGIN:VEVENT",
    `UID:${m.app_number.replace(/\s/g, "")}-${d}@ordis`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;TZID=America/Toronto:${start}`,
    `DTEND;TZID=America/Toronto:${end}`,
    `SUMMARY:${esc(`Community consultation: ${info.address}`)}`,
    `LOCATION:${esc(m.location ?? "See the City's application page")}`,
    `DESCRIPTION:${esc(`Development application ${m.app_number}. Details: ${info.application_url ?? ""}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `ordis-meeting-${d}.ics` });
  a.click();
  URL.revokeObjectURL(url);
}

const TEMPLATES = [
  {
    key: "question",
    label: "Ask a question",
    subject: (i: Involved) => `Question about application ${i.app_number} (${i.address})`,
    body: (i: Involved, name: string) =>
      `Hello ${name},\n\nI live near ${i.address} and I'm trying to understand development application ${i.app_number}.\n\nMy question is:\n[your question]\n\nThank you,\n[your name]\n[your street]`,
  },
  {
    key: "notify",
    label: "Ask to be notified",
    subject: (i: Involved) => `Please notify me about application ${i.app_number} (${i.address})`,
    body: (i: Involved, name: string) =>
      `Hello ${name},\n\nI live near ${i.address}. Could you add me to the notification list for development application ${i.app_number}, including any community consultation meetings or statutory public meetings?\n\nThank you,\n[your name]\n[your email or mailing address]`,
  },
  {
    key: "comment",
    label: "Submit a comment",
    subject: (i: Involved) => `Comment on application ${i.app_number} (${i.address})`,
    body: (i: Involved, name: string) =>
      `Hello ${name},\n\nI live near ${i.address} and would like to submit a comment on development application ${i.app_number} for the planning record.\n\n[Your comment, in your own words. You can support, oppose, or ask for changes.]\n\nThank you,\n[your name]\n[your street]`,
  },
];

export default function GetInvolved({ appNumber }: { appNumber: string | null }) {
  const [info, setInfo] = useState<Involved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState(TEMPLATES[0].key);

  useEffect(() => {
    if (!appNumber) return;
    let cancelled = false;
    fetch(`${API_URL}/api/involved?app_number=${encodeURIComponent(appNumber)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d) => !cancelled && (setInfo(d), setError(null)))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [appNumber]);

  if (!appNumber) return <p className="p-3 text-[11px] text-ed-dim">Run an address to see how to take part in the process.</p>;
  if (error) return <p className="p-3 text-[11px] text-[#ff8b8b]">Could not load participation details: {error}</p>;
  if (!info || info.app_number !== appNumber) return <p className="p-3 text-[11px] text-ed-dim">Loading…</p>;

  const name = plannerName(info.planner.name);
  const t = TEMPLATES.find((x) => x.key === template)!;
  const mailto = info.planner.email
    ? `mailto:${info.planner.email}?subject=${encodeURIComponent(t.subject(info))}&body=${encodeURIComponent(t.body(info, name ?? "there"))}`
    : null;

  return (
    <div className="grid gap-3 p-3 text-[12px] text-ed-text lg:grid-cols-3">
      <Card title="Community meetings">
        {info.upcoming_meetings.length ? (
          info.upcoming_meetings.map((m) => (
            <div key={`${m.date}${m.time}`} className="space-y-1">
              <p className="text-[14px] font-semibold text-white">{niceDate(m.date)}</p>
              <p>
                {m.time ?? "Time not listed"} · {m.location ?? "Location on the City's page"}
              </p>
              <button onClick={() => downloadIcs(m, info)} className="mt-1 rounded bg-ed-select px-3 py-1 text-[11px] text-white">
                Add to calendar (.ics)
              </button>
            </div>
          ))
        ) : (
          <p>
            <Badge>none upcoming</Badge>{" "}
            <span className="text-ed-dim">The City&apos;s data lists no upcoming community meeting for this application.</span>
          </p>
        )}
        {info.past_meetings.length > 0 && (
          <div className="mt-3 border-t border-[#3a3a3a] pt-2 text-[11px] text-ed-dim">
            <p className="mb-1 uppercase tracking-wide">Past meetings</p>
            {info.past_meetings.map((m) => (
              <p key={`${m.date}${m.time}`}>
                {m.date} · {m.time ?? "–"} · {m.app_number}
              </p>
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] text-ed-dim">
          Statutory public meetings and decisions are posted on the{" "}
          {info.application_url ? (
            <a className="text-[#7fb6ff] underline" href={info.application_url} target="_blank" rel="noreferrer">
              application page
            </a>
          ) : (
            "application page"
          )}
          .
        </p>
      </Card>

      <Card title="City planner on this file">
        {name ? (
          <>
            <p className="text-[14px] font-semibold text-white">{name}</p>
            <p className="text-ed-dim">City Planning, City of Toronto</p>
            {info.planner.email && (
              <p>
                <a className="text-[#7fb6ff] underline" href={`mailto:${info.planner.email}`}>
                  {info.planner.email}
                </a>
              </p>
            )}
            {info.planner.phone && <p>{info.planner.phone}</p>}
          </>
        ) : (
          <p className="text-ed-dim">No planner contact is listed for this application.</p>
        )}
        <p className="mt-3 text-[11px] text-ed-dim">
          Planners can explain the application, the review stage and how to submit comments. Ward: {info.ward_name ?? "–"}.
        </p>
      </Card>

      <Card title="Write to the planner">
        <div className="mb-2 flex flex-wrap gap-1">
          {TEMPLATES.map((x) => (
            <button
              key={x.key}
              onClick={() => setTemplate(x.key)}
              className={`rounded px-2 py-0.5 text-[11px] ${template === x.key ? "bg-ed-select text-white" : "bg-[#3a3a3a] hover:bg-[#4a4a4a]"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
        <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded bg-[#1b1b1b] p-2 font-sans text-[11px] text-ed-text">
          {t.body(info, name ?? "there")}
        </pre>
        <div className="mt-2 flex gap-2">
          {mailto ? (
            <a href={mailto} className="rounded bg-ed-select px-3 py-1 text-[11px] text-white">
              Open in email
            </a>
          ) : (
            <span className="text-[11px] text-ed-dim">No email listed; use the application page.</span>
          )}
          <button
            onClick={() => navigator.clipboard.writeText(t.body(info, name ?? "there"))}
            className="rounded bg-[#3a3a3a] px-3 py-1 text-[11px] hover:bg-[#4a4a4a]"
          >
            Copy text
          </button>
        </div>
        <p className="mt-2 text-[10px] text-ed-dim">Templates are neutral starting points. Your message, your views.</p>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[#3a3a3a] bg-[#222] p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-permit">{title}</p>
      {children}
    </div>
  );
}
