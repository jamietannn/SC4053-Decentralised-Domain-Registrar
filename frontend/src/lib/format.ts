import { formatEther, parseEther } from "ethers";

export function shortAddress(address: string | null | undefined): string {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** Format wei as ETH without trailing zeros, e.g. 0.005 ETH. */
export function formatEth(wei: bigint): string {
  const s = formatEther(wei);
  return `${s.endsWith(".0") ? s.slice(0, -2) : s} ETH`;
}

/** Parse a user-entered ETH amount; null if empty, malformed, negative or too precise. */
export function parseEthInput(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  try {
    return parseEther(s.endsWith(".") ? s.slice(0, -1) : s);
  } catch {
    return null;
  }
}

export function formatDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** hh:mm:ss for a non-negative number of seconds. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}
