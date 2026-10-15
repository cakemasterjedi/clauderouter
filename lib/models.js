// Automatic model selection shared by the MCP server and the dashboard playground.
const STRUCTURED_RE = /\b(classif\w*|categori[sz]\w*|tag(s|ging)?|label(s|ling)?|extract\w*|pull out|list all|json|csv|pars(e|ing)|sort these|dedupe|count)\b/i;
const STRUCTURED_TASKS = new Set(["classify", "extract", "tag"]);

export const taskKind = (task, prompt) =>
  task ? (STRUCTURED_TASKS.has(task) ? "structured" : "prose") : STRUCTURED_RE.test(prompt || "") ? "structured" : "prose";

export function pickModel({ prompt = "", task, hasImages = false, inputChars, explicitModel, loaded = [], cfg }) {
  const chars = inputChars ?? prompt.length;
  let model, reason;
  if (explicitModel) {
    model = explicitModel; reason = "explicit";
  } else if (cfg.autoSelect === false) {
    model = hasImages ? cfg.visionModel : cfg.defaultModel; reason = "default";
  } else if (hasImages) {
    model = cfg.visionModel; reason = "vision";
  } else if (taskKind(task, prompt) === "prose" || !cfg.fastModel || cfg.fastModel === cfg.defaultModel) {
    model = cfg.defaultModel; reason = taskKind(task, prompt);
  } else {
    model = cfg.fastModel; reason = "structured";
    const avoid = cfg.swapAvoidTokens ?? 4000;
    if (loaded.includes(cfg.defaultModel) && !loaded.includes(cfg.fastModel) && chars / 4 < avoid) {
      model = cfg.defaultModel; reason = "structured:avoid-swap";
    }
  }

  const est = Math.ceil(chars / 4) + 2048;
  let numCtx = cfg.numCtx;
  if (est > cfg.numCtx) {
    const cap = cfg.maxNumCtx ?? 65536;
    let p = 1;
    while (p < est) p *= 2;
    numCtx = Math.min(p, cap);
    reason += "+ctx";
    if (est > cap) reason += "+truncated";
  }
  return { model, numCtx, reason };
}

// Names of models currently in VRAM; [] when Ollama is unreachable.
export async function loadedModels(host) {
  try {
    const res = await fetch(`${host}/api/ps`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return [];
    return ((await res.json()).models || []).map((m) => m.name);
  } catch {
    return [];
  }
}
