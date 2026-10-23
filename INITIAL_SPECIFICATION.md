# NTU Names — Initial Product and System Specification

This document consolidates the original project specification in [`blockchain.pdf`](./blockchain.pdf) and maps its intended user experience to the screens in [`UI Template.pdf`](./UI%20Template.pdf). It is a planning brief for implementation; it does not claim that the prototype flows or demo data are already implemented or authoritative.

## 1. Project overview

Build **NTU Names**, a decentralized `.ntu` domain registrar and resolution interface. Users should be able to:

- Register available names through a commit–reveal auction.
- Search for a name and inspect its availability, auction phase, owner, or resolved address.
- Manage registered names and designate one name as their primary name.
- Resolve a `.ntu` name to an Ethereum address and send ETH to that address.
- Connect an Ethereum wallet to interact with the application.

The blockchain contract is the authority for auction phases, ownership, resolution, settlement, and refunds. The frontend should present that state and help users submit valid transactions.

## 2. Core functional requirements

### 2.1 Name availability and auction creation

- Reject an auction for a name that is already registered.
- Reject a new auction when that name already has an active auction.
- Create an auction only after the name has passed the availability checks.
- Record the name, auction status, commit deadline, and reveal deadline.
- Start in the commit phase and move to the reveal phase after the commit deadline.
- Show the current phase and relevant time remaining in the interface.

The original specification does not define who may initiate an auction, exact name-validation rules, auction durations, or a minimum bid. Treat these as decisions to resolve before implementation rather than inventing defaults.

### 2.2 Commit phase

- Accept a bidder's commitment only for an initiated auction during its commit phase and before its commit deadline.
- The bidder enters an intended bid amount in ETH. The frontend also displays an estimated SGD equivalent; it is indicative, not an auction value or on-chain amount.
- Generate a random salt/secret for the commitment. The bidder must keep it for the reveal phase.
- Compute a cryptographic commitment from the auction's name, bid amount, salt, and bidder address. The commitment must use one consistent, contract-compatible encoding in both frontend and contract.
- Require a fixed ETH deposit with each commitment. The specification gives **0.005 ETH only as an example**, not a final parameter.
- Store the commitment and deposit separately. Do not store the intended bid amount in plaintext during the commit phase.
- Associate every commitment with its bidder and auction.
- Reject commitments submitted after the commit deadline.
- Explain that losing or failing to reveal may affect the deposit, and prompt users to save their salt before committing.

### 2.3 Reveal phase

- Accept reveals only after the commit deadline and before the reveal deadline.
- Require the bidder to submit the same name, bid amount, and salt used to create the commitment.
- Recalculate and verify the commitment, including the bidder identity and relevant auction.
- Reject a reveal that does not match the stored commitment, and reject duplicate reveals.
- Record each valid revealed bid and update the highest valid bid and bidder when a higher valid bid is revealed.
- Track whether each bidder revealed so that the contract can apply the specified non-reveal consequences.

### 2.4 Settlement, payment, and deposits

- After the reveal deadline, determine the highest valid revealed bid as the provisional winner.
- Require the provisional winner to pay the full winning bid in ETH within a predefined settlement period.
- Register the name to the winner only after the full winning payment has been received.
- Record the winning bid and final auction status. Account for the winning payment according to the auction rules.
- After the winner pays, make deposits from eligible unsuccessful bidders with valid reveals available for withdrawal.
- Apply a predefined penalty to bidders who do not reveal.
- If the provisional winner does not pay in time, apply the predefined penalty and follow a fallback procedure, such as offering the name to the next-highest valid bidder or restarting the auction.
- If there are no valid revealed bids, close the auction without a winner and leave the name unregistered.
- Prevent an auction from being settled more than once.
- Make eligible withdrawals claimable through a user action; do not rely on sending refunds to many addresses in one transaction.

The original specification does not settle the exact penalty, winner-deposit treatment, fallback ordering, tie-breaking, or the precise point at which losing bidders can withdraw if the winner defaults. Resolve these rules before implementing settlement.

### 2.5 Name ownership and resolution

Maintain enough contract state to support:

- Name → owner address.
- Name → resolved address. Initially set a successfully registered name's resolved address to its owner's address.
- Owner address → list of names owned by that address.
- Owner address → primary name, if one has been designated.
- Auction details, deadlines, status, current highest valid bid/bidder, and settlement status.
- Per-bidder commitment, deposit, reveal status, revealed bid after successful verification, and refund/penalty status.

Required behavior:

- On successful payment and settlement, assign the name to the winning address, add it to that owner's name list, and initialize its resolved address to the owner.
- Allow the name owner to designate one of their registered names as their primary name.
- Verify ownership when changing the primary name. A new selection replaces the old one, so an address has at most one primary name.
- Resolve a registered name to its address for any user. Allow a user to send ETH to the resolved address.
- Provide reverse resolution from an address to its primary name as a bonus capability.
- Return a clear unregistered/no-primary result when a lookup has no match.

The initial specification does not define a separate action for changing a name's resolved address; the required initial resolution is the owner's address.

## 3. UI and navigation reference

Use the screen designs and labels in [`UI Template.pdf`](./UI%20Template.pdf) as the visual and interaction reference. The slide numbers below follow the template's handoff notes. All names, balances, timestamps, auction phases, exchange rates, and transaction details displayed in the PDF are **illustrative demo data**, not production values or verified blockchain state.

