"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, Search, Sun } from "lucide-react";
import { StatusChip } from "@/components/brand";

const PHASES = [
  { n: "01", title: "Find", lead: "Start with any Toronto address.", body: "Search 26,000+ City development applications to see what's proposed nearby." },
  { n: "02", title: "Read", lead: "The paperwork, made approachable.", body: "AI agents read the application. Anything not stated is estimated with a visible rule, never passed off as fact." },
  { n: "03", title: "Build", lead: "A proposal in its real surroundings.", body: "Explore a 3D model on the real property boundary, among the City's 3D buildings and trees." },
  { n: "04", title: "Shadow", lead: "See the street in a different light.", body: "Move the sun through any day. Compare your street with and without the proposal." },
  { n: "05", title: "Understand", lead: "The context. Not a conclusion.", body: "A plain-language summary, the official record, and every assumption. Information, not advocacy." },
];

const SEGMENTS = PHASES.length + 1; // hero + phases
const card = "rounded-xl border border-line bg-white shadow-[0_8px_24px_rgba(35,53,44,0.05)]";

/** The small product moment that floats beside each phase. */
function PhaseCard({ n }: { n: string }) {
  if (n === "01")
    return (
      <div className={`${card} w-[450px] space-y-3.5 p-[22px]`}>
        <p className="mono text-[10px] text-muted">YOUR ADDRESS, YOUR STARTING POINT</p>
        <div className="flex items-center gap-3.5 text-[18px] text-black">
          <Search className="size-[18px]" strokeWidth={1.5} />
          135 Liberty St, Toronto <span className="text-[20px]">↗</span>
        </div>
        <p className="text-[11px] text-muted">City records, brought into focus.</p>
      </div>
    );
  if (n === "02")
    return (
      <div className={`${card} w-[330px] space-y-3 p-[22px]`}>
        <p className="mono text-[9px] text-muted">APPLICATION · PLAIN LANGUAGE</p>
        <p className="text-[18px] text-black">135 Liberty St</p>
        <StatusChip>Stated in application</StatusChip>
        <p className="text-[13px] leading-[1.5] text-black">10- and 11-storey office towers. Heritage buildings retained.</p>
        <StatusChip tone="prop">Estimated · rule shown</StatusChip>
        <p className="text-[12px] leading-[1.5] text-muted">Approx. 43 m / 47 m, using 4.0 m office floor heights.</p>
      </div>
    );
  if (n === "03")
    return (
      <div className={`${card} flex gap-5 px-4 py-2.5 text-[10px] text-muted`}>
        <span>┄ PROPERTY BOUNDARY</span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 bg-context" /> CITY 3D MASSING
        </span>
      </div>
    );
  if (n === "04")
    return (
      <div className={`${card} flex items-center gap-4 rounded-full px-5 py-3 text-[11px]`}>
        <Sun className="size-4" strokeWidth={1.5} />
        <span className="mono text-prop-ink">21 JUN · 16:00</span>
        <span className="h-4 w-px bg-line" />
        <span className="text-muted">Without</span>
        <span className="rounded bg-select px-2 py-0.5 text-prop-ink">With proposal</span>
      </div>
    );
  return (
    <div className={`${card} w-[260px] space-y-3 p-5`}>
      <p className="text-[15px] text-black">A clearer picture.</p>
      {["What is proposed", "What is estimated", "The official record"].map((x, i) => (
        <div key={x} className="flex items-center justify-between border-b border-line pb-2 text-[12px] text-muted last:border-0">
          {x}
          {i < 2 ? <Check className="size-3.5 text-prop-ink" /> : <span>↗</span>}
        </div>
      ))}
    </div>
  );
}

