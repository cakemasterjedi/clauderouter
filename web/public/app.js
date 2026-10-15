const $ = (s) => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value" || k === "checked" || k === "disabled") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...kids.flat().filter((x) => x != null && x !== false));
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
const clone = (x) => JSON.parse(JSON.stringify(x));
const ago = (ts) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 1000));
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};

let toastTimer;
function toast(text, bad) {
  const t = $("#toast");
  t.textContent = text;
  t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), bad ? 6000 : 2500);
}

const kpi = (label, value, unit) => h("div", { class: "kpi" }, h("span", { class: "label" }, label), h("b", {}, String(value), unit ? h("small", {}, unit) : null));
const bars = (title, obj) => {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return h("div", {},
    h("div", { class: "label" }, title),
    entries.length
      ? h("div", { class: "bars" }, entries.map(([k, v]) => h("div", { class: "bar-row" },
        h("div", { class: "bar-top" }, h("span", { title: k }, k), h("span", {}, String(v))),
        h("div", { class: "bar" }, h("i", { style: `width:${(v / max) * 100}%` })))))
      : h("p", { class: "help", style: "margin-top:12px" }, "No data yet."));
};
const sw = (checked, onchange, label) => {
  const input = h("input", { type: "checkbox", role: "switch", "aria-checked": String(!!checked), checked: !!checked, onchange: (e) => { input.setAttribute("aria-checked", String(e.target.checked)); onchange(e); } });
  return h("label", { class: "switch" }, input, h("span", { class: "track" }), label ? h("span", {}, label) : null);
};
const switchRow = (obj, key, title, help) => h("div", { class: "switch-row" },
  h("div", {}, h("div", { class: "t" }, title), help ? h("div", { class: "help" }, help) : null),
  sw(obj[key], (e) => { obj[key] = e.target.checked; obj._changed?.(); }, null));

let config;
function renderKill() {
  const box = $("#killbox");
  box.checked = config.enabled;
  box.setAttribute("aria-checked", String(config.enabled));
  $("#killtxt").textContent = config.enabled ? "Router on" : "Router off";
}
$("#killbox").addEventListener("change", async (e) => {
  const want = e.target.checked;
  e.target.disabled = true;
  try {
    config = (await api("/api/config", { ...config, enabled: want })).config;
    toast(config.enabled ? "Router turned on" : "Router turned off");
  } catch (err) { toast(err.message, true); }
  e.target.disabled = false;
  renderKill();
});

async function refreshStatus() {
  const el = $("#ollama");
  try {
    const o = await api("/api/ollama");
    el.className = "status " + (o.up ? "up" : "down");
    el.lastChild.textContent = o.up ? "Ollama up" : "Ollama down";
  } catch { el.className = "status down"; el.lastChild.textContent = "Ollama down"; }
}

