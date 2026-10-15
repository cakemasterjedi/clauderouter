import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { runGenerate } from "../lib/generate.js";

let srv, host, calls, behave;
before(async () => {
  srv = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", async () => {
      const body = JSON.parse(b);
      calls.push(body);
      const mode = behave[body.model] || "ok";
      if (mode === "500") { res.writeHead(500); return res.end("boom"); }
      if (mode === "hang") return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ response: `from ${body.model}`, eval_count: 3 }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  host = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.closeAllConnections(); srv.close(); });

const cfg = (o = {}) => ({ ollamaHost: host, fallbackModel: "fb", generateTimeoutSec: 30, ...o });
const run = (o = {}, body = {}, extra = {}) => { calls = []; return runGenerate({ cfg: cfg(o), body: { model: "main", prompt: "hi", options: { num_ctx: 8192 }, ...body }, ...extra }); };

test("primary success, no fallback", async () => {
  behave = {};
  const out = await run();
  assert.equal(out.model, "main");
  assert.equal(out.r.response, "from main");
  assert.equal(out.fallbackFrom, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stream, false);
});

test("primary 500 -> fallback succeeds", async () => {
  behave = { main: "500" };
  const out = await run();
  assert.equal(out.model, "fb");
  assert.equal(out.fallbackFrom, "main");
  assert.match(out.fallbackError, /500.*boom/);
  assert.deepEqual(calls.map((c) => c.model), ["main", "fb"]);
  assert.deepEqual(calls[1].options, { num_ctx: 8192 });
  assert.equal(calls[1].prompt, "hi");
});

test("primary timeout -> fallback", async () => {
  behave = { main: "hang" };
  const out = await run({}, {}, { timeoutMs: 100 });
  assert.equal(out.model, "fb");
  assert.match(out.fallbackError, /timed out/);
});

test("no retry when disabled, same model, or images", async () => {
  behave = { main: "500" };
  await assert.rejects(run({ fallbackModel: "" }), /500/);
  assert.equal(calls.length, 1);
  await assert.rejects(run({ fallbackModel: "main" }), /500/);
  assert.equal(calls.length, 1);
  await assert.rejects(run({}, { images: ["abc"] }), /500/);
  assert.equal(calls.length, 1);
});

test("both fail -> error mentions both", async () => {
  behave = { main: "500", fb: "500" };
  await assert.rejects(run(), (e) => /main failed/.test(e.message) && /fallback fb failed/.test(e.message) && e.fallbackFrom === "main");
  assert.equal(calls.length, 2);
});
