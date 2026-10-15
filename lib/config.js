// Shared config for the MCP server, hooks and web dashboard. Read fresh on every use.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const configDir = () => process.env.OFFLOAD_CONFIG_DIR || join(homedir(), ".config", "ollama-offload");
export const stateDir = () => process.env.OFFLOAD_STATE_DIR || join(homedir(), ".local", "state", "ollama-offload");
export const configPath = () => join(configDir(), "config.json");

export const defaultConfig = () => ({
  enabled: true,
  defaultModel: "gemma4:12b-it-qat",
  visionModel: "gemma4:12b-it-qat",
  fastModel: "qwen3.5:9b",
  autoSelect: true,
  numCtx: 16384,
  maxNumCtx: 65536,
  swapAvoidTokens: 4000,
  think: false,
  ollamaHost: "http://localhost:11434",
  router: {
    llmClassifier: false,
    rules: [
      { name: "code-and-reasoning", pattern: "refactor|implement|debug|fix|bug|architect|security|deploy|migrat|review|test", action: "keep", hint: "" },
      { name: "summarize", pattern: "summari[sz]e|tl;?dr|recap|gist", action: "offload", hint: "" },
      { name: "draft-reword", pattern: "draft|reword|rephrase|rewrite this|proofread|translate", action: "offload", hint: "" },
      { name: "classify", pattern: "classify|categori[sz]e|tag these|label these|sort these", action: "offload", hint: "" },
      { name: "extract", pattern: "extract|pull out|list all", action: "offload", hint: "" },
      { name: "describe-image", pattern: "describe (this|the) (image|screenshot|photo)", action: "offload", hint: "Pass the image with image_paths." },
    ],
  },
  largeFileGuard: {
    enabled: true,
    minBytes: 262144,
    extensions: [".log", ".txt", ".csv", ".json", ".jsonl", ".ndjson", ".md", ".xml", ".html"],
  },
});

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

function merge(base, over) {
  const out = { ...base };
  if (!isObj(over)) return out;
  for (const k of Object.keys(base)) {
    if (!(k in over)) continue;
    if (isObj(base[k])) out[k] = merge(base[k], over[k]);
    else if (typeof over[k] === typeof base[k] && Array.isArray(over[k]) === Array.isArray(base[k])) out[k] = over[k];
  }
  return out;
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch {}
}

export function saveConfig(cfg) {
  ensureDir(configDir());
  const tmp = join(configDir(), `config.json.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, configPath());
}

// raw: file contents only; otherwise env vars override where they did before.
export function loadConfig({ raw = false } = {}) {
  let cfg = defaultConfig();
  if (!existsSync(configPath())) {
    try { saveConfig(cfg); } catch {}
  } else {
    try { cfg = merge(cfg, JSON.parse(readFileSync(configPath(), "utf8"))); } catch {}
  }
  if (!raw) {
    const e = process.env;
    if (e.OLLAMA_HOST) cfg.ollamaHost = e.OLLAMA_HOST;
    if (e.OLLAMA_DEFAULT_MODEL) cfg.defaultModel = e.OLLAMA_DEFAULT_MODEL;
    if (e.OLLAMA_VISION_MODEL) cfg.visionModel = e.OLLAMA_VISION_MODEL;
    if (e.OLLAMA_NUM_CTX) cfg.numCtx = Number(e.OLLAMA_NUM_CTX) || cfg.numCtx;
  }
  return cfg;
}

// Returns {errors, config}; config is the sanitized value to save.
export function validateConfig(input) {
  const errors = [];
  const d = defaultConfig();
  const c = merge(d, input);
  if (!isObj(input)) return { errors: ["config must be an object"], config: d };
  for (const k of ["defaultModel", "visionModel", "ollamaHost"]) if (!c[k].trim()) errors.push(`${k} must not be empty`);
  if (!Number.isInteger(c.numCtx) || c.numCtx < 512) errors.push("numCtx must be an integer >= 512");
  if (typeof c.fastModel !== "string") errors.push("fastModel must be a string");
  if (typeof c.autoSelect !== "boolean") errors.push("autoSelect must be a boolean");
  if (!Number.isInteger(c.maxNumCtx) || c.maxNumCtx < 512) errors.push("maxNumCtx must be an integer >= 512");
  else if (c.maxNumCtx < c.numCtx) errors.push("maxNumCtx must be >= numCtx");
  if (!Number.isInteger(c.swapAvoidTokens) || c.swapAvoidTokens < 0) errors.push("swapAvoidTokens must be an integer >= 0");
  if (!Number.isInteger(c.largeFileGuard.minBytes) || c.largeFileGuard.minBytes < 0) errors.push("largeFileGuard.minBytes must be an integer >= 0");
  c.largeFileGuard.extensions = c.largeFileGuard.extensions.map((x) => String(x).trim().toLowerCase()).filter(Boolean).map((x) => (x.startsWith(".") ? x : `.${x}`));
  const rules = Array.isArray(input.router?.rules) ? input.router.rules : d.router.rules;
  c.router.rules = rules.map((r, i) => {
    const rule = { name: String(r?.name ?? "").trim(), pattern: String(r?.pattern ?? ""), action: r?.action, hint: String(r?.hint ?? "") };
    const label = rule.name || `rule #${i + 1}`;
    if (!rule.name) errors.push(`${label}: name required`);
    if (rule.action !== "offload" && rule.action !== "keep") errors.push(`${label}: action must be offload or keep`);
    if (!rule.pattern) errors.push(`${label}: pattern required`);
    else try { new RegExp(rule.pattern, "i"); } catch (e) { errors.push(`${label}: invalid regex (${e.message})`); }
    return rule;
  });
  return { errors, config: c };
}
