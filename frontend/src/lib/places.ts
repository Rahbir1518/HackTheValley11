"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { API_URL } from "@/lib/api";
import { clerkEnabled } from "@/lib/auth-config";

/** A place the resident looked at. Signed in, places live on the server (shared with the mobile
 *  app) and can be watched; signed out, they stay in this browser only. */
export interface Place {
  address: string;
  app?: string;
  label: string;
  watched?: boolean;
  /** Watched places: what changed since last seen (status, a new community meeting). */
  changes?: string[];
  status?: string | null;
  next_meeting?: string | null;
}

const KEY = "ordis.places";

export function loadPlaces(): Place[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function rememberPlace(p: Place) {
  try {
    const rest = loadPlaces().filter((x) => x.address !== p.address);
    localStorage.setItem(KEY, JSON.stringify([p, ...rest].slice(0, 6)));
  } catch {
    // storage unavailable (private mode); recent places are optional
  }
}

type TokenGetter = () => Promise<string | null>;
const useClerkToken = (): TokenGetter => useAuth().getToken;
const noToken: TokenGetter = async () => null;
const useNoToken = (): TokenGetter => noToken;
/** Chosen once: the Clerk provider is only mounted when Clerk keys are configured. */
const useTokenGetter = clerkEnabled ? useClerkToken : useNoToken;

interface ServerPlace {
  address: string;
  app_number: string | null;
  label: string | null;
  watched: boolean;
  changes: string[];
  status?: string | null;
  next_meeting?: string | null;
}

const fromServer = (p: ServerPlace): Place => ({
  address: p.address,
  app: p.app_number ?? undefined,
  label: p.label ?? "",
  watched: p.watched,
  changes: p.changes,
  status: p.status,
  next_meeting: p.next_meeting,
});

/** Saved places: synced through the API when signed in, browser storage otherwise. */
export function usePlaces() {
  const getToken = useTokenGetter();
  const [places, setPlaces] = useState<Place[]>([]);
  const [synced, setSynced] = useState(false);

  /** null when signed out or the API refuses (then the browser list is used). */
  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      try {
        const token = await getToken();
        const r = await fetch(`${API_URL}${path}`, {
          ...init,
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        return r.ok ? r.json() : null;
      } catch {
        return null;
      }
    },
    [getToken],
  );

  const refresh = useCallback(async () => {
    const data = await call("/api/me/places");
    setSynced(!!data);
    setPlaces(data ? (data.places as ServerPlace[]).map(fromServer) : loadPlaces());
  }, [call]);

  useEffect(() => {
    let cancelled = false;
    call("/api/me/places").then((data) => {
      if (cancelled) return;
      setSynced(!!data);
      setPlaces(data ? (data.places as ServerPlace[]).map(fromServer) : loadPlaces());
    });
    return () => {
      cancelled = true;
    };
  }, [call]);

  const save = useCallback(
    async (p: Place, watched?: boolean) => {
      rememberPlace(p); // also kept in this browser
      await call("/api/me/places", { method: "POST", body: JSON.stringify({ address: p.address, app_number: p.app ?? null, label: p.label, watched }) });
      await refresh();
    },
    [call, refresh],
  );

  return {
    places,
    /** Signed in and stored on the server (watching is available). */
    synced,
    remember: (p: Place) => save(p),
    setWatched: (p: Place, on: boolean) => save(p, on),
    markSeen: async (address: string) => {
      await call("/api/me/places/seen", { method: "POST", body: JSON.stringify({ address }) });
      await refresh();
    },
    remove: async (address: string) => {
      await call(`/api/me/places?address=${encodeURIComponent(address)}`, { method: "DELETE" });
      await refresh();
    },
  };
}
