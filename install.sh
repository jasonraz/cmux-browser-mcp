#!/usr/bin/env bash
set -euo pipefail

# cmux-browser-mcp installer
# Works both when run from a local clone AND when piped via curl:
#   curl -fsSL https://raw.githubusercontent.com/jasonraz/cmux-browser-mcp/main/install.sh | bash

INSTALL_DIR="${HOME}/.claude/mcp-servers/cmux-browser"
REPO_RAW="https://raw.githubusercontent.com/jasonraz/cmux-browser-mcp/main"

echo "==> cmux-browser-mcp installer"
echo ""

# --- Pre-flight checks ---

# Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required but not found in PATH."
    echo "Install it from https://nodejs.org or via your package manager."
      exit 1
      fi

      NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
      if [ "$NODE_MAJOR" -lt 18 ]; then
        echo "Error: Node.js >= 18 is required (found v$(node --version))."
          exit 1
          fi

          # cmux
          CMUX_CLI="${CMUX_CLI_PATH:-/Applications/cmux.app/Contents/Resources/bin/cmux}"
          if [ ! -x "$CMUX_CLI" ]; then
            if command -v cmux >/dev/null 2>&1; then
                CMUX_CLI="$(command -v cmux)"
                  else
                      echo "Error: cmux not found."
                          echo "Install cmux from https://www.cmux.dev or set CMUX_CLI_PATH."
                              exit 1
                                fi
                                fi
                                echo "  Found cmux: $CMUX_CLI"

                                # Claude Code
                                CLAUDE_CLI=""
                                if command -v claude >/dev/null 2>&1; then
                                  CLAUDE_CLI="$(command -v claude)"
                                    echo "  Found Claude Code: $CLAUDE_CLI"
                                    else
                                      echo "  Warning: claude CLI not found - will install files but skip MCP registration."
                                        echo "  You can register manually later (see README)."
                                        fi
                                        echo ""

                                        # --- Install files ---
                                        echo "==> Installing to ${INSTALL_DIR}"
                                        mkdir -p "$INSTALL_DIR"

                                        # Determine if we're running from a local clone or via curl
                                        SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-}")" 2>/dev/null && pwd)" || SCRIPT_DIR=""

                                        if [ -f "${SCRIPT_DIR}/server.mjs" ] && [ -f "${SCRIPT_DIR}/package.json" ]; then
                                          # Running from a local clone — copy files directly
                                            cp "$SCRIPT_DIR/package.json" "$INSTALL_DIR/package.json"
                                              cp "$SCRIPT_DIR/server.mjs" "$INSTALL_DIR/server.mjs"
                                              else
                                                # Running via curl — download files from GitHub
                                                  echo "  Downloading files from GitHub..."
                                                    curl -fsSL "$REPO_RAW/package.json" -o "$INSTALL_DIR/package.json"
                                                      curl -fsSL "$REPO_RAW/server.mjs"   -o "$INSTALL_DIR/server.mjs"
                                                      fi

                                                      echo "==> Installing npm dependencies"
                                                      cd "$INSTALL_DIR" && npm install --silent 2>&1
                                                      echo "  Done."
                                                      echo ""

                                                      # --- Register with Claude Code ---
                                                      if [ -n "$CLAUDE_CLI" ]; then
                                                        echo "==> Registering MCP server with Claude Code"
                                                          if CLAUDECODE="" "$CLAUDE_CLI" mcp add cmux-browser --scope user -- node "$INSTALL_DIR/server.mjs" 2>/dev/null; then
                                                              echo "  Registered successfully."
                                                                else
                                                                    echo "  Warning: Auto-registration failed. Register manually:"
                                                                        echo ""
                                                                            echo "  claude mcp add cmux-browser --scope user -- node $INSTALL_DIR/server.mjs"
                                                                                echo ""
                                                                                  fi
                                                                                  else
                                                                                    echo "==> Manual registration required. Run:"
                                                                                      echo ""
                                                                                        echo "  claude mcp add cmux-browser --scope user -- node $INSTALL_DIR/server.mjs"
                                                                                          echo ""
                                                                                          fi

                                                                                          echo ""
                                                                                          echo "==> Installation complete!"
                                                                                          echo ""
                                                                                          echo "  Restart Claude Code for the MCP server to load."
                                                                                          echo "  Verify with: /mcp (in Claude Code)"
                                                                                          echo ""
                                                                                          echo "  43 browser tools are now available:"
                                                                                          echo "  browser_open, browser_navigate, browser_snapshot, browser_screenshot,"
                                                                                          echo "  browser_click, browser_fill, browser_type, browser_press, browser_wait,"
                                                                                          echo "  browser_eval, browser_get, browser_find, and more."
                                                                                          echo ""
                                                                                          echo "  Quick test after restart:"
                                                                                          echo "  Ask Claude: \"Open https://example.com in the browser and take a screenshot\""
                                                                                          echo ""
