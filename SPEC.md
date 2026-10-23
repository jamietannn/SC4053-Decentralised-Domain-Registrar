# NTU Names — Specification

## Context
[README.md](./README.md) and [INITIAL_SPECIFICATION.md](./INITIAL_SPECIFICATION.md) describe a `.ntu` registrar on an Ethereum testnet using a commit–reveal blind auction, but leave the business rules open (auction start, penalties, settlement fallback, tie-break, timings, amounts, salt handling, etc.). This specification resolves those points through a requirements interview with the project owner. Source tags `[Rn]` refer to interview round *n* (R1–R14, listed at the end). Items marked **⚑ REC** are technical recommendations adopted in this spec that were not individually chosen in the interview (see the list near the end).

Where this document conflicts with README.md or INITIAL_SPECIFICATION.md, this document takes precedence (see §10). The implementation is described in [DEVELOPMENT.md](./DEVELOPMENT.md).

Terminology: **domain** = the label being registered (e.g. `alice` for `alice.ntu`). **nameHash** = `keccak256(bytes(domain))`.

---

## 1. Roles and permissions

| Role | Who | Can do |
|---|---|---|
| Anyone | any address | `startAuction`, `finalise`, `withdrawTreasury` (funds go only to the fixed treasury), all view functions [R3, R4] |
| Bidder | address that committed in an auction | `revealBid` and `withdrawDeposit` for **its own** commitment only (keyed by `msg.sender`) [R12] |
| Current offeree | eligible bidder whose rank equals the current settlement window index | `payWinningBid` [R3, R6] |
| Name owner | address that paid for a domain | `setPrimaryName` for domains it owns [spec 2.5] |
| Treasury | fixed address set in the constructor | receives revenue; has **no** other powers [R4] |

There is no owner/admin role, no pause, no dispute or seizure power, and no upgradeability [R4]. Transfers, release, and changing the resolved address are not supported [R5].

## 2. Business rules and domain lifecycle

### 2.1 Domain format [R2]
- Valid domain: 3–32 characters, each `a–z` or `0–9`. No hyphens, uppercase, Unicode, or `.ntu` suffix inside the label.
- The frontend lowercases and trims input, strips a trailing `.ntu`, then validates before hashing. The contract enforces the format **at reveal** (it only sees a hash before that) [R1].
- No reserved or blocked domains [R11].
- Uniqueness: one registration per nameHash, permanently. Canonical-only format means `Alice` and `alice` can't both register.

### 2.2 Auction start [R1, R12, R13]
- Anyone calls `startAuction(nameHash)`. The plaintext domain never appears on-chain before reveal.
- Reverts if nameHash is already registered, or if an auction for that nameHash is in Commit, Reveal, or Settlement.
- If the previous auction for that nameHash is Closed but not finalised, `startAuction` finalises it first (auto-finalise), then opens a new one.
- Restart after a no-winner close is allowed **immediately**, with no cooldown [R4].
- The starter has no special rights and does not need to bid.

### 2.3 Commit [R2, R4, R12, R13]
- `commitment = keccak256(abi.encode(domain /*string*/, bidWei /*uint256*/, salt /*bytes32*/))`. The bidder address is **not** included [R12]. This deviates from INITIAL_SPEC §2.2 by your decision. **⚑ REC:** `abi.encode` (not `encodePacked`), with a 32-byte salt from `crypto.getRandomValues`.
- Each commit pays exactly the fixed deposit (0.005 ETH at deploy) [R2].
- One commitment per address per auction, which can't be changed or cancelled [R4].
- **Copy guard:** a commitment value can be used only once, across all auctions forever. A reused value reverts [R13].
- There's no cap on commits per auction [R11] (this supersedes the cap of 20 from R5).
- Commit order is recorded (`commitIndex`, starting at 0 per auction) for tie-breaking.

