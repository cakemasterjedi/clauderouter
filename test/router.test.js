import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tempEnv, runHook } from "./helpers.js";
import { loadConfig, saveConfig, defaultConfig, validateConfig, configPath } from "../lib/config.js";
import { classify } from "../lib/router.js";
import { readEvents } from "../lib/log.js";
import { statSync, readdirSync } from "node:fs";

let t;
before(() => (t = tempEnv()));
after(() => t.cleanup());

test("keep rule wins over later offload rule", () => {
  const r = classify("please summarize and debug this", defaultConfig());
  assert.equal(r.action, "keep");
});
test("offload on summarize, no match = keep", () => {
  assert.equal(classify("Summarise the notes", defaultConfig()).action, "offload");
  const r = classify("hello there", defaultConfig());
  assert.deepEqual([r.action, r.rule], ["keep", null]);
});
test("bypass and disabled", () => {
  assert.equal(classify("!summarize this", defaultConfig()).source, "bypass");
  assert.equal(classify("summarize", { ...defaultConfig(), enabled: false }).source, "disabled");
});
test("invalid regex is skipped", () => {
  const cfg = defaultConfig();
  cfg.router.rules.unshift({ name: "bad", pattern: "(", action: "keep" });
  assert.equal(classify("summarize this", cfg).rule, "summarize");
});

test("config defaults created with modes; save is atomic", () => {
  const cfg = loadConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(statSync(configPath()).mode & 0o777, 0o600);
  assert.equal(statSync(process.env.OFFLOAD_CONFIG_DIR).mode & 0o777, 0o700);
  cfg.defaultModel = "x:1";
  saveConfig(cfg);
  assert.equal(loadConfig({ raw: true }).defaultModel, "x:1");
  assert.deepEqual(readdirSync(process.env.OFFLOAD_CONFIG_DIR).filter((f) => f.endsWith(".tmp")), []);
});
test("env overrides config except raw", () => {
  process.env.OLLAMA_NUM_CTX = "2048";
  assert.equal(loadConfig().numCtx, 2048);
  assert.equal(loadConfig({ raw: true }).numCtx, 16384);
  delete process.env.OLLAMA_NUM_CTX;
});
test("validateConfig rejects bad regex", () => {
  const cfg = defaultConfig();
  cfg.router.rules.push({ name: "oops", pattern: "(", action: "offload" });
  assert.match(validateConfig(cfg).errors.join(), /invalid regex/);
  assert.deepEqual(validateConfig(defaultConfig()).errors, []);
});

test("route hook: offload prints valid JSON and logs", () => {
  saveConfig(defaultConfig());
  const r = runHook("route-prompt.js", { prompt: "summarize this file please", session_id: "s1" }, t.env);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(out.hookSpecificOutput.additionalContext, /mcp__ollama__generate/);
  const ev = readEvents().at(-1);
  assert.deepEqual([ev.type, ev.rule, ev.action, ev.source], ["route", "summarize", "offload", "regex"]);
});
test("route hook: keep, bypass, disabled, garbage input print nothing", () => {
  for (const p of ["fix the bug", "!summarize this"]) assert.equal(runHook("route-prompt.js", { prompt: p }, t.env).stdout, "");
  assert.equal(readEvents().at(-1).source, "bypass");
  saveConfig({ ...defaultConfig(), enabled: false });
  assert.equal(runHook("route-prompt.js", { prompt: "summarize" }, t.env).stdout, "");
  assert.equal(readEvents().at(-1).source, "disabled");
  const r = runHook("route-prompt.js", "not json", t.env);
  assert.deepEqual([r.status, r.stdout], [0, ""]);
  saveConfig(defaultConfig());
});
test("route hook logs only 40 chars of prompt", () => {
  runHook("route-prompt.js", { prompt: "summarize " + "x".repeat(100) }, t.env);
  assert.equal(readEvents().at(-1).prompt.length, 40);
});
