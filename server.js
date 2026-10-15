#!/usr/bin/env node
// Minimal MCP server that lets Claude Code hand text work to a local Ollama.
import { readFile, stat } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./lib/config.js";
import { pickModel, loadedModels } from "./lib/models.js";
import { logEvent, snip } from "./lib/log.js";
import { runGenerate, timings } from "./lib/generate.js";

async function ollama(path, body, host = loadConfig().ollamaHost) {
  const res = await fetch(`${host}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Ollama ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

const text = (t) => ({ content: [{ type: "text", text: t }] });

const server = new McpServer({ name: "ollama", version: "1.0.0" });

server.tool(
  "list_models",
  "List the models installed in the local Ollama.",
  {},
  async () => {
    const { models } = await ollama("/api/tags");
    return text(models.map((m) => `${m.name}  ${m.details.parameter_size}  [${(m.capabilities || []).join(", ")}]`).join("\n"));
  },
);

server.tool(
  "generate",
  "Run a prompt on a local Ollama model (free, private, lower quality than Claude). " +
    "Good for bulk summarizing, drafting, classifying, rewording, or extracting from large text. " +
    "Pass file_paths to process files without reading them yourself, or image_paths to use the vision model. " +
    "The model is chosen automatically (faster model for classify/extract/tag, best-prose model otherwise); pass task to help. Verify important output.",
  {
    prompt: z.string().describe("Full prompt, including any text to process"),
    system: z.string().optional().describe("Optional system prompt"),
    model: z.string().optional().describe("Model name; omit to let the server choose automatically (recommended)"),
    task: z.enum(["summarize", "draft", "reword", "explain", "classify", "extract", "tag", "other"]).optional().describe("Kind of work; lets the server pick the faster model for classify/extract/tag"),
    file_paths: z.array(z.string()).optional().describe("Absolute paths of text files to append to the prompt; Ollama reads them so Claude does not have to"),
    image_paths: z.array(z.string()).optional().describe("Absolute paths of images to attach"),
    temperature: z.number().optional(),
    think: z.boolean().optional().describe("Let the model reason before answering; slower, better on harder tasks. Default false"),
  },
  async ({ prompt, system, model, task, file_paths, image_paths, temperature, think }) => {
    const cfg = loadConfig();
    const label = snip(prompt);
    const request = prompt; // before file contents are appended; task inference must not see file text
    const t0 = Date.now();
    let file_bytes = 0;
    let picked = { model: model || cfg.defaultModel, numCtx: cfg.numCtx, reason: model ? "explicit" : "default" };
    try {
      for (const p of file_paths || []) {
        file_bytes += (await stat(p)).size;
        prompt += `\n\n--- ${p} ---\n${await readFile(p, "utf8")}`;
      }
      const images = image_paths?.length
        ? await Promise.all(image_paths.map(async (p) => (await readFile(p)).toString("base64")))
        : undefined;
      picked = pickModel({
        prompt: request, task, hasImages: !!images, inputChars: prompt.length + (system?.length || 0), explicitModel: model,
        loaded: model ? [] : await loadedModels(cfg.ollamaHost), cfg,
      });
      const { r, model: used, fallbackFrom, fallbackError } = await runGenerate({ cfg, body: {
        model: picked.model,
        prompt,
        system,
        images,
        think: think ?? cfg.think,
        options: { num_ctx: picked.numCtx, ...(temperature === undefined ? {} : { temperature }) },
      } });
      logEvent("generate", {
        model: used, route_reason: picked.reason, num_ctx: picked.numCtx, ms: Date.now() - t0, ok: true,
        prompt_eval_count: r.prompt_eval_count, eval_count: r.eval_count, ...timings(r),
        ...(fallbackFrom ? { fallback_from: fallbackFrom, fallback_error: fallbackError } : {}),
        file_bytes, est_claude_tokens_saved: Math.round(file_bytes / 4), prompt: label,
      });
      return text(r.response);
    } catch (e) {
      logEvent("generate", { model: picked.model, route_reason: picked.reason, num_ctx: picked.numCtx, ms: Date.now() - t0, ok: false, error: String(e.message).slice(0, 200), ...(e.fallbackFrom ? { fallback_from: e.fallbackFrom } : {}), file_bytes, est_claude_tokens_saved: 0, prompt: label });
      throw e;
    }
  },
);

await server.connect(new StdioServerTransport());
