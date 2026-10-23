# NTU Names — Development Guide

How to build, test and run the implementation of [SPEC.md](./SPEC.md).

```
contracts/   Hardhat project: NtuNames.sol, tests, deploy script
frontend/    React + Vite + ethers v6 web app
shared/      Commitment test vectors used by both test suites
docs/        Manual test checklist
```

Requirements: Node.js 18+ and npm. For live use: MetaMask.

## 1. Contracts

```bash
cd contracts
npm install
npm test          # 58 Hardhat tests, labelled with SPEC.md acceptance criteria (AC1–AC51)
```

## 2. Run locally (Hardhat node + MetaMask)

Terminal 1 — local chain (chain id 31337). It auto-mines transactions and also mines a block every 3 s so phase deadlines pass in real time:

```bash
cd contracts
npm run node
```

Terminal 2 — deploy (180 s phases, 0.005 ETH deposit and minimum bid). This writes the ABI and address into `frontend/src/generated/`:

```bash
cd contracts
npm run deploy:local
```

How the frontend finds the contract:

- The repository ships `frontend/src/generated/deployments.json` as an empty `{}` placeholder. Each developer deploys their own copy, and no shared address is committed.
- `npm run deploy:local` (or `deploy:sepolia`) writes `{ "<chainId>": { "address", "deployBlock" } }` into that file. The app picks the entry for `VITE_CHAIN_ID`.
- Setting `VITE_CONTRACT_ADDRESS` (and optionally `VITE_DEPLOY_BLOCK`) in `frontend/.env` overrides that file. Use it to point at an existing deployment without redeploying.
- With no address for the target chain, the app shows a "No NTU Domains contract is configured" banner, lookups are skipped, and every transaction button is disabled.
- After deploying locally, don't commit the address that `deploy:local` wrote. Restore the placeholder before committing with `git checkout -- frontend/src/generated/deployments.json`.

Terminal 3 — web app at http://localhost:5173:

```bash
cd frontend
npm install
cp .env.example .env     # defaults target the local node
npm run dev
```

In MetaMask, add the network **Hardhat local** (RPC `http://127.0.0.1:8545`, chain id `31337`, symbol ETH), or click **Switch to Hardhat local** in the app. Import one of the test accounts printed by `npm run node`. Those keys are public test keys: never use them on a real network.

If you restart the node, redeploy and reset each MetaMask account's activity (Settings → Advanced → Clear activity tab data) so nonces match the new chain.

## 3. Deploy to Sepolia

```bash
cd contracts
cp .env.example .env     # set SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, optionally TREASURY_ADDRESS
npm run deploy:sepolia
```

Then, in `frontend/.env`, set `VITE_CHAIN_ID=11155111` and `VITE_RPC_URL=<your Sepolia RPC>`. The contract address comes from `src/generated/deployments.json`, or you can override it with `VITE_CONTRACT_ADDRESS`. Never commit `.env` files.

## 4. Frontend checks

```bash
cd frontend
npm test            # unit tests: commitment vectors (AC51), domain rules, SGD freshness and hints (AC55, AC59, AC60), recipient (AC56), commit gating (AC53), address lookup input (AC63)
npm run build       # type-check + production build
```

Demo mode (read-only sample data, no wallet needed): open `http://localhost:5173/?demo=1`, or set `VITE_DEMO=1`. Use `?demo=0` to leave.

The remaining frontend acceptance criteria are verified by hand with [docs/MANUAL_TEST_CHECKLIST.md](./docs/MANUAL_TEST_CHECKLIST.md).

## Notes

- **Privacy:** commitments are computed in the browser. The domain, bid and salt are never sent to an RPC node before reveal. The app does not store salts.
- **Local labels:** the app keeps a browser-local map of name hash → domain for names you searched or bid on, so the dashboard can label auctions before reveal. It holds no secrets and is safe to clear.
