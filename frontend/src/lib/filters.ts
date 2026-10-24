// Event filters used by the UI. ethers matches filter arguments by *parameter position* (non-indexed
// parameters must be null), so these live in one place and are tested against the real contract.
import type { Contract } from "ethers";

/** NameRegistered(bytes32 indexed nameHash, string domain, address indexed owner, uint256 indexed id, uint256 price) */
export const nameRegisteredBy = (c: Contract, owner: string) => c.filters.NameRegistered(null, null, owner);

/** BidCommitted(uint256 indexed id, address indexed bidder, ...) */
export const bidCommittedBy = (c: Contract, bidder: string) => c.filters.BidCommitted(null, bidder);

/** Every event that involves `account`, for the transaction history. */
export const historyFilters = (c: Contract, account: string) => [
  c.filters.AuctionStarted(null, null, account),
  c.filters.BidCommitted(null, account),
  c.filters.BidRevealed(null, account),
  nameRegisteredBy(c, account),
  c.filters.AuctionSettled(null, account),
  c.filters.DepositWithdrawn(null, account),
  c.filters.PrimaryNameSet(account),
];
