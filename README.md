# clauderouter

Hand low-stakes text work from Claude Code to a local [Ollama](https://ollama.com) model.

- **MCP server** (`server.js`): `generate` and `list_models` tools for Claude Code.
- **Hooks** (`hooks/`): a prompt router that sends summarize / draft / reword / classify / extract / image-description requests to Ollama and keeps code, debugging and security with Claude (prefix a prompt with `!` to skip routing), plus a guard that tells Claude to summarize or partially read files of 256 KB or more.
- **Dashboard** (`web/`): a zero-dependency web UI with stats, an event log, rule and setting editing, and a playground. Token login, 10-failure lockout per IP.

## Setup

```sh
npm install
claude mcp add ollama -- node "$PWD/server.js"
```

Config, logs and the dashboard token live in `~/.config/ollama-offload/` (override with `OFFLOAD_CONFIG_DIR`). Default Ollama host is `http://localhost:11434`.

### Dashboard

```sh
cp deploy/ollama-offload-web.service ~/.config/systemd/user/
systemctl --user enable --now ollama-offload-web
node bin/offload-url   # prints the sign-in link
```

It listens on `127.0.0.1:3460` (`OFFLOAD_WEB_PORT` changes the port). Set `OFFLOAD_WEB_HOST` to a LAN address to also listen there, and restrict the port with your firewall. It serves plain HTTP, so only expose it on a trusted network or VPN.

## Tests

```sh
npm test
```
