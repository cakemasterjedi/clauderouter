// Shared Ollama /api/generate call with timeout and one-shot fallback model.
async function once(cfg, body, timeoutMs, fetchImpl) {
  const res = await fetchImpl(`${cfg.ollamaHost}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, stream: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama /api/generate -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const msg = (e) => (e?.name === "TimeoutError" ? "timed out" : String(e?.message ?? e));

// body: full /api/generate payload incl. model. Returns { r, model, fallbackFrom?, fallbackError? }.
export async function runGenerate({ cfg, body, fetchImpl = fetch, timeoutMs = cfg.generateTimeoutSec * 1000 }) {
  try {
    return { r: await once(cfg, body, timeoutMs, fetchImpl), model: body.model };
  } catch (e) {
    const fb = cfg.fallbackModel;
    if (!fb || fb === body.model || body.images?.length) throw Object.assign(e, { message: msg(e) });
    const fallbackError = msg(e).slice(0, 200);
    try {
      return { r: await once(cfg, { ...body, model: fb }, timeoutMs, fetchImpl), model: fb, fallbackFrom: body.model, fallbackError };
    } catch (e2) {
      throw Object.assign(new Error(`${body.model} failed (${fallbackError}); fallback ${fb} failed (${msg(e2).slice(0, 200)})`), { fallbackFrom: body.model });
    }
  }
}

export const durMs = (ns) => (typeof ns === "number" ? Math.round(ns / 1e6) : undefined);
export const timings = (r) => ({ total_duration_ms: durMs(r.total_duration), eval_duration_ms: durMs(r.eval_duration) });
