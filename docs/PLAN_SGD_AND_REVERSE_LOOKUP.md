# Plan: SGD estimates on all ETH inputs + reverse-resolution search

## Context
Two features are missing or incomplete against what the user wants:
1. **SGD estimate.** The CoinGecko SGD estimate exists only on the Commit bid field (`frontend/src/pages/Auction.tsx:223-290`). The Reveal bid field and the Send ETH amount field have none. Each screen would also fetch its own rate.
2. **Reverse resolution (address → primary domain).** The contract (`reverseResolve`, `NtuNames.sol:408`) and the registry (`registry.reverseResolve`, `lib/chainRegistry.ts:164`) support it. The UI only uses it to mark the Primary badge in My Domains. Users can't look up an address.

The requirements interview (recorded as round R14) settled these points:
- **SGD:** show it on all ETH *input* fields: Commit bid, Reveal bid, Send ETH amount. Use one app-wide rate, refreshed every 60 s. Keep the 10-minute freshness rule and the "SGD estimate unavailable" fallback. Show the rate timestamp. Read-only amounts and History stay ETH-only.
- **Reverse lookup:** the Search page gets an explicit **By domain | By address** toggle, kept in the URL as `?by=address&q=0x…`.
  - Address input is strict: `0x` + 40 hex characters, and a mixed-case address with a bad checksum is rejected.
  - The result shows the checksummed address and its primary name (e.g. `alice.ntu`, Primary badge). If there is none, it shows "This address has no primary .ntu name."
  - It works without a wallet.

## Step 1 — Specification updates (`SPEC.md`)
- **§7 new bullet "SGD estimates":**
  - Every ETH input field (Commit bid, Reveal bid, Send ETH amount) shows "≈ X SGD (indicative only)" plus "rate from CoinGecko at <time>" as the user types.
  - The rate is one shared app-wide CoinGecko fetch, refreshed every 60 s.
  - If the fetch fails or the rate is more than 10 minutes old, the field shows "SGD estimate unavailable".
  - The estimate is display-only and never changes the ETH value sent.
  - The Commit step 2 text points to this bullet.
- **§7 Search:**
  - Add the "By domain | By address" toggle; the mode is kept in the URL.
  - Address mode validates strictly as described above and calls `reverseResolve`.
  - Result: checksummed address → primary domain with a Primary badge, or "This address has no primary .ntu name."
  - It works read-only through `VITE_RPC_URL`.
  - The existing domain-mode bullets stay as they are.
- **§8 new acceptance criteria (Frontend):**
  - **AC59:** Reveal bid and Send ETH amount show an SGD estimate with the rate time when the rate is fresh.
  - **AC60:** with a failed or stale (more than 10 min) rate, all three fields show "SGD estimate unavailable".
  - **AC61:** address search for an address with a primary name shows that `.ntu` name.
  - **AC62:** address search for an address with no primary shows "This address has no primary .ntu name."
  - **AC63:** malformed or bad-checksum input shows a validation error and makes no RPC call.
- **§9 Out of scope:**
  - SGD on read-only amounts and History.
  - Reverse-name display elsewhere in the app (header, owner/winner fields).
- **Interview rounds:** add **R14**: SGD on all ETH inputs with a shared 60 s rate; Search address mode with explicit toggle, strict validation, "no primary" message.
- **§10:** no deviation entry needed (this extends §7).

## Step 2 — Shared SGD rate
- **New `frontend/src/state/sgdRate.tsx`:** a `SgdRateProvider` and a `useSgdRate()` hook.
  - It wraps the existing `fetchSgdRate()` from `lib/sgd.ts` with the existing `useAsync(load, deps, 60_000)` from `state/hooks.ts`.
  - It exposes `{ rate: SgdRate | null }` and keeps the last good value while it reloads.
  - Mount it in `App.tsx` inside `RegistryProvider`.
- **`lib/sgd.ts`:** add a pure function `sgdHint(rate, wei, nowSeconds)`. It returns either `{ estimate, rateTime }` or `{ unavailable: true }` and reuses `isRateFresh` and `sgdEstimate`. Unit-testable.
- **`components/ui.tsx`:** add `<SgdHint wei={bigint | null} />`.
  - It uses `useSgdRate()`, `useNow()` and `formatDateTime`.
  - With a fresh rate it renders "≈ X SGD estimate (indicative only) · rate from CoinGecko at …"; otherwise "SGD estimate unavailable".
  - It renders nothing when `wei` is null.
