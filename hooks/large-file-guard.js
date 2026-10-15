#!/usr/bin/env node
// PreToolUse hook (matcher: Read): deny whole-file reads of big text files; fail open on any error.
import { readFileSync, statSync } from "node:fs";
import { extname, basename } from "node:path";
import { loadConfig } from "../lib/config.js";
import { logEvent } from "../lib/log.js";

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const { file_path, offset, limit } = input.tool_input || {};
  const g = loadConfig().largeFileGuard;
  if (g.enabled && file_path && offset == null && limit == null && g.extensions.includes(extname(file_path).toLowerCase())) {
    const bytes = statSync(file_path).size;
    if (bytes >= g.minBytes) {
      logEvent("guard", { session_id: input.session_id, path: basename(file_path), bytes });
      const reason = `${file_path} is ${(bytes / 1024).toFixed(0)} KB; to save Claude context, summarize/extract it with mcp__ollama__generate using file_paths, or Read a slice with offset/limit.`;
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
    }
  }
} catch {}
process.exit(0);