### 2.4 Reveal [R3, R13]
- The bidder submits `(domain, bidWei, salt)`. If the recomputed hash ≠ the stored commitment, it reverts and the bidder may retry with the correct values while reveal is open.
- On a match, the reveal is recorded, and the bid is **eligible** only if all three hold:
  1. The domain format is valid.
  2. `keccak256(bytes(domain)) == auction.nameHash`.
  3. `bidWei ≥ minBid` (0.005 ETH).

  Otherwise the bid is recorded as **ineligible** with a reason (`InvalidDomain`, `WrongDomain`, or `BelowMinimum`). An ineligible bidder can't win, and their deposit is withdrawable **immediately** [R3, R9, R13].
- Duplicate reveals revert.
- A bidder who never reveals forfeits the full deposit to the treasury [R2].
- **⚑ REC:** No maximum bid. Absurd bids just default and forfeit their deposit (see §6, griefing).

### 2.5 Ranking and tie-break [R1, R2]
- First-price: the winner pays their own bid.
- Rank eligible bids by `bidWei` descending, ties by `commitIndex` ascending (earliest commit wins). Ranks are unique, starting at 0.

### 2.6 Settlement cascade [R3, R6, R7]
- Let `E` = the number of eligible bids and `S` = the settlement duration. Offer *k* (the bidder at rank *k*) is payable during `[revealDeadline + k·S, revealDeadline + (k+1)·S)`. Windows are derived purely from time, and no transaction is needed to advance them.
- Amount due = `bidWei − deposit` and must be **exact**. It can be 0 when the bid equals the minimum, but the call is still required [R7].
- On payment: the domain is registered to the payer permanently [R1], `resolved = owner` (fixed) [R5], the domain is appended to the owner's list, and it becomes primary automatically if the owner has none [R7].
- Bidders ranked above the payer have defaulted and forfeit their deposits. Bidders ranked below the payer can withdraw their deposits [R3].
- If every offer expires (time ≥ `revealDeadline + E·S`), the auction closes with no winner. All eligible deposits are forfeited, and the name is immediately re-auctionable [R3, R4].

### 2.7 Primary name and resolution [spec 2.5, R5, R7]
- `resolve(domain)` returns the owner, or the zero address if unregistered.
- `reverseResolve(addr)` returns the primary domain, or `""` if none.
- `setPrimaryName(domain)` requires the caller to own it, and replaces the previous primary. Each address has at most one primary.
- There's no renewal, expiry, transfer, or release, so ownership and resolution never change after registration.

## 3. Money flows

Constructor parameters (immutable): `deposit = 0.005 ETH`, `minBid = 0.005 ETH` [R2]. The constructor requires `minBid ≥ deposit > 0`.

| Event | Flow |
|---|---|
| Commit | +deposit held by contract |
| Ineligible reveal | deposit becomes withdrawable by that bidder immediately |
| Winner pays (rank *k*) | +(bid − deposit). `treasuryBalance += bid + k·deposit + (commitCount − revealCount)·deposit`. Lower-ranked eligible deposits become withdrawable. |
| Closed, no winner (finalise) | `treasuryBalance += (commitCount − ineligibleCount)·deposit`, which covers non-revealers plus all defaulted eligible bidders |
| `withdrawDeposit` | pull-payment of exactly `deposit` to the bidder, once |
| `withdrawTreasury` | anyone triggers it; sends the whole accrued `treasuryBalance` to the fixed treasury address. It never touches deposits that are still held or refundable [R4] |

- Payments are in ETH only, with no fees beyond these.
- Accounting never uses `address(this).balance`.
- The contract has no `receive`/`fallback`, so plain ETH sends to it revert.
- Send ETH to a name is a direct wallet transfer and never passes through the contract [R8].

## 4. Smart contract architecture and public interface

A single non-upgradeable contract, `NtuNames` [R10]. Built with Hardhat and TypeScript tests, and the frontend uses ethers v6 [R6].
**⚑ REC:** Solidity `0.8.24`, OpenZeppelin `ReentrancyGuard`, custom errors.

