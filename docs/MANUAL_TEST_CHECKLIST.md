# Manual Test Checklist

These cover the frontend acceptance criteria in SPEC.md §8 that need a real browser and wallet, plus one end-to-end demo run. Run them against a local node (see DEVELOPMENT.md) and again on Sepolia before a demo. Accounts A, B and C are three MetaMask accounts with test ETH.

| # | Criterion | Steps | Expected |
|---|---|---|---|
| M1 | AC52 wrong network | Connect MetaMask while it is on a different network. | A "wrong network" banner appears with a **Switch to …** button. Every transaction button is disabled. Search still returns results. Clicking the switch button changes the wallet's network and re-enables the buttons. |
| M2 | AC53 commit gating | Open a Commit-phase auction. Enter a bid, but don't generate a salt or tick the box. | **Commit bid** stays disabled with a reason. It enables only after a salt is generated **and** the save acknowledgement is ticked. Changing the bid clears the tick. |
| M3 | AC54 reveal pre-check | In the reveal phase, enter a wrong bid or salt and click **Reveal bid**. | "These details don't match your commitment…" appears, and MetaMask does **not** open. |
| M4 | AC55 SGD estimate | Open the commit form normally, then again with the network to api.coingecko.com blocked (DevTools → Network → block request URL). | Normal: "≈ … SGD estimate (indicative only)" plus the rate time. Blocked: "SGD estimate unavailable". |
| M5 | AC56 unregistered recipient | On Send ETH, enter `nobodyxyz.ntu` and an amount, then **Proceed**. | "nobodyxyz.ntu is not registered." The review step is not shown. |
| M6 | AC57 demo mode | Open `/?demo=1` and visit every page. | The orange "DEMO DATA – not on-chain" banner is always visible, and no transaction button can be used. `?demo=0` exits. |
| M7 | AC58 RPC failure | Stop the Hardhat node (or point `VITE_RPC_URL` at a dead URL) with the app open. | Within about 15 s, a "Network unavailable" banner appears and transaction buttons are disabled. Restarting the node clears it. |
| M8 | Wallet safety | Go through connect and all flows. | The app never asks for a seed phrase or private key. |

## End-to-end demo run (all three accounts)

1. **A:** Search `demo1`. It shows Available. Click **Start auction**. The app goes to the auction page in the Commit phase with a countdown.
2. **A, B, C:** Each bids (A 0.03, B 0.02, C 0.004), copying the domain, bid and salt before ticking the box. The confirmation shows the domain, amount and time.
3. When the reveal phase starts, the page updates by itself. **A, B, C** each reveal. C is warned that the reveal will be ineligible (below the minimum) and can **Withdraw deposit** right away.
4. After the reveal deadline: **A** sees "Congratulations, you won!" with 0.025 ETH due. **B** sees rank #2 and when B's window opens.
5. Let A's window expire. **B** now sees **Pay winning bid** (0.015 ETH) and pays. The payment confirmation is shown.
6. **B:** My domains lists `demo1.ntu` as Primary. History shows the commit, reveal, payment and primary rows.
7. **A:** The auction page says A's payment window passed and the deposit was forfeited. There is no withdraw button.
8. **Any account:** Send ETH to `demo1.ntu`. The review shows B's address, and the transfer confirms with a transaction hash.
