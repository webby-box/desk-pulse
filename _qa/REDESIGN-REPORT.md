# Desk pulse redesign report

Date: 2026-09-07  
Author: Webby  
Commit SHA: 7aea981563a9bf4d7b5e6515961381512f289fbf

## What changed
Mobile-first dark FinTech shell (system UI, tabular mono on numbers only). Hero Equity, colored uPnL, Liquid + live mark secondary. One position card: side pill, lev, size, entry/mark, uPnL, slim SL–TP thermometer. History/trades collapsed. No LIVE/status badge.

Money logic in `app.js` unchanged: writer `upnl_usd` until same-asset Coinbase spot in `marks[]`; BTC/LINK never use ETH mark; boot `await refreshBook()` then `await refreshMark()`.

## Screenshots
- `_qa/desk-mobile.png` (390×844)
- `_qa/desk-desktop.png` (1280×800)

## Tests
```
$ node _qa/smoke.mjs && node _qa/e2e-static.mjs
OK: no LIVE/status badge in HTML
OK: no .badge rules; system UI font
OK: boot awaits refreshBook before refreshMark
OK: loaded book.json upnl_usd=-0.1376 mark_eth=2503.795 mark_link=13.305
OK: primary asset LINK
OK: LINK mark is not ETH (13.305)
OK: first-paint uPnL uses writer -0.1376
OK: position.upnl_usd used when marks[LINK] missing
OK: BTC never gets ETH mark; writer uPnL survives ETH-only book marks
OK: after Coinbase BTC spot, uPnL recomputes from BTC only
OK: LINK never uses ETH mark; writer uPnL until same-asset spot
OK: after Coinbase LINK spot, uPnL recomputes from LINK only
OK: non-zero writer beats mark==entry zero compute
ALL PASS
OK: fetched index/app/book
OK: no LIVE/status badge in served HTML
OK: served app.js boot order
… smoke re-run …
E2E ALL PASS
```

Mirror: `/workspace/easy-cash/quant/web/desk-dashboard/`
