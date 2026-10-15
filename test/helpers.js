import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function tempEnv() {
  const dir = mkdtempSync(join(tmpdir(), "offload-test-"));
  const env = { OFFLOAD_CONFIG_DIR: join(dir, "config"), OFFLOAD_STATE_DIR: join(dir, "state") };
  Object.assign(process.env, env);
  return { dir, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function runHook(name, input, env) {
  const r = spawnSync("node", [join(ROOT, "hooks", name)], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
