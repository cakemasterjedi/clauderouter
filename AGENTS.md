# AGENTS.md

<!-- handoff:learnings:begin -->
## Session Learnings (auto-updated by handoff)

### Implicit Rules
- Hardware: AMD RX 6700 XT 12GB VRAM (ROCm gfx1030), 35GB RAM, 16 cores, Ollama 0.40.3 at localhost:11434
- Env overrides for server: OLLAMA_HOST, OLLAMA_DEFAULT_MODEL, OLLAMA_VISION_MODEL, OLLAMA_NUM_CTX
- Installed models: gemma4:12b-it-qat (default), llama3.2:latest, qwen2.5vl:latest
- User has ADHD-mode plugin always-on: lead with action, numbered steps, one next action

### Key Decisions
- Decision: custom MCP server (server.js, ~70 lines) over third-party package — Reason: small, auditable, no unknown deps
- Decision: file_paths param — Reason: Ollama reads files directly so Claude never ingests them, actually saves Claude tokens
- Decision: num_ctx default 16384 — Reason: Ollama default 4096 silently truncates large files; 16k fits VRAM
- Decision: gemma4:12b-it-qat as text+vision default — Reason: 7.6GB VRAM at 16k ctx, fully GPU-resident, 38 tok/s, vision+tools, QAT better quality at 4-bit; 26-27B Qwen3.6/3.8 options 16-19GB would spill to RAM
- Decision: think=false default — Reason: thinking used ~2000 chars, made short answers ~17s; opt-in via think param

<!-- handoff:learnings:end -->
