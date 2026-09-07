#!/usr/bin/env node
"use strict";

import http from "http";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

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

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      let rel = urlPath === "/" ? "/index.html" : urlPath;
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(url + " HTTP " + res.status);
  return res.text();
}

const { server, port } = await startServer();
const base = "http://127.0.0.1:" + port;
try {
  const index = await fetchText(base + "/index.html");
  const app = await fetchText(base + "/app.js");
  const bookTxt = await fetchText(base + "/book.json");
  ok("fetched index/app/book");

  if (/\bid=["']badge["']/.test(index)) fail("served HTML has #badge");
  if (/>\s*LIVE\s*</.test(index) || /\bLIVE\b/.test(index)) fail("served HTML has LIVE badge text");
  if (!/id="equity"/.test(index)) fail("served HTML missing #equity");
  if (!/id="upnl"/.test(index)) fail("served HTML missing #upnl");
  if (!/id="liquid"/.test(index)) fail("served HTML missing #liquid");
  if (!/id="live-mark"/.test(index)) fail("served HTML missing #live-mark");
  ok("no LIVE/status badge in served HTML");

  JSON.parse(bookTxt);
  if (!/await refreshBook\(\);\s*await refreshMark\(\);/.test(app)) {
    fail("served app.js missing book-then-mark boot");
  }
  ok("served app.js boot order");

  const smoke = spawn(process.execPath, [path.join(root, "_qa", "smoke.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  const code = await new Promise((resolve) => smoke.on("close", resolve));
  if (code !== 0) fail("smoke.mjs exited " + code);
  ok("smoke.mjs still passes");

  const desk = require(path.join(root, "app.js"));
  const book = JSON.parse(bookTxt);
  desk.resetMarks();
  const live = desk.liveNumbers(desk.normalize(book));
  if (book.upnl_usd != null && Number(book.upnl_usd) !== 0) {
    if (Math.abs(Number(live.upnl) - Number(book.upnl_usd)) > 1e-9) {
      fail("e2e first-paint uPnL mismatch");
    }
  }
  ok("e2e smoke logic still passes");
  console.log("E2E ALL PASS");
} finally {
  server.close();
}
