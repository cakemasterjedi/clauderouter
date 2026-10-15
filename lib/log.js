// NDJSON event log. Only first 40 chars of prompts are ever stored. Never throws.
import { appendFileSync, mkdirSync, statSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./config.js";

export const logPath = () => join(stateDir(), "events.ndjson");
const maxBytes = () => Number(process.env.OFFLOAD_LOG_MAX_BYTES) || 10 * 1024 * 1024;

export const snip = (s) => String(s ?? "").slice(0, 40);

// Keep the newest half of the lines once the file is over max.
export function rotate(file = logPath(), max = maxBytes()) {
  if (statSync(file).size <= max) return false;
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  writeFileSync(file, lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n", { mode: 0o600 });
  return true;
}

export function logEvent(type, data) {
  try {
    mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    try { chmodSync(stateDir(), 0o700); } catch {}
    appendFileSync(logPath(), JSON.stringify({ type, ts: new Date().toISOString(), ...data }) + "\n", { mode: 0o600 });
    rotate();
  } catch {}
}

export function readEvents() {
  try {
    return readFileSync(logPath(), "utf8").split("\n").filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l)]; } catch { return []; }
    });
  } catch {
    return [];
  }
}