- **Use it in:**
  - `Auction.tsx` CommitPanel: replace the local `useAsync(fetchSgdRate)` and the hint markup (lines 223, 230, 286-291) with `<SgdHint wei={bidWei} />`. Keep the existing "Enter a valid ETH amount" message.
  - `Auction.tsx` RevealPanel: add `<SgdHint wei={bidWei} />` under the bid input (around line 407).
  - `SendEth.tsx`: parse `amountInput` with `parseEthInput` while rendering, and add `<SgdHint>` under the amount input (around line 110).

## Step 3 — Address search mode
- **New `frontend/src/lib/address.ts`:** `checkAddress(input)` returns `{ok:true, address}` or `{ok:false, error}`.
  - Trim the input.
  - Require `/^0x[0-9a-fA-F]{40}$/`.
  - Then require ethers `isAddress`, which rejects a mixed-case address with a bad checksum.
  - Return `getAddress()` (the checksummed form).
- **`pages/Search.tsx`:**
  - Read `by` from search params (default `domain`). Render a segmented toggle (two buttons, `aria-pressed`). Switching mode clears `q`.
  - The placeholder, hint and `.ntu` suffix change per mode (no suffix in address mode).
  - Domain mode keeps the current `SearchResult` path unchanged.
  - Address mode runs `checkAddress`; on error it shows `<Notice tone="error">` and makes no call. Otherwise it renders `AddressResult`.
- **`AddressResult`:**
  - Reuses the `configured` guard pattern from `SearchResult`.
  - Loads with `useAsync(() => registry.reverseResolve(address), [registry, address])`.
  - Renders a `Card` with a `DetailList`: Address (full, mono) and Primary name (`fqdn(name)` + `<Badge tone="blue">Primary</Badge>`), or the "no primary" message.
  - On RPC error it shows "Couldn't look up this address. Is the network reachable?"
- **Demo mode** works unchanged: `demoRegistry.reverseResolve` already returns `javier` for the demo account.
- **Styles:** add a small `.segmented` style in `styles.css`, using the existing button classes.

## Step 4 — Tests and docs
- `lib/sgd.test.ts`: add `sgdHint` cases: fresh, stale (601 s), null rate, null wei.
- New `lib/address.test.ts`:
  - valid lower-case, upper-case and checksummed addresses → checksummed result
  - bad checksum → rejected
  - wrong length, missing `0x`, non-hex, empty → rejected
- `docs/MANUAL_TEST_CHECKLIST.md`: add M9 (AC59/60: SGD on Reveal and Send ETH, blocked CoinGecko) and M10 (AC61–63: address search with primary, without primary, invalid).
- `DEVELOPMENT.md` §4: mention the new unit tests.

## Critical files
`SPEC.md`, `frontend/src/lib/sgd.ts`, `frontend/src/state/sgdRate.tsx` (new), `frontend/src/components/ui.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/Auction.tsx`, `frontend/src/pages/SendEth.tsx`, `frontend/src/lib/address.ts` (new), `frontend/src/pages/Search.tsx`, `frontend/src/styles.css`, tests and docs listed above. No contract changes.

## Verification
1. `cd frontend && npm test`: all unit tests pass, including the new sgd and address tests.
2. `npm run typecheck`, then `npm run build`.
3. `cd contracts && npm test`: still 58 passing (unchanged).
4. Manual check against a local node (`npm run node`, `deploy:local`, `npm run dev`):
   - Type amounts in Commit, Reveal and Send ETH and see the SGD estimate with the rate time.
   - Block `api.coingecko.com` in DevTools and see "SGD estimate unavailable" in all three.
   - Search → By address with a winner's address → its `.ntu` primary name.
   - A fresh account's address → the "no primary" message.
   - A bad-checksum or short address → validation error, with no request in the Network tab.
   - `?demo=1` → address search for the demo account shows `javier.ntu`.
