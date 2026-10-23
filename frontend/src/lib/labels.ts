import { isValidDomain, nameHash } from "./domain";

/**
 * Browser-local memory of nameHash → domain for domains this browser has searched or bid on, so auctions
 * can be labelled before any reveal makes the name public on-chain. Only a display convenience: never secret
 * material (salts are not stored anywhere) and safe to lose.
 */
const KEY = "ntu-names:labels";

function load(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function rememberDomain(domain: string): void {
  if (!isValidDomain(domain)) return;
  try {
    const labels = load();
    labels[nameHash(domain)] = domain;
    localStorage.setItem(KEY, JSON.stringify(labels));
  } catch {
    /* storage unavailable: labels are optional */
  }
}

export function knownDomain(hash: string): string | null {
  return load()[hash] ?? null;
}
