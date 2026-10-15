#!/usr/bin/env node
// Minimal MCP server that lets Claude Code hand text work to a local Ollama.
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_DEFAULT_MODEL || "gemma4:12b-it-qat";
const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "gemma4:12b-it-qat";

async function ollama(path, body) {
  const res = await fetch(`${HOST}${path}`, {
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
    "Pass file_paths to process files without reading them yourself, or image_paths to use the vision model. Verify important output.",
  {
    prompt: z.string().describe("Full prompt, including any text to process"),
    system: z.string().optional().describe("Optional system prompt"),
    model: z.string().optional().describe(`Model name; defaults to ${DEFAULT_MODEL} (or ${VISION_MODEL} with images)`),
    file_paths: z.array(z.string()).optional().describe("Absolute paths of text files to append to the prompt; Ollama reads them so Claude does not have to"),
    image_paths: z.array(z.string()).optional().describe("Absolute paths of images to attach"),
    temperature: z.number().optional(),
    think: z.boolean().optional().describe("Let the model reason before answering; slower, better on harder tasks. Default false"),
  },
  async ({ prompt, system, model, file_paths, image_paths, temperature, think }) => {
    for (const p of file_paths || []) prompt += `\n\n--- ${p} ---\n${await readFile(p, "utf8")}`;
    const images = image_paths?.length
      ? await Promise.all(image_paths.map(async (p) => (await readFile(p)).toString("base64")))
      : undefined;
    const r = await ollama("/api/generate", {
      model: model || (images ? VISION_MODEL : DEFAULT_MODEL),
      prompt,
      system,
      images,
      stream: false,
      think: think ?? false,
      options: { num_ctx: Number(process.env.OLLAMA_NUM_CTX || 16384), ...(temperature === undefined ? {} : { temperature }) },
    });
    return text(r.response);
  },
);

await server.connect(new StdioServerTransport());
