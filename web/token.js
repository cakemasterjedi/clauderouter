import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { configDir } from "../lib/config.js";

// Fixed token from web.env; created once, never regenerated.
export function readWebToken() {
  const file = join(configDir(), "web.env");
  if (existsSync(file)) {
    const m = readFileSync(file, "utf8").match(/^OFFLOAD_WEB_TOKEN=(\S+)/m);
    if (m) return m[1];
  }
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const token = randomBytes(24).toString("hex");
  writeFileSync(file, `OFFLOAD_WEB_TOKEN=${token}\n`, { mode: 0o600 });
  return token;
}
