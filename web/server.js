#!/usr/bin/env node
// Local dashboard for the Ollama offload router. Zero dependencies.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { timingSafeEqual, createHash } from "node:crypto";
import { loadConfig, saveConfig, validateConfig } from "../lib/config.js";
import { logEvent, readEvents, snip } from "../lib/log.js";
import { pickModel, loadedModels } from "../lib/models.js";
import { runGenerate, timings } from "../lib/generate.js";
import { classify } from "../lib/router.js";
import { readWebToken } from "./token.js";
import { computeStats } from "./stats.js";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const TYPES = { "index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "style.css": "text/css; charset=utf-8" };
const COOKIE = "offload_token";

const sha = (s) => createHash("sha256").update(String(s)).digest();
const safeEq = (a, b) => timingSafeEqual(sha(a), sha(b));

const LOGIN = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=color-scheme content="light dark"><title>clauderouter</title>
<style>:root{--bg:#f6f7f9;--s:#fff;--b:#e3e5ea;--t:#16181d;--m:#5b6270;--a:#4f46e5;--af:#fff}@media(prefers-color-scheme:dark){:root{--bg:#0f1115;--s:#171a20;--b:#2a2f39;--t:#e8eaee;--m:#9aa3b2;--a:#8183f4;--af:#0f1115}}
*{box-sizing:border-box}body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:var(--bg);color:var(--t)}
form{display:grid;gap:16px;width:100%;max-width:22rem;background:var(--s);border:1px solid var(--b);border-radius:12px;padding:24px}
h1{margin:0;font-size:20px;letter-spacing:-.02em}p{margin:0;color:var(--m);font-size:13px}
input,button{font:inherit;min-height:44px;padding:8px 12px;border-radius:8px;border:1px solid var(--b);background:var(--s);color:var(--t);width:100%}
button{background:var(--a);border-color:var(--a);color:var(--af);font-weight:600;cursor:pointer}
:focus-visible{outline:2px solid var(--a);outline-offset:2px}</style>
<form method=get action=/><h1>clauderouter</h1><p>Enter your access token to continue.</p><input name=token type=password placeholder="Access token" aria-label="Access token" autofocus><button>Sign in</button></form>`;

const readBody = (req) => new Promise((resolve, reject) => {
  let n = 0;
  const chunks = [];
  req.on("data", (c) => { n += c.length; if (n > 1e6) { reject(new Error("body too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new Error("invalid JSON")); } });
  req.on("error", reject);
});

async function ollamaGet(path) {
  const res = await fetch(`${loadConfig().ollamaHost}${path}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const MAX_FAILS = 10;
const LOCK_MS = 10 * 60 * 1000;

export function createApp({ token = readWebToken(), fails = new Map(), now = Date.now } = {}) {
  const send = (res, code, body, headers = {}) => {
    const json = typeof body !== "string";
    res.writeHead(code, { "content-type": json ? "application/json" : "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
    res.end(json ? JSON.stringify(body) : body);
  };

  const api = {
    "GET /api/stats": () => computeStats(readEvents()),
    "GET /api/events": (req, url) => {
      const type = url.searchParams.get("type");
      const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 500);
      const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
      const all = readEvents().filter((e) => !type || e.type === type).reverse();
      return { total: all.length, offset, limit, events: all.slice(offset, offset + limit) };
    },
    "GET /api/config": () => loadConfig({ raw: true }),
    "POST /api/config": async (req) => {
      const { errors, config } = validateConfig(await readBody(req));
      if (errors.length) return [400, { errors }];
      saveConfig(config);
      return { config };
    },
    "GET /api/ollama": async () => {
      const [tags, ps] = await Promise.allSettled([ollamaGet("/api/tags"), ollamaGet("/api/ps")]);
      return {
        up: tags.status === "fulfilled",
        models: tags.status === "fulfilled" ? tags.value.models.map((m) => ({ name: m.name, size: m.size, parameter_size: m.details?.parameter_size })) : [],
        running: ps.status === "fulfilled" ? ps.value.models.map((m) => ({ name: m.name, size: m.size, size_vram: m.size_vram, context_length: m.context_length, expires_at: m.expires_at })) : [],
      };
    },
    "POST /api/route-test": async (req) => {
      const { prompt = "" } = await readBody(req);
      const { rule, action, source, hint } = classify(String(prompt), loadConfig());
      return { rule, action, source, hint };
    },
    "POST /api/playground": async (req) => {
      const { prompt, model, system } = await readBody(req);
      if (!prompt) return [400, { errors: ["prompt required"] }];
      const cfg = loadConfig();
      const picked = pickModel({ prompt, inputChars: prompt.length + (system?.length || 0), explicitModel: model, loaded: model ? [] : await loadedModels(cfg.ollamaHost), cfg });
      const extra = { route_reason: picked.reason, num_ctx: picked.numCtx };
      const t0 = Date.now();
      try {
        const { r, model: used, fallbackFrom, fallbackError } = await runGenerate({ cfg, body: { model: picked.model, prompt, system: system || undefined, think: cfg.think, options: { num_ctx: picked.numCtx } } });
        const ms = Date.now() - t0;
        logEvent("generate", { model: used, ...extra, ms, ok: true, prompt_eval_count: r.prompt_eval_count, eval_count: r.eval_count, ...timings(r), ...(fallbackFrom ? { fallback_from: fallbackFrom, fallback_error: fallbackError } : {}), file_bytes: 0, est_claude_tokens_saved: 0, prompt: snip(prompt) });
        return { response: r.response, ms, model: used, route_reason: picked.reason, eval_count: r.eval_count, ...(fallbackFrom ? { fallback_from: fallbackFrom } : {}) };
      } catch (e) {
        logEvent("generate", { model: picked.model, ...extra, ms: Date.now() - t0, ok: false, error: String(e.message).slice(0, 200), ...(e.fallbackFrom ? { fallback_from: e.fallbackFrom } : {}), file_bytes: 0, est_claude_tokens_saved: 0, prompt: snip(prompt) });
        return [502, { errors: [e.message] }];
      }
    },
  };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const ip = req.socket.remoteAddress;
      const lock = fails.get(ip);
      if (lock?.until > now()) return send(res, 429, { error: "too many failed logins, try again later" });
      const cookie = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1];

      const qt = url.searchParams.get("token");
      if (req.method === "GET" && url.pathname === "/" && qt && safeEq(qt, token)) {
        fails.delete(ip);
        return send(res, 302, "", { location: "/", "set-cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/` });
      }

      const viaBearer = bearer !== undefined && safeEq(bearer, token);
      const authed = viaBearer || (cookie !== undefined && safeEq(cookie, token));
      if (!authed) {
        if (qt !== null || bearer !== undefined || cookie !== undefined) {
          const n = (lock && !lock.until ? lock.n : 0) + 1;
          fails.set(ip, n >= MAX_FAILS ? { n, until: now() + LOCK_MS } : { n });
        }
        return req.headers.accept?.includes("text/html") && !url.pathname.startsWith("/api/")
          ? send(res, 401, LOGIN)
          : send(res, 401, { error: "unauthorized" });
      }

      if (lock) fails.delete(ip);

      if (req.method === "POST") {
        const origin = req.headers.origin;
        const ok = origin ? (() => { try { return new URL(origin).host === req.headers.host; } catch { return false; } })() : viaBearer;
        if (!ok) return send(res, 403, { error: "cross-origin request rejected" });
      }

      const handler = api[`${req.method} ${url.pathname}`];
      if (handler) {
        let out = await handler(req, url);
        let code = 200;
        if (Array.isArray(out)) [code, out] = out;
        return send(res, code, out);
      }
      if (req.method === "GET") {
        const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        if (TYPES[name]) {
          res.writeHead(200, { "content-type": TYPES[name], "cache-control": "no-store", "x-content-type-options": "nosniff" });
          return res.end(await readFile(join(PUBLIC, name)));
        }
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      if (!res.headersSent) send(res, /^(invalid JSON|body too large)/.test(e.message) ? 400 : 500, { error: e.message });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.OFFLOAD_WEB_PORT) || 3460;
  // Always localhost; OFFLOAD_WEB_HOST adds comma-separated extra addresses (e.g. the LAN IP).
  const hosts = ["127.0.0.1", ...(process.env.OFFLOAD_WEB_HOST || "").split(",").map((h) => h.trim()).filter((h) => h && h !== "127.0.0.1")];
  const shared = { token: readWebToken(), fails: new Map() };
  for (const host of hosts) createApp(shared).listen(port, host, () => console.log(`ollama-offload dashboard on http://${host}:${port}/`));
}
