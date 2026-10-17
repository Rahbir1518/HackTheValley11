"use client";

import { useRef, useState } from "react";

const EMBED_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY;

/** Real imagery of the site in a small draggable, resizable window.
 *  Aerial: Esri World Imagery (keyless). Street: Google Maps Embed API when a key is set. */
export default function SiteImagery({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  const [tab, setTab] = useState<"aerial" | "street">(EMBED_KEY ? "street" : "aerial");
  const [pos, setPos] = useState({ right: 12, top: 12 });
  const [collapsed, setCollapsed] = useState(false);
  const drag = useRef<{ x: number; y: number; right: number; top: number } | null>(null);

  // ~170 m either side of the site
  const dLat = 170 / 111_320;
  const dLon = 170 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const aerial =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?" +
    new URLSearchParams({
      bbox: `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`,
      bboxSR: "4326",
      imageSR: "3857",
      size: "640,640",
      format: "jpg",
      f: "image",
    });
  const streetEmbed = EMBED_KEY
    ? `https://www.google.com/maps/embed/v1/streetview?key=${EMBED_KEY}&location=${lat},${lon}&fov=90`
    : null;
  const streetLink = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;

  return (
    <div
      className="pointer-events-auto absolute z-20 flex flex-col overflow-hidden rounded border border-ed-border bg-ed-panel shadow-2xl"
      style={{
        right: pos.right,
        top: pos.top,
        width: 320,
        height: collapsed ? "auto" : 280,
        minWidth: 220,
        minHeight: collapsed ? 0 : 160,
        resize: collapsed ? "none" : "both",
        direction: "rtl", // puts the native resize grip on the left, away from the viewport edge
      }}
    >
      <div style={{ direction: "ltr" }} className="flex h-full flex-col">
        <div
          className="flex h-7 shrink-0 cursor-move select-none items-center gap-1 border-b border-ed-border bg-ed-header px-2 text-[11px] text-ed-text"
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY, ...pos };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            setPos({
              right: Math.max(0, drag.current.right - (e.clientX - drag.current.x)),
              top: Math.max(0, drag.current.top + (e.clientY - drag.current.y)),
            });
          }}
          onPointerUp={() => (drag.current = null)}
        >
          <span className="font-semibold">Site imagery</span>
          <span className="truncate text-ed-dim">· {label}</span>
          <div className="ml-auto flex gap-px" onPointerDown={(e) => e.stopPropagation()}>
            {(["aerial", "street"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded px-1.5 text-[10px] ${tab === t ? "bg-ed-select text-white" : "bg-[#3a3a3a] hover:bg-[#4a4a4a]"}`}
              >
                {t === "aerial" ? "Aerial" : "Street"}
              </button>
            ))}
            <button onClick={() => setCollapsed(!collapsed)} className="ml-1 w-4 text-ed-dim hover:text-white" title="Collapse">
              {collapsed ? "▾" : "▴"}
            </button>
          </div>
        </div>
        {!collapsed && (
          <div className="relative min-h-0 flex-1 bg-black">
            {tab === "aerial" && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={aerial} alt={`Aerial photo around ${label}`} className="h-full w-full object-cover" />
                <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-permit shadow" />
                <span className="absolute bottom-0 right-0 bg-black/60 px-1 text-[9px] text-white/80">
                  Imagery: Esri, Maxar, Earthstar Geographics
                </span>
              </>
            )}
            {tab === "street" &&
              (streetEmbed ? (
                <iframe title="Street View" src={streetEmbed} className="h-full w-full border-0" loading="lazy" allowFullScreen />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[11px] text-ed-dim">
                  <p>
                    Set <code className="text-ed-text">NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY</code> to show Street View here.
                  </p>
                  <a href={streetLink} target="_blank" rel="noreferrer" className="rounded bg-ed-select px-3 py-1 text-white">
                    Open in Google Street View ↗
                  </a>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