/** Full-screen line-drawing video scrubbed by scroll, with the hero and five phases over it. */
export default function ScrollStory() {
  const section = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const target = useRef(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const v = video.current;
    let raf = 0;
    let current = 0;
    const onScroll = () => {
      const el = section.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -rect.top / (rect.height - window.innerHeight)));
      target.current = p;
      setProgress(p);
    };
    const tick = () => {
      if (v && v.duration) {
        current += (target.current - current) * 0.12;
        const t = current * (v.duration - 0.05);
        if (Math.abs(v.currentTime - t) > 1 / 60) v.currentTime = t;
      }
      raf = requestAnimationFrame(tick);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const visible = (i: number) => {
    const centre = (i + 0.5) / SEGMENTS;
    if ((i === 0 && progress <= centre) || (i === SEGMENTS - 1 && progress >= centre)) return 1;
    const d = Math.abs(progress - centre) * SEGMENTS;
    return Math.max(0, Math.min(1, 1.6 - d * 2.2));
  };
  const active = Math.floor(progress * SEGMENTS) - 1; // -1 = hero

  return (
    <section ref={section} style={{ height: `${SEGMENTS * 110}vh` }} className="relative">
      <div className="sticky top-0 h-screen overflow-hidden bg-white">
        <video ref={video} src="/media/backgroundVid.mp4" muted playsInline preload="auto" className="absolute inset-0 h-full w-full object-cover object-right" />
        <div className="absolute inset-y-0 left-0 w-[58%] bg-linear-to-r from-white from-55% to-transparent" />

        {/* Hero */}
        <div
          className="absolute inset-0 flex flex-col justify-center px-6 pt-16 md:px-20"
          style={{ opacity: visible(0), transform: `translateY(${(1 - visible(0)) * -24}px)`, pointerEvents: visible(0) > 0.5 ? "auto" : "none" }}
        >
          <div className="mb-[34px] flex max-w-[395px] gap-4">
            <div className="h-[57px] w-[2px] shrink-0 bg-rust" />
            <p className="text-[13px] leading-[1.5] text-muted">What is Ordis? A civic tool that turns Toronto development applications into 3D models you can explore.</p>
          </div>
          <h1 className="text-[64px] font-semibold leading-[0.99] tracking-[-0.01em] text-ink md:text-[104px]">
            Your block
            <br />
            is changing.
          </h1>
          <p className="mt-[34px] max-w-[470px] text-[21px] leading-[1.5] text-muted">See what&apos;s proposed near you, before it&apos;s built.</p>
          <div className="mt-[34px] flex items-center gap-7">
            <Link href="/ask" className="flex h-12 items-center rounded-full bg-ink px-6 text-[14px] text-white hover:bg-black">
              Enter Ordis →
            </Link>
            <span className="mono text-[11px] text-muted">Scroll to explore ↓</span>
          </div>
        </div>

        {/* Phases */}
        {PHASES.map((ph, i) => {
          const o = visible(i + 1);
          return (
            <div key={ph.n} className="absolute inset-0" style={{ opacity: o, pointerEvents: o > 0.5 ? "auto" : "none" }}>
              <div className="absolute left-6 top-[22vh] w-[480px] space-y-6 md:left-20" style={{ transform: `translateY(${(1 - o) * 30}px)` }}>
                <p className="mono text-[12px] text-rust">PHASE {ph.n}</p>
                <p className="text-[80px] font-semibold leading-[1.05] tracking-[-0.01em] text-ink md:text-[112px]">{ph.title}.</p>
                <div className="w-[410px] space-y-2.5 text-muted">
                  <p className="text-[21px] leading-[1.45]">{ph.lead}</p>
                  <p className="text-[16px] leading-[1.6]">{ph.body}</p>
                </div>
              </div>
              <div className="absolute bottom-[16vh] right-[12%] hidden lg:block" style={{ transform: `translateY(${(1 - o) * 20}px)` }}>
                <PhaseCard n={ph.n} />
              </div>
            </div>
          );
        })}

        <p className="mono absolute bottom-[68px] right-12 text-[9px] text-muted">SCHEMATIC MASSING STUDY / ORDIS</p>

        {/* Story progress */}
        <div className="absolute inset-x-0 bottom-0 flex gap-2 px-12 pb-[22px]">
          {PHASES.map((ph, i) => (
            <div key={ph.n} className="flex-1 space-y-2.5">
              <div className="h-px bg-line">
                <div className="h-px bg-ink" style={{ width: `${Math.max(0, Math.min(1, progress * SEGMENTS - (i + 1) + 1)) * 100}%` }} />
              </div>
              <p className={`mono whitespace-pre text-[10px] ${i === active ? "text-ink" : "text-muted"}`}>{`${ph.n}  ${ph.title}`}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
