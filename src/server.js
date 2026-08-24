import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "./engines/edge.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "..", "public");
const clients = new Set();
const logs = [{ at: new Date().toISOString(), level: "INFO", message: "Moteur démo prêt. Aucun ordre réel ne sera envoyé." }];

const state = {
  running: false, mode: "DEMO", symbol: "BTCUSDT", market: "BTC Up or Down · 15m", timeLeft: 642,
  spot: 104382.12, chainlink: 104377.86, up: 0.57, down: 0.43, modelUp: 0.64, modelDown: 0.36,
  signal: { action: "ENTER", side: "UP", strength: "GOOD", edge: 0.07, phase: "EARLY", reason: "Momentum au-dessus de la VWAP" },
  portfolio: { initial: 1000, cash: 1000, exposure: 0, pnl: 0, trades: 0, wins: 0, losses: 0, drawdown: 0 },
  position: null, history: [], config: { capital: 1000, positionSize: 10, threshold: 0.05, stopLoss: 12, takeProfit: 24, interval: 5 }
};

function log(message, level = "INFO") { logs.unshift({ at: new Date().toISOString(), level, message }); logs.splice(30); }
function snapshot() { return { ...state, logs }; }
function broadcast() { const data = `data: ${JSON.stringify(snapshot())}\n\n`; for (const res of clients) res.write(data); }
function tick() {
  if (!state.running) return;
  state.spot += (Math.random() - 0.46) * 38; state.chainlink = state.spot + (Math.random() - 0.5) * 15;
  state.up = Math.max(0.05, Math.min(0.95, state.up + (Math.random() - 0.48) * 0.015)); state.down = 1 - state.up;
  state.modelUp = Math.max(0.1, Math.min(0.9, state.modelUp + (Math.random() - 0.48) * 0.02)); state.modelDown = 1 - state.modelUp;
  state.timeLeft = state.timeLeft <= 0 ? 899 : state.timeLeft - 1;
  state.signal = decide({ remainingMinutes: state.timeLeft / 60, edgeUp: state.modelUp - state.up, edgeDown: state.modelDown - state.down, modelUp: state.modelUp, modelDown: state.modelDown });
  if (state.signal.side && !state.position && state.signal.action === "ENTER") {
    state.position = { side: state.signal.side, size: state.config.positionSize, entry: state.signal.side === "UP" ? state.up : state.down, openedAt: new Date().toISOString() };
    state.portfolio.exposure = state.config.positionSize;
    state.portfolio.trades += 1;
    log(`Entrée simulée ${state.signal.side} · ${state.config.positionSize}%`);
  }
  if (state.position) {
    const current = state.position.side === "UP" ? state.up : state.down;
    state.portfolio.exposure = state.position.size;
    state.portfolio.pnl = (current - state.position.entry) * state.position.size * state.portfolio.initial;
  }
  broadcast();
}
setInterval(tick, 1000);

function json(res, data, status = 200) { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); }
async function body(req) { let s = ""; for await (const chunk of req) s += chunk; return s ? JSON.parse(s) : {}; }
function verify(value) { try { const u = new URL(value); return ["http:", "https:", "ws:", "wss:"].includes(u.protocol); } catch { return false; } }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/state") return json(res, snapshot());
  if (url.pathname === "/api/events") { res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }); res.write(`data: ${JSON.stringify(snapshot())}\n\n`); clients.add(res); req.on("close", () => clients.delete(res)); return; }
  if (url.pathname === "/api/control" && req.method === "POST") { const data = await body(req); if (["start", "pause", "stop", "reset"].includes(data.action)) { if (data.action === "start") state.running = true; if (data.action === "pause" || data.action === "stop") state.running = false; if (data.action === "reset") { state.running = false; state.portfolio = { initial: state.config.capital, cash: state.config.capital, exposure: 0, pnl: 0, trades: 0, wins: 0, losses: 0, drawdown: 0 }; state.position = null; state.history = []; } log(`Action navigateur: ${data.action}`); broadcast(); return json(res, snapshot()); } return json(res, { error: "Action invalide" }, 400); }
  if (url.pathname === "/api/config" && req.method === "POST") { const data = await body(req); const c = { ...state.config, ...data }; if (!Number.isFinite(Number(c.capital)) || Number(c.capital) < 100 || Number(c.capital) > 10000000) return json(res, { error: "Capital entre 100 et 10 000 000 requis." }, 400); state.config = { ...c, capital: Number(c.capital) }; if (!state.running) state.portfolio.initial = state.config.capital; log("Configuration démo mise à jour"); broadcast(); return json(res, snapshot()); }
  if (url.pathname === "/api/verify" && req.method === "POST") { const data = await body(req); const ok = verify(data.url); return json(res, { ok, latency: ok ? Math.floor(40 + Math.random() * 160) : null, message: ok ? "URL valide et joignable en simulation" : "URL invalide" }); }
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1); const filePath = path.resolve(publicDir, file); if (!filePath.startsWith(publicDir)) return json(res, { error: "Forbidden" }, 403); fs.readFile(filePath, (err, content) => { if (err) return json(res, { error: "Not found" }, 404); const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html"; res.writeHead(200, { "Content-Type": type }); res.end(content); });
});
server.listen(process.env.PORT || 3000, () => console.log("[v0] Dashboard démo sur http://localhost:" + (process.env.PORT || 3000)));
