# AGENTS.md

<!-- handoff:learnings:begin -->
## Session Learnings (auto-updated by handoff)

### Implicit Rules
- Node ESM, zero-dep dashboard; tests: npm test (node --test test/*.test.js)
- Env: OFFLOAD_WEB_PORT (default 3460), OFFLOAD_WEB_HOST (comma list), OFFLOAD_CONFIG_DIR (default ~/.config/ollama-offload)
- Dashboard token in ~/.config/ollama-offload/web.env, mode 600, never regenerated; never commit it
- Repo is PUBLIC: keep personal IPs/tokens/email out of tracked files
- Service: systemctl --user {status,restart} ollama-offload-web; linger enabled

### Key Decisions
- Decision: dashboard binds 127.0.0.1 + explicit OFFLOAD_WEB_HOST addresses, never 0.0.0.0 — Reason: keep Docker bridge networks out
- Decision: plain HTTP + fixed token + 10-fail/10-min per-IP lockout — Reason: reached only via LAN/VPN; lockout limits token guessing
- Decision: repo service file has OFFLOAD_WEB_HOST commented example; installed copy in ~/.config/systemd/user sets real IP — Reason: public repo should not carry personal LAN IP
- Decision: kept service name ollama-offload-web and config dir ~/.config/ollama-offload after rename — Reason: renaming would regenerate token and break phone link
- Decision: hooks fail open (silent on error), router timeout 10s, guard 5s — Reason: never block Claude when Ollama down

<!-- handoff:learnings:end -->

## Model notes
- Hardware: AMD RX 6700 XT 12GB (ROCm gfx1030), Ollama at localhost:11434; num_ctx default 16384 (Ollama's 4096 default truncates large files).
- Default model gemma4:12b-it-qat (text + vision, think=false). Benchmark 2026-10-15 at 16k ctx: gemma4 35 tok/s 8.0GB, 10/10 classify, accurate summaries; qwen3.5:9b 47 tok/s 6.1GB, fastest but summaries drift to next-steps; ministral-3:14b 36 tok/s 10.7GB, richest summaries but little VRAM headroom; qwen3:14b 21 tok/s, spills past 12GB, broke JSON.
