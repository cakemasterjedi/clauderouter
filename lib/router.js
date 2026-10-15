// Prompt classification shared by the hook and the web tester.
export function classify(prompt, cfg) {
  if (!cfg.enabled) return { rule: null, action: "keep", source: "disabled" };
  if (prompt.startsWith("!")) return { rule: null, action: "keep", source: "bypass" };
  for (const r of cfg.router.rules) {
    let re;
    try { re = new RegExp(r.pattern, "i"); } catch { continue; }
    if (re.test(prompt)) return { rule: r.name, action: r.action, source: "regex", hint: r.hint || "" };
  }
  return { rule: null, action: "keep", source: "regex" };
}

export async function classifyWithLlm(prompt, cfg) {
  try {
    const res = await fetch(`${cfg.ollamaHost}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({
        model: cfg.defaultModel,
        system: "Decide if a request is low-stakes text work a small local model can do (summarize, draft, reword, translate, classify, simple extraction, describe an image) or needs a stronger model (code, debugging, architecture, reasoning, tool use). Answer with exactly one word: OFFLOAD or KEEP.",
        prompt: prompt.slice(0, 2000),
        stream: false,
        think: false,
        options: { num_ctx: 2048, temperature: 0 },
      }),
    });
    if (!res.ok) return false;
    return /^\s*OFFLOAD\b/i.test((await res.json()).response || "");
  } catch {
    return false;
  }
}

export async function route(prompt, cfg) {
  const r = classify(prompt, cfg);
  if (r.source === "regex" && r.rule === null && cfg.router.llmClassifier && (await classifyWithLlm(prompt, cfg))) {
    return { rule: "llm", action: "offload", source: "llm", hint: "" };
  }
  return r;
}

export function contextFor(r) {
  return (
    `Auto-offload router: this request matched offload rule "${r.rule}". ` +
    "Do the bulk text work with mcp__ollama__generate (pass file_paths instead of reading large files yourself; image_paths for images), " +
    "then spot-check the result and present it. Keep any code edits and reasoning with yourself. " +
    "Pass task (e.g. task:\"classify\") so the server can choose the model." +
    (r.hint ? ` ${r.hint}` : "")
  );
}
