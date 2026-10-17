/** "Your recent places" for the Ask Ordis sidebar. Per-browser convenience only. */
export interface Place {
  address: string;
  app?: string;
  label: string;
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
