#!/usr/bin/env node
// UserPromptSubmit hook: nudge Claude to offload low-stakes text work to Ollama.
import { readFileSync } from "node:fs";
import { loadConfig } from "../lib/config.js";
import { logEvent, snip } from "../lib/log.js";
import { route, contextFor } from "../lib/router.js";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const prompt = String(input.prompt ?? "");
  const r = await route(prompt, loadConfig());
  logEvent("route", { session_id: input.session_id, rule: r.rule, action: r.action, source: r.source, prompt: snip(prompt) });
  if (r.action === "offload") {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: contextFor(r) } }));
  }
} catch {}
process.exit(0);
