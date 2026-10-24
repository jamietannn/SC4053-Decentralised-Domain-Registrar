import { formatEther } from "ethers";

export const shortAddr = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const fmtEth = (wei: bigint) => {
  const s = formatEther(wei);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};
export function countdown(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
export const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" });
export const ZERO = "0x0000000000000000000000000000000000000000";
