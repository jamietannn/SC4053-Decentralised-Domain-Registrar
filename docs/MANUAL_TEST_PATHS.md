# Manual test paths

Paths to try in the browser besides the happy path (start auction → commit → reveal → pay → send ETH). Setup is in the [README](../README.md#running-it).

## Before you start
- Run `npm run node` (not `npx hardhat node`) and deploy with `PHASE_SECONDS=120 npm run deploy:local`. Each phase then lasts 2 minutes, enough to click through MetaMask by hand.
- Use a **new name for every test**, because a registered name cannot be auctioned again.
- Several paths need a second account. Import Hardhat account #3 into MetaMask the same way as #2 (**Add account or hardware wallet → Import account → Private key**):
  - Address: `0x90F79bf6EB2c4f870365e785982e1f101e93b906`
  - Private key: `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6`
  - Check that the imported address starts with `0x90F7`. Keys like this are public; never use them on a real network.
- After switching accounts in MetaMask, connect the new account to the app (the sidebar address should change).
- If you restart the node, redeploy and clear MetaMask's activity data (Settings → Advanced → Clear activity tab data).

## Bidding outcomes
| Path | How to trigger | Expected |
|---|---|---|
| Losing bidder withdraws | Account A commits and reveals 0.02. Account B commits and reveals 0.01. A pays. | B opens the auction and clicks **Withdraw deposit**; 0.005 ETH is returned. |
| Tie | Both accounts bid the same amount. | The earlier commit wins. |
| Never reveal | Commit, then do not reveal. | The deposit is forfeited and **Withdraw** never appears. |
| Winner does not pay | The winner skips paying for one settlement window (2 minutes). | The next-highest bidder is offered the name. The first bidder's deposit is forfeited. |
| Nobody pays | Every eligible bidder skips their window. | The auction closes with no winner, **Finalise auction** appears, and the name can be auctioned again. |
| No reveals | Commit, but nobody reveals. | The auction closes; non-revealers' deposits are forfeited on finalise. |
| No commits | Start an auction and let the commit window end with no bids. | It closes immediately; **Start new auction** works straight away. |

## Rejected or ineligible bids
| Path | How to trigger | Expected |
|---|---|---|
| Bid below 0.005 ETH | Commit a bid under the minimum (the form warns you). | The reveal is marked **ineligible** and the deposit is refundable immediately. |
| Wrong salt, bid or domain on reveal | Enter a value that differs from the commit. | The app shows "Details don't match your commitment" and sends no transaction. |
| Reveal too early or too late | Look for the reveal form outside the reveal phase. | There is no reveal form. A missed reveal becomes the "Never reveal" path. |
| Second commit in one auction | Commit twice from the same account. | The page says you have already committed. |
| Bid on a registered or active name | Search a name that is registered or in an auction. | **Start auction** is not offered; search shows Registered or the current phase. |

## Names and sending
| Path | How to trigger | Expected |
|---|---|---|
| Set primary | Win a second name (for example `bob`), then use **Set primary** on My domains. | Only one name is Primary at a time. |
| Send to an unregistered name | Enter an unregistered `.ntu` name on Send ETH. | Blocked with "not registered". |
| Send to a raw address | Enter a `0x…` address. | Works without a name. |
| Invalid names | Search `ab`, `al-ice`, or a name with uppercase letters. | Search shows the format rule (3–32 characters, a–z and 0–9). |

## App and wallet behaviour
| Path | How to trigger | Expected |
|---|---|---|
| Wrong network | Switch MetaMask to another network. | Transaction buttons disable and a switch banner appears; search still works. |
| Cancelled transaction | Click Cancel in MetaMask. | The toast says "Transaction cancelled", not an error. |
| No wallet | Use "Browse without a wallet". | Search works; actions are disabled. |
| Node down | Stop `npm run node`. | A "Network unavailable" banner appears and actions are disabled. |
| Demo mode | Open the app with `?demo=1`. | Sample data shows behind a banner, and every transaction button is disabled. |

## Suggested order
These are the most likely to expose bugs, because earlier bugs were all in code paths only reachable in the browser:
1. Losing bidder and **Withdraw deposit**.
2. Winner does not pay, so the next bidder gets a turn.
3. Nobody reveals, then **Finalise auction**.
4. Wrong salt on reveal.
5. Wrong network.

Record any bug you find (what you did, what you saw, any error text), since each confirmed issue belongs in section 5 of the audit report.
