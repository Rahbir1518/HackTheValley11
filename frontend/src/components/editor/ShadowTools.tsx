"use client";

import { useEffect, useRef } from "react";
import { formatToronto, minutesOfDayToronto, sunTimes, type Sun } from "@/lib/sun";
import { ToolButton } from "./ui";

interface Props {
  date: string;
  minutes: number;
  onDate: (d: string) => void;
  onMinutes: (m: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  sun: Sun;
  shadows: boolean;
  onShadows: (s: boolean) => void;
  heatOn: boolean;
  onHeat: (v: boolean) => void;
  heatAvailable: boolean;
}

const PRESETS: [string, string][] = [
  ["Mar 21", "03-21"],
  ["Jun 21", "06-21"],
  ["Sep 21", "09-21"],
  ["Dec 21", "12-21"],
];

function hhmm(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Scene overlay: date + time of day drive the sun (suncalc, Toronto). */
export default function ShadowTools({
  date,
  minutes,
  onDate,
  onMinutes,
  playing,
  onPlaying,
  sun,
  shadows,
  onShadows,
  heatOn,
  onHeat,
  heatAvailable,
}: Props) {
  const { sunrise, sunset } = sunTimes(date);
  const rise = minutesOfDayToronto(sunrise);
  const set = minutesOfDayToronto(sunset);

  // Play animates from sunrise to sunset.
  const minutesRef = useRef(minutes);
  useEffect(() => {
    minutesRef.current = minutes;
  }, [minutes]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const next = minutesRef.current + 4;
      onMinutes(next > set ? rise : next);
    }, 50);
    return () => clearInterval(id);
  }, [playing, rise, set, onMinutes]);

  const year = date.slice(0, 4);
  return (
    <div className="pointer-events-auto w-[300px] rounded border border-ed-border bg-[#282828ee] p-2 text-[11px] text-ed-text shadow-lg backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-semibold text-white">☀ Sun & shadows</span>
        <label className="flex items-center gap-1 text-ed-dim">
          <input type="checkbox" checked={shadows} onChange={(e) => onShadows(e.target.checked)} className="accent-ed-select" />
          shadows
        </label>
      </div>
      <div className="flex items-center gap-1">
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && onDate(e.target.value)}
          className="h-6 flex-1 rounded border border-ed-border bg-[#1e1e1e] px-1 text-ed-text [color-scheme:dark]"
        />
        {PRESETS.map(([label, md]) => (
          <button
            key={md}
            onClick={() => onDate(`${year}-${md}`)}
            className={`h-6 rounded px-1 text-[10px] ${date.endsWith(md) ? "bg-ed-select text-white" : "bg-[#3a3a3a] hover:bg-[#4a4a4a]"}`}
            title={md === "06-21" ? "Summer solstice: shortest shadows" : md === "12-21" ? "Winter solstice: longest shadows" : "Equinox"}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <ToolButton active={playing} onClick={() => onPlaying(!playing)} title="Animate sunrise to sunset">
          {playing ? "❚❚" : "▶"}
        </ToolButton>
        <input
          type="range"
          min={0}
          max={1439}
          step={5}
          value={minutes}
          onChange={(e) => onMinutes(Number(e.target.value))}
          className="flex-1 accent-permit"
        />
        <span className="w-10 text-right font-mono text-white">{hhmm(minutes)}</span>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ed-dim">
        <span>↑ {formatToronto(sunrise)}</span>
        <span>
          {sun.up ? `alt ${sun.altitudeDeg.toFixed(0)}° · az ${sun.azimuthDeg.toFixed(0)}°` : "sun below horizon"}
        </span>
        <span>↓ {formatToronto(sunset)}</span>
      </div>
      <button
        onClick={() => onHeat(!heatOn)}
        disabled={!heatAvailable}
        title="Hours of direct sun the proposal removes at ground level over this whole day"
        className={`mt-2 w-full rounded border py-1 text-[11px] font-semibold disabled:opacity-40 ${
          heatOn ? "border-[#7a1a10] bg-[#c2410c] text-white" : "border-ed-border bg-[#4a4a4a] hover:bg-[#565656]"
        }`}
      >
        {heatOn ? "■ Hide sunlight lost" : "◐ Show sunlight lost over this day"}
      </button>
    </div>
  );
}
