# cmux-browser-mcp

An MCP (Model Context Protocol) server that gives Claude Code full control of
[cmux](https://github.com/manaflow-ai/cmux)'s embedded browser.

Open pages, click buttons, fill forms, take screenshots, run JavaScript — all
from Claude Code, right next to your terminal.

## Prerequisites

- [cmux](https://www.cmux.dev) (macOS terminal with embedded browser)
- [Claude Code](https://claude.com/claude-code) CLI (`claude`)
- Node.js >= 18

## Quick Install

```bash
unzip cmux-browser-mcp.zip
cd cmux-browser-mcp
chmod +x install.sh
./install.sh
```

Then **restart Claude Code**.

## Manual Install

```bash
# 1. Copy files
mkdir -p ~/.claude/mcp-servers/cmux-browser
cp package.json server.mjs ~/.claude/mcp-servers/cmux-browser/

# 2. Install dependencies
cd ~/.claude/mcp-servers/cmux-browser && npm install

# 3. Register with Claude Code
claude mcp add cmux-browser --scope user -- node ~/.claude/mcp-servers/cmux-browser/server.mjs

# 4. Restart Claude Code
```

Verify with `/mcp` inside Claude Code — you should see `cmux-browser` listed.

## Tools (31)

| Category | Tools |
|---|---|
| **Navigation** | `browser_open`, `browser_navigate`, `browser_back`, `browser_forward`, `browser_reload` |
| **Inspection** | `browser_snapshot`, `browser_screenshot`, `browser_get_url`, `browser_get` |
| **Interaction** | `browser_click`, `browser_fill`, `browser_type`, `browser_press`, `browser_hover`, `browser_select`, `browser_scroll`, `browser_check`, `browser_uncheck` |
| **Waiting** | `browser_wait` |
| **JavaScript** | `browser_eval` |
| **Search** | `browser_find`, `browser_is` |
| **Debug** | `browser_console`, `browser_errors`, `browser_highlight` |
| **Tabs** | `browser_tab` |
| **Dialogs** | `browser_dialog` |
| **State** | `browser_cookies`, `browser_storage` |
| **Injection** | `browser_add_script`, `browser_add_init_script`, `browser_add_style` |
| **Frames** | `browser_frame` |

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

`browser_screenshot` uses `cmux --json browser screenshot` to capture a PNG,
saves it to a temp file, and returns the path. Claude Code can then `Read` the
PNG to view it visually.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `CMUX_CLI_PATH` | `/Applications/cmux.app/Contents/Resources/bin/cmux` | Path to the cmux CLI binary |

## Gotchas

- **`CMUX_SURFACE_ID` env var**: Auto-set in cmux terminal panes. The MCP server
  strips this from child processes so browser commands target the correct surface
  instead of the caller's terminal. This is handled automatically.

- **Screenshots need `--json`**: The bare `cmux browser screenshot` returns "OK"
  with no image data. The server uses `cmux --json browser screenshot` to get
  the `png_base64` field. This is handled automatically.

- **`maxBuffer`**: Screenshot base64 data can be large. The server sets
  `maxBuffer` to 50 MB for `execFile` calls.

## Uninstall

```bash
claude mcp remove cmux-browser --scope user
rm -rf ~/.claude/mcp-servers/cmux-browser
```

## License

MIT
