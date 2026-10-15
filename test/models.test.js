import test from "node:test";
import assert from "node:assert/strict";
import { pickModel } from "../lib/models.js";
import { defaultConfig, validateConfig } from "../lib/config.js";

const cfg = (o = {}) => ({ ...defaultConfig(), defaultModel: "D", visionModel: "V", fastModel: "F", ...o });
const pick = (o = {}, c) => pickModel({ prompt: "hello", inputChars: 100, loaded: [], cfg: cfg(c), ...o });

test("explicit model wins", () => {
  const r = pick({ explicitModel: "X", task: "classify", hasImages: true });
  assert.deepEqual([r.model, r.reason], ["X", "explicit"]);
});
test("autoSelect off uses default or vision", () => {
  assert.deepEqual(pick({ task: "classify" }, { autoSelect: false }).model, "D");
  const r = pick({ hasImages: true }, { autoSelect: false });
  assert.deepEqual([r.model, r.reason], ["V", "default"]);
});
test("images use vision model", () => {
  const r = pick({ hasImages: true, task: "classify" });
  assert.deepEqual([r.model, r.reason], ["V", "vision"]);
});
test("prose tasks and prompts use default", () => {
  for (const task of ["summarize", "draft", "reword", "explain", "other"]) assert.equal(pick({ task }).reason, "prose");
  const r = pick({ prompt: "Summarize this article" });
  assert.deepEqual([r.model, r.reason], ["D", "prose"]);
});
test("structured via task", () => {
  for (const task of ["classify", "extract", "tag"]) assert.deepEqual([pick({ task }).model, pick({ task }).reason], ["F", "structured"]);
});
test("task overrides prompt inference", () => {
  assert.equal(pick({ prompt: "extract the gist", task: "summarize" }).model, "D");
});
test("structured via regex inference", () => {
  for (const p of ["Classify these", "categorise them", "output JSON", "pull out names", "parse the csv", "dedupe this", "count lines"]) {
    assert.equal(pick({ prompt: p }).model, "F", p);
  }
});
test("swap avoidance triggers for short structured when default loaded", () => {
  const r = pick({ task: "classify", loaded: ["D"], inputChars: 4000 });
  assert.deepEqual([r.model, r.reason], ["D", "structured:avoid-swap"]);
});
test("swap avoidance does not trigger when large, fast loaded, or default not loaded", () => {
  assert.equal(pick({ task: "classify", loaded: ["D"], inputChars: 16000 }).model, "F");
  assert.equal(pick({ task: "classify", loaded: ["D", "F"] }).model, "F");
  assert.equal(pick({ task: "classify", loaded: ["Z"] }).model, "F");
  assert.equal(pick({ task: "classify", loaded: [] }).model, "F");
  assert.equal(pick({ task: "classify", loaded: ["D"], inputChars: 100 }, { swapAvoidTokens: 10 }).model, "F");
});
test("prose is never downgraded to the fast model", () => {
  assert.equal(pick({ task: "summarize", loaded: ["F"] }).model, "D");
  assert.equal(pick({ task: "summarize", loaded: [] }).model, "D");
});
test("empty or same fastModel uses default", () => {
  assert.deepEqual(pick({ task: "classify" }, { fastModel: "" }).model, "D");
  assert.deepEqual(pick({ task: "classify" }, { fastModel: "D" }).model, "D");
});
test("context raised to power of two", () => {
  const r = pick({ task: "summarize", inputChars: 80000 }); // 20000+2048 -> 32768
  assert.equal(r.numCtx, 32768);
  assert.equal(r.reason, "prose+ctx");
  assert.equal(pick({ inputChars: 100 }).numCtx, 16384);
  assert.equal(pick({ inputChars: 100 }).reason, "prose");
});
test("context capped with truncated flag", () => {
  const r = pick({ task: "classify", inputChars: 400000 });
  assert.equal(r.numCtx, 65536);
  assert.equal(r.reason, "structured+ctx+truncated");
  const r2 = pick({ inputChars: 80000 }, { maxNumCtx: 20000 });
  assert.equal(r2.numCtx, 20000);
  assert.match(r2.reason, /\+truncated$/);
});
test("config validation for new fields", () => {
  assert.deepEqual(validateConfig(defaultConfig()).errors, []);
  const bad = (o) => validateConfig({ ...defaultConfig(), ...o }).errors.join();
  assert.match(bad({ maxNumCtx: 100 }), /maxNumCtx/);
  assert.match(bad({ maxNumCtx: 8192 }), /maxNumCtx must be >= numCtx/);
  assert.match(bad({ swapAvoidTokens: -1 }), /swapAvoidTokens/);
  assert.equal(defaultConfig().fastModel, "qwen3.5:9b");
  assert.equal(defaultConfig().autoSelect, true);
});

test("regex inference is word-bounded", () => {
  const cfg = { ...defaultConfig() };
  assert.equal(pickModel({ prompt: "Summarize the account history", cfg }).reason, "prose");
  assert.equal(pickModel({ prompt: "Summarize the stage results", cfg }).reason, "prose");
  assert.equal(pickModel({ prompt: "Tag these tickets", cfg }).reason, "structured");
  assert.equal(pickModel({ prompt: "Output JSON with the fields", cfg }).reason, "structured");
});
