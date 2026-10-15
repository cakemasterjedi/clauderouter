const $ = (s) => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value" || k === "checked") el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((x) => x != null));
  return el;
}
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) location.reload();
  if (!res.ok) throw new Error((data.errors || [data.error || res.statusText]).join("\n"));
  return data;
}
const fmtBytes = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(0) + " MB" : n + " B");
const stat = (label, value) => h("div", { class: "stat" }, h("b", {}, String(value)), h("span", {}, label));
const table = (head, rows) => h("table", {}, h("thead", {}, h("tr", {}, head.map((x) => h("th", {}, x)))), h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c))))));
const breakdown = (title, obj) => h("div", {}, h("h4", {}, title), table(["", "count"], Object.entries(obj).sort((a, b) => b[1] - a[1])));

let config;
function renderKill() {
  $("#killbox").checked = config.enabled;
  $("#kill").className = "kill " + (config.enabled ? "on" : "off");
  $("#killtxt").textContent = config.enabled ? "Router ON" : "Router OFF (kill switch)";
}
$("#killbox").addEventListener("change", async (e) => {
  try { config = (await api("/api/config", { ...config, enabled: e.target.checked })).config; } catch (err) { alert(err.message); }
  renderKill();
});

const views = {
  async overview(m) {
    const [s, o] = await Promise.all([api("/api/stats"), api("/api/ollama")]);
    const g = s.generate;
    m.append(
      h("div", { class: "card grid" },
        stat("offloads today", g.today), stat("last 7 days", g.week), stat("all time", g.all),
        stat("est. Claude tokens saved", g.tokensSaved.toLocaleString()), stat("avg latency", g.avgMs + " ms"),
        stat("success rate", g.successRate == null ? "n/a" : Math.round(g.successRate * 100) + "%"), stat("large-file guard hits", s.guard.total)),
      h("div", { class: "card" }, h("h3", {}, "Route decisions (" + s.route.total + ")"),
        h("div", { class: "grid" }, breakdown("By rule", s.route.byRule), breakdown("By action", s.route.byAction), breakdown("By source", s.route.bySource))),
      h("div", { class: "card" }, h("h3", {}, "Ollama: " + (o.up ? "up" : "unreachable")),
        o.running.length ? table(["loaded model", "size", "VRAM", "ctx"], o.running.map((r) => [r.name, fmtBytes(r.size), fmtBytes(r.size_vram), r.context_length ?? ""])) : h("p", { class: "mut" }, "No model loaded."),
        h("p", { class: "mut" }, o.models.length + " models installed")));
  },

  async events(m) {
    let type = "", offset = 0;
    const limit = 25;
    const box = h("div", { class: "card" });
    const load = async () => {
      const d = await api(`/api/events?type=${type}&offset=${offset}&limit=${limit}`);
      box.replaceChildren(
        h("div", { class: "row" },
          h("select", { onchange: (e) => { type = e.target.value; offset = 0; load(); } }, ["", "route", "generate", "guard"].map((t) => h("option", { value: t, ...(t === type ? { selected: "" } : {}) }, t || "all types"))),
          h("button", { onclick: () => { offset = Math.max(0, offset - limit); load(); } }, "Prev"),
          h("span", { class: "mut" }, `${d.total ? offset + 1 : 0}-${Math.min(offset + limit, d.total)} of ${d.total}`),
          h("button", { onclick: () => { if (offset + limit < d.total) { offset += limit; load(); } } }, "Next")),
        table(["time", "type", "details"], d.events.map((e) => {
          const { ts, type: t, ...rest } = e;
          return [new Date(ts).toLocaleString(), h("span", { class: "tag" }, t), h("code", {}, JSON.stringify(rest))];
        })));
    };
    m.append(box);
    await load();
  },

  async settings(m) {
    const o = await api("/api/ollama").catch(() => ({ models: [] }));
    const c = JSON.parse(JSON.stringify(config));
    const field = (label, el) => h("label", { class: "f" }, label, el);
    const modelSel = (key) => {
      const names = [...new Set([c[key], ...o.models.map((x) => x.name)])];
      return field(key, h("select", { onchange: (e) => (c[key] = e.target.value) }, names.map((n) => h("option", { value: n, ...(n === c[key] ? { selected: "" } : {}) }, n))));
    };
    const text = (obj, key, label, num) => field(label, h("input", { type: num ? "number" : "text", value: obj[key], oninput: (e) => (obj[key] = num ? Number(e.target.value) : e.target.value) }));
    const check = (obj, key, label) => h("label", { class: "row" }, h("input", { type: "checkbox", checked: obj[key], onchange: (e) => (obj[key] = e.target.checked) }), label);
    const rulesBox = h("div");
    const drawRules = () => rulesBox.replaceChildren(...c.router.rules.map((r, i) => {
      const move = (d) => () => { const j = i + d; if (j < 0 || j >= c.router.rules.length) return; [c.router.rules[i], c.router.rules[j]] = [c.router.rules[j], c.router.rules[i]]; drawRules(); };
      return h("div", { class: "rule" },
        h("input", { type: "text", value: r.name, placeholder: "name", oninput: (e) => (r.name = e.target.value) }),
        h("input", { type: "text", value: r.pattern, placeholder: "regex (case-insensitive)", oninput: (e) => (r.pattern = e.target.value) }),
        h("select", { onchange: (e) => (r.action = e.target.value) }, ["offload", "keep"].map((a) => h("option", { value: a, ...(a === r.action ? { selected: "" } : {}) }, a))),
        h("input", { type: "text", value: r.hint || "", placeholder: "hint (optional)", oninput: (e) => (r.hint = e.target.value) }),
        h("span", { class: "row" }, h("button", { onclick: move(-1) }, "↑"), h("button", { onclick: move(1) }, "↓"),
          h("button", { onclick: () => { c.router.rules.splice(i, 1); drawRules(); } }, "✕")));
    }));
    drawRules();
    const msg = h("div", { class: "err" });
    m.append(
      h("div", { class: "card" }, h("h3", {}, "Settings"), check(c, "enabled", "Router enabled (kill switch)"),
        h("div", { class: "grid" }, modelSel("defaultModel"), modelSel("visionModel"), text(c, "numCtx", "numCtx", true), text(c, "ollamaHost", "ollamaHost")),
        check(c, "think", "think by default"), check(c.router, "llmClassifier", "LLM classifier when no rule matches (4s timeout, falls back to keep)")),
      h("div", { class: "card" }, h("h3", {}, "Large file guard"), check(c.largeFileGuard, "enabled", "Deny whole-file Read of big text files"),
        h("div", { class: "grid" }, text(c.largeFileGuard, "minBytes", "minBytes", true),
          field("extensions (comma separated)", h("input", { type: "text", value: c.largeFileGuard.extensions.join(","), oninput: (e) => (c.largeFileGuard.extensions = e.target.value.split(",").map((x) => x.trim()).filter(Boolean)) })))),
      h("div", { class: "card" }, h("h3", {}, "Rules (first match wins; no match = keep)"), rulesBox,
        h("button", { onclick: () => { c.router.rules.push({ name: "new-rule", pattern: "", action: "offload", hint: "" }); drawRules(); } }, "Add rule")),
      h("div", { class: "row" }, h("button", { class: "pri", onclick: async () => {
        msg.textContent = "";
        try { config = (await api("/api/config", c)).config; renderKill(); msg.textContent = "Saved."; msg.className = "mut"; } catch (e) { msg.textContent = e.message; msg.className = "err"; }
      } }, "Save"), msg));
  },

  async test(m) {
    const o = await api("/api/ollama").catch(() => ({ models: [] }));
    const rt = h("textarea", { placeholder: "Type a prompt to see how it would be routed" });
    const rout = h("pre");
    const pp = h("textarea", { placeholder: "Prompt to run on a local model" });
    const sel = h("select", {}, o.models.map((x) => h("option", { value: x.name, ...(x.name === config.defaultModel ? { selected: "" } : {}) }, x.name)));
    const pout = h("pre");
    m.append(
      h("div", { class: "card" }, h("h3", {}, "Router tester"), rt,
        h("div", { class: "row" }, h("button", { class: "pri", onclick: async () => {
          try { rout.textContent = JSON.stringify(await api("/api/route-test", { prompt: rt.value }), null, 2); } catch (e) { rout.textContent = e.message; }
        } }, "Classify")), rout),
      h("div", { class: "card" }, h("h3", {}, "Playground"), pp,
        h("div", { class: "row" }, sel, h("button", { class: "pri", onclick: async () => {
          pout.textContent = "Running...";
          try { const r = await api("/api/playground", { prompt: pp.value, model: sel.value }); pout.textContent = `${r.response}\n\n[${r.model}, ${r.ms} ms, ${r.eval_count ?? "?"} tokens]`; } catch (e) { pout.textContent = e.message; }
        } }, "Run")), pout));
  },
};

async function show(name) {
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.t === name);
  const m = $("#main");
  m.replaceChildren();
  try { await views[name](m); } catch (e) { m.append(h("div", { class: "card err" }, e.message)); }
}
$("#tabs").addEventListener("click", (e) => e.target.dataset.t && show(e.target.dataset.t));
config = await api("/api/config");
renderKill();
show("overview");