**Constructor**
`(uint64 commitDuration, uint64 revealDuration, uint64 settlementDuration, uint256 deposit, uint256 minBid, address treasury)` [R3].
- Deploy values are 180 s / 180 s / 180 s / 0.005 / 0.005, and the treasury is given by the deployer.
- Reverts if any duration is 0, `deposit == 0`, `minBid < deposit`, or `treasury == 0`.

**Phase enum:** `None, Commit, Reveal, Settlement, Settled, Closed`.

Phase is derived in this order:
1. Not existing → `None`.
2. Settled → `Settled`.
3. `now < commitDeadline` → `Commit`.
4. `commitCount == 0` → `Closed` [R13].
5. `now < revealDeadline` → `Reveal`.
6. `E == 0` → `Closed`.
7. `now < revealDeadline + E·S` → `Settlement`.
8. Otherwise → `Closed`.

### State-changing functions
| Function | Access | Preconditions (revert error) | Effects / returns | Events |
|---|---|---|---|---|
| `startAuction(bytes32 nameHash) → uint256 auctionId` | anyone | `nameHash≠0` (`ZeroHash`); not registered (`NameAlreadyRegistered`); no live auction (`AuctionActive`) | auto-finalise a stale Closed auction; ids start at 1; `commitDeadline = now+C`, `revealDeadline = commitDeadline+R` | `AuctionStarted(id, nameHash, starter, commitDeadline, revealDeadline)` |
| `commitBid(uint256 auctionId, bytes32 commitment)` payable | anyone | phase Commit (`NotInCommitPhase`); `msg.value==deposit` (`WrongDeposit`); `commitment≠0` (`ZeroCommitment`); no prior commit by sender (`AlreadyCommitted`); commitment unused (`CommitmentUsed`) | store bid with `commitIndex`; mark the commitment used | `BidCommitted(id, bidder, commitment, commitIndex)` |
| `revealBid(uint256 auctionId, string domain, uint256 bid, bytes32 salt)` | committed bidder | phase Reveal (`NotInRevealPhase`); has commit (`NoCommitment`); not revealed (`AlreadyRevealed`); hash matches (`CommitmentMismatch`) | record bid, eligibility, reason; eligible → append to the eligible list and store the domain string | `BidRevealed(id, bidder, domain, bid, eligible, reason)` |
| `payWinningBid(uint256 auctionId)` payable | current offeree | phase Settlement (`NotInSettlement`); caller eligible (`NotEligible`); caller rank == current window index (`NotYourTurn`); `msg.value == bid−deposit` (`WrongPayment`) | settle, register, resolve, append to list, auto-primary, accrue treasury, finalised | `NameRegistered(nameHash, domain, owner, id, price)`, `AuctionSettled(id, winner, price, rank)`, optional `PrimaryNameSet(owner, domain)` |
| `finalise(uint256 auctionId)` | anyone | phase Closed (`NotClosed`); not finalised (`AlreadyFinalised`) | accrue forfeits; clear the active auction | `AuctionClosed(id, nameHash, forfeitedWei)` |
| `withdrawDeposit(uint256 auctionId)` | bidder | revealed and not withdrawn, and either ineligible, or settled and ranked below the winner (`NotWithdrawable`) | `withdrawn=true` then send the deposit (CEI + `nonReentrant`; reverts on send failure) | `DepositWithdrawn(id, bidder, amount)` |
| `withdrawTreasury()` | anyone | `treasuryBalance>0` (`NothingToWithdraw`) | zero the balance then send to the treasury (`nonReentrant`) | `TreasuryWithdrawn(treasury, amount)` |
| `setPrimaryName(string domain)` | name owner | caller owns the domain (`NotOwner`) | replace primary | `PrimaryNameSet(owner, domain)` |

The rank check is O(n) over the eligible list, done only in `payWinningBid` [R11]. Below-winner checks in `withdrawDeposit` are O(1): compare `(bid, commitIndex)` with the winner's.

