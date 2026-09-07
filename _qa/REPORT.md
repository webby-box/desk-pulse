# desk-pulse QA

Date: 2026-09-07

## Scope
Static board in `/workspace/desk-pulse` (live: https://webby-box.github.io/desk-pulse/).

## What was tested
- `index.html` has no `#badge` / LIVE status chrome (header is `desk` + ETH/BTC mark + age only).
- `styles.css` has no `.badge` rules.
- `_qa/smoke.mjs` loads `book.json` and runs `app.js` first-paint `liveNumbers`:
  - prefer `position.upnl_usd` / book `upnl_usd` when `marks[asset]` is missing
  - BTC never consumes ETH mark (`mark_eth` 2506 vs BTC ~79k)
  - fail if uPnL would paint `0` while writer `upnl_usd` is non-zero (including mark==entry trap)
  - after Coinbase-shaped BTC spot, uPnL recomputes from BTC only

## Fixes
- Guard Node export of core helpers; do not boot fetch/intervals outside the browser.
- History table renders `n_pos`; trades table matches `t/k/mkt/side/sz/pnl/tx`.
- Mark age class is `age` (stale/dead), not leftover `dim tiny`.
- Drop unused badge CSS; align `lastUpdated` with dense mono type.

## Results
```
node _qa/smoke.mjs
→ ALL PASS
```

Snapshot: book `upnl_usd=0.517`, first-paint uPnL `0.517`, primary BTC mark `79587.17` (not ETH).

## Commit
SHA: (filled after git commit)
