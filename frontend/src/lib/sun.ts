import * as SunCalc from "suncalc";

// Toronto City Hall; the whole scene is within a few hundred metres so one location is fine.
export const TORONTO = { lat: 43.6535, lon: -79.3841 };

/** Offset (minutes) of America/Toronto from UTC at a given instant, e.g. -240 in summer. */
function torontoOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value; // "GMT-4"
  const m = parts?.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!m) return -300;
  const h = parseInt(m[1], 10);
  return h * 60 + Math.sign(h) * parseInt(m[2] ?? "0", 10);
}

/** A date string (YYYY-MM-DD) + minutes after midnight, interpreted as Toronto local time. */
export function torontoInstant(date: string, minutes: number): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, 0, minutes));
  const offset = torontoOffsetMinutes(guess);
  return new Date(guess.getTime() - offset * 60_000);
}

export interface Sun {
  altitudeDeg: number;
  azimuthDeg: number; // compass bearing, 0 = north, 90 = east
  /** Unit vector pointing at the sun in three.js scene space (x = east, y = up, z = south). */
  direction: [number, number, number];
  up: boolean;
}

export function sunAt(instant: Date): Sun {
  // suncalc 2.x returns degrees: altitude above the horizon, azimuth as a compass bearing.
  const { altitude, azimuth } = SunCalc.getPosition(instant, TORONTO.lat, TORONTO.lon);
  const alt = (altitude * Math.PI) / 180;
  const az = (azimuth * Math.PI) / 180;
  const east = Math.sin(az) * Math.cos(alt);
  const north = Math.cos(az) * Math.cos(alt);
  // glTF export maps Blender (x east, y north, z up) to three (x, z up, -y), so north = -z.
  return {
    altitudeDeg: altitude,
    azimuthDeg: azimuth,
    direction: [east, Math.sin(alt), -north],
    up: altitude > 0,
  };
}

export function sunTimes(date: string) {
  const noon = torontoInstant(date, 12 * 60);
  const t = SunCalc.getTimes(noon, TORONTO.lat, TORONTO.lon);
  // Toronto always has a sunrise and sunset; the fallbacks only satisfy the types.
  return {
    sunrise: t.sunrise ?? torontoInstant(date, 6 * 60),
    sunset: t.sunset ?? torontoInstant(date, 18 * 60),
  };
}

export function formatToronto(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function minutesOfDayToronto(d: Date) {
  // Explicit 24-hour clock: en-CA formats as "06:30 p.m." by default, which would not parse.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}
