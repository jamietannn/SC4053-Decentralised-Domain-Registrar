import { Interface } from "ethers";
import abi from "../generated/NtuNames.abi.json";

const iface = new Interface(abi);

/** Plain-language messages for NtuNames custom errors. */
export const CONTRACT_ERROR_MESSAGES: Record<string, string> = {
  InvalidConfig: "The contract was deployed with invalid parameters.",
  ZeroHash: "Invalid domain hash.",
  NameAlreadyRegistered: "This domain is already registered.",
  AuctionActive: "An auction for this domain is already running.",
  NotInCommitPhase: "The commit phase for this auction is over (or has not started).",
  WrongDeposit: "The deposit amount is wrong.",
  ZeroCommitment: "Invalid commitment.",
  AlreadyCommitted: "You have already committed a bid in this auction.",
  CommitmentUsed: "This commitment has already been used. Generate a new salt and try again.",
  NotInRevealPhase: "This auction is not in its reveal phase.",
  NoCommitment: "This wallet has no commitment in this auction.",
  AlreadyRevealed: "You have already revealed this bid.",
  CommitmentMismatch: "The domain, bid and salt do not match your commitment.",
  NotInSettlement: "This auction is not in settlement.",
  NotEligible: "You do not have an eligible bid in this auction.",
  NotYourTurn: "It is not your settlement window.",
  WrongPayment: "The payment amount must equal your bid minus the deposit.",
  NotClosed: "This auction has not closed yet.",
  AlreadyFinalised: "This auction has already been finalised.",
  NotWithdrawable: "Nothing is withdrawable for you in this auction.",
  NothingToWithdraw: "The treasury balance is zero.",
  TransferFailed: "The ETH transfer failed.",
  NotOwner: "You do not own this domain.",
};

export type DescribedError = { cancelled: boolean; message: string };

function findRevertData(err: unknown): string | null {
  const seen = new Set<unknown>();
  const stack: unknown[] = [err];
  while (stack.length) {
    const e = stack.pop();
    if (!e || typeof e !== "object" || seen.has(e)) continue;
    seen.add(e);
    const data = (e as { data?: unknown }).data;
    if (typeof data === "string" && /^0x[0-9a-fA-F]{8}/.test(data)) return data;
    for (const key of ["error", "info", "cause", "data"]) stack.push((e as Record<string, unknown>)[key]);
  }
  return null;
}

/** Turn wallet / RPC / contract errors into one readable sentence. */
export function describeError(err: unknown): DescribedError {
  const e = err as { code?: unknown; info?: { error?: { code?: unknown } }; revert?: { name?: string } } | null;
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001 || e?.info?.error?.code === 4001)
    return { cancelled: true, message: "You cancelled the request in your wallet." };

  let name = e?.revert?.name;
  if (!name) {
    const data = findRevertData(err);
    if (data) {
      try {
        name = iface.parseError(data)?.name;
      } catch {
        /* not one of ours */
      }
    }
  }
  if (name && CONTRACT_ERROR_MESSAGES[name]) return { cancelled: false, message: CONTRACT_ERROR_MESSAGES[name] };

  if (e?.code === "INSUFFICIENT_FUNDS") return { cancelled: false, message: "Your wallet has insufficient ETH." };
  if (e?.code === "NETWORK_ERROR" || e?.code === "SERVER_ERROR" || e?.code === "TIMEOUT")
    return { cancelled: false, message: "The network is unavailable. Please try again." };
  const fallback = (err as { shortMessage?: string; message?: string })?.shortMessage ?? (err as Error)?.message;
  return { cancelled: false, message: fallback || "Something went wrong." };
}
