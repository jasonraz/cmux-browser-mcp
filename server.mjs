#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const CMUX_CLI =
  process.env.CMUX_CLI_PATH ||
  "/Applications/cmux.app/Contents/Resources/bin/cmux";

// Build a clean env that strips CMUX_SURFACE_ID so the CLI doesn't
// accidentally target the terminal surface when a browser surface is
// explicitly specified via --surface.
function cmuxEnv() {
  const env = { ...process.env };
  delete env.CMUX_SURFACE_ID;
  return env;
}

async function cmux(...args) {
  try {
    const { stdout, stderr } = await execFileAsync(CMUX_CLI, args, {
      timeout: 30_000,
      maxBuffer: 50 * 1024 * 1024,
      env: cmuxEnv(),
    });
    const out = (stdout || "").trim();
    const err = (stderr || "").trim();
    return err ? `${out}\n${err}`.trim() : out;
  } catch (e) {
    const msg = e.stderr?.trim() || e.stdout?.trim() || e.message;
    throw new Error(`cmux ${args.join(" ")} failed: ${msg}`);
  }
}

// Lazily-fetched capabilities set for graceful degradation on older cmux versions.
let _capabilities = null;
async function getCapabilities() {
  if (_capabilities) return _capabilities;
  try {
    const out = await cmux("capabilities");
    const parsed = JSON.parse(out);
    _capabilities = new Set(parsed.methods || []);
  } catch {
    _capabilities = new Set();
  }
  return _capabilities;
}

function requireCapability(method) {
  return async (caps) => {
    if (caps.size > 0 && !caps.has(method)) {
      throw new Error(
        `This feature requires a newer version of cmux (missing capability: ${method}). Please update cmux.`
      );
    }
  };
}

async function cmuxWithCap(method, ...args) {
  const caps = await getCapabilities();
  if (caps.size > 0 && !caps.has(method)) {
    throw new Error(
      `This feature requires a newer version of cmux (missing capability: ${method}). Please update cmux.`
    );
  }
  return cmux(...args);
}

// Track the most recently opened browser surface so callers don't have to
// pass it explicitly on every single tool call.
let defaultSurface = null;

function surfaceArgs(surface) {
  const resolved = surface || defaultSurface;
  return resolved ? [resolved] : [];
}

const server = new McpServer({
  name: "cmux-browser",
  version: "1.2.0",
});

// --- Browser open / navigate ---

