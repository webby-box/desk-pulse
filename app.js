(function (root) {
  "use strict";

  const BOOK_MS = 5000;
  const MARK_MS = 5000;
  const SPOT = {
    ETH: "https://api.coinbase.com/v2/prices/ETH-USD/spot",
    BTC: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
    LINK: "https://api.coinbase.com/v2/prices/LINK-USD/spot",
  };
  const SOURCES = [
    "./book.json",
    "https://cdn.jsdelivr.net/gh/webby-box/desk-pulse@main/book.json",
    "https://raw.githubusercontent.com/webby-box/desk-pulse/main/book.json",
    "../scans/book.json",
  ];

  const $ = (id) => document.getElementById(id);

  let bookRaw = null;
  let bookSrc = "";
  let bookAt = 0;
  let liveMark = null;
  let markAt = 0;
  let markAsset = "ETH";
  let marks = { ETH: null, BTC: null, LINK: null };
  let bookMarks = { ETH: null, BTC: null, LINK: null };

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
    const histRaw = raw.pnl_history || raw.history || [];
    const hist = (Array.isArray(histRaw) ? histRaw : []).filter(function (h) {
      if (!h || typeof h !== "object") return false;
      const e = num(pick(h, ["equity_usd", "equityUsd"]));
      const l = num(pick(h, ["liquid_usd", "liquidUsd"]));
      // drop corrupt/null equity points so spark/table do not break
      return e != null && l != null;
    });
    const trades = raw.trades || [];
    return {
      updatedEt: pick(raw, ["updatedEt", "updated_et", "updatedAt", "updated_at"]),
      status: String(status).toUpperCase(),
      liquidUsd: num(pick(raw, ["liquidUsd", "liquid_usd"])),
      bookUpnl: num(pick(raw, ["openUpnlUsd", "upnl_usd", "open_upnl_usd"])),
      bookEquity: num(pick(raw, ["equityUsd", "equity_usd"])),
      fundingUsd: num(pick(raw, ["fundingUsd", "funding_usd"])),
      fundingNote: pick(raw, ["fundingNote", "funding_note"]),
      totalPnlUsd: num(pick(raw, ["totalPnlUsd", "total_pnl_usd"])),
      totalPnlPct: num(pick(raw, ["totalPnlPct", "total_pnl_pct"])),
      residualRows: rows,
      wallet: pick(raw, ["wallet", "account"]),
      notes: pick(raw, ["notes"]),
      positions: positions,
      pnlHistory: Array.isArray(hist) ? hist : [],
      trades: Array.isArray(trades) ? trades : [],
      marks: (function () {
        const src = raw.marks || raw.spot || {};
        // Prefer nested marks/spot; also accept top-level mark_eth / mark_btc / mark_link (never cross-seed ETH into LINK).
        const eth = num(pick(src, ["ETH", "eth", "ETH-USD", "eth_usd"])) ?? num(pick(raw, ["mark_eth", "markEth"]));
        const btc = num(pick(src, ["BTC", "btc", "BTC-USD", "btc_usd"])) ?? num(pick(raw, ["mark_btc", "markBtc"]));
        const link = num(pick(src, ["LINK", "link", "LINK-USD", "link_usd"])) ?? num(pick(raw, ["mark_link", "markLink"]));
        return { ETH: eth, BTC: btc, LINK: link };
      })(),
    };
  }

  function assetOf(p) {
    const m = String((p && p.market) || "").toUpperCase();
    if (m.indexOf("LINK") >= 0) return "LINK";
    if (m.indexOf("BTC") >= 0 || m.indexOf("WBTC") >= 0) return "BTC";
    if (m.indexOf("ETH") >= 0) return "ETH";
    // Market set but unknown: return recognizable token symbol, else null (use p.mark).
    // Never default unknown-with-market to ETH — that cross-filled LINK with ETH (~2505).
    if (m) {
      const tok = (m.split(/[\/:\-\s]/)[0] || "").replace(/[^A-Z0-9]/g, "");
      if (tok && tok !== "GMX" && tok !== "USD" && tok !== "USDC") return tok;
      return null;
    }
    // Only fall back to markAsset when market empty.
    return markAsset || "ETH";
  }

  function markFor(p) {
    const a = assetOf(p);
    // Prefer marks.LINK / marks.BTC / marks.ETH then p.mark. Never cross-fill LINK↔ETH (or ETH≠BTC).
    if (marks[a] != null) return marks[a];
    if (bookMarks[a] != null) return bookMarks[a];
    if (p && p.mark != null) return p.mark;
    return null;
  }

  function liveNumbers(book) {
    const open = book.positions.filter(isOpen);
    let upnl = 0;
    let coll = 0;
    let usedWriter = false;
    const cards = book.positions.map(function (p) {
      const a = assetOf(p);
      const m = markFor(p);
      let u = 0;
      if (isOpen(p)) {
        // Prefer writer uPnL until live same-asset Coinbase spot is in marks[a].
        // Do not compute from bookMarks / p.mark alone (stale book.marks can zero out first paint).
        if (marks[a] != null) {
          u = upnlOf(p, marks[a]);
        } else if (p.upnlUsd != null) {
          u = p.upnlUsd;
          usedWriter = true;
        } else if (book.bookUpnl != null) {
          u = book.bookUpnl;
          usedWriter = true;
        } else {
          u = upnlOf(p, m);
        }
        upnl += u || 0;
        coll += p.collateralUsd || 0;
      }
      return { p: p, mark: m, upnl: u };
    });
    const primary = open.length ? assetOf(open[0]) : markAsset;
    // marks.ASSET → bookMarks.ASSET → p.mark only; never cross-asset liveMark
    const mark = marks[primary] != null
      ? marks[primary]
      : (bookMarks[primary] != null
        ? bookMarks[primary]
        : (open[0] && open[0].mark != null ? open[0].mark : null));
    const liquid = book.liquidUsd != null ? book.liquidUsd : 0;
    let totalUpnl;
    if (!open.length) {
      totalUpnl = book.bookUpnl;
    } else if (usedWriter && open.every(function (p) { return marks[assetOf(p)] == null; }) && book.bookUpnl != null) {
      // single writer book-level upnl is authoritative when no live spots yet
      totalUpnl = book.bookUpnl;
      // keep per-card writer values; sync sum for equity
      upnl = book.bookUpnl;
    } else {
      totalUpnl = upnl;
    }
    const equity = open.length ? liquid + coll + (totalUpnl || 0) : (book.bookEquity != null ? book.bookEquity : liquid);
    return { mark: mark, asset: primary, upnl: totalUpnl, equity: equity, cards: cards, open: open };
  }

  function setTone(el, n) {
    el.classList.remove("up", "down");
    if (n == null || Number.isNaN(Number(n))) return;
    if (Number(n) > 0) el.classList.add("up");
    if (Number(n) < 0) el.classList.add("down");
  }

  function setBadge(status) {
    const el = $("badge");
    if (!el) return; // badge removed from UI
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


  function bookStaleSec() {
    if (!bookAt) return null;
    return Math.floor((Date.now() - bookAt) / 1000);
  }

  function paintStale() {
    const el = $("err");
    if (!el) return;
    const age = bookStaleSec();
    // only show stale when we have a book but it is older than 90s wall vs updatedEt parse hard —
    // use fetch age: if last successful refresh got a book whose updated_et is >3 min behind wall clock, warn.
    if (!bookRaw) return;
    const et = (normalize(bookRaw).updatedEt || "");
    // parse "2026-09-07 10:49:02 ET" loosely as local ET wall
    const m = String(et).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return;
    const y=+m[1], mo=+m[2]-1, d=+m[3], hh=+m[4], mm=+m[5], ss=+(m[6]||0);
    // treat as America/New_York by constructing UTC-4/-5 roughly via Date with offset -4 for Sep
    const approx = Date.UTC(y, mo, d, hh+4, mm, ss); // EDT
    const lagMin = (Date.now() - approx) / 60000;
    if (lagMin > 3) {
      el.hidden = false;
      el.textContent = "Book stale · " + et + " · lag ~" + Math.round(lagMin) + "m — waiting for next push";
      el.className = "err stale";
    } else if (el.className === "err stale") {
      el.hidden = true;
      el.textContent = "";
      el.className = "err";
    }
  }

  function paintAge() {
    const el = $("mark-age");
    if (el) {
      el.textContent = "age " + ageText(markAt);
      el.className = "age";
      if (markAt) {
        const s = (Date.now() - markAt) / 1000;
        if (s > 30) el.classList.add("dead");
        else if (s > 12) el.classList.add("stale");
      }
    }
    const ba = $("book-age");
    if (ba) ba.textContent = "book " + ageText(bookAt);
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
    const pc = $("pos-count");
    if (pc) pc.textContent = String(openCards.length);
    const pe = $("pos-empty");
    if (pe) pe.hidden = openCards.length > 0;
    for (const c of openCards) {
      const p = c.p;
      const card = el("article", "card");
      const head = el("div", "card-head");
      const side = String(p.side || "").toUpperCase();
      const pill = el("span", "pill " + (side === "SHORT" ? "short" : "long"), side || "—");
      head.append(
        el("span", "mkt", [p.venue, p.market].filter(Boolean).join(" ") || "Position"),
        pill
      );
      const grid = el("div", "grid");
      kv(grid, "Lev", p.leverage != null ? Number(p.leverage).toFixed(2) + "×" : "—");
      kv(grid, "Size", money(p.sizeUsd));
      kv(grid, "Entry", px(p.entry));
      kv(grid, "Mark", px(c.mark));
      kv(grid, "uPnL", money(c.upnl), "v" + (c.upnl > 0 ? " up" : c.upnl < 0 ? " down" : ""));
      card.append(head, grid);
      renderTherm(card, p, c.mark);
      list.append(card);
    }
  }

  function series(hist, key) {
    return hist.map(function (h) { return num(h[key]); }).filter(function (v) { return v != null; });
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
    const h = 64;
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
        el("td", "", String(pick(h, ["n_pos", "n"]) != null ? pick(h, ["n_pos", "n"]) : "—"))
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
        el("td", "", String(pick(t, ["kind", "k"]) || "—")),
        el("td", "", String(pick(t, ["market"]) || "—")),
        el("td", "", String(pick(t, ["side"]) || "—")),
        el("td", "", size != null ? money(size) : "—"),
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
    const tpEl = $("total-pnl");
    if (tpEl) {
      const fund = book.fundingUsd != null ? book.fundingUsd : 87;
      const tp = book.totalPnlUsd != null ? book.totalPnlUsd : (live.equity != null ? live.equity - fund : null);
      const pct = book.totalPnlPct != null ? book.totalPnlPct : (fund && tp != null ? (tp / fund) * 100 : null);
      if (tp == null) {
        tpEl.textContent = "—";
      } else {
        const pctS = pct == null ? "" : " · " + (pct >= 0 ? "+" : "") + Number(pct).toFixed(2) + "%";
        tpEl.textContent = "Total vs $" + Number(fund).toFixed(0) + " fund " + money(tp) + pctS;
      }
      setTone(tpEl, tp);
    }

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
        bookMarks.LINK = bm.LINK != null ? bm.LINK : null;
        // Never cross-fill LINK↔ETH.
        // Do not seed live marks[] from book — first paint uses writer upnl until Coinbase spot lands.
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
      for (const p of open) { const a = assetOf(p); if (a) set[a] = true; }
    }
    if (!Object.keys(set).length) set[markAsset || "ETH"] = true;
    // always keep ETH for liquid residual pricing context when flat (never invent LINK↔ETH)
    if (!set.ETH && !set.BTC && !set.LINK) set.ETH = true;
    return Object.keys(set).filter(Boolean);
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
      // Prefer open position's asset spot only — NEVER fall LINK→ETH / BTC→ETH (or cross-asset).
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

  const api = {
    normalize: normalize,
    liveNumbers: liveNumbers,
    assetOf: assetOf,
    markFor: markFor,
    isOpen: isOpen,
    positionsFrom: positionsFrom,
    getMarks: function () { return marks; },
    setMarks: function (next) { marks = Object.assign({ ETH: null, BTC: null, LINK: null }, next || {}); },
    setBookMarks: function (next) { bookMarks = Object.assign({ ETH: null, BTC: null, LINK: null }, next || {}); },
    resetMarks: function () {
      marks = { ETH: null, BTC: null, LINK: null };
      bookMarks = { ETH: null, BTC: null, LINK: null };
      liveMark = null;
      markAsset = "ETH";
    },
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else if (root) {
    root.__desk = api;
  }

  if (typeof document !== "undefined") {
    (async function boot() {
      await refreshBook();
      await refreshMark();
    })();
    setInterval(refreshBook, BOOK_MS);
    setInterval(refreshMark, MARK_MS);
    setInterval(paintAge, 1000);
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
