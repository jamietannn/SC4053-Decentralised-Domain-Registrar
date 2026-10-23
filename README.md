# NTU Names

NTU Names is a decentralized `.ntu` domain name registrar built for an Ethereum testnet. It uses a commit-and-reveal bidding process to register names and provides a web interface for searching, registering, and resolving them.

## Project in a nutshell

Users bid for unregistered `.ntu` names through a blind-auction flow. During the commit phase, a bidder submits a cryptographic commitment and an ETH deposit. During the reveal phase, the bidder reveals the name, bid, and secret salt so the smart contract can verify the commitment. The highest valid bidder can then register the name according to the auction's settlement rules.

Once registered, a name resolves to an Ethereum address. Users can search for names and send ETH directly to a registered `.ntu` name through the web interface.

## Background and problem statement

Traditional DNS registrars, such as GoDaddy and Namecheap, are centralized services. Centralization can create single points of failure and gives the registrar significant control over domain records. It can also create risks of censorship, arbitrary record changes or hijacking, domain squatting, and front-running of domain searches.

A decentralized registrar records ownership and resolution transparently on-chain. However, public blockchain transactions are visible in the mempool before they are confirmed. If a bidder submits a plain-text name and bid, another participant or a MEV bot could observe the transaction and try to acquire the name first by submitting a competing transaction with a higher gas fee.

NTU Names uses a **commit-and-reveal** process to keep the name and bid out of the public transaction data during the initial bidding phase:

1. **Commit phase:** The bidder submits a cryptographic commitment derived from the name, bid, and a secret salt, along with an ETH deposit. The commitment hides the bid inputs from ordinary observers while bidding is open.
2. **Reveal phase:** The bidder submits the name, bid, and same salt. The contract recomputes the commitment and verifies it against the stored value.
3. **Auction outcome:** The contract compares valid revealed bids and applies the auction's winner, payment, registration, and deposit rules.

The salt must be unpredictable and kept secret until reveal. The commitment must use consistent encoding in the frontend and contract. The name and bid must not be included in plaintext in the commit transaction or its events; a weak or guessable salt can make it possible to test candidate inputs against a published commitment.

## Feature requirements

### Domain bidding

- Allow any address to bid for an unregistered `.ntu` name.
- Reject bidding for names that are already registered or have an active auction.
- Track auction status and deadlines so bids and reveals are accepted only during their valid phases.
- Use short commit and reveal phases of approximately **2–3 minutes each for testing**. These accelerated durations are for testnet demonstrations and should not be assumed to be suitable for production.

### Commit-and-reveal auction

- Generate a commitment from the domain name, bid amount, and salt using a well-defined cryptographic hash and encoding.
- Submit the commitment with the required ETH deposit without storing the intended bid in plaintext during the commit phase.
- Verify revealed inputs against the original commitment.
- Reject invalid or duplicate reveals.
- Determine the highest valid revealed bid and apply the agreed settlement and registration rules.
- Define what happens to deposits when bidders fail to reveal or when the winner does not complete payment.

### Name resolution

- Support **forward resolution**: `.ntu` domain → Ethereum address.
- Initialize a registered name's resolved address to its owner's address.
- Allow users to search for a name, inspect its status, and use a registered name as the recipient of an ETH transfer.
- **Bonus:** Support reverse resolution: Ethereum address → its designated primary `.ntu` domain.

### Web interface

- Search for a `.ntu` name and display its status, such as available, in auction, or registered.
- Guide bidders through the commit and reveal steps, including generating and saving the salt.
- Show relevant auction phase and timing information.
- Resolve a registered name before sending ETH and let the user review the resolved address and transfer details.
- Provide wallet interaction for submitting and confirming blockchain transactions.

See [`INITIAL_SPECIFICATION.md`](./INITIAL_SPECIFICATION.md) for the fuller initial requirements and screen-by-screen mapping to [`UI Template.pdf`](./UI%20Template.pdf).

## Design questions to resolve

The project concept identifies several important questions that must be answered in the contract rules and user experience:

- **Unrevealed commitments:** What penalty applies when a bidder commits but does not reveal? Is all or only part of the deposit forfeited, and where do forfeited funds go?
- **Commitment privacy:** How will the frontend ensure the name and bid are not exposed in transaction calldata or events during the commit phase? How will salt strength and secure backup be handled?
- **Winner settlement:** How long does the winner have to pay, how is the winner's deposit handled, and what happens if they fail to pay?
- **Auction completion:** Can the next-highest bidder become the winner, or should the auction restart? How are tied bids resolved?
- **Timing and parameters:** Are the 2–3 minute phases test-only settings, and what deposit, minimum bid, and settlement duration should be used?

These choices affect both contract behavior and frontend states; they should be specified before implementation rather than left to assumptions.

## Project documents

- [`INITIAL_SPECIFICATION.md`](./INITIAL_SPECIFICATION.md) — initial functional requirements and UI-template references.
- [`blockchain.pdf`](./blockchain.pdf) — original specification source.
- [`UI Template.pdf`](./UI%20Template.pdf) — visual and navigation reference for the interface.

## Status

This README describes the project goals and initial requirements. It does not claim that the contracts or interface are deployed, complete, or security-audited. UI mockup content and sample data are illustrative unless verified against the deployed testnet contract.
