(function () {
  "use strict";

  const BOOK_MS = 10000;
  const MARK_MS = 5000;
  const SPOT = {
    ETH: "https://api.coinbase.com/v2/prices/ETH-USD/spot",
    BTC: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
  };
  const SOURCES = ["./book.json", "../scans/book.json"];

  const $ = (id) => document.getElementById(id);

  let bookRaw = null;
  let bookSrc = "";
  let bookAt = 0;
  let liveMark = null;
  let markAt = 0;
  let markAsset = "ETH";
  let marks = { ETH: null, BTC: null };
  let bookMarks = { ETH: null, BTC: null };

  function money(n, digits) {
    if (digits == null) digits = 2;
    if (n == null || Number.isNaN(Number(n))) return "—";
    const v = Number(n);
    const sign = v < 0 ? "-" : "";
    return sign + "$" + Math.abs(v).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function px(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return Number(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function qty(n, key) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    const v = Number(n);
    const stable = /usdc|usd|usdt/i.test(String(key || ""));
    const digits = stable ? 2 : Math.abs(v) >= 1 ? 4 : 6;
    return v.toLocaleString("en-US", {
      minimumFractionDigits: stable ? 2 : 0,
      maximumFractionDigits: digits,
    });
  }

  function truncAddr(a) {
    if (!a || typeof a !== "string") return "—";
    if (!a.startsWith("0x") || a.length < 10) return a;
    return "0x…" + a.slice(-4);
  }

  function truncTx(a) {
    if (!a || typeof a !== "string") return "—";
    if (!a.startsWith("0x") || a.length < 12) return a;
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  function pick(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] != null) return obj[k];
    }
    return null;
  }

  function num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }

  function compactTime(raw) {
    if (!raw) return "—";
    const s = String(raw).trim();
    const m = s.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?\s*(ET)?/i);
    if (m) return m[2] + (m[3] ? " ET" : "") + " " + m[1].slice(5);
    if (s.length > 22) return s.slice(0, 20);
    return s;
  }

  function residualRows(raw) {
    const resObj = raw.residuals;
    if (resObj && typeof resObj === "object" && !Array.isArray(resObj)) {
      return Object.entries(resObj)
        .filter(([, v]) => v != null)
        .map(([k, v]) => ({ key: String(k).replace(/_/g, " "), val: v }));
    }
    return [];
  }

  function normalizePos(p) {
    if (!p || typeof p !== "object") return null;
    return {
      id: pick(p, ["id"]),
      side: pick(p, ["side"]),
      market: pick(p, ["market"]),
      leverage: num(pick(p, ["leverage"])),
      collateralUsd: num(pick(p, ["collateralUsd", "collateral_usd"])),
      collateralToken: pick(p, ["collateralToken", "collateral_token"]),
      sizeUsd: num(pick(p, ["sizeUsd", "size_usd"])),
      entry: num(pick(p, ["entry"])),
      mark: num(pick(p, ["mark"])),
      sl: num(pick(p, ["sl"])),
      tp: num(pick(p, ["tp"])),
      slOnChain: pick(p, ["slOnChain", "sl_on_chain"]),
      tpOnChain: pick(p, ["tpOnChain", "tp_on_chain"]),
      venue: pick(p, ["venue"]),
      status: pick(p, ["status"]),
      upnlUsd: num(pick(p, ["upnlUsd", "upnl_usd"])),
    };
  }

  function positionsFrom(raw) {
    if (Array.isArray(raw.positions)) {
      return raw.positions.map(normalizePos).filter(Boolean);
    }
    const legacy = normalizePos(raw.position);
    return legacy ? [legacy] : [];
  }

  function isOpen(p) {
    if (!p) return false;
    const st = String(p.status || "").toUpperCase();
    if (st === "FLAT" || st === "CLOSED") return false;
    if (!p.side) return false;
    if (p.sizeUsd != null && Number(p.sizeUsd) === 0) return false;
    return true;
  }

  function upnlOf(p, mark) {
    const entry = p.entry;
    const size = p.sizeUsd;
    const m = mark != null ? mark : p.mark;
    if (entry == null || size == null || m == null || entry === 0) return p.upnlUsd;
    const side = String(p.side || "LONG").toUpperCase();
    if (side === "SHORT") return ((entry - m) / entry) * size;
    return ((m - entry) / entry) * size;
  }

  function normalize(raw) {
    const positions = positionsFrom(raw);
    const rows = residualRows(raw);
    let status = pick(raw, ["status"]);
    if (!status) {
      const open = positions.filter(isOpen);
      status = open.length ? "LIVE" : "FLAT";
    }
    const hist = raw.pnl_history || raw.history || [];
    const trades = raw.trades || [];
    return {
      updatedEt: pick(raw, ["updatedEt", "updated_et", "updatedAt", "updated_at"]),
      status: String(status).toUpperCase(),
      liquidUsd: num(pick(raw, ["liquidUsd", "liquid_usd"])),
      bookUpnl: num(pick(raw, ["openUpnlUsd", "upnl_usd", "open_upnl_usd"])),
      bookEquity: num(pick(raw, ["equityUsd", "equity_usd"])),
      residualRows: rows,
      wallet: pick(raw, ["wallet", "account"]),
      notes: pick(raw, ["notes"]),
      positions: positions,
      pnlHistory: Array.isArray(hist) ? hist : [],
      trades: Array.isArray(trades) ? trades : [],
      marks: (function () {
        const src = raw.marks || raw.spot || {};
        return {
          ETH: num(pick(src, ["ETH", "eth", "ETH-USD", "eth_usd"])),
          BTC: num(pick(src, ["BTC", "btc", "BTC-USD", "btc_usd"])),
        };
      })(),
    };
  }

  function assetOf(p) {
    const m = String((p && p.market) || "").toUpperCase();
    if (m.indexOf("BTC") >= 0 || m.indexOf("WBTC") >= 0) return "BTC";
    if (m.indexOf("ETH") >= 0) return "ETH";
    return markAsset || "ETH";
  }

  function markFor(p) {
    const a = assetOf(p);
    // Prefer marks.BTC / marks.ETH then p.mark. Never use cross-asset liveMark (ETH≠BTC).
    if (marks[a] != null) return marks[a];
    if (bookMarks[a] != null) return bookMarks[a];
    if (p && p.mark != null) return p.mark;
    return null;
  }

  function liveNumbers(book) {
    const open = book.positions.filter(isOpen);
    let upnl = 0;
    let coll = 0;
    const cards = book.positions.map(function (p) {
      const m = markFor(p);
      const u = isOpen(p) ? upnlOf(p, m) : 0;
      if (isOpen(p)) {
        upnl += u || 0;
        coll += p.collateralUsd || 0;
      }
      return { p: p, mark: m, upnl: u };
    });
    const primary = open.length ? assetOf(open[0]) : markAsset;
    const mark = marks[primary] != null
      ? marks[primary]
      : (bookMarks[primary] != null
        ? bookMarks[primary]
        : (open[0] && open[0].mark != null ? open[0].mark : null));
    const liquid = book.liquidUsd != null ? book.liquidUsd : 0;
    const equity = open.length ? liquid + coll + upnl : (book.bookEquity != null ? book.bookEquity : liquid);
    return { mark: mark, asset: primary, upnl: open.length ? upnl : book.bookUpnl, equity: equity, cards: cards, open: open };
  }

  function setTone(el, n) {
    el.classList.remove("up", "down");
    if (n == null || Number.isNaN(Number(n))) return;
    if (Number(n) > 0) el.classList.add("up");
    if (Number(n) < 0) el.classList.add("down");
  }

  function setBadge(status) {
    const el = $("badge");
    const s = String(status || "FLAT").toUpperCase();
    el.textContent = s;
    el.className = "badge";
    if (s === "LIVE" || s === "MIXED") el.classList.add("live");
    else if (s === "RISK") el.classList.add("risk");
    else el.classList.add("flat");
  }

  function ageText(ts) {
    if (!ts) return "—";
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return s + "s";
    return Math.floor(s / 60) + "m" + (s % 60) + "s";
  }

  function paintAge() {
    const el = $("mark-age");
    el.textContent = "age " + ageText(markAt);
    el.className = "age";
    if (!markAt) return;
    const s = (Date.now() - markAt) / 1000;
    if (s > 30) el.classList.add("dead");
    else if (s > 12) el.classList.add("stale");
    $("book-age").textContent = "book " + ageText(bookAt);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function kv(grid, k, v, vClass) {
    const cell = el("div");
    cell.append(el("span", "k", k), el("span", vClass || "v", v));
    grid.append(cell);
  }

  function renderTherm(host, pos, mark) {
    if (pos.sl == null || pos.tp == null || mark == null) {
      host.append(el("p", "empty", "no SL/TP"));
      return;
    }
    const sl = Number(pos.sl);
    const tp = Number(pos.tp);
    const m = Number(mark);
    const lo = Math.min(sl, tp);
    const hi = Math.max(sl, tp);
    const span = hi - lo || 1;
    const pct = Math.min(1, Math.max(0, (m - lo) / span));

    const levels = el("div", "levels");
    const a = el("div");
    a.append(el("span", "k", "SL"), el("span", "v sl", px(sl)));
    const b = el("div", "mk");
    b.append(el("span", "k", "MARK"), el("span", "v", px(m)));
    const c = el("div", "tp");
    c.append(el("span", "k", "TP"), el("span", "v tp", px(tp)));
    levels.append(a, b, c);

    const therm = el("div", "therm");
    const fill = el("div", "therm-fill");
    fill.style.width = (pct * 100).toFixed(2) + "%";
    const tSl = el("span", "tick sl");
    const tTp = el("span", "tick tp");
    const tMk = el("span", "tick mk");
    tSl.style.left = (((sl - lo) / span) * 100).toFixed(2) + "%";
    tTp.style.left = (((tp - lo) / span) * 100).toFixed(2) + "%";
    tMk.style.left = (pct * 100).toFixed(2) + "%";
    therm.append(fill, tSl, tMk, tTp);

    const toSl = ((m - sl) / m) * 100;
    const toTp = ((tp - m) / m) * 100;
    const dist = el("div", "dist");
    const d1 = el("span", toSl < 0 ? "down" : "", "SL " + (toSl >= 0 ? "+" : "") + toSl.toFixed(2) + "%");
    const d2 = el("span", toTp < 0 ? "down" : "up", "TP " + (toTp >= 0 ? "+" : "") + toTp.toFixed(2) + "%");
    dist.append(d1, d2);
    host.append(levels, therm, dist);
  }

  function renderPositions(cards) {
    const list = $("pos-list");
    list.replaceChildren();
    const openCards = cards.filter(function (c) { return isOpen(c.p); });
    $("pos-count").textContent = String(openCards.length);
    $("pos-empty").hidden = openCards.length > 0;
    for (const c of openCards) {
      const p = c.p;
      const card = el("article", "card");
      const head = el("div", "card-head");
      head.append(
        el("span", "", [p.venue, p.market].filter(Boolean).join(" ") || "pos"),
        el("span", String(p.side).toUpperCase() === "LONG" ? "v long" : "v short", p.side || "—")
      );
      const grid = el("div", "grid");
      kv(grid, "lev", p.leverage != null ? Number(p.leverage).toFixed(2) + "x" : "—");
      kv(grid, "coll", p.collateralUsd != null ? money(p.collateralUsd) : "—");
      kv(grid, "size", money(p.sizeUsd));
      kv(grid, "entry", px(p.entry));
      kv(grid, "mark", px(c.mark));
      kv(grid, "uPnL", money(c.upnl), "v" + (c.upnl > 0 ? " up" : c.upnl < 0 ? " down" : ""));
      card.append(head, grid);
      renderTherm(card, p, c.mark);
      list.append(card);
    }
  }

  function series(hist, key) {
    return hist.map(function (h) { return num(h[key]); });
  }

  function pathFrom(vals, w, h, pad) {
    const pts = vals.map(function (v, i) {
      return { i: i, v: v };
    }).filter(function (p) { return p.v != null; });
    if (pts.length < 2) return "";
    let lo = pts[0].v;
    let hi = pts[0].v;
    for (const p of pts) {
      if (p.v < lo) lo = p.v;
      if (p.v > hi) hi = p.v;
    }
    const span = hi - lo || 1;
    const n = vals.length - 1 || 1;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;
    return pts.map(function (p, idx) {
      const x = pad + (p.i / n) * innerW;
      const y = pad + (1 - (p.v - lo) / span) * innerH;
      return (idx ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
  }

  function renderSpark(hist) {
    const svg = $("spark");
    svg.replaceChildren();
    const w = 320;
    const h = 80;
    const pad = 4;
    const eq = series(hist, "equity_usd");
    const up = series(hist, "upnl_usd");
    const pe = pathFrom(eq, w, h, pad);
    const pu = pathFrom(up, w, h, pad);
    function line(d, color) {
      if (!d) return;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", color);
      p.setAttribute("stroke-width", "1.5");
      svg.appendChild(p);
    }
    line(pe, "#ffffff");
    line(pu, "#19c37d");
    $("spark-wrap").hidden = !pe && !pu;
  }

  function renderHist(hist) {
    const body = $("hist-body");
    body.replaceChildren();
    $("hist-empty").hidden = hist.length > 0;
    const rows = hist.slice().reverse();
    for (const h of rows) {
      const tr = el("tr");
      const u = num(pick(h, ["upnl_usd", "upnlUsd"]));
      const e = num(pick(h, ["equity_usd", "equityUsd"]));
      const tdU = el("td", u > 0 ? "up" : u < 0 ? "down" : "", money(u));
      tr.append(
        el("td", "", compactTime(pick(h, ["t", "updated_et"]))),
        tdU,
        el("td", "", money(e)),
        el("td", "", h.n_pos != null ? String(h.n_pos) : "—")
      );
      body.append(tr);
    }
    renderSpark(hist);
  }

  function renderTrades(trades) {
    const body = $("trades-body");
    body.replaceChildren();
    $("trades-empty").hidden = trades.length > 0;
    for (const t of trades) {
      const tr = el("tr");
      const pnl = num(pick(t, ["pnl_usd", "pnlUsd"]));
      const size = num(pick(t, ["size_usd", "sizeUsd"]));
      tr.append(
        el("td", "", compactTime(pick(t, ["t"]))),
        el("td", "", String(pick(t, ["kind"]) || "—")),
        el("td", "", String(pick(t, ["market"]) || "—")),
        el("td", "", String(pick(t, ["side"]) || "—")),
        el("td", "", money(size)),
        el("td", pnl > 0 ? "up" : pnl < 0 ? "down" : "", money(pnl)),
        el("td", "", truncTx(pick(t, ["tx"])))
      );
      body.append(tr);
    }
  }

  function renderResiduals(book) {
    const list = $("residuals-list");
    list.replaceChildren();
    for (const row of book.residualRows) {
      const li = el("li");
      li.append(el("span", "k", row.key), el("span", "mono", qty(row.val, row.key)));
      list.append(li);
    }
  }

  function render() {
    if (!bookRaw) return;
    const book = normalize(bookRaw);
    $("err").hidden = true;
    setBadge(book.status);
    const live = liveNumbers(book);
    markAsset = live.asset || markAsset;
    if ($("mark-label")) $("mark-label").textContent = markAsset;
    $("live-mark").textContent = live.mark != null ? px(live.mark) : (live.cards[0] && live.cards[0].mark != null ? px(live.cards[0].mark) : "—");
    $("liquid").textContent = money(book.liquidUsd);
    $("upnl").textContent = money(live.upnl);
    setTone($("upnl"), live.upnl);
    $("equity").textContent = money(live.equity);
    if ($("last-updated")) $("last-updated").textContent = book.updatedEt || "—";
    renderPositions(live.cards);
    renderHist(book.pnlHistory);
    renderTrades(book.trades);
    renderResiduals(book);
    $("wallet").textContent = truncAddr(book.wallet);
    $("notes").textContent = book.notes || "—";
    $("src").textContent = bookSrc;
    paintAge();
  }

  function showError(msg) {
    const el = $("err");
    el.hidden = false;
    el.textContent = msg;
    setBadge("RISK");
  }

  async function loadOne(url) {
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(url + " HTTP " + res.status);
    return res.json();
  }

  async function refreshBook() {
    let lastErr = null;
    for (const src of SOURCES) {
      try {
        bookRaw = await loadOne(src);
        bookSrc = src;
        bookAt = Date.now();
        const open = positionsFrom(bookRaw).filter(isOpen);
        if (open.length) markAsset = assetOf(open[0]);
        const bm = normalize(bookRaw).marks || {};
        bookMarks.ETH = bm.ETH != null ? bm.ETH : null;
        bookMarks.BTC = bm.BTC != null ? bm.BTC : null;
        // seed same-asset marks from book when spot lagging
        if (bm.BTC != null && marks.BTC == null) marks.BTC = bm.BTC;
        if (bm.ETH != null && marks.ETH == null) marks.ETH = bm.ETH;
        for (const p of open) {
          const a = assetOf(p);
          if (marks[a] == null && p.mark != null) marks[a] = p.mark;
        }
        render();
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    showError("book.json " + (lastErr && lastErr.message ? lastErr.message : "fail"));
  }

  function desiredAssets() {
    const set = {};
    if (bookRaw) {
      const open = positionsFrom(bookRaw).filter(isOpen);
      for (const p of open) set[assetOf(p)] = true;
    }
    if (!Object.keys(set).length) set[markAsset || "ETH"] = true;
    // always keep ETH for liquid residual pricing context when flat
    if (!set.ETH && !set.BTC) set.ETH = true;
    return Object.keys(set);
  }

  async function fetchSpot(asset) {
    const url = SPOT[asset];
    if (!url) throw new Error("no spot url for " + asset);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(asset + " HTTP " + res.status);
    const j = await res.json();
    const amt = num(j && j.data && j.data.amount);
    if (amt == null) throw new Error(asset + " no amount");
    return amt;
  }

  async function refreshMark() {
    try {
      if (bookRaw) {
        const open = positionsFrom(bookRaw).filter(isOpen);
        if (open.length) markAsset = assetOf(open[0]);
      }
      const assets = desiredAssets();
      let any = false;
      for (const a of assets) {
        try {
          marks[a] = await fetchSpot(a);
          any = true;
        } catch (e) { /* keep prior */ }
      }
      // Prefer open position's asset spot only — NEVER fall BTC→ETH (or cross-asset).
      if (marks[markAsset] != null) {
        liveMark = marks[markAsset];
        markAt = Date.now();
      } else if (bookRaw) {
        const open = positionsFrom(bookRaw).filter(isOpen);
        const bm = open[0] && open[0].mark != null ? open[0].mark : null;
        if (bm != null) {
          liveMark = bm;
          marks[markAsset] = bm;
          markAt = Date.now();
        } else if (!any) {
          throw new Error("no marks");
        }
      } else if (!any) {
        throw new Error("no marks");
      }
      render();
    } catch (e) {
      paintAge();
    }
  }

  refreshBook();
  refreshMark();
  setInterval(refreshBook, BOOK_MS);
  setInterval(refreshMark, MARK_MS);
  setInterval(paintAge, 1000);
})();
