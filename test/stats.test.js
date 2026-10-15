import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats } from "../web/stats.js";
import { defaultConfig, validateConfig } from "../lib/config.js";

const now = new Date(2026, 9, 15, 12, 0, 0).getTime();
const at = (daysAgo, h = 10) => new Date(2026, 9, 15 - daysAgo, h).toISOString();
const gen = (daysAgo, o = {}) => ({ type: "generate", ts: at(daysAgo), ok: true, model: "a", ms: 100, prompt_eval_count: 10, eval_count: 5, ...o });

test("token sums count ok events only", () => {
  const g = computeStats([gen(0), gen(3), gen(10), gen(0, { ok: false })], now).generate;
  assert.equal(g.inputTokens, 30);
  assert.equal(g.outputTokens, 15);
  assert.equal(g.tokensToday, 15);
  assert.equal(g.tokensWeek, 30);
  assert.equal(g.all, 4);
  assert.equal(computeStats([{ type: "generate", ts: at(0), ok: true }], now).generate.inputTokens, 0);
});

test("fallbacks and byModel", () => {
  const g = computeStats([
    gen(0, { eval_duration_ms: 500 }), gen(0, { eval_count: 15, eval_duration_ms: 1500, ms: 300 }),
    gen(1, { model: "b", fallback_from: "a" }), gen(1, { model: "b", ok: false, ms: 200 }),
  ], now).generate;
  assert.equal(g.fallbacks, 1);
  assert.deepEqual(g.byModel.a, { jobs: 2, ok: 2, inputTokens: 20, outputTokens: 20, avgMs: 200, tokPerSec: 10 });
  assert.equal(g.byModel.b.jobs, 2);
  assert.equal(g.byModel.b.ok, 1);
  assert.equal(g.byModel.b.tokPerSec, null);
  assert.equal(g.byModel.b.avgMs, 150);
});

test("daily buckets: 14 local days, zero days, window edge", () => {
  const d = computeStats([gen(0), gen(0), gen(13), gen(14), gen(5, { ok: false })], now).generate.daily;
  assert.equal(d.length, 14);
  assert.equal(d[13].date, "2026-10-15");
  assert.equal(d[0].date, "2026-10-02");
  assert.deepEqual(d[13], { date: "2026-10-15", jobs: 2, tokens: 30 });
  assert.deepEqual(d[0], { date: "2026-10-02", jobs: 1, tokens: 15 });
  assert.deepEqual(d[7], { date: "2026-10-09", jobs: 0, tokens: 0 });
  assert.equal(d[8].jobs, 1);
  assert.equal(d[8].tokens, 0);
});

test("config: fallbackModel and generateTimeoutSec validation", () => {
  const bad = (o) => validateConfig({ ...defaultConfig(), ...o }).errors.join();
  assert.equal(defaultConfig().fallbackModel, "qwen3.5:9b");
  assert.equal(defaultConfig().generateTimeoutSec, 180);
  assert.equal(bad({ fallbackModel: "" }), "");
  assert.match(bad({ generateTimeoutSec: 5 }), /generateTimeoutSec/);
  assert.match(bad({ generateTimeoutSec: 1801 }), /generateTimeoutSec/);
  assert.match(bad({ generateTimeoutSec: 30.5 }), /generateTimeoutSec/);
});