### View functions (no access control)
- `resolve(string) → address`
- `ownerOf(string) → address`
- `domainOf(bytes32) → string`
- `reverseResolve(address) → string`
- `namesOf(address) → string[]`
- `activeAuctionOf(bytes32) → uint256` (0 = none)
- `getAuction(uint256) → (nameHash, starter, commitDeadline, revealDeadline, commitCount, revealCount, eligibleCount, settled, finalised, winner, winningBid, phase)`
- `phaseOf(uint256) → Phase`
- `getBid(uint256, address) → (commitment, commitIndex, revealed, eligible, reason, bid, withdrawn)`
- `rankOf(uint256, address) → (rank, windowStart, windowEnd)` (reverts if not eligible)
- `currentOfferee(uint256) → address`
- `amountDue(uint256, address) → uint256`
- `canWithdraw(uint256, address) → bool`
- `isCommitmentUsed(bytes32) → bool`
- Public immutables: durations, `deposit`, `minBid`, `treasury`, plus `treasuryBalance`

There's no on-chain `makeCommitment` helper. The frontend computes commitments locally so the plaintext is never sent to an RPC.

## 5. State machine

**Domain** (per nameHash): `Available → InAuction` (startAuction) `→ Registered` (payWinningBid, terminal). `InAuction → Available` happens when the auction reaches Closed.

**Auction**: `Commit → Reveal` (time). `Commit → Closed` (time, zero commits). `Reveal → Closed` (time, E = 0). `Reveal → Settlement` (time, E > 0). `Settlement → Settled` (offeree pays). `Settlement → Closed` (time ≥ revealDeadline + E·S). `Closed → finalised` (finalise or auto-finalise on restart). Settled and Closed are terminal, and an auction can be settled at most once.

**Bid** (per bidder per auction): `Committed → Revealed(eligible|ineligible)`, or `Committed → Unrevealed` (forfeited). Ineligible → Withdrawn (any time). Eligible → Winner, Defaulted (forfeit), or Refundable → Withdrawn.

Boundaries are half-open [R6]. At `now == commitDeadline` a commit reverts and a reveal is accepted. At `now == revealDeadline` a reveal reverts and offer 0 opens. At `now == revealDeadline + k·S` offer *k−1* has expired and offer *k* is live.

## 6. Security, trust assumptions, failure handling

- **Commit privacy:** commit transactions contain only `auctionId` and the commitment, with no domain or bid. The domain is visible on-chain only as a hash until the first eligible reveal, and common domains can be dictionary-guessed (accepted) [R1].
- **Copied or front-run commitments:** the global used-commitment guard stops a copier from reusing someone's commitment. A front-runner can at most make the victim's commit revert (gas only). The victim recommits with a fresh salt, and the copier can't reveal and forfeits their deposit [R13].
- **Reveal front-running:** a reveal is accepted only from the committing address, and the tie-break uses commit order, so copying a reveal from the mempool gives no advantage.
- **Salt reuse:** if a user reuses (domain, bid, salt), the guard rejects the second commit. The frontend always generates a fresh salt.
- **Reentrancy:** only `withdrawDeposit` and `withdrawTreasury` send ETH. Both use CEI and `nonReentrant`. `payWinningBid` makes no external calls.
- **DoS:** with no commit cap, reveal costs O(1) and the O(n) rank scan happens only at pay [R11]. Known limitation: griefers can make high eligible bids and default. Each one delays settlement by S and costs the griefer their deposit (accepted).
- **Squatting:** the defence is the auction plus a 0.005 ETH minimum bid. No reserved list [R11].
- **Forced ETH** (selfdestruct or coinbase) doesn't affect accounting.
- **Timestamps:** validator skew of a few seconds is accepted at testnet scale.
- **Trust:** the chain is Sepolia (local Hardhat node for development) [R6]. No oracles, and no backend. Reads go through `VITE_RPC_URL`. If the RPC fails, a "Network unavailable" banner shows and actions are disabled [R10]. The CoinGecko SGD rate is display-only.
- **Transaction failures:** the UI decodes custom errors into readable messages. Pending state shows the hash, and success is shown only after a mined receipt with status 1 (**⚑ REC:** 1 confirmation). A wallet rejection is shown as "cancelled", not as an error.

