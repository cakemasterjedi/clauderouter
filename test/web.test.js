import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tempEnv } from "./helpers.js";
import { createApp } from "../web/server.js";
import { readWebToken } from "../web/token.js";
import { statSync } from "node:fs";
import { join } from "node:path";

let t, srv, base, token;
before(async () => {
  t = tempEnv();
  token = readWebToken();
  srv = createApp({ token });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.closeAllConnections(); srv.close(); t.cleanup(); });

const get = (path, headers = {}) => fetch(base + path, { redirect: "manual", headers });

test("token file is created once with mode 600", () => {
  assert.equal(statSync(join(process.env.OFFLOAD_CONFIG_DIR, "web.env")).mode & 0o777, 0o600);
  assert.equal(readWebToken(), token);
});
test("no token / bad token -> 401", async () => {
  assert.equal((await get("/api/stats")).status, 401);
  assert.equal((await get("/api/stats", { authorization: "Bearer wrong" })).status, 401);
  assert.equal((await get("/?token=wrong")).status, 401);
  const html = await get("/", { accept: "text/html" });
  assert.equal(html.status, 401);
  assert.match(await html.text(), /type=password/);
});
test("good token sets cookie and redirects; cookie works", async () => {
  const r = await get(`/?token=${token}`);
  assert.equal(r.status, 302);
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const ok = await get("/", { cookie: cookie.split(";")[0] });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /clauderouter/);
});
test("bearer works for API", async () => {
  const r = await get("/api/config", { authorization: `Bearer ${token}` });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).enabled, true);
});

const post = (path, body, headers = {}) =>
  fetch(base + path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("cross-origin POST rejected, same-origin allowed", async () => {
  assert.equal((await post("/api/route-test", { prompt: "x" }, { origin: "http://evil.example" })).status, 403);
  assert.equal((await post("/api/route-test", { prompt: "x" }, { origin: base })).status, 200);
  const cookieHdr = (await get(`/?token=${token}`)).headers.get("set-cookie").split(";")[0];
  const r = await fetch(base + "/api/route-test", { method: "POST", headers: { cookie: cookieHdr }, body: "{}" });
  assert.equal(r.status, 403);
});
test("route-test uses classifier", async () => {
  const r = await (await post("/api/route-test", { prompt: "tl;dr of this" })).json();
  assert.deepEqual([r.rule, r.action], ["summarize", "offload"]);
});
test("config save validates and persists", async () => {
  const cfg = await (await get("/api/config", { authorization: `Bearer ${token}` })).json();
  const bad = await post("/api/config", { ...cfg, router: { ...cfg.router, rules: [{ name: "b", pattern: "(", action: "keep" }] } });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).errors[0], /invalid regex/);
  const good = await post("/api/config", { ...cfg, enabled: false });
  assert.equal(good.status, 200);
  assert.equal((await (await get("/api/config", { authorization: `Bearer ${token}` })).json()).enabled, false);
});
test("events and stats endpoints respond", async () => {
  const h = { authorization: `Bearer ${token}` };
  assert.equal((await (await get("/api/events?type=route", h)).json()).events.every((e) => e.type === "route"), true);
  assert.equal((await get("/api/stats", h)).status, 200);
});

test("10 bad tokens from one IP -> 429 lockout for 10 minutes, then clears", async () => {
  let clock = 1e12;
  const s2 = createApp({ token, now: () => clock });
  await new Promise((r) => s2.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${s2.address().port}`;
  const bad = () => fetch(b + "/api/stats", { headers: { authorization: "Bearer wrong" } });
  const good = () => fetch(b + "/api/stats", { headers: { authorization: `Bearer ${token}` } });
  try {
    assert.equal((await fetch(b + "/api/stats")).status, 401); // no credential: not counted
    for (let i = 0; i < 9; i++) assert.equal((await bad()).status, 401);
    assert.equal((await good()).status, 200); // success resets the count
    for (let i = 0; i < 10; i++) assert.equal((await bad()).status, 401);
    assert.equal((await good()).status, 429); // locked, even with the right token
    clock += 10 * 60 * 1000 + 1;
    assert.equal((await good()).status, 200);
    assert.equal((await bad()).status, 401);
  } finally { s2.closeAllConnections(); s2.close(); }
});