const views = {
  async overview(m) {
    const [s, o] = await Promise.all([api("/api/stats"), api("/api/ollama")]);
    const g = s.generate;
    m.append(
      h("section", { class: "kpis" },
        kpi("Offloads today", g.today), kpi("Last 7 days", g.week), kpi("All time", g.all),
        kpi("Est. Claude tokens saved", g.tokensSaved.toLocaleString()), kpi("Avg latency", g.avgMs, "ms"),
        kpi("Success rate", g.successRate == null ? "n/a" : Math.round(g.successRate * 100), g.successRate == null ? "" : "%"),
        kpi("Large-file guard hits", s.guard.total)),
      h("section", { class: "card" },
        h("div", { class: "sect-h" }, h("div", { class: "label" }, "Route decisions"), h("div", { class: "help" }, s.route.total + " total")),
        h("div", { class: "cols" }, bars("By rule", s.route.byRule), bars("By action", s.route.byAction), bars("By source", s.route.bySource))),
      h("section", { class: "card" },
        h("div", { class: "sect-h" }, h("div", { class: "label" }, "Ollama"), h("div", { class: "help" }, (o.up ? "Reachable" : "Unreachable") + " · " + o.models.length + " models installed")),
        o.running.length
          ? o.running.map((r) => {
            const pct = r.size ? Math.min(100, Math.round((r.size_vram / r.size) * 100)) : 0;
            return h("div", { class: "model" },
              h("div", { class: "model-h" }, h("b", { class: "mono" }, r.name), h("span", { class: "help" }, fmtBytes(r.size) + (r.context_length ? " · ctx " + r.context_length : ""))),
              h("div", { class: "bar-top" }, h("span", { class: "help" }, "VRAM"), h("span", {}, `${fmtBytes(r.size_vram)} (${pct}%)`)),
              h("div", { class: "bar vram", role: "img", "aria-label": `VRAM usage ${pct}%` }, h("i", { style: `width:${pct}%` })));
          })
          : h("p", { class: "help" }, "No model loaded.")));
  },

  async events(m) {
    let type = "", offset = 0;
    const limit = 25;
    const box = h("section", { class: "card" });
    const load = async () => {
      const d = await api(`/api/events?type=${type}&offset=${offset}&limit=${limit}`);
      const seg = h("div", { class: "seg", role: "group", "aria-label": "Filter by type" },
        [["", "All"], ["route", "Route"], ["generate", "Generate"], ["guard", "Guard"]].map(([v, l]) =>
          h("button", { type: "button", class: v === type ? "on" : "", "aria-pressed": String(v === type), onclick: () => { type = v; offset = 0; load().catch(fail); } }, l)));
      box.replaceChildren(
        h("div", { class: "evhead" }, h("div", { class: "label" }, "Events"), seg),
        d.events.length ? h("div", { class: "evlist" }, d.events.map((e) => {
          const { ts, type: t, ...rest } = e;
          return h("div", { class: "ev" },
            h("span", { class: "badge " + t }, t),
            h("span", { class: "ev-time", title: new Date(ts).toLocaleString() }, ago(ts)),
            h("div", { class: "chips" }, Object.entries(rest).map(([k, v]) => {
              const val = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
              return h("span", { class: "chip", title: `${k}: ${val}` }, h("span", { class: "k" }, k + ":"), h("span", { class: "v" }, val));
            })));
        })) : h("div", { class: "empty" }, "No events yet."),
        h("div", { class: "pager" },
          h("button", { type: "button", class: "btn", disabled: offset <= 0, onclick: () => { offset = Math.max(0, offset - limit); load().catch(fail); } }, "Prev"),
          h("span", { class: "help" }, `${d.total ? offset + 1 : 0}–${Math.min(offset + limit, d.total)} of ${d.total}`),
          h("button", { type: "button", class: "btn", disabled: offset + limit >= d.total, onclick: () => { offset += limit; load().catch(fail); } }, "Next")));
    };
    const fail = (e) => box.replaceChildren(h("p", { class: "err", role: "alert" }, e.message));
    m.append(box);
    await load();
  },

  async settings(m) {
    const o = await api("/api/ollama").catch(() => ({ models: [] }));
    const c = clone(config);
    let saved = clone(config);
    const bar = h("div", { class: "savebar", role: "region", "aria-label": "Unsaved changes" });
    const msg = h("span", { class: "msg", role: "status", "aria-live": "polite" });
    const saveBtn = h("button", { type: "button", class: "btn pri" }, "Save");
    const discardBtn = h("button", { type: "button", class: "btn" }, "Discard");
    bar.append(h("div", { class: "savebar-in" }, msg, discardBtn, saveBtn));
    const norm = (x) => JSON.stringify({ ...x, enabled: 0 });
    let flash;
    const refresh = () => {
      const dirty = norm(c) !== norm(saved);
      if (dirty) { clearTimeout(flash); msg.textContent = "Unsaved changes"; msg.className = "msg"; }
      bar.classList.toggle("show", dirty || !!msg.dataset.flash);
      bar.classList.toggle("dirty", dirty);
      discardBtn.hidden = saveBtn.hidden = !dirty;
    };
    const say = (text, bad) => {
      msg.textContent = text; msg.className = "msg " + (bad ? "err" : "");
      msg.dataset.flash = "1"; bar.classList.add("show");
      clearTimeout(flash);
      if (!bad) flash = setTimeout(() => { delete msg.dataset.flash; refresh(); }, 2500);
    };
    const touch = () => { delete msg.dataset.flash; refresh(); };
    c._changed = c.router._changed = c.largeFileGuard._changed = touch;

    const field = (label, el, help) => h("label", { class: "f" }, h("span", {}, label), el, help ? h("span", { class: "help" }, help) : null);
    const modelSel = (key, label, help) => {
      const names = [...new Set([c[key], ...o.models.map((x) => x.name)])];
      return field(label, h("select", { onchange: (e) => { c[key] = e.target.value; touch(); } }, names.map((n) => h("option", { value: n, ...(n === c[key] ? { selected: "" } : {}) }, n))), help);
    };
    const text = (obj, key, label, num, help) => field(label, h("input", { type: num ? "number" : "text", value: obj[key], oninput: (e) => { obj[key] = num ? Number(e.target.value) : e.target.value; touch(); } }), help);

    const rulesBox = h("div");
    const drawRules = () => {
      rulesBox.replaceChildren(...c.router.rules.map((r, i) => {
        const move = (d) => () => { const j = i + d; if (j < 0 || j >= c.router.rules.length) return; [c.router.rules[i], c.router.rules[j]] = [c.router.rules[j], c.router.rules[i]]; drawRules(); touch(); };
        const sel = h("select", { class: "pill-select " + r.action, "aria-label": `Action for ${r.name}`, onchange: (e) => { r.action = e.target.value; sel.className = "pill-select " + r.action; touch(); } },
          ["offload", "keep"].map((a) => h("option", { value: a, ...(a === r.action ? { selected: "" } : {}) }, a)));
        const n = c.router.rules.length;
        return h("div", { class: "rule" },
          h("input", { type: "text", value: r.name, placeholder: "name", "aria-label": "Rule name", oninput: (e) => { r.name = e.target.value; touch(); } }),
          h("input", { type: "text", class: "rx", value: r.pattern, placeholder: "regex (case-insensitive)", "aria-label": "Regex pattern", spellcheck: "false", autocapitalize: "off", oninput: (e) => { r.pattern = e.target.value; touch(); } }),
          sel,
          h("input", { type: "text", value: r.hint || "", placeholder: "hint (optional)", "aria-label": "Hint", oninput: (e) => { r.hint = e.target.value; touch(); } }),
          h("div", { class: "rule-btns" },
            h("button", { type: "button", class: "btn icon", title: "Move up", "aria-label": "Move rule up", disabled: i === 0, onclick: move(-1) }, "↑"),
            h("button", { type: "button", class: "btn icon", title: "Move down", "aria-label": "Move rule down", disabled: i === n - 1, onclick: move(1) }, "↓"),
            h("button", { type: "button", class: "btn icon del", title: "Remove rule", "aria-label": "Remove rule", onclick: () => { c.router.rules.splice(i, 1); drawRules(); touch(); } }, "✕")));
      }));
      if (!c.router.rules.length) rulesBox.append(h("p", { class: "help" }, "No rules. Everything is kept on Claude."));
    };
    drawRules();

    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = discardBtn.disabled = true; saveBtn.textContent = "Saving…";
      try {
        const out = { ...clone(c), enabled: config.enabled };
        config = (await api("/api/config", out)).config;
        renderKill();
        saved = clone(config);
        Object.assign(c, clone(config), { _changed: touch });
        say("Saved.");
      } catch (e) { say(e.message, true); }
      saveBtn.disabled = discardBtn.disabled = false; saveBtn.textContent = "Save";
      refresh();
    });
    discardBtn.addEventListener("click", () => show("settings"));

    m.append(
      h("section", { class: "card" },
        h("div", { class: "sect-h" }, h("div", { class: "label" }, "Models & runtime"), h("div", { class: "help" }, "Which local model handles offloaded work.")),
        h("div", { class: "fields" },
          modelSel("defaultModel", "Default model", "Used for text prompts."), modelSel("visionModel", "Vision model", "Used when images are attached."),
          text(c, "numCtx", "Context window (numCtx)", true, "Tokens; minimum 512."), text(c, "ollamaHost", "Ollama host", false, "e.g. http://localhost:11434")),
        h("div", { style: "margin-top:8px" },
          switchRow(c, "think", "Think by default", "Let the model reason before answering (slower)."),
          switchRow(c.router, "llmClassifier", "LLM classifier fallback", "When no rule matches, ask the model (4s timeout, falls back to keep)."))),
      h("section", { class: "card" },
        h("div", { class: "sect-h" }, h("div", { class: "label" }, "Large file guard"), h("div", { class: "help" }, "Blocks whole-file reads of big text files so they can be offloaded instead.")),
        switchRow(c.largeFileGuard, "enabled", "Deny whole-file Read", "Applies to files over the size limit with a matching extension."),
        h("div", { class: "fields", style: "margin-top:8px" }, text(c.largeFileGuard, "minBytes", "Minimum size (bytes)", true),
          field("Extensions", h("input", { type: "text", value: c.largeFileGuard.extensions.join(","), spellcheck: "false", oninput: (e) => { c.largeFileGuard.extensions = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); touch(); } }), "Comma separated, e.g. .log,.txt"))),
      h("section", { class: "card" },
        h("div", { class: "sect-h" }, h("div", { class: "label" }, "Routing rules"), h("div", { class: "help" }, "Checked top to bottom; first match wins. No match means keep.")),
        rulesBox,
        h("div", { class: "actions" }, h("button", { type: "button", class: "btn", onclick: () => { c.router.rules.push({ name: "new-rule", pattern: "", action: "offload", hint: "" }); drawRules(); touch(); } }, "+ Add rule"))),
      bar);
    refresh();
  },

  async test(m) {
    const o = await api("/api/ollama").catch(() => ({ models: [] }));
    const rt = h("textarea", { id: "rt", placeholder: "Type a prompt to see how it would be routed" });
    const rout = h("div", { "aria-live": "polite" });
    const pp = h("textarea", { id: "pp", placeholder: "Prompt to run on a local model" });
    const names = [...new Set([config.defaultModel, ...o.models.map((x) => x.name)])];
    const sel = h("select", { "aria-label": "Model" }, names.map((n) => h("option", { value: n, ...(n === config.defaultModel ? { selected: "" } : {}) }, n)));
    const pout = h("div", { "aria-live": "polite" });
    const classify = async () => {
      try {
        const r = await api("/api/route-test", { prompt: rt.value });
        rout.replaceChildren(h("div", { class: "result" },
          h("div", { class: "row" }, h("span", { class: "badge " + r.action }, r.action), h("b", { class: "mono" }, r.rule ?? "(no rule)"), h("span", { class: "help" }, "source: " + r.source)),
          r.hint ? h("div", {}, h("span", { class: "label" }, "Hint "), r.hint) : null));
      } catch (e) { rout.replaceChildren(h("p", { class: "err", role: "alert" }, e.message)); }
    };
    const run = h("button", { type: "button", class: "btn pri" }, "Run");
    const exec = async () => {
      if (run.disabled) return;
      run.disabled = true; run.textContent = "Running…";
      pout.replaceChildren(h("p", { class: "help", style: "margin-top:12px" }, "Waiting for the model…"));
      try {
        const r = await api("/api/playground", { prompt: pp.value, model: sel.value });
        pout.replaceChildren(h("div", { class: "out" }, r.response), h("div", { class: "meta" }, `${r.model} · ${r.ms} ms · ${r.eval_count ?? "?"} tokens`));
      } catch (e) { pout.replaceChildren(h("p", { class: "err", role: "alert", style: "margin-top:12px" }, e.message)); }
      run.disabled = false; run.textContent = "Run";
    };
    run.addEventListener("click", exec);
    const ctrlEnter = (fn) => (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fn(); } };
    pp.addEventListener("keydown", ctrlEnter(exec));
    rt.addEventListener("keydown", ctrlEnter(classify));
    m.append(
      h("section", { class: "card" },
        h("div", { class: "sect-h" }, h("div", { class: "label" }, "Router tester"), h("div", { class: "help" }, "See which rule would handle a prompt. Nothing is sent to a model.")),
        h("label", { class: "f" }, h("span", {}, "Prompt"), rt),
        h("div", { class: "actions" }, h("button", { type: "button", class: "btn pri", onclick: classify }, "Classify"), h("span", { class: "help" }, "Ctrl/Cmd+Enter")), rout),
      h("section", { class: "card" },
        h("div", { class: "sect-h" }, h("div", { class: "label" }, "Playground"), h("div", { class: "help" }, "Run a prompt directly on a local model.")),
        h("label", { class: "f" }, h("span", {}, "Prompt"), pp),
        h("div", { class: "actions row" }, sel, run), pout));
  },
};

async function show(name) {
  if (!views[name]) name = "overview";
  for (const b of document.querySelectorAll("#tabs button")) {
    b.classList.toggle("on", b.dataset.t === name);
    b.setAttribute("aria-current", b.dataset.t === name ? "page" : "false");
  }
  const m = $("#main");
  const token = (show.n = (show.n || 0) + 1);
  const holder = h("div", { style: "display:contents" });
  m.replaceChildren(holder);
  try { await views[name](holder); } catch (e) { if (token === show.n) holder.append(h("div", { class: "card err", role: "alert" }, e.message)); }
}
const current = () => location.hash.slice(1) || "overview";
$("#tabs").addEventListener("click", (e) => {
  const t = e.target.closest("button")?.dataset.t;
  if (!t) return;
  if (current() === t) show(t); else location.hash = t;
});
window.addEventListener("hashchange", () => show(current()));
config = await api("/api/config");
renderKill();
refreshStatus();
setInterval(refreshStatus, 30000);
show(current());