## 7. Frontend requirements (React + Vite + ethers v6, local dev server only) [R6, R11]

- **Wallet:** MetaMask connect (template slides 4–6). Shows the account and network, and never asks for keys. On the wrong chain, transaction buttons are disabled and a "Switch to Sepolia" button calls `wallet_switchEthereumChain` (chain 11155111, or 31337 locally) [R9].
- **Read-only without wallet:** search and resolve work through the configured RPC [R10].
- **Search** has a **By domain | By address** toggle. The mode is kept in the URL (`?by=address&q=0x…`), and switching mode clears the query [R14].
  - **By domain** (exact match only) [R8]: normalise and validate, then compute nameHash. It shows one of:
    - Invalid (with the rule)
    - Available (Start auction)
    - In auction (phase, deadlines, countdown; Commit / Reveal / Pay / Finalise shown only when the contract state allows)
    - Registered (owner and resolved address)
  - **By address** (reverse resolution) [R14]: the input must be `0x` followed by 40 hex characters, and a mixed-case address must have a valid checksum. Otherwise a validation error is shown and no RPC call is made. A valid address is looked up with `reverseResolve` and shows the checksummed address and its primary domain (e.g. `alice.ntu`, with a Primary badge), or "This address has no primary .ntu domain." It works read-only, without a wallet.
- **Dashboard** (slide 7): the user's names (`namesOf`) and auctions they bid in (from `BidCommitted` events filtered by bidder), grouped by phase with countdowns. Countdowns are a display aid only, and the contract is authoritative.
- **Commit** (slides 14–17):
  1. Enter the bid in ETH. Client-side check: bid ≥ 0.005, or show a warning that it would be ineligible.
  2. Show the SGD estimate (see **SGD estimates** below) [R8].
  3. Generate the salt and display domain, bid, and salt with copy buttons.
  4. A mandatory "I have saved my domain, bid and salt" checkbox unlocks submission.
  5. Submit with the exact deposit.

  The salt is not stored anywhere by the app [R7]. A warning explains that losing the salt or not revealing forfeits the deposit.
- **SGD estimates** [R8, R14]: every ETH input field (Commit bid, Reveal bid, Send ETH amount) shows "≈ X SGD estimate (indicative only) · rate from CoinGecko at <time>" while the user types. The rate is one app-wide CoinGecko fetch, refreshed every 60 s and shared by all fields. If the fetch fails or the rate is older than 10 minutes, the field shows "SGD estimate unavailable". The estimate is display-only and never changes the ETH amount sent.
- **Reveal** (slide 18): the user types the domain, bid, and salt. Before sending, the frontend recomputes the commitment and compares it with `getBid().commitment`. On a mismatch it shows "Details don't match your commitment" and sends nothing. It also warns if the reveal will be ineligible.
- **Result / Pay** (slides 19–20): shows rank, amount due, and the offer window. "Pay" is enabled only when `currentOfferee == me`, then a confirmation is shown.
- **Loser / Withdraw** (slides 21–22): explains when the deposit becomes available. "Withdraw deposit" is enabled only when `canWithdraw` is true.
- **Finalise:** a button on closed, unfinalised auctions (permissionless).
- **My Domains** (slide 9): lists names and resolved addresses. "Set primary" appears only on owned names, and the current primary is marked.
- **Send ETH** (slides 10–12): input a `.ntu` domain or a 0x address and an amount (**no message field**) [R9]. Domain input is resolved, and an unregistered domain is blocked with "not registered". A review screen shows the domain, resolved address, amount, network, and wallet fee estimate. Then a direct wallet transfer, and the confirmation shows the transaction hash [R8].
- **History** (slide 13): contract events involving the connected address (AuctionStarted as starter, BidCommitted, BidRevealed, NameRegistered, AuctionSettled, DepositWithdrawn, PrimaryNameSet), plus this session's pending transactions. Direct ETH sends are not listed [R8, R9].
- **Demo mode** (`?demo=1` or `VITE_DEMO=1`): read-only browse of all screens with fixed sample data and a permanent "DEMO DATA – not on-chain" banner. No wallet is needed, and every transaction button is disabled [R9, R10].

