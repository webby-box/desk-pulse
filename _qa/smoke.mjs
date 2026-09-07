#!/usr/bin/env node
"use strict";

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function ok(msg) {
  console.log("OK:", msg);
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (/\bid=["']badge["']/.test(html)) fail("index.html still has #badge");
if (/class=["'][^"']*\bbadge\b/.test(html)) fail("index.html still has .badge chrome");
if (/>\s*LIVE\s*</.test(html)) fail("index.html contains LIVE badge text");
if (/\bLIVE\b/.test(html)) fail("index.html contains LIVE text");
ok("no LIVE/status badge in HTML");

const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
if (/\.badge\b/.test(css)) fail("styles.css still defines .badge");
if (/ui-monospace/.test(css.split("body")[0] + "") && /body\s*\{[^}]*ui-monospace/.test(css)) {
  fail("body uses mono as primary font");
}
if (!/system-ui/.test(css)) fail("expected system-ui body font");
ok("no .badge rules; system UI font");

const src = fs.readFileSync(path.join(root, "app.js"), "utf8");
if (!/await refreshBook\(\);\s*await refreshMark\(\);/.test(src)) {
  fail("boot must await refreshBook before refreshMark");
}
ok("boot awaits refreshBook before refreshMark");

const book = JSON.parse(fs.readFileSync(path.join(root, "book.json"), "utf8"));
if (book.upnl_usd == null) fail("book.json missing upnl_usd");
if (Number(book.upnl_usd) === 0) {
  console.log("note: book.upnl_usd is 0 at snapshot; regression cases still run");
}
ok("loaded book.json upnl_usd=" + book.upnl_usd + " mark_eth=" + book.mark_eth + " mark_link=" + book.mark_link);

const desk = require(path.join(root, "app.js"));

desk.resetMarks();
const norm = desk.normalize(book);
const first = desk.liveNumbers(norm);

const expectedAsset = desk.assetOf(book.positions[0]);
if (first.asset !== expectedAsset) fail("primary asset expected " + expectedAsset + ", got " + first.asset);
ok("primary asset " + first.asset);

const eth = Number(book.mark_eth);
if (first.asset !== "ETH" && first.mark != null && Math.abs(Number(first.mark) - eth) < 1) {
  fail(first.asset + " first-paint mark equals ETH (" + first.mark + ")");
}
if (first.asset === "BTC" && first.mark != null && Number(first.mark) < 10000) {
  fail("BTC mark looks like ETH scale: " + first.mark);
}
if (first.asset === "LINK" && first.mark != null && Number(first.mark) > 100) {
  fail("LINK mark looks like ETH/BTC scale: " + first.mark);
}
ok(first.asset + " mark is not ETH (" + first.mark + ")");

if (book.upnl_usd != null && Number(book.upnl_usd) !== 0) {
  if (first.upnl == null || Number(first.upnl) === 0) {
    fail(
      "uPnL would paint as " +
        first.upnl +
        " while book.upnl_usd=" +
        book.upnl_usd +
        " (writer must win when marks[asset] missing)"
    );
  }
  if (Math.abs(Number(first.upnl) - Number(book.upnl_usd)) > 1e-9) {
    fail("first-paint uPnL=" + first.upnl + " != book.upnl_usd=" + book.upnl_usd);
  }
}
ok("first-paint uPnL uses writer " + first.upnl);

const card = first.cards.find(function (c) {
  return desk.isOpen(c.p);
});
if (!card) fail("no open position card");
if (Math.abs(Number(card.upnl) - Number(book.positions[0].upnl_usd)) > 1e-9) {
  fail("card uPnL=" + card.upnl + " != position.upnl_usd");
}
ok("position.upnl_usd used when marks[" + first.asset + "] missing");

const poisoned = desk.normalize({
  liquid_usd: 34,
  upnl_usd: 0.517,
  equity_usd: 72,
  marks: { ETH: 2506.24 },
  positions: [
    {
      market: "BTC/USD",
      side: "LONG",
      status: "LIVE",
      size_usd: 228,
      entry: 79407,
      mark: 79587,
      upnl_usd: 0.517,
      collateral_usd: 37.86,
    },
  ],
});
desk.resetMarks();
desk.setBookMarks({ ETH: 2506.24, BTC: null });
const livePoison = desk.liveNumbers(poisoned);
if (livePoison.mark != null && Number(livePoison.mark) < 10000) {
  fail("BTC used ETH book mark: " + livePoison.mark);
}
if (Number(livePoison.upnl) === 0) {
  fail("ETH-only marks poisoned first-paint uPnL to 0");
}
ok("BTC never gets ETH mark; writer uPnL survives ETH-only book marks");

desk.setMarks({ BTC: 81000, ETH: 2506.24 });
const liveSpot = desk.liveNumbers(poisoned);
const expected = ((81000 - 79407) / 79407) * 228;
if (Math.abs(Number(liveSpot.upnl) - expected) > 0.05) {
  fail("live BTC spot uPnL expected ~" + expected + " got " + liveSpot.upnl);
}
if (Math.abs(Number(liveSpot.mark) - 2506.24) < 1) {
  fail("after spot, BTC mark still ETH");
}
ok("after Coinbase BTC spot, uPnL recomputes from BTC only");

desk.resetMarks();
const linkPoison = desk.normalize({
  liquid_usd: 21,
  upnl_usd: -0.1376,
  marks: { ETH: 2504.96, BTC: 79529.99 },
  positions: [
    {
      market: "LINK/USD",
      side: "LONG",
      status: "LIVE",
      size_usd: 300,
      entry: 13.2961,
      mark: 13.305,
      upnl_usd: -0.1376,
      collateral_usd: 49.88,
    },
  ],
});
desk.setBookMarks({ ETH: 2504.96, BTC: 79529.99, LINK: null });
const linkLive = desk.liveNumbers(linkPoison);
if (linkLive.mark != null && Number(linkLive.mark) > 100) {
  fail("LINK used ETH/BTC mark: " + linkLive.mark);
}
if (Math.abs(Number(linkLive.upnl) - -0.1376) > 1e-9) {
  fail("LINK writer uPnL lost: " + linkLive.upnl);
}
ok("LINK never uses ETH mark; writer uPnL until same-asset spot");

desk.setMarks({ LINK: 13.4, ETH: 2504.96 });
const linkSpot = desk.liveNumbers(linkPoison);
const linkExp = ((13.4 - 13.2961) / 13.2961) * 300;
if (Math.abs(Number(linkSpot.upnl) - linkExp) > 0.05) {
  fail("live LINK spot uPnL expected ~" + linkExp + " got " + linkSpot.upnl);
}
ok("after Coinbase LINK spot, uPnL recomputes from LINK only");

desk.resetMarks();
const zeroTrap = desk.normalize({
  upnl_usd: 12.5,
  liquid_usd: 10,
  positions: [
    {
      market: "BTC/USD",
      side: "LONG",
      status: "LIVE",
      size_usd: 100,
      entry: 80000,
      mark: 80000,
      upnl_usd: 12.5,
      collateral_usd: 20,
    },
  ],
});
const trapped = desk.liveNumbers(zeroTrap);
if (Number(trapped.upnl) === 0) {
  fail("uPnL painted 0 despite book upnl_usd=12.5 (mark==entry trap)");
}
if (Number(trapped.upnl) !== 12.5) fail("expected writer 12.5 got " + trapped.upnl);
ok("non-zero writer beats mark==entry zero compute");

const fleet = JSON.parse(fs.readFileSync(path.join(root, "fleet.json"), "utf8"));
const counted = desk.fleetCounts(fleet.bots);
if (counted.working + counted.idle + counted.held !== fleet.bots.length) {
  fail("fleet counts must cover every bot");
}
const workingBots = fleet.bots.filter((b) => String(b.state).toUpperCase() === "WORKING");
if (counted.working !== workingBots.length) fail("working count must match bot states, not header");
ok("fleet counts from bot states working=" + counted.working + " idle=" + counted.idle + " held=" + counted.held);

const atlas = fleet.bots.find((b) => b.name === "Atlas") || {
  name: "Atlas",
  state: "WORKING",
  task: "touch book.json",
  proof: "quant/web/desk-dashboard/book.json",
};
const atlasAct = desk.fleetActivity(atlas);
if (atlasAct.label !== "Doing") fail("working bot must use Doing, got " + atlasAct.label);
if (!/book\.json/i.test(atlasAct.text) || /touch/i.test(atlasAct.text)) {
  fail("working task should be plain English, got " + atlasAct.text);
}
ok("working task: " + atlasAct.text);

const idleDash = desk.fleetActivity({
  name: "ALPHA",
  state: "IDLE",
  task: "—",
  proof: "OFFLOAD-QUEUE.md",
});
if (idleDash.label === "Doing") fail("idle bot must not say Doing");
if (idleDash.text !== "Last file OFFLOAD-QUEUE.md") fail("idle blank task expected last file, got " + idleDash.text);
ok("idle blank task uses last file, not Doing —");

const room = desk.fleetActivity({ state: "ROOM", task: "rare sync only", proof: "—" });
if (room.text !== "Waiting in room") fail("room task expected Waiting in room, got " + room.text);
ok("room task: " + room.text);

const orphanRole = desk.fleetRole({
  name: "New Bot",
  role: "ORPHAN SUSPENDED — DELETE via sidebar",
  lane: "none",
});
if (orphanRole !== "Unassigned") fail("orphan role expected Unassigned, got " + orphanRole);
ok("orphan role cleaned");

const alphaRole = desk.fleetRole({
  name: "ALPHA",
  role: "Quant CIO only — NOT CoS",
  lane: "none",
});
if (/NOT CoS/i.test(alphaRole)) fail("role still has shouting: " + alphaRole);
if (alphaRole !== "Quant CIO only") fail("ALPHA role expected Quant CIO only, got " + alphaRole);
ok("role shouting stripped: " + alphaRole);

const sorted = desk.sortFleetBots([
  { name: "Z", state: "IDLE", age_min: 10 },
  { name: "A", state: "WORKING", age_min: 0 },
  { name: "R", state: "ROOM", age_min: null },
]);
if (sorted[0].name !== "A" || sorted[2].name !== "R") fail("sort must be working, idle, then held");
ok("fleet sort working first");

if (desk.fleetAgeText({ state: "IDLE", age_min: 328.5 }) !== "idle 5.5h") {
  fail("age 328.5m should be idle 5.5h, got " + desk.fleetAgeText({ state: "IDLE", age_min: 328.5 }));
}
ok("idle age formats as hours");

console.log("ALL PASS");
