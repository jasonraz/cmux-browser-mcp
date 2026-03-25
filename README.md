# cmux-browser-mcp

An MCP (Model Context Protocol) server that gives Claude Code full control of
[cmux](https://github.com/manaflow-ai/cmux)'s embedded browser.

Open pages, click buttons, fill forms, take screenshots, run JavaScript — all
from Claude Code, right next to your terminal.

## Prerequisites

- [cmux](https://www.cmux.dev) (macOS terminal with embedded browser)
- [Claude Code](https://claude.com/claude-code) CLI (`claude`)
- Node.js >= 18

## Install

```bash
git clone https://github.com/jasonraz/cmux-browser-mcp.git
cd cmux-browser-mcp
chmod +x install.sh
./install.sh
```

Then **restart Claude Code**. Verify with `/mcp` — you should see `cmux-browser` listed.

The install script will:
1. Copy `server.mjs` and `package.json` to `~/.claude/mcp-servers/cmux-browser/`
2. Run `npm install` to fetch the MCP SDK dependency
3. Register the server with Claude Code via `claude mcp add`

### Manual Install

If you prefer to do it yourself:

```bash
mkdir -p ~/.claude/mcp-servers/cmux-browser
cp package.json server.mjs ~/.claude/mcp-servers/cmux-browser/
cd ~/.claude/mcp-servers/cmux-browser && npm install
claude mcp add cmux-browser --scope user -- node ~/.claude/mcp-servers/cmux-browser/server.mjs
```

## Tools (43)

| Category | Tools |
|---|---|
| **Navigation** | `browser_open`, `browser_open_split`, `browser_navigate`, `browser_back`, `browser_forward`, `browser_reload` |
| **Inspection** | `browser_snapshot`, `browser_screenshot`, `browser_get_url`, `browser_get` |
| **Interaction** | `browser_click`, `browser_fill`, `browser_type`, `browser_press`, `browser_hover`, `browser_select`, `browser_scroll`, `browser_check`, `browser_uncheck` |
| **Waiting** | `browser_wait` |
| **JavaScript** | `browser_eval` |
| **Search** | `browser_find`, `browser_is` |
| **Debug** | `browser_console`, `browser_errors`, `browser_highlight` |
| **Tabs** | `browser_tab` |
| **Dialogs** | `browser_dialog` |
| **State** | `browser_cookies`, `browser_storage`, `browser_state` |
| **Downloads** | `browser_download` |
| **Injection** | `browser_add_script`, `browser_add_init_script`, `browser_add_style` |
| **Frames** | `browser_frame` |
| **Network** | `browser_network`, `browser_offline` |
| **Device** | `browser_viewport`, `browser_geolocation` |
| **Recording** | `browser_screencast`, `browser_trace` |
| **Identify** | `browser_identify` |

### Tool notes

- **`browser_click`** — supports `action`: `click` (default), `dblclick`, `focus`, `scroll-into-view`
- **`browser_press`** — supports `action`: `press` (default), `keydown`, `keyup`
- **`browser_screenshot`** — accepts optional `--json` flag via `json: true`
- **`browser_tab`** — `action` accepts `new`, `list`, `switch`, `close`, or a numeric tab index

## How It Works

The server wraps cmux's `browser` CLI subcommands as MCP tools with proper
schemas. Claude Code discovers these tools at startup and can call them directly.

The core workflow is **snapshot → ref → act**:

1. **Open** a page with `browser_open`
2. **Snapshot** the accessibility tree with `browser_snapshot` — returns element
   refs like `[ref=e1]`, `[ref=e2]`
3. **Act** on elements: `browser_click` ref `e1`, `browser_fill` ref `e3` with text
4. **Verify** with another snapshot or `browser_screenshot`

### Screenshots

`browser_screenshot` uses `cmux browser screenshot --out <path>` to capture a
PNG directly to disk and returns the file path. Claude Code can then `Read` the
PNG to view it visually.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `CMUX_CLI_PATH` | `/Applications/cmux.app/Contents/Resources/bin/cmux` | Path to the cmux CLI binary |

## Version compatibility

Tools check cmux's `capabilities` endpoint at runtime. If you call a tool that requires a newer version of cmux than you have installed, you'll get a clear error message telling you which capability is missing — not a cryptic failure.

All tools present in v1.1.x continue to work unchanged.

## Gotchas

- **`CMUX_SURFACE_ID` env var**: Auto-set in cmux terminal panes. The MCP server
  strips this from child processes so browser commands target the correct surface
  instead of the caller's terminal. This is handled automatically.

- **`maxBuffer`**: The server sets `maxBuffer` to 50 MB for `execFile` calls to
  accommodate large command outputs.

## Update

```bash
git pull
./install.sh
```

Then restart Claude Code.

## Uninstall

```bash
claude mcp remove cmux-browser --scope user
rm -rf ~/.claude/mcp-servers/cmux-browser
```

## License

MIT