## 8. Acceptance criteria (Given / When / Then)

Defaults: C = R = S = 180 s, D = minBid = 0.005 ETH, and `h = keccak256("alice")`. Each criterion maps to at least one Hardhat test (no coverage % target) [R10]. Frontend encoding and validation get unit tests, plus a manual Sepolia checklist.

**Deployment**
1. Given constructor `minBid < deposit`, when deploying, then it reverts.
2. Given any duration of 0, a deposit of 0, or a zero treasury, when deploying, then it reverts.

**Start auction**

3. Given `h` is unregistered with no auction, when anyone calls `startAuction(h)`, then auction 1 has `commitDeadline = t+180` and `revealDeadline = t+360`, `AuctionStarted` is emitted, and the phase is Commit.
4. Given a live auction for `h` (Commit, Reveal, or Settlement), when `startAuction(h)` is called, then it reverts `AuctionActive`.
5. Given `h` is registered, when `startAuction(h)` is called, then it reverts `NameAlreadyRegistered`.
6. Given `startAuction(0x0)`, then it reverts `ZeroHash`.
7. Given an auction for `h` that is Closed and not finalised, when `startAuction(h)` is called, then the old auction is finalised (forfeits accrued, `AuctionClosed` emitted) and a new auction id is created in the same transaction.

**Commit**

8. Given phase Commit, when a bidder commits with `msg.value = D`, then the bid is stored with the next `commitIndex`, the commitment is marked used, and `BidCommitted` is emitted.
9. Given `msg.value ≠ D`, it reverts `WrongDeposit`.
10. Given `now == commitDeadline`, it reverts `NotInCommitPhase`.
11. Given the same address commits twice in an auction, the second reverts `AlreadyCommitted`.
12. Given commitment X is already used in any auction, when another address (or the same address in another auction) commits X, it reverts `CommitmentUsed`.
13. Given commitment `0x0`, it reverts `ZeroCommitment`.
14. Given a front-runner commits Alice's X first, when Alice's commit of X is mined, it reverts. Then Alice can commit a fresh X′ successfully, and the front-runner's reveal attempts with guessed values revert `CommitmentMismatch`.
15. Given 100 commits from distinct addresses, all succeed (no cap).
16. Given the commit transaction, its calldata and events contain no plaintext domain or bid.

**Reveal**

17. Given `now == commitDeadline` and a matching reveal, it is accepted.
18. Given `now == revealDeadline`, it reverts `NotInRevealPhase`.
19. Given a mismatching bid or salt, it reverts `CommitmentMismatch`, and a later correct reveal before the deadline succeeds.
20. Given an address with no commit, it reverts `NoCommitment`.
21. Given an already revealed bid, it reverts `AlreadyRevealed`.
22. Given `bid = 0.004`, the reveal is recorded as ineligible `BelowMinimum` and `canWithdraw` is true immediately.
23. Given the domain `Alice`, `al`, a 33-character domain, or `al-ice` (matching commitment), it is ineligible `InvalidDomain`.
24. Given the domain `bob` revealed in the auction for `h`, it is ineligible `WrongDomain` and refundable immediately.
25. Given `bid = 0.005` exactly with a valid domain, it is eligible.
26. Given a 3-character domain and a 32-character domain, both are eligible.

**Ranking and settlement**

