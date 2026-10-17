"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const PHASES = [
  {
    n: "01",
    title: "Find",
    body: "Enter any Toronto address. Ordis searches more than 26,000 City of Toronto development applications around it and picks the one that matters to your block.",
  },
  {
    n: "02",
    title: "Read",
    body: "AI agents read the application text for storeys, height, podium and towers. Anything the text doesn't say is estimated with a rule you can see, never passed off as fact.",
  },
  {
    n: "03",
    title: "Build",
    body: "Blender builds a 3D massing model on the real property boundary, among the City's 3D buildings and street trees.",
  },
  {
    n: "04",
    title: "Shadow",
    body: "Move the sun through any day of the year and compare your street with and without the proposal.",
  },
  {
    n: "05",
    title: "Understand",
    body: "A plain-language summary, the official record and every assumption, side by side. Information, not advocacy.",
  },
];

const SEGMENTS = PHASES.length + 1; // hero + phases

/** Full-screen video scrubbed by scroll, with the hero and five phases fading in over it. */
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
      const total = rect.height - window.innerHeight;
      const p = Math.min(1, Math.max(0, -rect.top / total));
      target.current = p;
      setProgress(p);
    };

    // Ease the video towards the scroll position so scrubbing feels smooth.
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

  // Opacity of segment i: fades in and out around its slice of the scroll.
  const visible = (i: number) => {
    const centre = (i + 0.5) / SEGMENTS;
    // The hero is fully shown at the top and the last phase stays until the section ends.
    if ((i === 0 && progress <= centre) || (i === SEGMENTS - 1 && progress >= centre)) return 1;
    const d = Math.abs(progress - centre) * SEGMENTS;
    return Math.max(0, Math.min(1, 1.6 - d * 2.2));
  };
  const active = Math.min(PHASES.length - 1, Math.max(0, Math.floor(progress * SEGMENTS) - 1));

  return (
    <section ref={section} style={{ height: `${SEGMENTS * 110}vh` }} className="relative">
      <div className="sticky top-0 h-screen overflow-hidden bg-white">
        <video
          ref={video}
          src="/media/backgroundVid.mp4"
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover opacity-90"
        />
        {/* Legibility wash on the text side */}
        <div className="absolute inset-0 bg-linear-to-r from-white via-white/70 to-transparent" />

        {/* Hero */}
        <div
          className="absolute inset-0 flex flex-col justify-center px-6 md:px-16"
          style={{ opacity: visible(0), transform: `translateY(${(1 - visible(0)) * -24}px)` }}
        >
          <div className="mb-8 flex max-w-md items-start gap-3 border-l-2 border-permit pl-3 text-sm text-steel">
            <span className="font-semibold text-asphalt">What is Ordis?</span>
            <span>A civic tool that turns Toronto development applications into 3D models you can explore.</span>
          </div>
          <h1 className="max-w-4xl text-6xl font-semibold leading-[0.95] tracking-tight text-asphalt md:text-8xl">
            Your block is changing.
          </h1>
          <p className="mt-6 max-w-xl text-xl text-steel md:text-2xl">See what&apos;s proposed near you, before it&apos;s built.</p>
          <div className="mt-10 flex items-center gap-4">
            <Link href="/viewer" className="rounded-full bg-asphalt px-6 py-3 text-sm font-semibold text-white hover:bg-permit hover:text-asphalt">
              Enter Ordis
            </Link>
            <span className="animate-bounce text-sm text-steel">Scroll to explore ↓</span>
          </div>
        </div>

        {/* Phases */}
        {PHASES.map((ph, i) => {
          const o = visible(i + 1);
          return (
            <div
              key={ph.n}
              className="absolute inset-0 flex flex-col justify-center px-6 md:px-16"
              style={{ opacity: o, transform: `translateY(${(1 - o) * 30}px)`, pointerEvents: o > 0.5 ? "auto" : "none" }}
            >
              <span className="font-mono text-sm tracking-[0.3em] text-permit">PHASE {ph.n}</span>
              <h2 className="mt-2 text-7xl font-semibold tracking-tight text-asphalt md:text-9xl">{ph.title}.</h2>
              <p className="mt-6 max-w-lg text-lg leading-relaxed text-[#3d3d3b] md:text-xl">{ph.body}</p>
            </div>
          );
        })}

        {/* Phase rail */}
        <div className="absolute bottom-8 left-6 right-6 flex items-center gap-3 md:left-16 md:right-16">
          {PHASES.map((ph, i) => (
            <div key={ph.n} className="flex-1">
              <div className="h-px bg-concrete">
                <div
                  className="h-px bg-asphalt transition-[width] duration-150"
                  style={{ width: `${Math.max(0, Math.min(1, progress * SEGMENTS - (i + 1))) * 100}%` }}
                />
              </div>
              <span className={`mt-2 block font-mono text-[11px] ${i === active && progress > 1 / SEGMENTS ? "text-asphalt" : "text-steel"}`}>
                {ph.n} {ph.title}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
