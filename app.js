(function () {
  "use strict";

  const REFRESH_MS = 60000;
  const SOURCES = ["./book.json", "../scans/book.json"];

  const $ = (id) => document.getElementById(id);

  function money(n, digits = 2) {
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

  function pick(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] != null) return obj[k];
    }
    return null;
  }

  function compactTime(raw) {
    if (!raw) return "—";
    const s = String(raw).trim();
    const m = s.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?\s*(ET)?/i);
    if (m) return m[2] + (m[3] ? " ET" : "") + " · " + m[1].slice(5);
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

  /** Normalize camelCase brief + live snake_case writer */
  function normalize(raw) {
    const posRaw = raw.position || null;
    let residualsUsd = pick(raw, ["residualsUsd", "residuals_usd"]);
    let residualsNote = pick(raw, ["residualsNote", "residuals_note"]);
    const rows = residualRows(raw);
    if (rows.length && residualsNote == null) {
      residualsNote = rows.map((r) => r.key + "=" + r.val).join(" · ");
    }
    if (rows.length && residualsUsd == null) residualsUsd = 0;

    const pos = posRaw
      ? {
          side: pick(posRaw, ["side"]),
          market: pick(posRaw, ["market"]),
          leverage: pick(posRaw, ["leverage"]),
          collateralUsd: pick(posRaw, ["collateralUsd", "collateral_usd"]),
          collateralToken: pick(posRaw, ["collateralToken", "collateral_token"]),
          sizeUsd: pick(posRaw, ["sizeUsd", "size_usd"]),
          entry: pick(posRaw, ["entry"]),
          mark: pick(posRaw, ["mark"]),
          sl: pick(posRaw, ["sl"]),
          tp: pick(posRaw, ["tp"]),
          slOnChain: pick(posRaw, ["slOnChain", "sl_on_chain"]),
          tpOnChain: pick(posRaw, ["tpOnChain", "tp_on_chain"]),
          venue: pick(posRaw, ["venue"]),
          status: pick(posRaw, ["status"]),
        }
      : null;

    let status = pick(raw, ["status"]);
    if (!status && pos && pos.status) status = pos.status;
    if (!status) status = pos && pos.side ? "LIVE" : "FLAT";

    return {
      updatedEt: pick(raw, ["updatedEt", "updated_et", "updatedAt", "updated_at"]),
      status: String(status).toUpperCase(),
      liquidUsd: pick(raw, ["liquidUsd", "liquid_usd"]),
      openUpnlUsd: pick(raw, ["openUpnlUsd", "upnl_usd", "open_upnl_usd"]),
      equityUsd: pick(raw, ["equityUsd", "equity_usd"]),
      residualsUsd: residualsUsd,
      residualsNote: residualsNote,
      residualRows: rows,
      wallet: pick(raw, ["wallet", "account"]),
      venue: pick(raw, ["venue"]) || (pos && pos.venue) || null,
      chain: pick(raw, ["chain"]),
      notes: pick(raw, ["notes"]),
      position: pos,
    };
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
    if (s === "LIVE") el.classList.add("badge--live");
    else if (s === "RISK") el.classList.add("badge--risk");
    else el.classList.add("badge--flat");
  }

  function placeTick(id, pct) {
    const clamped = Math.min(100, Math.max(0, pct));
    $(id).style.left = clamped.toFixed(2) + "%";
  }

  function renderTherm(pos) {
    const wrap = $("therm-wrap");
    const empty = $("therm-empty");
    if (!pos || pos.sl == null || pos.tp == null || pos.mark == null) {
      wrap.hidden = true;
      empty.hidden = false;
      return;
    }
    wrap.hidden = false;
    empty.hidden = true;

    const sl = Number(pos.sl);
    const tp = Number(pos.tp);
    const mark = Number(pos.mark);
    const lo = Math.min(sl, tp);
    const hi = Math.max(sl, tp);
    const span = hi - lo || 1;
    const pct = Math.min(1, Math.max(0, (mark - lo) / span));

    $("therm-fill").style.width = (pct * 100).toFixed(2) + "%";
    placeTick("tick-sl", ((sl - lo) / span) * 100);
    placeTick("tick-tp", ((tp - lo) / span) * 100);
    placeTick("tick-m", pct * 100);

    $("sl-px").textContent = px(sl);
    $("tp-px").textContent = px(tp);
    $("mark-lvl").textContent = px(mark);

    const toSl = ((mark - sl) / mark) * 100;
    const toTp = ((tp - mark) / mark) * 100;
    $("dist-sl").textContent =
      "SL " + (toSl >= 0 ? "+" : "") + toSl.toFixed(2) + "%";
    $("dist-tp").textContent =
      "TP " + (toTp >= 0 ? "+" : "") + toTp.toFixed(2) + "%";
    $("dist-sl").className = toSl < 0 ? "down" : "";
    $("dist-tp").className = toTp < 0 ? "down" : "up";
  }

  function renderResiduals(book) {
    const list = $("residuals-list");
    const num = $("residuals");
    const note = $("residuals-note");
    list.replaceChildren();

    if (book.residualRows && book.residualRows.length) {
      num.hidden = true;
      list.hidden = false;
      for (const row of book.residualRows) {
        const li = document.createElement("li");
        const k = document.createElement("span");
        k.className = "res-k";
        k.textContent = row.key;
        const v = document.createElement("span");
        v.className = "res-v";
        v.textContent = qty(row.val, row.key);
        li.append(k, v);
        list.append(li);
      }
      note.hidden = true;
      note.textContent = "";
      return;
    }

    num.hidden = false;
    list.hidden = true;
    note.hidden = false;
    num.textContent = money(book.residualsUsd);
    note.textContent = book.residualsNote || "—";
  }

  function render(raw, source) {
    const book = normalize(raw);
    $("err").hidden = true;
    setBadge(book.status);

    const clock = $("clock");
    const clockMain = $("clock-main");
    clock.title = book.updatedEt || "";
    clockMain.textContent = compactTime(book.updatedEt);

    $("liquid").textContent = money(book.liquidUsd);
    $("upnl").textContent = money(book.openUpnlUsd);
    setTone($("upnl"), book.openUpnlUsd);
    $("equity").textContent = money(book.equityUsd);

    const pos = book.position;
    const flat =
      book.status === "FLAT" || !pos || !pos.side || Number(pos.sizeUsd) === 0;
    $("pos-empty").hidden = !flat;
    $("pos-body").hidden = flat;

    const venueBits = [book.venue, book.chain, pos && pos.market].filter(Boolean);
    $("venue").textContent = venueBits.join(" · ") || "—";

    if (!flat) {
      const sideEl = $("side");
      sideEl.textContent = pos.side;
      sideEl.className =
        "v " + (String(pos.side).toUpperCase() === "LONG" ? "long" : "short");
      $("lev").textContent =
        pos.leverage != null ? Number(pos.leverage).toFixed(2) + "×" : "—";
      $("coll").textContent =
        pos.collateralUsd != null
          ? money(pos.collateralUsd) +
            (pos.collateralToken ? " " + pos.collateralToken : "")
          : "—";
      $("size").textContent = money(pos.sizeUsd);
      $("entry").textContent = px(pos.entry);
      $("mark-px").textContent = px(pos.mark);

      const flags = [];
      if (pos.slOnChain === true) flags.push("SL on-chain");
      else if (pos.slOnChain === false) flags.push("SL missing");
      if (pos.tpOnChain === true) flags.push("TP on-chain");
      else if (pos.tpOnChain === false) flags.push("TP missing");
      $("chain-flags").textContent = flags.join(" · ") || "levels set";
      renderTherm(pos);
    } else {
      $("chain-flags").textContent = "—";
      renderTherm(null);
    }

    renderResiduals(book);
    $("wallet").textContent = truncAddr(book.wallet);
    $("notes").textContent = book.notes || "—";
    $("src").textContent = "src " + source;
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
    if (!res.ok) throw new Error(url + " → HTTP " + res.status);
    return res.json();
  }

  async function refresh() {
    let lastErr = null;
    for (const src of SOURCES) {
      try {
        const book = await loadOne(src);
        render(book, src);
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    showError(
      "book.json unreachable — " +
        (lastErr && lastErr.message ? lastErr.message : "fetch failed")
    );
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
