const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

export function computeStats(events, now = Date.now()) {
  const day = 86400000;
  const startToday = new Date(now).setHours(0, 0, 0, 0);
  const s = { generate: { today: 0, week: 0, all: 0, ok: 0, ms: 0, tokensSaved: 0 }, route: { total: 0, byRule: {}, byAction: {}, bySource: {} }, guard: { total: 0 } };
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
  return s;
}
