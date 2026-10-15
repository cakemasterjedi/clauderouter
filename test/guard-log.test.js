import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, runHook } from "./helpers.js";
import { readEvents, logEvent, logPath, rotate } from "../lib/log.js";

let t, big, small, other;
before(() => {
  t = tempEnv();
  big = join(t.dir, "big.log");
  small = join(t.dir, "small.log");
  other = join(t.dir, "big.bin");
  writeFileSync(big, "x".repeat(300000));
  writeFileSync(small, "hi");
  writeFileSync(other, "x".repeat(300000));
});
after(() => t.cleanup());

const guard = (tool_input) => runHook("large-file-guard.js", { session_id: "s", tool_input }, t.env);

test("big .log denied and logged", () => {
  const r = guard({ file_path: big });
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /file_paths/);
  const ev = readEvents().at(-1);
  assert.deepEqual([ev.type, ev.path, ev.bytes], ["guard", "big.log", 300000]);
});
test("small, offset, unlisted ext, missing file, bad input all allowed silently", () => {
  for (const ti of [{ file_path: small }, { file_path: big, offset: 1 }, { file_path: big, limit: 10 }, { file_path: other }, { file_path: join(t.dir, "nope.log") }]) {
    const r = guard(ti);
    assert.deepEqual([r.status, r.stdout], [0, ""]);
  }
  assert.deepEqual(runHook("large-file-guard.js", "garbage", t.env).stdout, "");
});

test("log rotation keeps newest half", () => {
  for (let i = 0; i < 10; i++) logEvent("route", { n: i });
  const before = readEvents().length;
  assert.equal(rotate(logPath(), 1), true);
  const evs = readEvents();
  assert.ok(evs.length < before);
  assert.equal(evs.at(-1).n, 9);
});
test("logEvent never throws", () => {
  const old = process.env.OFFLOAD_STATE_DIR;
  process.env.OFFLOAD_STATE_DIR = join(big, "x");
  assert.doesNotThrow(() => logEvent("route", {}));
  process.env.OFFLOAD_STATE_DIR = old;
});