27. Given eligible bids A = 0.03, B = 0.02, C = 0.01, at `now == revealDeadline` the phase is Settlement and `currentOfferee == A`.
28. Given A and B both bid 0.02 and B committed first, then B has rank 0.
29. Given offer 0, when B (rank 1) calls `payWinningBid`, it reverts `NotYourTurn`.
30. Given A pays `0.03−0.005 = 0.025` exactly during `[rd, rd+S)`, then the domain is registered to A, `resolve("alice") == A`, `namesOf(A)` includes alice, `reverseResolve(A) == "alice"` if A had no primary, and the events fire.
31. Given A sends 0.026 or 0.024, it reverts `WrongPayment`.
32. Given bid = 0.005, the winner calls with `value = 0`, and it succeeds.
33. Given `now == rd+S` with A unpaid, A's call reverts `NotYourTurn` and B is the offeree. B pays 0.015, and then A's deposit is forfeited, while C and earlier-ineligible bidders can withdraw.
34. Given 3 eligible bids and nobody pays, at `now == rd+3S` the phase is Closed. `finalise` accrues `(commitCount − ineligibleCount)·D`, and `startAuction(h)` succeeds.
35. Given a settled auction, a second `payWinningBid` reverts `NotInSettlement`.
36. Given a non-eligible or non-revealing address calls `payWinningBid`, it reverts `NotEligible`.

**Closure and edge cases**

37. Given zero commits, at `now == commitDeadline` the phase is Closed, and `startAuction(h)` succeeds immediately.
38. Given commits but zero eligible reveals, at `now == revealDeadline` the phase is Closed, and `finalise` accrues the non-revealer deposits.
39. Given a Closed auction, a second `finalise` reverts `AlreadyFinalised`. Given a non-Closed auction, `finalise` reverts `NotClosed`.

**Deposits and treasury**

40. Given bidder X never revealed, `withdrawDeposit` reverts `NotWithdrawable` forever, and X's deposit appears in `treasuryBalance` after settlement or finalise.
41. Given a refundable bidder, the first withdraw sends exactly D and the second reverts `NotWithdrawable`.
42. Given a winner, or a defaulted bidder ranked above the winner, `withdrawDeposit` reverts.
43. Given a refundable bidder contract that re-enters `withdrawDeposit` in its receive function, the re-entry reverts and only one D is paid.
44. Given winner rank k with N non-revealers, `treasuryBalance` increases by `bid + k·D + N·D`.
45. Given `treasuryBalance > 0`, anyone calls `withdrawTreasury` and the treasury receives the full amount. A second call reverts `NothingToWithdraw`.
46. Accounting invariant (checked after each test): `contract balance == treasuryBalance + Σ(unwithdrawn deposits still held or refundable)`.
47. Given a plain ETH send to the contract, it reverts.

**Names, primary, resolution**

48. Given A owns alice and later wins bob, the primary stays alice. `setPrimaryName("bob")` switches it, and `reverseResolve(A) == "bob"`.
49. Given B calls `setPrimaryName("alice")` (owned by A), it reverts `NotOwner`.
50. Given an unregistered domain, `resolve` returns `0x0`. Given an address with no primary, `reverseResolve` returns `""`.

**Frontend**

51. Given the frontend computes a commitment for (domain, bid, salt), it equals the value the contract computes (shared test vectors).
52. Given the wallet is on the wrong chain, all transaction buttons are disabled and the switch prompt appears. Search still works.
53. Given the commit form, the submit button stays disabled until the save acknowledgement is ticked.
54. Given reveal inputs that don't match the on-chain commitment, the UI shows an error and sends no transaction.
55. Given a CoinGecko failure or a rate older than 10 minutes, the screen shows "SGD estimate unavailable".
56. Given Send ETH to an unregistered domain, the review step is blocked with "not registered".
57. Given demo mode, the banner is always visible and no transaction can be sent.
58. Given an RPC failure, the "Network unavailable" banner shows and actions are disabled.
59. Given a fresh CoinGecko rate, when an amount is typed into the Reveal bid or Send ETH amount field, an SGD estimate with the rate's time is shown (as on the Commit bid field).
60. Given a CoinGecko failure or a rate older than 10 minutes, the Commit bid, Reveal bid and Send ETH amount fields all show "SGD estimate unavailable".
61. Given Search by address for an address whose primary is `alice`, the result shows `alice.ntu` as its primary name.
62. Given Search by address for an address with no primary, the result shows "This address has no primary .ntu domain."
63. Given Search by address with a malformed or bad-checksum address, a validation error is shown and no lookup is made.

