"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/** Black square "O" + ORDIS wordmark. */
export function Identity({ size = 26, tagline }: { size?: number; tagline?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span
        className="grid place-items-center bg-ink font-medium text-white"
        style={{ width: size, height: size, fontSize: size * 0.69 }}
      >
        O
      </span>
      <span className="text-[13px] tracking-[0.02em] text-black">ORDIS</span>
      {tagline && <span className="ml-3 hidden border-l border-muted/60 pl-2.5 text-[13px] text-muted md:inline">What&apos;s being built near you</span>}
    </Link>
  );
}

export function StatusChip({ children, tone = "soft" }: { children: React.ReactNode; tone?: "soft" | "prop" }) {
  return (
    <span className={`mono inline-block rounded px-2 py-1 text-[10px] uppercase ${tone === "prop" ? "bg-select text-prop-ink" : "bg-soft text-muted"}`}>
      {children}
    </span>
  );
}

type Mood = "idle" | "thinking" | "happy" | "tilt";

/**
 * Ordi: the rounded, slightly tilted mascot with two oval eyes and a small smile.
 * With `track`, the eyes (and a little of the body) follow the cursor anywhere on the page.
 */
export function Ordi({ size = 56, track = false, mood = "idle" }: { size?: number; track?: boolean; mood?: Mood }) {
  const ref = useRef<HTMLDivElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!track) return;
    const onMove = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, d / 300);
      setLook({ x: (dx / d) * reach, y: (dy / d) * reach });
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [track]);

  const s = size / 120; // the Figma master is 120 px
  const eyeShift = { x: look.x * 14 * s, y: look.y * 10 * s };
  const tilt = -7 + look.x * 4 + (mood === "tilt" ? 10 : 0);
  return (
    <div
      ref={ref}
      aria-hidden
      className="shrink-0"
      style={{
        width: size * 1.1,
        height: size * 1.1,
        display: "grid",
        placeItems: "center",
        animation: mood === "thinking" ? "ordi-bob 0.9s ease-in-out infinite" : track ? "ordi-bob 3.2s ease-in-out infinite" : undefined,
      }}
    >
      <div
        className="flex flex-col items-center justify-center border-ink bg-white transition-transform duration-200"
        style={{
          width: size,
          height: size,
          borderWidth: 2,
          borderTopLeftRadius: 0.4 * size,
          borderTopRightRadius: 0.4 * size,
          borderBottomLeftRadius: 14,
          borderBottomRightRadius: 14,
          gap: 14.4 * s,
          transform: `rotate(${tilt}deg) translate(${look.x * 3 * s}px, ${look.y * 2 * s}px) ${mood === "happy" ? "translateY(-3px)" : ""}`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/ordi-eyes.svg"
          alt=""
          width={39.6 * s}
          height={14.4 * s}
          style={{
            width: 39.6 * s,
            height: 14.4 * s,
            transform: `translate(${eyeShift.x}px, ${eyeShift.y}px)`,
            animation: mood === "thinking" ? "ordi-think 1.2s ease-in-out infinite" : "ordi-blink 5s infinite",
            transition: "transform 120ms ease-out",
          }}
        />
        <div className="rounded-full bg-ink" style={{ width: 24 * s, height: 6 * s }} />
      </div>
    </div>
  );
}