| Flow / screen | Template reference | Intended behavior |
|---|---:|---|
| Landing and wallet connection | Slides 4–6 | Start with **Connect MetaMask**, let the user select an account and confirm the connection, then show the dashboard. Never ask for a seed phrase or private key. Show the connected account and network. |
| Dashboard | Slide 7 | Show the user's names and current auction items grouped by commit, reveal, or settlement state, with relevant actions and countdown/phase indicators. Link to search, My Domains, Send ETH, and Transactions. |
| Search names | Slide 8 | Search for a `.ntu` name and show availability, commit phase, reveal phase, registered status, owner, or resolved address as applicable. The template suggests a list of close matches. Provide relevant actions such as commit, reveal, settle, or view details only when the contract state makes them valid. |
| My Domains / primary name | Slide 9 | List the connected user's names, status, resolved address, and relevant auction details/actions. **Set primary** must replace the previous primary selection and be available only for a name owned by the connected address. |
| Send ETH | Slides 10–12 | Accept a `.ntu` name or direct address, amount, and optional message. Resolve a name before transfer. Show the resolved destination, amount, configured network, and wallet-provided fee for review; then ask MetaMask to authorize the transaction and show confirmation. |
| Transaction history | Slide 13 | Display the user's relevant activity and transaction status/hash. Treat this as a history view; the template shows no primary action button. |
| Commit bid | Slides 14–17 | Enter bid amount in ETH and show an indicative SGD estimate; generate and reveal the salt to the user; require acknowledgement that the salt must be saved; submit the commitment with the required fixed deposit; then show confirmation. Use the exact commitment encoding expected by the contract. |
| Reveal bid | Slide 18 | Collect or restore the name, bid amount, and saved salt (ideally auto-filled from securely saved data). Submit only during the valid reveal phase, and clearly report an invalid/missing secret rather than silently changing it. |
| Winning result and payment | Slides 19–20 | Show the winning result and final price, allow the provisional winner to pay within the settlement period, and show payment confirmation. |
| Losing result and withdrawal | Slides 21–22 | Show the losing result and explain when the deposit is withdrawable; provide **Withdraw deposit** only when the contract says it is available, then show refund confirmation. |

### Navigation summarized from the template

- Connect MetaMask: slide 4 → account selection (5) → confirmation (6) → dashboard (7). Cancel/back actions return to the previous connection step.
- Dashboard actions can open commit, reveal, or settlement flows. Search can also link to these flows and to My Domains.
- My Domains can open reveal or settlement actions, and **Set primary** changes the selected primary name.
- Send ETH proceeds from the entry form (10) to transaction review (11), then to MetaMask (12); confirmation provides a route back to the dashboard.
- Commit proceeds through amount entry and salt generation (14), salt acknowledgement (15–16), and confirmation (17).
- Reveal (18) leads to the result appropriate for that bidder: winner/payment (19–20) or loser/withdrawal (21–22).

The original feature list mentions **Finalise auction**, while the template mainly presents **Pay winning bid** and the losing bidder's **Withdraw deposit**. Clarify whether finalisation is a permissionless public action, an automatic state derivation, or part of the winner-payment/fallback flow; do not infer it from the mockup alone.

## 4. Frontend and trust boundaries

- Use the connected wallet to identify the account and request transaction approvals; never collect private keys or recovery phrases.
- Use on-chain timestamps and contract state for phase, deadline, winner, settlement, and withdrawal eligibility. A client countdown is only a display aid and must not authorize an action.
- Wait for and display wallet/transaction outcomes, including failures and pending status; do not present a transaction as successful before confirmation.
- Make the salt recoverable by the bidder. The template shows a user-managed secret backup; decide and document any persistence mechanism without exposing the secret or losing it across sessions.
- Clearly separate prototype/demo mode from live blockchain actions. Do not present sample addresses, balances, exchange conversions, or statuses as real.
- Show an indicative SGD conversion only with a known source and timestamp, or label it as unavailable. The conversion does not change the ETH bid submitted on-chain.

## 5. Decisions to resolve before implementation

The source documents establish required behavior but leave several implementation parameters open. Confirm these with the project team before treating them as fixed:

1. Auction creation permissions and the exact name format/normalization rules.
2. Commit duration, reveal duration, settlement window, and the fixed deposit amount.
3. Minimum/maximum bid, tie-breaking, and what happens when all bids are invalid.
4. Non-reveal penalty and the treatment/refund of the winner's deposit after success or default.
5. Winner-default fallback: next-highest bidder eligibility and ordering, payment deadline, and when the auction restarts or closes.
6. Whether auction finalisation is a separate callable operation and who can call it.
7. SGD exchange-rate source, freshness, and failure behavior.
8. How salts are stored/exported/restored and how users are warned about losing them.
9. Search matching behavior and the exact information shown for unregistered names and addresses without a primary name.

## 6. Scope note

This brief captures the **initial product and system specification** and its mapping to the UI handoff. It does not prescribe a Solidity version, contract address, chain deployment, framework, complete security architecture, or implementation that has not yet been agreed and tested. The separate AI-audit-report prompts in the source PDF about development methodology, AI-generated code review, vulnerability findings, validation evidence, and lessons learned are outside this initial build specification.
