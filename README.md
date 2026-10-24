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

## Running it

### Prerequisites
- Node 20+ and npm.
- Google Chrome (or Brave/Edge/Firefox) with the [MetaMask](https://metamask.io) extension installed. MetaMask is a browser extension; the app cannot find a wallet in Safari, private windows, or embedded preview panes.

### 1. Install and test
```bash
npm install && npm --prefix frontend install
npm run test:all        # Hardhat contract tests + frontend unit tests
```

### 2. Start a local chain, deploy, and run the app
Use three terminals in the project root:
```bash
npm run node                                # 1. local chain on :8545 (chain id 31337), mines a block every second; leave running
PHASE_SECONDS=30 npm run deploy:local       # 2. deploy; writes frontend/.env.local and exports the ABI
npm run frontend                            # 3. Vite dev server; open the URL it prints
```
`PHASE_SECONDS` sets the commit, reveal and settlement phase lengths. Omit it for the spec default of 180 s (3 minutes). Use at least 120 s when you are clicking through MetaMask by hand; 30 s is only enough for scripted runs.

`npm run node` mines a block every second so the chain clock follows real time. A plain `npx hardhat node` only mines on transactions, so its clock stands still and the app's phase display goes stale (commits then fail with "commit phase is not open"). If you restart `npm run node`, the chain resets: rerun step 2.

### 3. Set up MetaMask for the local chain
1. **Add the network.** Open the network picker, choose **Manage networks**, then **Add a custom network** (or **Settings → Networks → Add a custom network**) and enter:
   - Network name: `Hardhat Local`
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Currency symbol: `ETH`
2. **Import a funded test account.** `npm run node` prints 20 accounts with private keys. In MetaMask choose **Add account or hardware wallet → Private key** and paste one (use accounts #2 and up; #0 deploys and #1 is the treasury). Each has 10,000 test ETH. **These keys are public. Never use them on a real network.**
3. Switch MetaMask to `Hardhat Local`, open the app, and click **Connect MetaMask**.

If MetaMask reports nonce errors after restarting the node, use **Settings → Advanced → Clear activity tab data**.

### 4. Try an end-to-end flow
1. **Search** `alice` and click **Start auction**.
2. **Commit** a bid of at least 0.01 ETH: generate a salt, **copy the domain, bid and salt** (the app does not store them), tick the checkbox, and commit. 0.005 ETH is sent as the deposit.
3. Wait for the **reveal** phase, then enter the domain, exact bid and salt and reveal.
4. After the reveal phase the page shows **Congratulations, you won!**: click **Pay winning bid** (bid minus deposit).
5. Check **My domains** (`alice.ntu` is primary), **Send ETH** to `alice.ntu`, and **Transactions**.

Other cases to try, ideally with a second imported account (full list with steps and expected results in [`docs/MANUAL_TEST_PATHS.md`](./docs/MANUAL_TEST_PATHS.md)):
- A losing bidder opens the auction and clicks **Withdraw deposit** (0.005 ETH returned).
- Commit but never reveal: the deposit is forfeited.
- The winner does not pay within the settlement window: the next-highest bidder is offered the name.
- Nobody reveals: the auction closes and **Finalise auction** appears.
- Commit below the 0.005 ETH minimum: the reveal is ineligible and the deposit is refundable straight away.
- Switch MetaMask to another network: transaction buttons disable and a switch banner appears.

### Demo mode (no wallet or chain)
Open the app with `?demo=1` (for example `http://localhost:5173/?demo=1`). It shows fixed sample data behind a permanent banner and disables every transaction button.

### Sepolia
Set `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY`, run `npm run deploy:sepolia`, and restart the frontend. `frontend/.env.local` then points at Sepolia (chain id 11155111). Do not commit private keys.

### Troubleshooting
| Symptom | Fix |
|---|---|
| "MetaMask was not found" | Install the extension and open the app in that same browser profile, not in a private window or preview pane |
| "Commit phase is not open for this auction" although the app shows Commit phase | The commit window passed in real time. Use `npm run node` (not `npx hardhat node`), redeploy with `PHASE_SECONDS=120`, and start a new auction |
| Wrong-network banner | Switch MetaMask to `Hardhat Local`, or click the banner's switch button |
| "Network unavailable" banner | `npm run node` is not running, or `VITE_RPC_URL` in `frontend/.env.local` is wrong |
| App shows no contract / actions fail after a node restart | Rerun `npm run deploy:local` (the address changes) |
| Port 5173 already in use | Vite picks the next free port; use the URL it prints |

Layout: `contracts/` (Solidity), `test/` (Hardhat tests), `scripts/` (deploy, ABI export), `frontend/` (React + Vite + ethers v6), `docs/` (audit report sections and test/Slither evidence).

## Status

The contract and the web interface are implemented and tested locally (see `docs/`). Nothing is deployed to a public testnet yet, the wallet flows have not been exercised in a real browser with MetaMask, and the contract has not been independently audited. UI mockup content and sample data are illustrative unless verified against the deployed testnet contract.
