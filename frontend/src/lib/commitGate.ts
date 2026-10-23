/** Why the Commit button is disabled, or null when the bid may be submitted (SPEC §7, AC53). */
export function commitBlocker(state: {
  canTransact: boolean;
  inCommitPhase: boolean;
  alreadyCommitted: boolean;
  bidWei: bigint | null;
  salt: string | null;
  acknowledged: boolean;
}): string | null {
  if (!state.inCommitPhase) return "The commit phase is over.";
  if (state.alreadyCommitted) return "You have already committed a bid in this auction.";
  if (!state.canTransact) return "Connect your wallet on the correct network to bid.";
  if (state.bidWei === null || state.bidWei <= 0n) return "Enter a bid amount in ETH.";
  if (!state.salt) return "Generate a salt first.";
  if (!state.acknowledged) return "Confirm that you have saved your domain, bid and salt.";
  return null;
}
