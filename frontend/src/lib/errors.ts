import { Interface } from "ethers";
import abi from "./abi.json";

const iface = new Interface(abi);

const MESSAGES: Record<string, string> = {
  ZeroHash: "Invalid name.",
  NameTaken: "This name is already registered.",
  AuctionActive: "An auction for this name is already running.",
  NotInCommitPhase: "The commit phase is not open for this auction.",
  WrongDeposit: "The deposit amount is wrong.",
  ZeroCommitment: "Invalid commitment.",
  AlreadyCommitted: "You have already committed a bid in this auction.",
  CommitmentUsed: "This commitment was already used. Generate a new salt and try again.",
  NotInRevealPhase: "The reveal phase is not open for this auction.",
  NoCommitment: "This wallet has no commitment in this auction.",
  AlreadyRevealed: "You have already revealed your bid.",
  CommitmentMismatch: "Details don't match your commitment.",
  NotInSettlement: "This auction is not in its settlement period.",
  NotEligible: "This wallet has no eligible bid in this auction.",
  NotYourTurn: "It is not your turn to pay yet (or your window has passed).",
  WrongPayment: "The payment amount is wrong.",
  NotClosed: "This auction is not closed yet.",
  AlreadyFinalised: "This auction was already finalised.",
  NotWithdrawable: "There is no deposit available to withdraw.",
  NothingToWithdraw: "Nothing to withdraw.",
  NotOwner: "You do not own this name.",
  TransferFailed: "The ETH transfer failed.",
};

export interface DecodedError { cancelled: boolean; message: string }

export function decodeError(e: any): DecodedError {
  if (e?.code === "ACTION_REJECTED" || e?.info?.error?.code === 4001 || e?.error?.code === 4001) {
    return { cancelled: true, message: "Transaction cancelled." };
  }
  let name: string | undefined = e?.revert?.name;
  if (!name) {
    const data = e?.data ?? e?.error?.data ?? e?.info?.error?.data;
    if (typeof data === "string" && data.startsWith("0x")) {
      try { name = iface.parseError(data)?.name; } catch { /* unknown selector */ }
    }
  }
  if (name && MESSAGES[name]) return { cancelled: false, message: MESSAGES[name] };
  if (e?.code === "INSUFFICIENT_FUNDS") return { cancelled: false, message: "Insufficient ETH to cover the amount plus gas." };
  return { cancelled: false, message: e?.shortMessage ?? e?.message ?? "Transaction failed." };
}
