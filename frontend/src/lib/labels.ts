// Convenience cache mapping nameHash -> domain label (the contract only knows hashes before reveal).
// This holds public names only. Salts and bids are never stored by the app (SPEC.md §7).
import { nameHash } from "./domain";

const KEY = "ntu-names.labels";

function load(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}

export function rememberLabel(domain: string) {
  try {
    const m = load();
    m[nameHash(domain)] = domain;
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch { /* storage unavailable */ }
}

export const labelFor = (hash: string): string | undefined => load()[hash];