server.tool(
  "browser_open",
  "Open a URL in cmux's embedded browser (creates a new browser split pane)",
  { url: z.string().optional().describe("URL to open (optional)") },
  async ({ url }) => {
    const args = ["browser", "open"];
    if (url) args.push(url);
    const result = await cmux(...args);
    const match = result.match(/surface=(surface:\S+)/);
    if (match) defaultSurface = match[1];
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_navigate",
  "Navigate the browser to a URL",
  {
    url: z.string().describe("URL to navigate to"),
    surface: z.string().optional().describe("Browser surface ref (e.g. surface:2)"),
    snapshot_after: z.boolean().optional().describe("Take a snapshot after navigating"),
  },
  async ({ url, surface, snapshot_after }) => {
    const sArgs = surfaceArgs(surface);
    const result = await cmux("browser", ...sArgs, "navigate", url);
    if (snapshot_after) {
      const snap = await cmux("browser", ...sArgs, "snapshot", "--interactive", "--compact");
      return { content: [{ type: "text", text: `${result}\n${snap}` }] };
    }
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_back",
  "Navigate back in browser history",
  {
    surface: z.string().optional().describe("Browser surface ref"),
    snapshot_after: z.boolean().optional().describe("Take a snapshot after"),
  },
  async ({ surface, snapshot_after }) => {
    const args = ["browser", ...surfaceArgs(surface), "back"];
    if (snapshot_after) args.push("--snapshot-after");
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_forward",
  "Navigate forward in browser history",
  {
    surface: z.string().optional().describe("Browser surface ref"),
    snapshot_after: z.boolean().optional().describe("Take a snapshot after"),
  },
  async ({ surface, snapshot_after }) => {
    const args = ["browser", ...surfaceArgs(surface), "forward"];
    if (snapshot_after) args.push("--snapshot-after");
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_reload",
  "Reload the current browser page",
  {
    surface: z.string().optional().describe("Browser surface ref"),
    snapshot_after: z.boolean().optional().describe("Take a snapshot after"),
  },
  async ({ surface, snapshot_after }) => {
    const args = ["browser", ...surfaceArgs(surface), "reload"];
    if (snapshot_after) args.push("--snapshot-after");
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Snapshot / inspection ---

server.tool(
  "browser_snapshot",
  "Take an accessibility tree snapshot of the current page. Returns element refs (e.g. [ref=e1]) that can be used with click, fill, type, etc.",
  {
    interactive: z.boolean().optional().default(true).describe("Only show interactive elements (default true)"),
    compact: z.boolean().optional().default(true).describe("Compact output (default true)"),
    cursor: z.boolean().optional().describe("Include cursor position"),
    max_depth: z.coerce.number().optional().describe("Max tree depth"),
    selector: z.string().optional().describe("CSS selector to scope the snapshot"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ interactive, compact, cursor, max_depth, selector, surface }) => {
    const args = ["browser", ...surfaceArgs(surface), "snapshot"];
    if (interactive) args.push("--interactive");
    if (compact) args.push("--compact");
    if (cursor) args.push("--cursor");
    if (max_depth != null) args.push("--max-depth", String(max_depth));
    if (selector) args.push("--selector", selector);
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_screenshot",
  "Take a PNG screenshot of the current browser page. Saves to a temp file and returns the file path. Use the Read tool on the returned path to view the image.",
  {
    surface: z.string().optional().describe("Browser surface ref (e.g. surface:2)"),
    output_path: z.string().optional().describe("File path to save the PNG (defaults to a temp file)"),
    json: z.boolean().optional().describe("Output JSON metadata instead of plain text"),
  },
  async ({ surface, output_path, json }) => {
    const filePath =
      output_path || join(tmpdir(), `cmux-screenshot-${Date.now()}.png`);
    const args = ["browser", ...surfaceArgs(surface), "screenshot", "--out", filePath];
    if (json) args.push("--json");
    const result = await cmux(...args);
    return {
      content: [
        { type: "text", text: `Screenshot saved to: ${filePath}\n${result}`.trim() },
      ],
    };
  }
);

server.tool(
  "browser_get_url",
  "Get the current browser URL",
  { surface: z.string().optional().describe("Browser surface ref") },
  async ({ surface }) => {
    const result = await cmux("browser", ...surfaceArgs(surface), "get-url");
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_get",
  "Get a property from the page or an element",
  {
    property: z.enum(["url", "title", "text", "html", "value", "attr", "count", "box", "styles"]).describe("Property to get"),
    selector: z.string().optional().describe("CSS selector (required for element properties)"),
    attr_name: z.string().optional().describe("Attribute name (when property is 'attr')"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ property, selector, attr_name, surface }) => {
    const args = ["browser", ...surfaceArgs(surface), "get", property];
    if (selector) args.push(selector);
    if (attr_name && property === "attr") args.push(attr_name);
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Interaction ---

server.tool(
  "browser_click",
  "Click an element by ref or CSS selector. action can be click (default), dblclick, focus, or scroll-into-view.",
  {
    selector: z.string().describe("Element ref (e.g. e1) or CSS selector"),
    action: z.enum(["click", "dblclick", "focus", "scroll-into-view"]).optional().default("click").describe("Click action (default: click)"),
    surface: z.string().optional().describe("Browser surface ref"),
    snapshot_after: z.boolean().optional().describe("Take a snapshot after clicking"),
  },
  async ({ selector, action, surface, snapshot_after }) => {
    const act = action ?? "click";
    const capMap = { dblclick: "browser.dblclick", focus: "browser.focus", "scroll-into-view": "browser.scroll_into_view" };
    const cap = capMap[act];
    const args = ["browser", ...surfaceArgs(surface), act, selector];
    if (snapshot_after) args.push("--snapshot-after");
    const result = cap ? await cmuxWithCap(cap, ...args) : await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_fill",
  "Fill an input field (clears existing content first). Pass empty text to clear.",
  {
    selector: z.string().describe("Element ref (e.g. e1) or CSS selector"),
    text: z.string().optional().default("").describe("Text to fill (empty to clear)"),
    surface: z.string().optional().describe("Browser surface ref"),
    snapshot_after: z.boolean().optional().describe("Take a snapshot after filling"),
  },
  async ({ selector, text, surface, snapshot_after }) => {
    const args = ["browser", ...surfaceArgs(surface), "fill", selector];
    args.push(text);
    if (snapshot_after) args.push("--snapshot-after");
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_type",
  "Type text into a focused element (appends, does not clear)",
  {
    selector: z.string().describe("Element ref or CSS selector"),
    text: z.string().describe("Text to type"),
    surface: z.string().optional().describe("Browser surface ref"),
    snapshot_after: z.boolean().optional().describe("Take a snapshot after typing"),
  },
  async ({ selector, text, surface, snapshot_after }) => {
    const args = ["browser", ...surfaceArgs(surface), "type", selector, text];
    if (snapshot_after) args.push("--snapshot-after");
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_press",
  "Press, keydown, or keyup a key (e.g. Enter, Tab, Escape, ArrowDown)",
  {
    key: z.string().describe("Key to press (e.g. Enter, Tab, Escape)"),
    action: z.enum(["press", "keydown", "keyup"]).optional().default("press").describe("Key action (default: press)"),
    surface: z.string().optional().describe("Browser surface ref"),
    snapshot_after: z.boolean().optional().describe("Take a snapshot after"),
  },
  async ({ key, action, surface, snapshot_after }) => {
    const act = action ?? "press";
    const capMap = { keydown: "browser.keydown", keyup: "browser.keyup" };
    const cap = capMap[act];
    const args = ["browser", ...surfaceArgs(surface), act, key];
    if (snapshot_after) args.push("--snapshot-after");
    const result = cap ? await cmuxWithCap(cap, ...args) : await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_hover",
  "Hover over an element",
  {
    selector: z.string().describe("Element ref or CSS selector"),
    surface: z.string().optional().describe("Browser surface ref"),
    snapshot_after: z.boolean().optional().describe("Take a snapshot after"),
  },
  async ({ selector, surface, snapshot_after }) => {
    const args = ["browser", ...surfaceArgs(surface), "hover", selector];
    if (snapshot_after) args.push("--snapshot-after");
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_select",
  "Select an option from a dropdown",
  {
    selector: z.string().describe("Select element ref or CSS selector"),
    value: z.string().describe("Option value to select"),
    surface: z.string().optional().describe("Browser surface ref"),
    snapshot_after: z.boolean().optional().describe("Take a snapshot after"),
  },
  async ({ selector, value, surface, snapshot_after }) => {
    const args = ["browser", ...surfaceArgs(surface), "select", selector, value];
    if (snapshot_after) args.push("--snapshot-after");
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_scroll",
  "Scroll the page or an element",
  {
    selector: z.string().optional().describe("CSS selector to scroll (omit for page)"),
    dx: z.coerce.number().optional().describe("Horizontal scroll amount"),
    dy: z.coerce.number().optional().describe("Vertical scroll amount (positive = down)"),
    surface: z.string().optional().describe("Browser surface ref"),
    snapshot_after: z.boolean().optional().describe("Take a snapshot after"),
  },
  async ({ selector, dx, dy, surface, snapshot_after }) => {
    const args = ["browser", ...surfaceArgs(surface), "scroll"];
    if (selector) args.push("--selector", selector);
    if (dx != null) args.push("--dx", String(dx));
    if (dy != null) args.push("--dy", String(dy));
    if (snapshot_after) args.push("--snapshot-after");
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_check",
  "Check a checkbox",
  {
    selector: z.string().describe("Checkbox element ref or CSS selector"),
    surface: z.string().optional().describe("Browser surface ref"),
    snapshot_after: z.boolean().optional().describe("Take a snapshot after"),
  },
  async ({ selector, surface, snapshot_after }) => {
    const args = ["browser", ...surfaceArgs(surface), "check", selector];
    if (snapshot_after) args.push("--snapshot-after");
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_uncheck",
  "Uncheck a checkbox",
  {
    selector: z.string().describe("Checkbox element ref or CSS selector"),
    surface: z.string().optional().describe("Browser surface ref"),
    snapshot_after: z.boolean().optional().describe("Take a snapshot after"),
  },
  async ({ selector, surface, snapshot_after }) => {
    const args = ["browser", ...surfaceArgs(surface), "uncheck", selector];
    if (snapshot_after) args.push("--snapshot-after");
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Wait ---

server.tool(
  "browser_wait",
  "Wait for a condition before proceeding (selector visible, text appears, URL changes, page loads)",
  {
    selector: z.string().optional().describe("CSS selector to wait for"),
    text: z.string().optional().describe("Text to wait for on page"),
    url_contains: z.string().optional().describe("Wait for URL to contain this string"),
    load_state: z.enum(["interactive", "complete"]).optional().describe("Wait for load state"),
    js_function: z.string().optional().describe("JS function that returns truthy when ready"),
    timeout_ms: z.coerce.number().optional().describe("Timeout in milliseconds (default varies)"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ selector, text, url_contains, load_state, js_function, timeout_ms, surface }) => {
    const args = ["browser", ...surfaceArgs(surface), "wait"];
    if (selector) args.push("--selector", selector);
    if (text) args.push("--text", text);
    if (url_contains) args.push("--url-contains", url_contains);
    if (load_state) args.push("--load-state", load_state);
    if (js_function) args.push("--function", js_function);
    if (timeout_ms != null) args.push("--timeout-ms", String(timeout_ms));
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- JavaScript evaluation ---

server.tool(
  "browser_eval",
  "Evaluate JavaScript in the browser page context",
  {
    script: z.string().describe("JavaScript code to evaluate"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ script, surface }) => {
    // Always wrap in async IIFE — Playwright treats eval strings as function
    // bodies, so top-level return and await both require a wrapper.
    const finalScript = `(async () => {\n${script}\n})()`;
    const result = await cmux("browser", ...surfaceArgs(surface), "eval", finalScript);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Find elements ---

server.tool(
  "browser_find",
  "Find elements by various strategies (role, text, label, placeholder, testid, etc.)",
  {
    strategy: z.enum(["role", "text", "label", "placeholder", "alt", "title", "testid", "first", "last", "nth"]).describe("Find strategy"),
    query: z.string().describe("Search query for the strategy"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ strategy, query, surface }) => {
    const result = await cmux("browser", ...surfaceArgs(surface), "find", strategy, query);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Element state checks ---

server.tool(
  "browser_is",
  "Check element state (visible, enabled, checked)",
  {
    check: z.enum(["visible", "enabled", "checked"]).describe("State to check"),
    selector: z.string().describe("Element ref or CSS selector"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ check, selector, surface }) => {
    const result = await cmux("browser", ...surfaceArgs(surface), "is", check, selector);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Console / errors ---

server.tool(
  "browser_console",
  "List or clear browser console messages",
  {
    action: z.enum(["list", "clear"]).describe("Action to perform"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ action, surface }) => {
    const result = await cmux("browser", ...surfaceArgs(surface), "console", action);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_errors",
  "List or clear browser errors",
  {
    action: z.enum(["list", "clear"]).describe("Action to perform"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ action, surface }) => {
    const result = await cmux("browser", ...surfaceArgs(surface), "errors", action);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Tabs ---

server.tool(
  "browser_tab",
  "Manage browser tabs (new, list, switch, close)",
  {
    action: z.string().describe("Tab action: new, list, switch, close, or a numeric index"),
    target: z.string().optional().describe("Tab index or URL (for switch/new)"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ action, target, surface }) => {
    const args = ["browser", ...surfaceArgs(surface), "tab", action];
    if (target) args.push(target);
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Dialog handling ---

server.tool(
  "browser_dialog",
  "Accept or dismiss a JavaScript dialog (alert/confirm/prompt)",
  {
    action: z.enum(["accept", "dismiss"]).describe("Accept or dismiss the dialog"),
    text: z.string().optional().describe("Text to enter (for prompt dialogs)"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ action, text, surface }) => {
    const args = ["browser", ...surfaceArgs(surface), "dialog", action];
    if (text) args.push(text);
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Cookies / storage ---

server.tool(
  "browser_cookies",
  "Get, set, or clear browser cookies",
  {
    action: z.enum(["get", "set", "clear"]).describe("Cookie action"),
    args: z.array(z.string()).optional().describe("Additional arguments for the action"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ action, args: extraArgs, surface }) => {
    const cmdArgs = ["browser", ...surfaceArgs(surface), "cookies", action];
    if (extraArgs) cmdArgs.push(...extraArgs);
    const result = await cmux(...cmdArgs);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_storage",
  "Get, set, or clear localStorage or sessionStorage",
  {
    storage_type: z.enum(["local", "session"]).describe("Storage type"),
    action: z.enum(["get", "set", "clear"]).describe("Storage action"),
    args: z.array(z.string()).optional().describe("Additional arguments (key, value)"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ storage_type, action, args: extraArgs, surface }) => {
    const cmdArgs = ["browser", ...surfaceArgs(surface), "storage", storage_type, action];
    if (extraArgs) cmdArgs.push(...extraArgs);
    const result = await cmux(...cmdArgs);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Highlight ---

server.tool(
  "browser_highlight",
  "Highlight an element on the page (useful for visual debugging)",
  {
    selector: z.string().describe("Element ref or CSS selector to highlight"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ selector, surface }) => {
    const result = await cmux("browser", ...surfaceArgs(surface), "highlight", selector);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Frames ---

server.tool(
  "browser_frame",
  "Switch to an iframe or back to the main frame",
  {
    target: z.string().describe("CSS selector of iframe, or 'main' to switch back"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ target, surface }) => {
    const args = ["browser", ...surfaceArgs(surface), "frame", target];
    const result = await cmux(...args);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Add scripts/styles ---

server.tool(
  "browser_add_script",
  "Inject a script into the page (runs once, now)",
  {
    script: z.string().describe("JavaScript to inject"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ script, surface }) => {
    const result = await cmux("browser", ...surfaceArgs(surface), "addscript", script);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_add_init_script",
  "Inject a script that runs on every page navigation",
  {
    script: z.string().describe("JavaScript to inject on every navigation"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ script, surface }) => {
    const result = await cmux("browser", ...surfaceArgs(surface), "addinitscript", script);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "browser_add_style",
  "Inject CSS into the page",
  {
    css: z.string().describe("CSS to inject"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ css, surface }) => {
    const result = await cmux("browser", ...surfaceArgs(surface), "addstyle", css);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Viewport ---

server.tool(
  "browser_viewport",
  "Set the browser viewport size",
  {
    width: z.coerce.number().describe("Viewport width in pixels"),
    height: z.coerce.number().describe("Viewport height in pixels"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ width, height, surface }) => {
    const result = await cmuxWithCap("browser.viewport.set", "browser", ...surfaceArgs(surface), "viewport", "set", String(width), String(height));
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Geolocation ---

server.tool(
  "browser_geolocation",
  "Set the browser geolocation (latitude/longitude)",
  {
    latitude: z.coerce.number().describe("Latitude"),
    longitude: z.coerce.number().describe("Longitude"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ latitude, longitude, surface }) => {
    const result = await cmuxWithCap("browser.geolocation.set", "browser", ...surfaceArgs(surface), "geolocation", "set", String(latitude), String(longitude));
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Offline mode ---

server.tool(
  "browser_offline",
  "Enable or disable browser offline mode",
  {
    offline: z.boolean().describe("true to go offline, false to go online"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ offline, surface }) => {
    const result = await cmuxWithCap("browser.offline.set", "browser", ...surfaceArgs(surface), "offline", "set", offline ? "true" : "false");
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Network ---

server.tool(
  "browser_network",
  "Inspect or intercept network requests (list, route, unroute)",
  {
    action: z.enum(["requests", "route", "unroute"]).describe("Network action"),
    args: z.array(z.string()).optional().describe("Additional arguments (URL pattern, handler, etc.)"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ action, args: extraArgs, surface }) => {
    const capMap = { requests: "browser.network.requests", route: "browser.network.route", unroute: "browser.network.unroute" };
    const cmdArgs = ["browser", ...surfaceArgs(surface), "network", action];
    if (extraArgs) cmdArgs.push(...extraArgs);
    const result = await cmuxWithCap(capMap[action], ...cmdArgs);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Screencast ---

server.tool(
  "browser_screencast",
  "Start or stop a browser screencast recording",
  {
    action: z.enum(["start", "stop"]).describe("Start or stop recording"),
    args: z.array(z.string()).optional().describe("Additional arguments (e.g. output path)"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ action, args: extraArgs, surface }) => {
    const cap = action === "start" ? "browser.screencast.start" : "browser.screencast.stop";
    const cmdArgs = ["browser", ...surfaceArgs(surface), "screencast", action];
    if (extraArgs) cmdArgs.push(...extraArgs);
    const result = await cmuxWithCap(cap, ...cmdArgs);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Trace ---

server.tool(
  "browser_trace",
  "Start or stop a Playwright trace recording",
  {
    action: z.enum(["start", "stop"]).describe("Start or stop tracing"),
    args: z.array(z.string()).optional().describe("Additional arguments (e.g. output path)"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ action, args: extraArgs, surface }) => {
    const cap = action === "start" ? "browser.trace.start" : "browser.trace.stop";
    const cmdArgs = ["browser", ...surfaceArgs(surface), "trace", action];
    if (extraArgs) cmdArgs.push(...extraArgs);
    const result = await cmuxWithCap(cap, ...cmdArgs);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Open split ---

server.tool(
  "browser_open_split",
  "Open a browser split pane (always creates a new split, unlike browser_open which reuses existing)",
  { url: z.string().optional().describe("URL to open (optional)") },
  async ({ url }) => {
    const args = ["browser", "open-split"];
    if (url) args.push(url);
    const result = await cmuxWithCap("browser.open_split", ...args);
    const match = result.match(/surface=(surface:\S+)/);
    if (match) defaultSurface = match[1];
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Download ---

server.tool(
  "browser_download",
  "Wait for or trigger a file download",
  {
    wait: z.boolean().optional().describe("Wait for a download to complete"),
    path: z.string().optional().describe("File path to save the download"),
    timeout_ms: z.coerce.number().optional().describe("Timeout in milliseconds"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ wait, path, timeout_ms, surface }) => {
    const args = ["browser", ...surfaceArgs(surface), "download"];
    if (wait) args.push("wait");
    if (path) args.push("--path", path);
    if (timeout_ms != null) args.push("--timeout-ms", String(timeout_ms));
    const result = await cmuxWithCap("browser.download.wait", ...args);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Browser state save/load ---

server.tool(
  "browser_state",
  "Save or load browser state (cookies, localStorage, etc.) to/from a file",
  {
    action: z.enum(["save", "load"]).describe("Save or load browser state"),
    path: z.string().describe("File path for the state"),
    surface: z.string().optional().describe("Browser surface ref"),
  },
  async ({ action, path, surface }) => {
    const cap = action === "save" ? "browser.state.save" : "browser.state.load";
    const result = await cmuxWithCap(cap, "browser", ...surfaceArgs(surface), "state", action, path);
    return { content: [{ type: "text", text: result }] };
  }
);

// --- Identify ---

server.tool(
  "browser_identify",
  "Identify the current browser surface (returns surface/workspace refs)",
  { surface: z.string().optional().describe("Browser surface ref") },
  async ({ surface }) => {
    const result = await cmux("browser", ...surfaceArgs(surface), "identify");
    return { content: [{ type: "text", text: result }] };
  }
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
