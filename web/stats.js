const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function computeStats(events, now = Date.now()) {
  const day = 86400000;
  const startToday = new Date(now).setHours(0, 0, 0, 0);
  const s = { generate: { today: 0, week: 0, all: 0, ok: 0, ms: 0, tokensSaved: 0, inputTokens: 0, outputTokens: 0, tokensToday: 0, tokensWeek: 0, fallbacks: 0, byModel: {}, daily: [] }, route: { total: 0, byRule: {}, byAction: {}, bySource: {} }, guard: { total: 0 } };
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - 13 + i); return { date: ymd(d), jobs: 0, tokens: 0 }; });
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  const eval_ = {};
  for (const e of events) {
    const t = Date.parse(e.ts);
    if (e.type === "generate") {
      const g = s.generate;
      g.all++;
      if (t >= startToday) g.today++;
      if (t >= now - 7 * day) g.week++;
      if (e.ok) g.ok++;
      g.ms += e.ms || 0;
      g.tokensSaved += e.est_claude_tokens_saved || 0;
      if (e.fallback_from) g.fallbacks++;
      const inp = e.ok ? e.prompt_eval_count || 0 : 0, out = e.ok ? e.eval_count || 0 : 0;
      g.inputTokens += inp; g.outputTokens += out;
      if (t >= startToday) g.tokensToday += inp + out;
      if (t >= now - 7 * day) g.tokensWeek += inp + out;
      const m = (g.byModel[e.model ?? "(unknown)"] ??= { jobs: 0, ok: 0, inputTokens: 0, outputTokens: 0, ms: 0, tokPerSec: null });
      m.jobs++; m.ms += e.ms || 0;
      if (e.ok) m.ok++;
      m.inputTokens += inp; m.outputTokens += out;
      if (e.ok && e.eval_duration_ms > 0) { const x = (eval_[e.model ?? "(unknown)"] ??= { n: 0, ms: 0 }); x.n += e.eval_count || 0; x.ms += e.eval_duration_ms; }
      const d = byDate[ymd(new Date(t))];
      if (d) { d.jobs++; d.tokens += inp + out; }
    } else if (e.type === "route") {
      s.route.total++;
      bump(s.route.byRule, e.rule ?? "(none)");
      bump(s.route.byAction, e.action);
      bump(s.route.bySource, e.source);
    } else if (e.type === "guard") s.guard.total++;
  }
  const g = s.generate;
  g.avgMs = g.all ? Math.round(g.ms / g.all) : 0;
  g.successRate = g.all ? g.ok / g.all : null;
  delete g.ms;
  for (const [k, m] of Object.entries(g.byModel)) {
    m.avgMs = m.jobs ? Math.round(m.ms / m.jobs) : 0;
    delete m.ms;
    if (eval_[k]) m.tokPerSec = Math.round((eval_[k].n / eval_[k].ms) * 10000) / 10;
  }
  g.daily = days;
  return s;
}