## 9. Out of scope (v1)

- Renewal and expiry
- Transfers, NFTs, and release
- Changing the resolved address
- Admin, pause, dispute, and upgradeability
- Reserved names, premium pricing, and fees
- Subdomains and Unicode domains
- Salt storage, export, or auto-fill
- On-chain or attached messages in Send ETH
- Search suggestions
- SGD estimates on read-only amounts (deposit, amount due, final price) and in History
- Showing reverse-resolved names outside Search (header, owner and winner fields)
- Etherscan-based history and listing direct sends in history
- A backend
- Public hosting
- Mainnet
- E2E (Playwright) tests and coverage targets
- A simulated-flow demo mode
- The AI-audit-report items from the source PDF

## 10. Deviations from source documents (traceability)

- INITIAL_SPEC §2.2 includes the bidder address in the commitment. **Excluded**, per R12, and mitigated by the copy guard (R13).
- INITIAL_SPEC §2.1 records the domain at auction creation. **Only the nameHash** is recorded (R1, R13).
- Slide 18's "ideally auto-filled" reveal is replaced by **manual entry** (R7).
- Slide 10's message field is **removed** (R9).
- Slide 8's close-match list is **dropped** (R8).
- INITIAL_SPEC §2.3 "reject invalid reveals": hash mismatches still revert. Matching but ineligible reveals are accepted and refundable (R3, R13).
- The R5 cap of 20 commits is **superseded** by no cap (R11).

## 11. Open questions

None.

## Technical recommendations adopted (not individually chosen in the interview)

1. `abi.encode` encoding and a 32-byte `crypto.getRandomValues` salt.
2. Solidity 0.8.24, OpenZeppelin ReentrancyGuard, and custom errors.
3. Function, event, and error names as listed.
4. No maximum bid.
5. Auto-finalise inside `startAuction`.
6. The O(1) below-winner check for withdrawals.
7. One confirmation counts as success.
8. The frontend pre-checks the commitment before reveal.
9. Deploy values of 180 s per phase.
10. Auction ids start at 1, and 0 means none.

## Interview rounds (source tags)

- **R1:** hash-started auction, first-price, permanent, deposit credited.
- **R2:** a-z0-9 3–32, 0.005/0.005, full forfeit to treasury, earliest-commit tie-break.
- **R3:** cascade to runner-up, constructor durations, derived + permissionless finalise, ineligible-but-refundable reveals.
- **R4:** one immutable commit per address, cap (superseded), fixed treasury with no admin, immediate restart.
- **R5:** no transfer, fixed resolver, no release, cap 20 (superseded).
- **R6:** half-open boundaries, back-to-back derived windows, Sepolia, Hardhat + React/Vite + ethers.
- **R7:** encoding (tuple superseded by R12), manual salt, exact payment, auto-primary.
- **R8:** direct send, events-only history, CoinGecko, exact search.
- **R9:** remove message field, immediate ineligible refund, mock mode, block and switch on wrong network.
- **R10:** configured RPC without wallet, single contract, G/W/T tests without a % target, read-only demo.
- **R11:** no cap with rank-by-scan, no reserved names, local hosting.
- **R12:** start step plus `hash(domain, bid, salt)` without the bidder.
- **R13:** start takes a hash, copy guard, wrong domain refundable, empty auction closes at commitDeadline.
- **R14:** SGD estimate on every ETH input via one shared 60 s CoinGecko rate; Search by address (explicit toggle, strict checksum validation, primary name or "no primary"). UI text says "domain", never "name" (product name: NTU Domains).
