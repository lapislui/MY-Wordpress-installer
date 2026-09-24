const path = require("path");
const fs = require("fs");
const net = require("net");
const crypto = require("crypto");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const {
  app,
  BrowserWindow,
  BrowserView,
  Menu,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  session,
  safeStorage,
  screen,
  shell
} = require("electron");
const mysql = require("mysql2/promise");
const AdmZip = require("adm-zip");
const { Client: SshClient, Server: SshServer, utils: ssh2Utils } = require("ssh2");
const { OPEN_MODE, STATUS_CODE } = ssh2Utils.sftp;

let lastFocusedWindow = null;
const browserWindows = new Map();
const configuredBrowserPartitions = new Set();
const extensionLoadFailures = new Map();
let localSftpServer = null;
let localSftpServerState = {
  running: false,
  host: "127.0.0.1",
  port: 2222,
  rootPath: "",
  username: "wpdesktop",
  clients: 0,
  lastError: ""
};
let embeddedMcpRuntime = null;
let embeddedMcpState = {
  running: false,
  host: "127.0.0.1",
  port: 3789,
  endpoint: "",
  sessions: 0,
  lastError: ""
};
const activeSftpConnections = new Map(); // Maps connection IDs to { conn, sftp, config }
const VAULT_CAPTURE_LOG_PREFIX = "__WP_DESKTOP_SAVE_CREDENTIAL__:";
const AUTO_ALLOWED_BROWSER_PERMISSIONS = new Set([
  "media",
  "display-capture",
  "speaker-selection",
  "fullscreen",
  "pointerLock",
  "notifications",
  "clipboard-sanitized-write"
]);

function getOriginFromUrl(value) {
  try {
    return value ? new URL(value).origin : "";
  } catch (_) {
    return "";
  }
}

function shouldAutoAllowBrowserPermission(origin, permission) {
  if (!origin || !permission) {
    return false;
  }

  if (AUTO_ALLOWED_BROWSER_PERMISSIONS.has(permission)) {
    return true;
  }

  const stored = getStoredPermissionDecision(origin, permission);
  if (stored === "allow") {
    return true;
  }
  if (stored === "block") {
    return false;
  }

  try {
    const hostname = new URL(origin).hostname;
    const googleOrigin = hostname === "accounts.google.com" || hostname.endsWith(".google.com");
    return googleOrigin && ["hid", "usb", "serial"].includes(permission);
  } catch (_) {
    return false;
  }
}

function ignoreBrokenPipe(error) {
  if (error?.code === "EPIPE") {
    return;
  }

  throw error;
}

process.stdout?.on?.("error", ignoreBrokenPipe);
process.stderr?.on?.("error", ignoreBrokenPipe);

process.on("uncaughtException", (error) => {
  if (error?.code === "EPIPE") {
    return;
  }

  throw error;
});

function getVaultPath() {
  return path.join(app.getPath("userData"), "vault.bin");
}

function getSitesPath() {
  return path.join(app.getPath("userData"), "sites.json");
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

const LOCAL_SERVER_DEFINITIONS = {
  xampp: {
    label: "XAMPP",
    documentRootName: "htdocs",
    defaultRoots: [
      "C:\\xampp",
      "C:\\Users\\Keval\\Saved Games\\xampp"
    ],
    controlPanelPatterns: [["xampp-control.exe"]],
    apacheStartPatterns: [["apache_start.bat"]],
    apacheStopPatterns: [["apache_stop.bat"]],
    apacheConfigPatterns: [["apache", "conf", "httpd.conf"]],
    phpExecutablePatterns: [["php", "php.exe"]],
    phpConfigPatterns: [
      ["php", "php.ini"],
      ["php", "php-development.ini"]
    ],
    mysqlConfigPatterns: [
      ["mysql", "bin", "my.ini"],
      ["mysql", "data", "my.ini"],
      ["mysql", "backup", "my.ini"]
    ],
    phpMyAdminPatterns: [["phpMyAdmin"]]
  },
  laragon: {
    label: "Laragon",
    documentRootName: "www",
    defaultRoots: ["C:\\laragon"],
    controlPanelPatterns: [["laragon.exe"]],
    apacheStartPatterns: [],
    apacheStopPatterns: [],
    apacheConfigPatterns: [
      ["bin", "apache", "*", "conf", "httpd.conf"],
      ["etc", "apache2", "httpd.conf"]
    ],
    phpExecutablePatterns: [
      ["bin", "php", "*", "php.exe"],
      ["bin", "php", "php.exe"]
    ],
    phpConfigPatterns: [
      ["bin", "php", "*", "php.ini"],
      ["etc", "php", "php.ini"]
    ],
    mysqlConfigPatterns: [
      ["bin", "mysql", "*", "my.ini"],
      ["bin", "mysql", "*", "bin", "my.ini"],
      ["data", "mysql", "my.ini"],
      ["etc", "mysql", "my.ini"]
    ],
    phpMyAdminPatterns: [
      ["etc", "apps", "phpMyAdmin"],
      ["etc", "apps", "phpmyadmin"]
    ]
  }
};

function normalizeLocalServerType(value) {
  return value === "laragon" ? "laragon" : "xampp";
}

function getSupportedLocalServerTypes() {
  return Object.keys(LOCAL_SERVER_DEFINITIONS);
}

function getLocalServerDefinition(type) {
  return LOCAL_SERVER_DEFINITIONS[normalizeLocalServerType(type)];
}

function getLocalServerLabel(type) {
  return getLocalServerDefinition(type).label;
}

function getActiveLocalServerLabel(settings = getSettings()) {
  return getLocalServerLabel(settings?.localServerType);
}

function getLocalServerWebServerLabel(settings = getSettings()) {
  return `Apache via ${getActiveLocalServerLabel(settings)}`;
}

function getLocalServerPhpVersionLabel(settings = getSettings()) {
  return `PHP via ${getActiveLocalServerLabel(settings)}`;
}

function getLocalServerDatabaseLabel(settings = getSettings()) {
  return `MySQL via ${getActiveLocalServerLabel(settings)}`;
}

async function buildSettingsPayload(settings = getSettings()) {
  const apacheRunning = await isApacheRunning();
  const resolvedHtdocsPath = getResolvedHtdocsPath(settings);
  const localServerType = normalizeLocalServerType(settings.localServerType);
  return {
    ...settings,
    localServerType,
    localServerLabel: getLocalServerLabel(localServerType),
    htdocsPath: resolvedHtdocsPath,
    apacheRunning,
    xamppServiceStatus: await getXamppServiceStatus(settings),
    mcpServerStatus: getEmbeddedMcpStatus(settings),
    detectedDbProfile: detectLocalServerDbProfile(settings),
    effectiveDbProfile: getEffectiveDbProfile(settings),
    mysqlConfigContent: readMysqlConfigContent(settings),
    serverPaths: getLocalServerPathsSummary(settings),
    xamppPaths: getLocalServerPathsSummary(settings)
  };
}

function getBrowserHistoryPath() {
  return path.join(app.getPath("userData"), "browser-history.json");
}

function getEmbeddedMcpStatus(settings = getSettings()) {
  const configured = settings.mcpServer || {};
  return {
    ...configured,
    ...embeddedMcpState,
    running: Boolean(embeddedMcpRuntime?.httpServer?.listening),
    endpoint: embeddedMcpState.endpoint || `http://${configured.host || "127.0.0.1"}:${configured.port || 3789}/mcp`,
    sessions: embeddedMcpRuntime?.transports?.size || 0,
    lastError: embeddedMcpState.lastError || ""
  };
}

function getEmbeddedMcpHome() {
  return path.join(app.getPath("userData"), "mcp");
}

function getMcpBuildEntryPath() {
  return path.join(__dirname, "mcp-dist", "mcp", "core", "mcpServerFactory.js");
}

function ensureEmbeddedMcpBuild() {
  if (fs.existsSync(getMcpBuildEntryPath())) {
    return { ok: true };
  }

  if (app.isPackaged) {
    return {
      ok: false,
      message: "Packaged app is missing mcp-dist. Rebuild the installer with npm run pack:win."
    };
  }

  const tscPath = process.platform === "win32"
    ? path.join(__dirname, "node_modules", ".bin", "tsc.cmd")
    : path.join(__dirname, "node_modules", ".bin", "tsc");
  if (!fs.existsSync(tscPath)) {
    return {
      ok: false,
      message: "TypeScript compiler was not found. Run npm install, then npm run mcp:build."
    };
  }

  const result = spawnSync(tscPath, ["-p", "tsconfig.mcp.json", "--pretty", "false"], {
    cwd: __dirname,
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0 || !fs.existsSync(getMcpBuildEntryPath())) {
    return {
      ok: false,
      message: `MCP build failed: ${result.stderr || result.stdout || "unknown TypeScript error"}`
    };
  }

  return { ok: true };
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": "http://localhost",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type,mcp-session-id",
    ...headers
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function startEmbeddedMcpServer(settings = getSettings()) {
  if (embeddedMcpRuntime?.httpServer?.listening) {
    return getEmbeddedMcpStatus(settings);
  }
  if (settings.mcpServer?.enabled === false) {
    embeddedMcpState.running = false;
    embeddedMcpState.lastError = "";
    return getEmbeddedMcpStatus(settings);
  }

  let McpServerFactory;
  let SnapshotStoreClass;
  let BrowserInspectorClass;
  let StreamableHTTPServerTransport;
  let isInitializeRequest;
  try {
    const buildResult = ensureEmbeddedMcpBuild();
    if (!buildResult.ok) {
      throw new Error(buildResult.message);
    }
    ({ createWpDesktopMcpServer: McpServerFactory } = require("./mcp-dist/mcp/core/mcpServerFactory.js"));
    ({ SnapshotStore: SnapshotStoreClass } = require("./mcp-dist/mcp/core/snapshotStore.js"));
    ({ BrowserInspector: BrowserInspectorClass } = require("./mcp-dist/mcp/core/browserInspector.js"));
    ({ StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js"));
    ({ isInitializeRequest } = require("@modelcontextprotocol/sdk/types.js"));
  } catch (error) {
    embeddedMcpState = {
      ...embeddedMcpState,
      running: false,
      lastError: `MCP build output is missing or invalid: ${error.message}`
    };
    return getEmbeddedMcpStatus(settings);
  }

  const host = settings.mcpServer?.host || "127.0.0.1";
  const configuredPort = Number(settings.mcpServer?.port) || 3789;
  const store = new SnapshotStoreClass(getEmbeddedMcpHome());
  const inspector = new BrowserInspectorClass(store);
  const transports = new Map();

  const httpServer = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        sendJson(res, 204, {});
        return;
      }

      const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${host}:${configuredPort}`}`);
      if (requestUrl.pathname === "/mcp/status" || requestUrl.pathname === "/health") {
        sendJson(res, 200, getEmbeddedMcpStatus());
        return;
      }
      if (requestUrl.pathname !== "/mcp") {
        sendJson(res, 404, { error: "Not found. Use /mcp for MCP or /mcp/status for status." });
        return;
      }

      const sessionIdHeader = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
      let transport = sessionId ? transports.get(sessionId) : null;

      if (req.method === "POST") {
        const body = await parseRequestBody(req);
        if (!transport) {
          if (sessionId || !isInitializeRequest(body)) {
            sendJson(res, 400, {
              jsonrpc: "2.0",
              error: { code: -32000, message: "Bad Request: initialize first or provide a valid MCP session id." },
              id: null
            });
            return;
          }

          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (newSessionId) => {
              transports.set(newSessionId, transport);
            }
          });
          transport.onclose = () => {
            if (transport?.sessionId) {
              transports.delete(transport.sessionId);
            }
          };
          const mcpServer = McpServerFactory({
            store,
            inspector,
            listTabs: () => {
              const allTabs = [];
              for (const win of BrowserWindow.getAllWindows()) {
                const state = browserWindows.get(win.id);
                if (state && state.tabs) {
                  for (const tab of state.tabs) {
                    allTabs.push({
                      id: tab.id,
                      title: tab.title,
                      url: tab.url,
                      isLoading: tab.isLoading,
                      nickname: tab.nickname || undefined
                    });
                  }
                }
              }
              return allTabs;
            },
            createTab: async (url, mode) => {
              let win = lastFocusedWindow || BrowserWindow.getAllWindows()[0];
              if (!win) {
                win = createWindow({ startupUrl: url });
              } else {
                createBrowserTab(win, url, mode || "auto", true);
              }
            },
            closeTab: async (tabId) => {
              for (const win of BrowserWindow.getAllWindows()) {
                const state = browserWindows.get(win.id);
                if (state && state.tabs && state.tabs.some(t => t.id === tabId)) {
                  closeBrowserTab(win, tabId);
                  return;
                }
              }
              throw new Error(`Tab ${tabId} not found.`);
            },
            navigateTab: async (tabId, url) => {
              const resolvedUrl = ensureUrl(url);
              for (const win of BrowserWindow.getAllWindows()) {
                const state = browserWindows.get(win.id);
                if (state && state.tabs) {
                  const tab = state.tabs.find(t => t.id === tabId);
                  if (tab) {
                    wcSafeLoadURL(tab.view.webContents, resolvedUrl);
                    tab.url = resolvedUrl;
                    emitBrowserState(win);
                    return;
                  }
                }
              }
              throw new Error(`Tab ${tabId} not found.`);
            },
            executeTabJs: async (tabId, js) => {
              for (const win of BrowserWindow.getAllWindows()) {
                const state = browserWindows.get(win.id);
                if (state && state.tabs) {
                  const tab = state.tabs.find(t => t.id === tabId);
                  if (tab) {
                    return await tab.view.webContents.executeJavaScript(js);
                  }
                }
              }
              throw new Error(`Tab ${tabId} not found.`);
            },
            listSites: () => getSites(),
            getSftpStatus: () => getLocalSftpStatus(),
            startSftpServer: async (overrides) => await startLocalSftpServer(overrides),
            stopSftpServer: async () => await stopLocalSftpServer(),
            clickElement: async (tabId, selector) => {
              const res = findTabAcrossAllWindows(tabId);
              if (!res) throw new Error(`Tab ${tabId} not found.`);
              const js = `(() => {
                const element = document.querySelector(${JSON.stringify(selector)});
                if (!element) {
                  return { success: false, error: 'Element not found' };
                }
                element.click();
                return { success: true };
              })()`;
              return await res.tab.view.webContents.executeJavaScript(js);
            },
            fillInput: async (tabId, selector, value) => {
              const res = findTabAcrossAllWindows(tabId);
              if (!res) throw new Error(`Tab ${tabId} not found.`);
              const js = `(() => {
                const element = document.querySelector(${JSON.stringify(selector)});
                if (!element) {
                  return { success: false, error: 'Element not found' };
                }
                element.value = ${JSON.stringify(value)};
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true };
              })()`;
              return await res.tab.view.webContents.executeJavaScript(js);
            },
            getHtml: async (tabId) => {
              const res = findTabAcrossAllWindows(tabId);
              if (!res) throw new Error(`Tab ${tabId} not found.`);
              return await res.tab.view.webContents.executeJavaScript(`document.documentElement.outerHTML`);
            },
            getElementInfo: async (tabId, selector) => {
              const res = findTabAcrossAllWindows(tabId);
              if (!res) throw new Error(`Tab ${tabId} not found.`);
              const js = `(() => {
                const element = document.querySelector(${JSON.stringify(selector)});
                if (!element) {
                  return null;
                }
                const rect = element.getBoundingClientRect();
                const computed = window.getComputedStyle(element);
                return {
                  tagName: element.tagName,
                  id: element.id,
                  className: element.className,
                  outerHTML: element.outerHTML.slice(0, 5000),
                  bounds: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    left: rect.left
                  },
                  styles: {
                    display: computed.display,
                    visibility: computed.visibility,
                    opacity: computed.opacity,
                    color: computed.color,
                    backgroundColor: computed.backgroundColor,
                    fontFamily: computed.fontFamily,
                    fontSize: computed.fontSize,
                    fontWeight: computed.fontWeight
                  }
                };
              })()`;
              return await res.tab.view.webContents.executeJavaScript(js);
            },
            getConsoleLogs: async (tabId) => {
              const res = findTabAcrossAllWindows(tabId);
              if (!res) throw new Error(`Tab ${tabId} not found.`);
              return res.tab.consoleLogs || [];
            },
            getNetworkRequests: async (tabId) => {
              const res = findTabAcrossAllWindows(tabId);
              if (!res) throw new Error(`Tab ${tabId} not found.`);
              return res.tab.networkRequests || [];
            },
            getPerformanceMetrics: async (tabId) => {
              const res = findTabAcrossAllWindows(tabId);
              if (!res) throw new Error(`Tab ${tabId} not found.`);
              const js = `(() => {
                const navigation = performance.getEntriesByType('navigation')[0] || {};
                const paint = performance.getEntriesByType('paint') || [];
                const fcpEntry = paint.find(entry => entry.name === 'first-contentful-paint');
                let lcp = 0;
                try {
                  const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
                  if (lcpEntries.length > 0) {
                    lcp = lcpEntries[lcpEntries.length - 1].startTime;
                  }
                } catch (e) {}
                return {
                  navigationTiming: {
                    duration: navigation.duration || 0,
                    domInteractive: navigation.domInteractive || 0,
                    domComplete: navigation.domComplete || 0,
                    loadEventEnd: navigation.loadEventEnd || 0
                  },
                  firstContentfulPaint: fcpEntry ? fcpEntry.startTime : 0,
                  largestContentfulPaint: lcp,
                  cumulativeLayoutShift: 0
                };
              })()`;
              return await res.tab.view.webContents.executeJavaScript(js);
            },
            takeTabScreenshot: async (tabId) => {
              const res = findTabAcrossAllWindows(tabId);
              if (!res) throw new Error(`Tab ${tabId} not found.`);
              const image = await res.tab.view.webContents.capturePage();
              return image.toPNG().toString("base64");
            }
          });
          await mcpServer.connect(transport);
        }

        await transport.handleRequest(req, res, body);
        return;
      }

      if ((req.method === "GET" || req.method === "DELETE") && transport) {
        await transport.handleRequest(req, res);
        return;
      }

      sendJson(res, 405, { error: "Method not allowed or missing MCP session." }, { allow: "GET, POST, DELETE, OPTIONS" });
    } catch (error) {
      embeddedMcpState.lastError = error.message || "Embedded MCP request failed.";
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        });
      }
    }
  });

  async function listenOn(port, attemptsLeft = 10) {
    return await new Promise((resolve, reject) => {
      const onError = (error) => {
        httpServer.off("listening", onListening);
        if (error.code === "EADDRINUSE" && attemptsLeft > 1) {
          resolve(listenOn(port + 1, attemptsLeft - 1));
          return;
        }
        reject(error);
      };
      const onListening = () => {
        httpServer.off("error", onError);
        resolve(port);
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(port, host);
    });
  }

  try {
    const port = await listenOn(configuredPort);
    embeddedMcpRuntime = { httpServer, store, inspector, transports };
    embeddedMcpState = {
      running: true,
      host,
      port,
      endpoint: `http://${host}:${port}/mcp`,
      sessions: 0,
      lastError: ""
    };
  } catch (error) {
    store.close();
    void inspector.close();
    embeddedMcpState = {
      ...embeddedMcpState,
      running: false,
      lastError: error.message || "Embedded MCP server failed to start."
    };
  }

  return getEmbeddedMcpStatus(settings);
}

async function stopEmbeddedMcpServer() {
  if (!embeddedMcpRuntime) {
    embeddedMcpState.running = false;
    return getEmbeddedMcpStatus();
  }

  const runtime = embeddedMcpRuntime;
  embeddedMcpRuntime = null;
  await Promise.allSettled([...runtime.transports.values()].map((transport) => transport.close()));
  await new Promise((resolve) => runtime.httpServer.close(resolve));
  await runtime.inspector.close();
  runtime.store.close();
  embeddedMcpState.running = false;
  embeddedMcpState.sessions = 0;
  return getEmbeddedMcpStatus();
}

function getDefaultVault() {
  return {
    installerDb: null,
    siteCredentials: {}
  };
}

function normalizeVaultCredentialEntry(entry, fallbackId = "") {
  const username = String(entry?.username || "");
  const password = String(entry?.password || "");
  const timestamp = new Date().toISOString();

  return {
    id: String(entry?.id || fallbackId || `cred-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`),
    username,
    password,
    createdAt: entry?.createdAt || timestamp,
    updatedAt: entry?.updatedAt || timestamp
  };
}

function normalizeVaultCredentialCollection(value, key = "") {
  if (value && typeof value === "object" && Array.isArray(value.entries)) {
    const entries = value.entries
      .map((entry, index) => normalizeVaultCredentialEntry(entry, `${key || "site"}-${index + 1}`))
      .filter((entry) => entry.username || entry.password);
    const selectedId = entries.some((entry) => entry.id === value.selectedId)
      ? value.selectedId
      : entries[0]?.id || null;
    return { entries, selectedId };
  }

  if (value && typeof value === "object" && ("username" in value || "password" in value)) {
    const entry = normalizeVaultCredentialEntry(value, `${key || "site"}-1`);
    if (!entry.username && !entry.password) {
      return { entries: [], selectedId: null };
    }
    return { entries: [entry], selectedId: entry.id };
  }

  return { entries: [], selectedId: null };
}

function getVaultCredentialCollection(vault, key) {
  return normalizeVaultCredentialCollection(vault?.siteCredentials?.[key], key);
}

function getPreferredVaultCredential(vault, key) {
  const collection = getVaultCredentialCollection(vault, key);
  return (
    collection.entries.find((entry) => entry.id === collection.selectedId) ||
    collection.entries[0] ||
    null
  );
}

function saveVaultCredential(vault, payload) {
  const key = String(payload?.key || "");
  if (!key) {
    throw new Error("Missing credential key.");
  }

  const username = String(payload?.username || "");
  const password = String(payload?.password || "");
  const collection = getVaultCredentialCollection(vault, key);
  const now = new Date().toISOString();
  let selectedEntry =
    collection.entries.find((entry) => entry.id === payload?.id) ||
    collection.entries.find((entry) => entry.username === username && entry.password === password) ||
    null;

  if (selectedEntry) {
    selectedEntry.username = username;
    selectedEntry.password = password;
    selectedEntry.updatedAt = now;
  } else {
    selectedEntry = normalizeVaultCredentialEntry(
      {
        username,
        password,
        createdAt: now,
        updatedAt: now
      },
      `${key}-${collection.entries.length + 1}`
    );
    collection.entries.unshift(selectedEntry);
  }

  collection.entries = collection.entries.filter((entry) => entry.username || entry.password);
  collection.selectedId = selectedEntry.id;
  vault.siteCredentials[key] = collection;
  return collection;
}

function removeVaultCredential(vault, key, credentialId = "") {
  if (!key) {
    return { entries: [], selectedId: null };
  }

  if (!vault.siteCredentials[key]) {
    return { entries: [], selectedId: null };
  }

  if (!credentialId) {
    delete vault.siteCredentials[key];
    return { entries: [], selectedId: null };
  }

  const collection = getVaultCredentialCollection(vault, key);
  collection.entries = collection.entries.filter((entry) => entry.id !== credentialId);
  collection.selectedId = collection.entries[0]?.id || null;

  if (!collection.entries.length) {
    delete vault.siteCredentials[key];
    return { entries: [], selectedId: null };
  }

  vault.siteCredentials[key] = collection;
  return collection;
}

function serializeVaultCredentialResponse(value, key = "") {
  const collection = normalizeVaultCredentialCollection(value, key);
  const preferred =
    collection.entries.find((entry) => entry.id === collection.selectedId) ||
    collection.entries[0] ||
    null;

  return {
    entries: collection.entries,
    selectedId: collection.selectedId,
    username: preferred?.username || "",
    password: preferred?.password || ""
  };
}

function getVault() {
  const vaultPath = getVaultPath();

  try {
    if (!fs.existsSync(vaultPath)) {
      return getDefaultVault();
    }

    const raw = fs.readFileSync(vaultPath);
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString("utf8");
    const parsed = JSON.parse(json);

    return {
      installerDb: parsed.installerDb || null,
      siteCredentials: Object.fromEntries(
        Object.entries(parsed.siteCredentials || {}).map(([key, value]) => [
          key,
          normalizeVaultCredentialCollection(value, key)
        ])
      )
    };
  } catch (_) {
    return getDefaultVault();
  }
}

function saveVault(vault) {
  const json = JSON.stringify(vault, null, 2);
  const raw = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, "utf8");

  fs.writeFileSync(getVaultPath(), raw);
}

function getSites() {
  try {
    const sitesPath = getSitesPath();
    if (!fs.existsSync(sitesPath)) {
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(sitesPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveSites(sites) {
  fs.writeFileSync(getSitesPath(), JSON.stringify(sites, null, 2));
}

function getBrowserHistory() {
  try {
    const historyPath = getBrowserHistoryPath();
    if (!fs.existsSync(historyPath)) {
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(historyPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveBrowserHistory(entries) {
  fs.writeFileSync(getBrowserHistoryPath(), JSON.stringify(entries.slice(0, 250), null, 2));
}

function clearBrowserHistory() {
  try {
    const historyPath = getBrowserHistoryPath();
    if (fs.existsSync(historyPath)) {
      fs.unlinkSync(historyPath);
    }
  } catch (_) {
    // Ignore cleanup failures.
  }
}

function pickFirstExistingPath(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function getDefaultLocalServerType() {
  const detected = getSupportedLocalServerTypes().find((type) => getDefaultRootPathForType(type));
  return detected || "xampp";
}

function getDefaultRootPathForType(type) {
  const definition = getLocalServerDefinition(type);
  return pickFirstExistingPath(definition.defaultRoots);
}

function getDefaultHtdocsPathForType(type) {
  const definition = getLocalServerDefinition(type);
  const rootPath = getDefaultRootPathForType(type);
  return rootPath ? path.join(rootPath, definition.documentRootName) : "";
}

function getDocumentRootFromRoot(rootPath, type) {
  if (!rootPath) {
    return "";
  }

  return path.join(path.resolve(rootPath), getLocalServerDefinition(type).documentRootName);
}

function getLocalServerRootFromDocumentRoot(documentRootPath, type) {
  if (!documentRootPath) {
    return "";
  }

  const resolved = path.resolve(documentRootPath);
  const documentRootName = getLocalServerDefinition(type).documentRootName.toLowerCase();
  return path.basename(resolved).toLowerCase() === documentRootName
    ? path.dirname(resolved)
    : "";
}

function getRootPathSettingKey(type) {
  return normalizeLocalServerType(type) === "laragon" ? "laragonRootPath" : "xamppRootPath";
}

function getStoredRootPath(settings, type) {
  const key = getRootPathSettingKey(type);
  return settings?.[key] || "";
}

function getResolvedRootPath(settings, type = settings?.localServerType) {
  const normalizedType = normalizeLocalServerType(type);
  const storedRootPath = getStoredRootPath(settings, normalizedType);
  const derivedRootPath = getLocalServerRootFromDocumentRoot(settings?.htdocsPath, normalizedType);
  return storedRootPath || derivedRootPath || getDefaultRootPathForType(normalizedType);
}

function getResolvedHtdocsPath(settings) {
  if (settings?.htdocsPath) {
    return settings.htdocsPath;
  }

  const localServerType = normalizeLocalServerType(settings?.localServerType);
  const rootPath = getResolvedRootPath(settings, localServerType);
  return rootPath
    ? getDocumentRootFromRoot(rootPath, localServerType)
    : getDefaultHtdocsPathForType(localServerType);
}

function expandCandidatePattern(rootPath, segments) {
  let candidates = [rootPath];
  for (const segment of segments) {
    if (segment === "*") {
      candidates = candidates.flatMap((candidateRoot) => {
        try {
          return fs.readdirSync(candidateRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(candidateRoot, entry.name));
        } catch (_) {
          return [];
        }
      });
      continue;
    }

    candidates = candidates.map((candidateRoot) => path.join(candidateRoot, segment));
  }

  return pickFirstExistingPath(candidates);
}

function pickFirstExistingPattern(rootPath, patterns) {
  for (const pattern of patterns) {
    const resolved = expandCandidatePattern(rootPath, pattern);
    if (resolved) {
      return resolved;
    }
  }

  return "";
}

function getLocalServerPathsSummary(settings) {
  const localServerType = normalizeLocalServerType(settings?.localServerType);
  const definition = getLocalServerDefinition(localServerType);
  const localServerRootPath = getResolvedRootPath(settings, localServerType);
  const htdocsPath = getResolvedHtdocsPath({ ...settings, localServerType });

  if (!localServerRootPath) {
    return {
      localServerType,
      localServerLabel: definition.label,
      localServerRootPath: "",
      xamppRootPath: "",
      documentRootName: definition.documentRootName,
      htdocsPath,
      controlPanelPath: "",
      apacheStartPath: "",
      apacheStopPath: "",
      apacheConfigPath: "",
      phpExecutablePath: "",
      phpConfigPath: "",
      mysqlConfigPath: "",
      phpMyAdminPath: ""
    };
  }

  return {
    localServerType,
    localServerLabel: definition.label,
    localServerRootPath,
    xamppRootPath: localServerRootPath,
    documentRootName: definition.documentRootName,
    htdocsPath,
    controlPanelPath: pickFirstExistingPattern(localServerRootPath, definition.controlPanelPatterns),
    apacheStartPath: pickFirstExistingPattern(localServerRootPath, definition.apacheStartPatterns),
    apacheStopPath: pickFirstExistingPattern(localServerRootPath, definition.apacheStopPatterns),
    apacheConfigPath: pickFirstExistingPattern(localServerRootPath, definition.apacheConfigPatterns),
    phpExecutablePath: pickFirstExistingPattern(localServerRootPath, definition.phpExecutablePatterns),
    phpConfigPath: pickFirstExistingPattern(localServerRootPath, definition.phpConfigPatterns),
    mysqlConfigPath: pickFirstExistingPattern(localServerRootPath, definition.mysqlConfigPatterns),
    phpMyAdminPath: pickFirstExistingPattern(localServerRootPath, definition.phpMyAdminPatterns)
  };
}

function parseMysqlConfigProfile(source) {
  const text = String(source || "");
  const portMatch = text.match(/^\s*port\s*=\s*(\d+)\s*$/im);
  const bindAddressMatch = text.match(/^\s*bind-address\s*=\s*([^\s#;]+)\s*$/im);
  const rawHost = (bindAddressMatch?.[1] || "").trim();
  const host = !rawHost || rawHost === "0.0.0.0" || rawHost === "::" || rawHost === "*"
    ? "127.0.0.1"
    : rawHost;

  return {
    host,
    port: portMatch?.[1] || "3306"
  };
}

function parseApacheConfigProfile(source) {
  const text = String(source || "");
  const listenMatches = [...text.matchAll(/^\s*Listen\s+([^\s#]+)\s*$/gim)];
  const ports = listenMatches
    .map((match) => {
      const raw = String(match?.[1] || "").trim();
      const portMatch = raw.match(/(?::)?(\d+)$/);
      return portMatch ? Number(portMatch[1]) : null;
    })
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);

  return {
    ports: Array.from(new Set(ports))
  };
}

function readApacheConfigContent(settings) {
  const apacheConfigPath = getLocalServerPathsSummary(settings).apacheConfigPath;
  if (!apacheConfigPath || !fs.existsSync(apacheConfigPath)) {
    return "";
  }

  return fs.readFileSync(apacheConfigPath, "utf8");
}

function getConfiguredApachePorts(settings = getSettings()) {
  const apacheConfigContent = readApacheConfigContent(settings);
  const parsed = parseApacheConfigProfile(apacheConfigContent);
  return parsed.ports.length ? parsed.ports : [80];
}

function readMysqlConfigContent(settings) {
  const mysqlConfigPath = getLocalServerPathsSummary(settings).mysqlConfigPath;
  if (!mysqlConfigPath || !fs.existsSync(mysqlConfigPath)) {
    return "";
  }

  return fs.readFileSync(mysqlConfigPath, "utf8");
}

function getEffectiveDbProfile(settings = getSettings()) {
  const mysqlConfigContent = readMysqlConfigContent(settings);
  const parsed = parseMysqlConfigProfile(mysqlConfigContent);

  return {
    host: parsed.host || "127.0.0.1",
    port: String(parsed.port || "3306"),
    user: settings.dbUser || "root",
    password: settings.dbPassword || ""
  };
}

function detectLocalServerDbProfile(settings) {
  const mysqlConfigPath = getLocalServerPathsSummary(settings).mysqlConfigPath;
  if (!mysqlConfigPath || !fs.existsSync(mysqlConfigPath)) {
    return null;
  }

  const source = fs.readFileSync(mysqlConfigPath, "utf8");
  const parsed = parseMysqlConfigProfile(source);
  return {
    host: parsed.host || "127.0.0.1",
    port: parsed.port || "3306",
    user: "root",
    password: ""
  };
}

function getSettings() {
  try {
    const settingsPath = getSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return getDefaultSettings();
    }

    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    return normalizeSettings(parsed);
  } catch (_) {
    return getDefaultSettings();
  }
}

function saveSettings(settings) {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(normalizeSettings(settings), null, 2));
}

function getDefaultSettings() {
  const localServerType = getDefaultLocalServerType();
  return {
    localServerType,
    xamppRootPath: getDefaultRootPathForType("xampp"),
    laragonRootPath: getDefaultRootPathForType("laragon"),
    htdocsPath: getDefaultHtdocsPathForType(localServerType),
    dbUser: "root",
    dbPassword: "",
    wpInstallUsername: "admin",
    wpInstallPassword: "root",
    wpInstallEmail: "",
    shareLocalSiteSessions: true,
    shareOnlineSiteSessions: false,
    autoSaveLocalTabSessions: false,
    autoSaveOnlineTabSessions: false,
    sessionAutoSaveDelaySeconds: 5,
    savedTabSessions: [],
    downloadDirectory: app.getPath("downloads"),
    browserPermissions: {},
    browserBookmarks: [],
    browserShowBookmarksBar: true,
    browserExtensions: [],
    mcpServer: {
      enabled: true,
      host: "127.0.0.1",
      port: 3789
    },
    sftpServer: {
      host: "127.0.0.1",
      port: 2222,
      username: "wpdesktop",
      password: "",
      rootPath: getDefaultHtdocsPathForType(localServerType),
      enabled: false
    }
  };
}

function normalizeSettings(input = {}) {
  const permissions = input.browserPermissions && typeof input.browserPermissions === "object"
    ? Object.fromEntries(
        Object.entries(input.browserPermissions).map(([origin, rules]) => ([
          origin,
          rules && typeof rules === "object"
            ? Object.fromEntries(
                Object.entries(rules).filter(([, decision]) => decision === "allow" || decision === "block")
              )
            : {}
        ])).filter(([, rules]) => Object.keys(rules).length > 0)
      )
    : {};
  const normalizeBookmarkNode = (node) => {
    if (!node || typeof node !== "object") {
      return null;
    }

    const type = node.type === "folder" ? "folder" : "bookmark";
    const id = String(node.id || "").trim();
    const title = String(node.title || "").trim();
    if (!id || !title) {
      return null;
    }

    if (type === "folder") {
      const children = Array.isArray(node.children)
        ? node.children.map(normalizeBookmarkNode).filter(Boolean)
        : [];
      return { id, type, title, children };
    }

    const url = String(node.url || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return null;
    }
    return {
      id,
      type: "bookmark",
      title,
      url,
      iconOnly: Boolean(node.iconOnly)
    };
  };

  const bookmarks = Array.isArray(input.browserBookmarks)
    ? input.browserBookmarks
        .map((bookmark) => {
          if (bookmark?.type === "folder" || Array.isArray(bookmark?.children)) {
            return normalizeBookmarkNode(bookmark);
          }

          const id = String(bookmark?.id || "").trim();
          const title = String(bookmark?.title || "").trim();
          const url = String(bookmark?.url || "").trim();
          if (!id || !title || !/^https?:\/\//i.test(url)) {
            return null;
          }
          return {
            id,
            type: "bookmark",
            title,
            url,
            iconOnly: Boolean(bookmark?.iconOnly)
          };
        })
        .filter(Boolean)
    : [];

  const extensions = Array.isArray(input.browserExtensions)
    ? input.browserExtensions
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const id = String(entry.id || "").trim();
          const name = String(entry.name || "").trim();
          const sourcePath = String(entry.sourcePath || "").trim();
          const unpackedPath = String(entry.unpackedPath || "").trim();
          const sourceType = entry.sourceType === "zip" ? "zip" : "folder";
          if (!id || !name || !sourcePath || !unpackedPath) {
            return null;
          }
          return {
            id,
            name,
            version: String(entry.version || "").trim(),
            sourceType,
            sourcePath,
            unpackedPath,
            extensionId: String(entry.extensionId || "").trim(),
            enabled: entry.enabled !== false,
            pinned: entry.pinned === true,
            popupPath: String(entry.popupPath || "").trim(),
            iconPath: String(entry.iconPath || "").trim()
          };
        })
        .filter(Boolean)
    : [];
  const savedTabSessions = Array.isArray(input.savedTabSessions)
    ? input.savedTabSessions
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const scope = entry.scope === "local" ? "local" : "online";
          const tabName = String(entry.tabName || "").trim();
          if (!tabName) {
            return null;
          }
          return {
            scope,
            tabName,
            groupName: String(entry.groupName || "").trim(),
            autoSave: entry.autoSave === true,
            updatedAt: Number(entry.updatedAt || Date.now())
          };
        })
        .filter(Boolean)
    : [];
  const sftpServerInput = input.sftpServer && typeof input.sftpServer === "object"
    ? input.sftpServer
    : {};
  const mcpServerInput = input.mcpServer && typeof input.mcpServer === "object"
    ? input.mcpServer
    : {};

  return {
    localServerType: normalizeLocalServerType(
      input.localServerType || (input.laragonRootPath ? "laragon" : "xampp")
    ),
    xamppRootPath: input.xamppRootPath || getDefaultRootPathForType("xampp"),
    laragonRootPath: input.laragonRootPath || getDefaultRootPathForType("laragon"),
    htdocsPath: input.htdocsPath || "",
    dbUser: String(input.dbUser || "root").trim() || "root",
    dbPassword: input.dbPassword ?? "",
    wpInstallUsername: String(input.wpInstallUsername || "admin").trim() || "admin",
    wpInstallPassword: input.wpInstallPassword ?? "root",
    wpInstallEmail: String(input.wpInstallEmail || "").trim(),
    shareLocalSiteSessions: input.shareLocalSiteSessions !== false,
    shareOnlineSiteSessions: input.shareOnlineSiteSessions === true,
    autoSaveLocalTabSessions: input.autoSaveLocalTabSessions === true,
    autoSaveOnlineTabSessions: input.autoSaveOnlineTabSessions === true,
    sessionAutoSaveDelaySeconds: Math.max(1, Number(input.sessionAutoSaveDelaySeconds) || 5),
    savedTabSessions,
    downloadDirectory: input.downloadDirectory || app.getPath("downloads"),
    browserPermissions: permissions,
    browserBookmarks: bookmarks,
    browserShowBookmarksBar: input.browserShowBookmarksBar !== false,
    browserExtensions: extensions,
    mcpServer: {
      enabled: mcpServerInput.enabled !== false,
      host: String(mcpServerInput.host || "127.0.0.1").trim() || "127.0.0.1",
      port: Math.max(1, Math.min(65535, Number(mcpServerInput.port) || 3789))
    },
    sftpServer: {
      host: String(sftpServerInput.host || "127.0.0.1").trim() || "127.0.0.1",
      port: Math.max(1, Math.min(65535, Number(sftpServerInput.port) || 2222)),
      username: String(sftpServerInput.username || "wpdesktop").trim() || "wpdesktop",
      password: String(sftpServerInput.password || ""),
      rootPath: String(sftpServerInput.rootPath || input.htdocsPath || "").trim(),
      enabled: sftpServerInput.enabled === true
    }
  };
}

function isGenericDbProfile(profile) {
  if (!profile) {
    return true;
  }

  const host = String(profile.host || "").trim() || "127.0.0.1";
  const port = String(profile.port || "").trim() || "3306";
  const user = String(profile.user || "").trim() || "root";
  const password = profile.password ?? "";

  return host === "127.0.0.1" && port === "3306" && user === "root" && password === "";
}

function resolveDbProfile(primaryProfile, fallbackProfile) {
  if (!fallbackProfile) {
    return {
      host: primaryProfile?.host || "127.0.0.1",
      port: String(primaryProfile?.port || "3306"),
      user: primaryProfile?.user || "root",
      password: primaryProfile?.password ?? ""
    };
  }

  if (!primaryProfile || isGenericDbProfile(primaryProfile)) {
    return {
      host: fallbackProfile.host || "127.0.0.1",
      port: String(fallbackProfile.port || "3306"),
      user: fallbackProfile.user || "root",
      password: fallbackProfile.password ?? ""
    };
  }

  return {
    host: primaryProfile.host || fallbackProfile.host || "127.0.0.1",
    port: String(primaryProfile.port || fallbackProfile.port || "3306"),
    user: primaryProfile.user || fallbackProfile.user || "root",
    password: primaryProfile.password ?? fallbackProfile.password ?? ""
  };
}

function getDefaultStartupUrl() {
  return "http://localhost/";
}

function findLaunchUrl(argv = process.argv) {
  return argv.find((arg) => /^https?:\/\//i.test(arg)) || null;
}

function ensureUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return getDefaultStartupUrl();
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (/^(localhost|127\.0\.0\.1|::1)(:\d+)?(\/.*)?$/i.test(raw)) {
    return `http://${raw}`;
  }
  return `https://${raw}`;
}

function buildSearchUrl(query) {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

function isProbablyUrlInput(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return false;
  }

  if (/^https?:\/\//i.test(raw)) {
    return true;
  }

  if (/^(localhost|127\.0\.0\.1|::1)(:\d+)?(\/.*)?$/i.test(raw)) {
    return true;
  }

  if (/\s/.test(raw)) {
    return false;
  }

  return /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw) || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(\/.*)?$/i.test(raw);
}

function shouldTrackBrowserHistory(url) {
  if (!url || /^(data|javascript|devtools|about|file):/i.test(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function recordBrowserHistoryVisit(url, title = "", incrementVisit = true) {
  if (!shouldTrackBrowserHistory(url)) {
    return;
  }

  const history = getBrowserHistory();
  const existing = history.find((entry) => entry.url === url);
  const now = Date.now();

  if (existing) {
    existing.title = title || existing.title || url;
    existing.lastVisited = now;
    existing.visitCount = Number(existing.visitCount || 0) + (incrementVisit ? 1 : 0);
  } else {
    history.unshift({
      url,
      title: title || url,
      lastVisited: now,
      visitCount: incrementVisit ? 1 : 0
    });
  }

  const nextHistory = existing
    ? history
    : history.sort((left, right) => Number(right.lastVisited || 0) - Number(left.lastVisited || 0));

  saveBrowserHistory(nextHistory);
}

function scoreSuggestionMatch(query, ...values) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  let score = 0;
  values.forEach((value, index) => {
    const text = String(value || "").toLowerCase();
    if (!text) {
      return;
    }

    if (text === normalizedQuery) {
      score += index === 0 ? 180 : 140;
    } else if (text.startsWith(normalizedQuery)) {
      score += index === 0 ? 120 : 90;
    } else if (text.includes(normalizedQuery)) {
      score += index === 0 ? 70 : 50;
    }
  });

  return score;
}

async function fetchRemoteSearchSuggestions(query) {
  const raw = String(query || "").trim();
  if (!raw || raw.length < 2) {
    return [];
  }

  try {
    const response = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(raw)}&type=list`);

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      return [];
    }

    return payload
      .map((entry) => String(entry?.phrase || "").trim())
      .filter(Boolean)
      .slice(0, 5);
  } catch (_) {
    return [];
  }
}

function getPartitionForUrl(url, tabId, mode = "auto", group = null, options = {}) {
  const settings = getSettings();

  if (mode === "isolated") {
    return `${mode}:${tabId}`;
  }

  if (options.ignoreSavedSessions !== true) {
    const tabName = String(options.tabName || "").trim();
    const savedPartition = getSavedPartitionForDescriptor(settings, {
      scope: isLocalUrl(url) ? "local" : "online",
      groupName: getTabGroupMatchName(group),
      tabName
    });
    if (savedPartition) {
      return savedPartition;
    }
  }

  const groupPartition = getTabGroupPartitionName(group);
  if (groupPartition) {
    return groupPartition;
  }

  const buildTabScopedPartition = (scope) => {
    const siteIdentifier = getSanitizedSiteIdentifier(url, scope === "local" ? "local-default" : "online-default");
    const tabIdentifier = sanitizeSessionToken(tabId || `tab-${Date.now()}`);
    return `persist:${scope}-${siteIdentifier}-${tabIdentifier}`;
  };

  if (isLocalUrl(url)) {
    if (settings.shareLocalSiteSessions === false) {
      return buildTabScopedPartition("local");
    }
    return "persist:local-shared";
  }

  if (settings.shareOnlineSiteSessions === true) {
    return "persist:online-shared";
  }

  return buildTabScopedPartition("online");
}

function getSessionScopeForUrl(url) {
  return isLocalUrl(url) ? "local" : "online";
}

function normalizeSavedSessionMatchValue(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getTabGroupMatchName(group) {
  return String(group?.name || "").trim();
}

function getFallbackTabSessionName(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname) {
      return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    }
  } catch (_) {
    // Ignore invalid URL input.
  }

  return String(url || "").trim() || "tab";
}

function getTabSessionMatchName(tab) {
  const nickname = String(tab?.nickname || "").trim();
  if (nickname) {
    return nickname;
  }

  const title = String(tab?.title || "").trim();
  if (title && title.toLowerCase() !== "new tab") {
    return title;
  }

  return getFallbackTabSessionName(tab?.url);
}

function buildSavedTabSessionPartition(scope, groupName, tabName) {
  return `persist:saved-${scope}-${sanitizeSessionToken(groupName || "ungrouped", "ungrouped")}-${sanitizeSessionToken(tabName, "tab")}`;
}

function buildSavedTabSessionKey(scope, groupName, tabName) {
  return [
    scope === "local" ? "local" : "online",
    normalizeSavedSessionMatchValue(groupName),
    normalizeSavedSessionMatchValue(tabName)
  ].join("::");
}

function getSavedTabSessionDescriptorForTab(state, tab) {
  if (!tab?.url) {
    return null;
  }

  return {
    scope: getSessionScopeForUrl(tab.url),
    groupName: getTabGroupMatchName(getTabGroupForTab(state, tab)),
    tabName: getTabSessionMatchName(tab)
  };
}

function findSavedTabSessionEntry(settings, descriptor) {
  if (!descriptor?.tabName) {
    return null;
  }

  const targetKey = buildSavedTabSessionKey(descriptor.scope, descriptor.groupName, descriptor.tabName);
  return (settings.savedTabSessions || []).find((entry) =>
    buildSavedTabSessionKey(entry.scope, entry.groupName, entry.tabName) === targetKey
  ) || null;
}

function findSavedTabSessionEntryForPartition(settings, partition) {
  const target = String(partition || "").trim();
  if (!target) {
    return null;
  }

  return (settings.savedTabSessions || []).find((entry) =>
    buildSavedTabSessionPartition(entry.scope, entry.groupName, entry.tabName) === target
  ) || null;
}

function findSavedTabSessionEntryForTab(settings, state, tab) {
  return findSavedTabSessionEntry(settings, getSavedTabSessionDescriptorForTab(state, tab))
    || findSavedTabSessionEntryForPartition(settings, tab?.partition);
}

function getSavedPartitionForDescriptor(settings, descriptor) {
  const matched = findSavedTabSessionEntry(settings, descriptor);
  if (!matched) {
    return "";
  }

  return buildSavedTabSessionPartition(matched.scope, matched.groupName, matched.tabName);
}

function resolvePartitionForTab(state, tab, options = {}) {
  if (!tab) {
    return "";
  }

  if (tab.mode === "isolated") {
    return `${tab.mode}:${tab.id}`;
  }

  const settings = getSettings();
  const descriptor = options.descriptor || getSavedTabSessionDescriptorForTab(state, tab);
  const savedPartition = getSavedPartitionForDescriptor(settings, descriptor);
  if (savedPartition) {
    return savedPartition;
  }

  const existingSavedEntry = findSavedTabSessionEntryForPartition(settings, tab.partition);
  if (existingSavedEntry) {
    return tab.partition;
  }

  const group = options.group === undefined ? getTabGroupForTab(state, tab) : options.group;
  return getPartitionForUrl(tab.url, tab.id, tab.mode, group);
}

function saveNamedTabSession(settings, descriptor, autoSave = false) {
  const safeSettings = normalizeSettings(settings);
  if (!descriptor?.tabName) {
    return safeSettings;
  }

  const nextEntry = {
    scope: descriptor.scope === "local" ? "local" : "online",
    groupName: String(descriptor.groupName || "").trim(),
    tabName: String(descriptor.tabName || "").trim(),
    autoSave: autoSave === true,
    updatedAt: Date.now()
  };
  const targetKey = buildSavedTabSessionKey(nextEntry.scope, nextEntry.groupName, nextEntry.tabName);
  const existingIndex = safeSettings.savedTabSessions.findIndex((entry) =>
    buildSavedTabSessionKey(entry.scope, entry.groupName, entry.tabName) === targetKey
  );

  if (existingIndex >= 0) {
    safeSettings.savedTabSessions.splice(existingIndex, 1, nextEntry);
  } else {
    safeSettings.savedTabSessions.push(nextEntry);
  }

  return safeSettings;
}

function removeNamedTabSession(settings, descriptor) {
  const safeSettings = normalizeSettings(settings);
  if (!descriptor?.tabName) {
    return safeSettings;
  }

  const targetKey = buildSavedTabSessionKey(descriptor.scope, descriptor.groupName, descriptor.tabName);
  safeSettings.savedTabSessions = safeSettings.savedTabSessions.filter((entry) =>
    buildSavedTabSessionKey(entry.scope, entry.groupName, entry.tabName) !== targetKey
  );
  return safeSettings;
}

function removeNamedTabSessionByPartition(settings, partition) {
  const safeSettings = normalizeSettings(settings);
  safeSettings.savedTabSessions = safeSettings.savedTabSessions.filter((entry) =>
    buildSavedTabSessionPartition(entry.scope, entry.groupName, entry.tabName) !== String(partition || "").trim()
  );
  return safeSettings;
}

function sanitizeSessionToken(value, fallback = "default") {
  const sanitized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || fallback;
}

function getSanitizedSiteIdentifier(url, fallback = "default") {
  try {
    const parsed = new URL(url);
    const siteIdentifier = parsed.port
      ? `${parsed.hostname}:${parsed.port}`
      : parsed.hostname;

    return sanitizeSessionToken(siteIdentifier, fallback);
  } catch (_) {
    return fallback;
  }
}

function getSessionProfileName(partition) {
  return String(partition || "").trim() || "temporary-session";
}

function buildTabGroupProfilePartition(groupId) {
  return `persist:group-${sanitizeSessionToken(groupId, "default")}`;
}

function getTabGroupPartitionName(group) {
  if (!group) {
    return "";
  }

  return String(group.partition || group.profilePartition || "").trim()
    || buildTabGroupProfilePartition(group.id || "default");
}

function buildBrowserWebPreferences(partition) {
  return {
    partition,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    javascript: true,
    nativeWindowOpen: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: true
  };
}

function shouldOpenAsPopupWindow(details = {}) {
  const featureText = String(details.features || "").trim();
  const disposition = String(details.disposition || "").trim().toLowerCase();
  return Boolean(featureText) || disposition === "new-window";
}

function shouldOpenExternallyForCompatibility(url) {
  try {
    const parsed = new URL(String(url || ""));
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (hostname === "api.razorpay.com" && pathname.startsWith("/v1/checkout/public")) {
      return true;
    }

    if (hostname === "checkout.razorpay.com") {
      return true;
    }

    return false;
  } catch (_) {
    return false;
  }
}

function openUrlInExternalBrowser(url) {
  if (!url || !shouldOpenExternallyForCompatibility(url)) {
    return false;
  }

  shell.openExternal(url).catch(() => {
    // Ignore failures here and let the caller decide whether to continue.
  });
  return true;
}

function buildPopupBrowserWindowOptions(parentWindow, partition) {
  return {
    parent: parentWindow,
    width: 520,
    height: 720,
    minWidth: 420,
    minHeight: 520,
    autoHideMenuBar: true,
    show: true,
    webPreferences: buildBrowserWebPreferences(partition)
  };
}

function getStoredPermissionDecision(origin, permission) {
  if (!origin || !permission) {
    return null;
  }

  const settings = getSettings();
  return settings.browserPermissions?.[origin]?.[permission] || null;
}

function savePermissionDecision(origin, permission, decision) {
  if (!origin || !permission || !decision) {
    return;
  }

  const settings = getSettings();
  settings.browserPermissions[origin] = settings.browserPermissions[origin] || {};
  settings.browserPermissions[origin][permission] = decision;
  saveSettings(settings);
}

function clearPermissionDecision(origin, permission) {
  if (!origin || !permission) {
    return false;
  }

  const settings = getSettings();
  if (!settings.browserPermissions?.[origin]?.[permission]) {
    return false;
  }

  delete settings.browserPermissions[origin][permission];
  if (Object.keys(settings.browserPermissions[origin]).length === 0) {
    delete settings.browserPermissions[origin];
  }
  saveSettings(settings);
  return true;
}

function getSavedPermissionsList() {
  const settings = getSettings();
  return Object.entries(settings.browserPermissions || {}).flatMap(([origin, rules]) =>
    Object.entries(rules).map(([permission, decision]) => ({
      id: `${origin}::${permission}`,
      origin,
      permission,
      decision
    }))
  );
}

function getBrowserBookmarks() {
  return getSettings().browserBookmarks || [];
}

function flattenBrowserBookmarks(nodes, output = []) {
  (nodes || []).forEach((node) => {
    if (!node) {
      return;
    }

    if (node.type === "folder") {
      flattenBrowserBookmarks(node.children || [], output);
      return;
    }

    output.push(node);
  });
  return output;
}

function findBookmarkNodeAndParent(nodes, nodeId, parent = null) {
  for (let index = 0; index < (nodes || []).length; index += 1) {
    const node = nodes[index];
    if (node?.id === nodeId) {
      return { node, parent, index };
    }

    if (node?.type === "folder") {
      const found = findBookmarkNodeAndParent(node.children || [], nodeId, node);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

function insertBookmarkNode(bookmarks, node, parentId = null) {
  if (!parentId) {
    bookmarks.unshift(node);
    return true;
  }

  const found = findBookmarkNodeAndParent(bookmarks, parentId);
  if (!found?.node || found.node.type !== "folder") {
    return false;
  }

  found.node.children = [node, ...(found.node.children || [])];
  return true;
}

function saveBrowserBookmark({ title, url, parentId = null }) {
  const normalizedUrl = ensureUrl(url);
  const settings = getSettings();
  const existing = flattenBrowserBookmarks(settings.browserBookmarks || []).find((bookmark) => bookmark.url === normalizedUrl);
  if (existing) {
    existing.title = title || existing.title || normalizedUrl;
    saveSettings(settings);
    return existing;
  }

  const bookmark = {
    id: `bookmark-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type: "bookmark",
    title: title || normalizedUrl,
    url: normalizedUrl,
    iconOnly: false
  };
  settings.browserBookmarks = settings.browserBookmarks || [];
  insertBookmarkNode(settings.browserBookmarks, bookmark, parentId);
  saveSettings(settings);
  return bookmark;
}

function removeBrowserBookmark(bookmarkId) {
  if (!bookmarkId) {
    return false;
  }

  const settings = getSettings();
  const found = findBookmarkNodeAndParent(settings.browserBookmarks || [], bookmarkId);
  if (!found) {
    return false;
  }

  const bucket = found.parent ? found.parent.children : settings.browserBookmarks;
  bucket.splice(found.index, 1);

  saveSettings(settings);
  return true;
}

function updateBrowserBookmark(bookmarkId, changes = {}) {
  if (!bookmarkId) {
    throw new Error("Missing bookmark id.");
  }

  const settings = getSettings();
  const found = findBookmarkNodeAndParent(settings.browserBookmarks || [], bookmarkId);
  if (!found?.node) {
    throw new Error("Bookmark not found.");
  }
  const bookmark = found.node;

  if (typeof changes.title === "string") {
    bookmark.title = changes.title.trim() || bookmark.title || bookmark.url;
  }
  if (bookmark.type !== "folder" && typeof changes.url === "string") {
    bookmark.url = ensureUrl(changes.url);
  }
  if (bookmark.type !== "folder" && typeof changes.iconOnly === "boolean") {
    bookmark.iconOnly = changes.iconOnly;
  }

  saveSettings(settings);
  return bookmark;
}

function createBrowserBookmarkFolder({ title, parentId = null }) {
  const settings = getSettings();
  const folder = {
    id: `bookmark-folder-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type: "folder",
    title: String(title || "New folder").trim() || "New folder",
    children: []
  };

  settings.browserBookmarks = settings.browserBookmarks || [];
  if (!insertBookmarkNode(settings.browserBookmarks, folder, parentId)) {
    throw new Error("Folder target was not found.");
  }

  saveSettings(settings);
  return folder;
}

function cloneBookmarkNodeWithFreshIds(node) {
  if (!node) {
    return null;
  }

  if (node.type === "folder") {
    return {
      id: `bookmark-folder-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      type: "folder",
      title: String(node.title || "New folder").trim() || "New folder",
      children: (node.children || []).map((child) => cloneBookmarkNodeWithFreshIds(child)).filter(Boolean)
    };
  }

  return {
    id: `bookmark-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type: "bookmark",
    title: node.title || node.url || "Bookmark",
    url: ensureUrl(node.url),
    iconOnly: Boolean(node.iconOnly)
  };
}

function isBookmarkNodeDescendant(node, candidateId) {
  if (!node || node.type !== "folder") {
    return false;
  }

  return (node.children || []).some((child) => child?.id === candidateId || isBookmarkNodeDescendant(child, candidateId));
}

function moveBrowserBookmark(bookmarkId, { parentId = null, index = null } = {}) {
  if (!bookmarkId) {
    throw new Error("Missing bookmark id.");
  }

  const settings = getSettings();
  settings.browserBookmarks = settings.browserBookmarks || [];

  const found = findBookmarkNodeAndParent(settings.browserBookmarks, bookmarkId);
  if (!found?.node) {
    throw new Error("Bookmark not found.");
  }

  const node = found.node;
  if (parentId && node.id === parentId) {
    throw new Error("A folder cannot contain itself.");
  }

  if (parentId && isBookmarkNodeDescendant(node, parentId)) {
    throw new Error("A folder cannot be moved into one of its children.");
  }

  let targetBucket = settings.browserBookmarks;
  if (parentId) {
    const target = findBookmarkNodeAndParent(settings.browserBookmarks, parentId);
    if (!target?.node || target.node.type !== "folder") {
      throw new Error("Folder target was not found.");
    }
    targetBucket = target.node.children = target.node.children || [];
  }

  const sourceBucket = found.parent ? found.parent.children : settings.browserBookmarks;
  sourceBucket.splice(found.index, 1);

  let normalizedIndex = Number.isInteger(index) ? index : targetBucket.length;
  if (sourceBucket === targetBucket && found.index < normalizedIndex) {
    normalizedIndex -= 1;
  }
  normalizedIndex = Math.max(0, Math.min(normalizedIndex, targetBucket.length));
  targetBucket.splice(normalizedIndex, 0, node);

  saveSettings(settings);
  return node;
}

function copyBrowserBookmark(bookmarkId, removeAfterCopy = false) {
  const settings = getSettings();
  const found = findBookmarkNodeAndParent(settings.browserBookmarks || [], bookmarkId);
  const bookmark = found?.node;
  if (!bookmark) {
    throw new Error("Bookmark not found.");
  }

  clipboard.writeText(JSON.stringify({
    type: "wpdesktop-bookmark-node",
    bookmark
  }));

  if (removeAfterCopy) {
    const bucket = found.parent ? found.parent.children : settings.browserBookmarks;
    bucket.splice(found.index, 1);
    saveSettings(settings);
  }

  return bookmark;
}

function pasteBrowserBookmark() {
  const raw = clipboard.readText().trim();
  if (!raw) {
    throw new Error("Clipboard is empty.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new Error("Clipboard does not contain a bookmark.");
  }

  if ((parsed?.type !== "wpdesktop-bookmark" && parsed?.type !== "wpdesktop-bookmark-node") || !parsed.bookmark) {
    throw new Error("Clipboard does not contain a bookmark.");
  }

  const settings = getSettings();
  const clone = cloneBookmarkNodeWithFreshIds(parsed.bookmark);
  settings.browserBookmarks = settings.browserBookmarks || [];
  insertBookmarkNode(settings.browserBookmarks, clone, null);
  saveSettings(settings);
  return clone;
}

function pasteBrowserBookmarkIntoParent(parentId = null) {
  const raw = clipboard.readText().trim();
  if (!raw) {
    throw new Error("Clipboard is empty.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new Error("Clipboard does not contain a bookmark.");
  }

  if ((parsed?.type !== "wpdesktop-bookmark" && parsed?.type !== "wpdesktop-bookmark-node") || !parsed.bookmark) {
    throw new Error("Clipboard does not contain a bookmark.");
  }

  const settings = getSettings();
  const clone = cloneBookmarkNodeWithFreshIds(parsed.bookmark);
  settings.browserBookmarks = settings.browserBookmarks || [];
  if (!insertBookmarkNode(settings.browserBookmarks, clone, parentId)) {
    throw new Error("Folder target was not found.");
  }
  saveSettings(settings);
  return clone;
}

function flattenFolderBookmarks(node, output = []) {
  if (!node) {
    return output;
  }

  if (node.type === "folder") {
    (node.children || []).forEach((child) => flattenFolderBookmarks(child, output));
    return output;
  }

  output.push(node);
  return output;
}

function openBookmarkFolderItems(win, folder, { inNewWindow = false, isolated = false } = {}) {
  const items = flattenFolderBookmarks(folder, []);
  if (!items.length) {
    return;
  }

  if (!inNewWindow) {
    items.forEach((item) => createBrowserTab(win, item.url, isolated ? "isolated" : "auto", true));
    return;
  }

  const [first, ...rest] = items;
  const child = createWindow({ startupUrl: first.url, startupMode: isolated ? "isolated" : "auto" });
  child.webContents.once("did-finish-load", () => {
    rest.forEach((item) => createBrowserTab(child, item.url, isolated ? "isolated" : "auto", true));
  });
}

function openBookmarkFolderInNewTabGroup(win, folder) {
  const items = flattenFolderBookmarks(folder, []);
  if (!items.length) {
    return false;
  }

  const state = getBrowserState(win);
  const group = createTabGroupRecord(state, folder.title || "Bookmark folder");
  items.forEach((item, index) => {
    createBrowserTab(win, item.url, "auto", index === items.length - 1, null, { groupId: group.id });
  });
  emitBrowserState(win);
  return true;
}

function getBrowserShowBookmarksBar() {
  return getSettings().browserShowBookmarksBar !== false;
}

function setBrowserShowBookmarksBar(visible) {
  const settings = getSettings();
  settings.browserShowBookmarksBar = Boolean(visible);
  saveSettings(settings);
  return settings.browserShowBookmarksBar;
}

function getDownloadDirectory() {
  return getSettings().downloadDirectory || app.getPath("downloads");
}

function setDownloadDirectory(targetPath) {
  const settings = getSettings();
  settings.downloadDirectory = targetPath || app.getPath("downloads");
  saveSettings(settings);
  return settings.downloadDirectory;
}

function getUniqueDownloadPath(targetDirectory, filename) {
  const extension = path.extname(filename);
  const base = path.basename(filename, extension);
  let candidate = path.join(targetDirectory, filename);
  let attempt = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(targetDirectory, `${base} (${attempt})${extension}`);
    attempt += 1;
  }

  return candidate;
}

function getExtensionsStoragePath() {
  const target = path.join(app.getPath("userData"), "browser-extensions");
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function findManifestRoot(directoryPath, depth = 0) {
  if (!directoryPath || !fs.existsSync(directoryPath) || depth > 2) {
    return null;
  }

  const manifestPath = path.join(directoryPath, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    return directoryPath;
  }

  const children = fs.readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => findManifestRoot(path.join(directoryPath, entry.name), depth + 1))
    .filter(Boolean);

  return children[0] || null;
}

function readExtensionManifest(extensionRoot) {
  const manifestPath = path.join(extensionRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("manifest.json was not found.");
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const name = String(manifest.name || "").trim();
  if (!name) {
    throw new Error("Extension manifest is missing a name.");
  }

  const popupPath = String(
    manifest.action?.default_popup
    || manifest.browser_action?.default_popup
    || ""
  ).trim();
  const icons = manifest.icons && typeof manifest.icons === "object" ? manifest.icons : {};
  const bestIconKey = Object.keys(icons)
    .sort((left, right) => Number(right) - Number(left))
    .find((key) => Boolean(icons[key]));
  const iconPath = bestIconKey ? String(icons[bestIconKey] || "").trim() : "";

  return {
    name,
    version: String(manifest.version || "").trim(),
    popupPath,
    iconPath,
    manifest
  };
}

function getBrowserExtensions() {
  return getSettings().browserExtensions || [];
}

async function loadExtensionIntoSession(browserSession, extensionEntry) {
  if (!extensionEntry?.enabled || !extensionEntry.unpackedPath || !fs.existsSync(extensionEntry.unpackedPath)) {
    return null;
  }

  const existing = browserSession.extensions.getAllExtensions().find((item) => item.path === extensionEntry.unpackedPath);
  if (existing) {
    return existing;
  }

  return browserSession.extensions.loadExtension(extensionEntry.unpackedPath, {
    allowFileAccess: true
  });
}

async function loadConfiguredExtensionsForSession(browserSession, partition) {
  const settings = getSettings();
  for (const extensionEntry of settings.browserExtensions || []) {
    if (!extensionEntry.enabled) {
      continue;
    }
    try {
      const loaded = await loadExtensionIntoSession(browserSession, extensionEntry);
      if (loaded && (extensionEntry.extensionId !== loaded.id || extensionEntry.name !== loaded.name || extensionEntry.version !== loaded.version)) {
        const fresh = getSettings();
        const current = (fresh.browserExtensions || []).find((item) => item.id === extensionEntry.id);
        if (current) {
          current.extensionId = loaded.id;
          current.name = loaded.name || current.name;
          current.version = loaded.version || current.version;
          saveSettings(fresh);
        }
      }
      extensionLoadFailures.delete(`${partition}::${extensionEntry.id}`);
    } catch (error) {
      extensionLoadFailures.set(`${partition}::${extensionEntry.id}`, error.message || "Load failed");
    }
  }
}

function getConfiguredBrowserSessions() {
  return Array.from(configuredBrowserPartitions).map((partition) => ({
    partition,
    browserSession: session.fromPartition(partition)
  }));
}

async function loadExtensionAcrossConfiguredSessions(extensionEntry) {
  for (const { partition, browserSession } of getConfiguredBrowserSessions()) {
    try {
      const loaded = await loadExtensionIntoSession(browserSession, extensionEntry);
      if (loaded && (extensionEntry.extensionId !== loaded.id || extensionEntry.name !== loaded.name || extensionEntry.version !== loaded.version)) {
        const fresh = getSettings();
        const current = (fresh.browserExtensions || []).find((item) => item.id === extensionEntry.id);
        if (current) {
          current.extensionId = loaded.id;
          current.name = loaded.name || current.name;
          current.version = loaded.version || current.version;
          saveSettings(fresh);
          extensionEntry.extensionId = current.extensionId;
          extensionEntry.name = current.name;
          extensionEntry.version = current.version;
        }
      }
      extensionLoadFailures.delete(`${partition}::${extensionEntry.id}`);
    } catch (error) {
      extensionLoadFailures.set(`${partition}::${extensionEntry.id}`, error.message || "Load failed");
    }
  }
}

async function unloadExtensionAcrossConfiguredSessions(extensionEntry) {
  for (const { browserSession } of getConfiguredBrowserSessions()) {
    const loaded = browserSession.extensions.getAllExtensions().find((item) =>
      item.id === extensionEntry.extensionId || item.path === extensionEntry.unpackedPath
    );
    if (loaded) {
      await browserSession.extensions.removeExtension(loaded.id);
    }
  }
}

function upsertBrowserExtension(entry) {
  const settings = getSettings();
  settings.browserExtensions = settings.browserExtensions || [];
  const existingIndex = settings.browserExtensions.findIndex((item) =>
    item.sourcePath === entry.sourcePath || item.unpackedPath === entry.unpackedPath
  );
  if (existingIndex >= 0) {
    settings.browserExtensions[existingIndex] = {
      ...settings.browserExtensions[existingIndex],
      ...entry
    };
  } else {
    settings.browserExtensions.unshift(entry);
  }
  saveSettings(settings);
  return settings.browserExtensions.find((item) => item.id === entry.id)
    || settings.browserExtensions[existingIndex]
    || entry;
}

async function installBrowserExtensionFromFolder(folderPath) {
  const resolvedRoot = findManifestRoot(folderPath);
  if (!resolvedRoot) {
    throw new Error("No unpacked Chromium extension was found in that folder.");
  }

  const { name, version, popupPath, iconPath } = readExtensionManifest(resolvedRoot);
  const extensionEntry = upsertBrowserExtension({
    id: `extension-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    version,
    sourceType: "folder",
    sourcePath: folderPath,
    unpackedPath: resolvedRoot,
    extensionId: "",
    enabled: true,
    pinned: false,
    popupPath,
    iconPath: iconPath ? path.join(resolvedRoot, iconPath) : ""
  });

  await loadExtensionAcrossConfiguredSessions(extensionEntry);
  return extensionEntry;
}

async function installBrowserExtensionFromArchive(archivePath) {
  const archiveName = path.basename(archivePath, path.extname(archivePath));
  const targetDirectory = path.join(
    getExtensionsStoragePath(),
    `${archiveName}-${Date.now()}`
  );
  fs.mkdirSync(targetDirectory, { recursive: true });
  const zip = new AdmZip(archivePath);
  zip.extractAllTo(targetDirectory, true);

  const resolvedRoot = findManifestRoot(targetDirectory);
  if (!resolvedRoot) {
    throw new Error("The zip does not contain an unpacked Chromium extension.");
  }

  const { name, version, popupPath, iconPath } = readExtensionManifest(resolvedRoot);
  const extensionEntry = upsertBrowserExtension({
    id: `extension-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    version,
    sourceType: "zip",
    sourcePath: archivePath,
    unpackedPath: resolvedRoot,
    extensionId: "",
    enabled: true,
    pinned: false,
    popupPath,
    iconPath: iconPath ? path.join(resolvedRoot, iconPath) : ""
  });

  await loadExtensionAcrossConfiguredSessions(extensionEntry);
  return extensionEntry;
}

async function setBrowserExtensionEnabled(extensionId, enabled) {
  const settings = getSettings();
  const extensionEntry = (settings.browserExtensions || []).find((item) => item.id === extensionId);
  if (!extensionEntry) {
    throw new Error("Extension not found.");
  }

  extensionEntry.enabled = Boolean(enabled);
  saveSettings(settings);

  if (extensionEntry.enabled) {
    await loadExtensionAcrossConfiguredSessions(extensionEntry);
  } else {
    await unloadExtensionAcrossConfiguredSessions(extensionEntry);
  }

  return extensionEntry;
}

function setBrowserExtensionPinned(extensionId, pinned) {
  const settings = getSettings();
  const extensionEntry = (settings.browserExtensions || []).find((item) => item.id === extensionId);
  if (!extensionEntry) {
    throw new Error("Extension not found.");
  }

  extensionEntry.pinned = Boolean(pinned);
  saveSettings(settings);
  return extensionEntry;
}

async function removeBrowserExtension(extensionId) {
  const settings = getSettings();
  const index = (settings.browserExtensions || []).findIndex((item) => item.id === extensionId);
  if (index === -1) {
    throw new Error("Extension not found.");
  }

  const [extensionEntry] = settings.browserExtensions.splice(index, 1);
  saveSettings(settings);
  await unloadExtensionAcrossConfiguredSessions(extensionEntry);
  return extensionEntry;
}

function toChromeExtensionUrl(extensionId, relativePath) {
  const normalizedPath = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return `chrome-extension://${extensionId}/${normalizedPath}`;
}

function getExtensionByInternalId(extensionId) {
  return getBrowserExtensions().find((item) => item.id === extensionId) || null;
}

function openBrowserExtensionPopup(win, extensionId) {
  const extensionEntry = getExtensionByInternalId(extensionId);
  if (!extensionEntry) {
    throw new Error("Extension not found.");
  }
  if (!extensionEntry.enabled) {
    throw new Error("Enable the extension before opening it.");
  }
  if (!extensionEntry.extensionId || !extensionEntry.popupPath) {
    throw new Error("This extension does not expose a popup.");
  }

  const activeTab = getActiveBrowserTab(win);
  const popupPartition = activeTab?.partition || "persist:online-shared";
  configureBrowserSession(win, popupPartition);

  const child = new BrowserWindow({
    parent: win,
    width: 420,
    height: 560,
    show: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: extensionEntry.name || "Extension",
    backgroundColor: "#202124",
    webPreferences: {
      partition: popupPartition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  child.once("ready-to-show", () => {
    if (!child.isDestroyed()) {
      child.show();
    }
  });

  child.loadURL(toChromeExtensionUrl(extensionEntry.extensionId, extensionEntry.popupPath));
  return true;
}

function configureBrowserSession(win, partition) {
  if (configuredBrowserPartitions.has(partition)) {
    return;
  }

  const browserSession = session.fromPartition(partition);
  attachDownloadTracking(win, browserSession);
  browserSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    const origin = getOriginFromUrl(requestingOrigin) || requestingOrigin || "";
    return shouldAutoAllowBrowserPermission(origin, permission);
  });

  browserSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const origin = getOriginFromUrl(details?.requestingUrl) || getOriginFromUrl(details?.embeddingOrigin) || "";
    const allowed = shouldAutoAllowBrowserPermission(origin, permission);
    if (origin) {
      savePermissionDecision(origin, permission, allowed ? "allow" : "block");
    }
    callback(allowed);
  });

  browserSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const origin = getOriginFromUrl(request?.securityOrigin);
    if (origin) {
      savePermissionDecision(origin, "display-capture", "allow");
    }
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"]
      });
      const source = sources.find((item) => item.display_id) || sources[0];
      if (!source) {
        callback({});
        return;
      }

      callback({
        video: source,
        audio: "loopback"
      });
    } catch (_) {
      callback({});
    }
  });

  browserSession.setDevicePermissionHandler((details) => {
    try {
      const origin = getOriginFromUrl(details?.origin) || details?.origin || "";
      if (shouldAutoAllowBrowserPermission(origin, details.deviceType)) {
        if (origin) {
          savePermissionDecision(origin, details.deviceType, "allow");
        }
        return true;
      }
      if (origin) {
        savePermissionDecision(origin, details.deviceType, "block");
      }
      return false;
    } catch (_) {
      return false;
    }
  });

  browserSession.setBluetoothPairingHandler(async (details, callback) => {
    if (process.platform === "darwin") {
      callback({ confirmed: true });
      return;
    }

    try {
      if (details?.pairingKind === "providePin") {
        callback({ confirmed: false, pin: null });
        return;
      }

      const buttons = details?.pairingKind === "confirmPin"
        ? ["Pair", "Cancel"]
        : ["Allow", "Cancel"];
      const message = details?.pairingKind === "confirmPin"
        ? `Confirm the Bluetooth PIN ${details.pin || ""} matches on your passkey device.`
        : "Allow this Bluetooth passkey device pairing request?";

      const focused = BrowserWindow.getFocusedWindow() || lastFocusedWindow || null;
      const result = await dialog.showMessageBox(focused || undefined, {
        type: "question",
        buttons,
        defaultId: 0,
        cancelId: 1,
        title: "Bluetooth Passkey Pairing",
        message
      });

      callback({
        confirmed: result.response === 0,
        pin: null
      });
    } catch (_) {
      callback({ confirmed: false, pin: null });
    }
  });

  void loadConfiguredExtensionsForSession(browserSession, partition);

  configuredBrowserPartitions.add(partition);
}

function isLocalUrl(url) {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function buildSiteUrl(targetPath) {
  const normalized = targetPath.replace(/\\/g, "/");
  const htdocsMatch = normalized.match(/\/htdocs\/(.+)$/i);
  const wwwMatch = normalized.match(/\/www\/(.+)$/i);

  if (htdocsMatch) {
    return `http://localhost/${htdocsMatch[1].replace(/^\/+/, "")}`;
  }

  if (wwwMatch) {
    return `http://localhost/${wwwMatch[1].replace(/^\/+/, "")}`;
  }

  return `file://${targetPath.replace(/\\/g, "/")}`;
}

function hasWordPressFiles(folderPath) {
  return (
    fs.existsSync(path.join(folderPath, "wp-admin")) ||
    fs.existsSync(path.join(folderPath, "wp-config.php")) ||
    fs.existsSync(path.join(folderPath, "wp-content"))
  );
}

function findWordPressFolders(rootPath, maxDepth = 4) {
  const found = [];
  const visited = new Set();

  function walk(currentPath, depth) {
    if (depth > maxDepth || visited.has(currentPath)) {
      return;
    }

    visited.add(currentPath);

    if (hasWordPressFiles(currentPath)) {
      found.push(currentPath);
      return;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name.startsWith(".") || entry.name.toLowerCase() === "cgi-bin") {
        continue;
      }
      walk(path.join(currentPath, entry.name), depth + 1);
    }
  }

  walk(rootPath, 0);
  return found;
}

function testPort(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 800 }, () => {
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function isApacheRunning() {
  const ports = getConfiguredApachePorts(getSettings());
  for (const port of ports) {
    if (await testPort("127.0.0.1", port)) {
      return true;
    }
  }
  return false;
}

async function isMysqlRunning(settings = getSettings()) {
  const dbProfile = getEffectiveDbProfile(settings);
  return testPort(dbProfile.host || "127.0.0.1", Number(dbProfile.port) || 3306);
}

async function getXamppServiceStatus(settings = getSettings()) {
  const apachePorts = getConfiguredApachePorts(settings);
  const dbProfile = getEffectiveDbProfile(settings);
  const apachePortChecks = await Promise.all(apachePorts.map((port) => testPort("127.0.0.1", port)));
  const mysqlPort = Number(dbProfile.port) || 3306;
  const mysqlHost = dbProfile.host || "127.0.0.1";
  const mysqlRunning = await testPort(mysqlHost, mysqlPort);

  return {
    apachePorts,
    apacheRunning: apachePortChecks.some(Boolean),
    mysqlHost,
    mysqlPort,
    mysqlRunning,
    installerReady: apachePortChecks.some(Boolean) && mysqlRunning
  };
}

async function buildSitesFromHtdocs() {
  const settings = getSettings();
  const htdocsPath = getResolvedHtdocsPath(settings);
  const savedSites = getSites();
  const savedMap = new Map(savedSites.map((site) => [site.id, site]));
  const serviceStatus = await getXamppServiceStatus(settings);
  const apacheRunning = serviceStatus.apacheRunning;

  if (!htdocsPath || !fs.existsSync(htdocsPath)) {
    return { htdocsPath, apacheRunning, xamppServiceStatus: serviceStatus, sites: savedSites };
  }

  const wordpressFolders = findWordPressFolders(htdocsPath);
  const scannedSites = wordpressFolders
    .map((folderPath) => {
      const relativePath = path.relative(htdocsPath, folderPath).replace(/\\/g, "/");
      const siteName = path.basename(folderPath);
      const id = relativePath.toLowerCase().replace(/[^a-z0-9/_-]/g, "-").replace(/[\/]+/g, "--");
      const fallbackId = siteName.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      const saved = savedMap.get(id) || savedMap.get(fallbackId) || {};
      const wpConfig = parseWpConfig(folderPath) || {};
      const siteUrl = `http://localhost/${relativePath}`;
      const savedMultisite = saved.multisite || {};
      const multisiteEnabled = savedMultisite.enabled === true || wpConfig.allowMultisite === true || wpConfig.networkConfigured === true;
      const multisitePrepared = savedMultisite.prepared === true || wpConfig.allowMultisite === true || wpConfig.networkConfigured === true;
      const multisiteNetworkConfigured = savedMultisite.networkConfigured === true || wpConfig.networkConfigured === true;

      return {
        id,
        name: siteName,
        domain: `${siteName}.site`,
        path: folderPath,
        relativePath,
        shellPath: folderPath,
        siteUrl,
        adminUrl: `${siteUrl}/wp-admin/`,
        dbName: wpConfig.dbName || saved.dbName || sanitizeDbName(siteName),
        dbHost: wpConfig.dbHost || saved.dbHost || "127.0.0.1",
        dbPort: String(wpConfig.dbPort || saved.dbPort || "3306"),
        dbUser: wpConfig.dbUser || saved.dbUser || "root",
        dbPassword: wpConfig.dbPassword ?? saved.dbPassword ?? "",
        databaseVersion: saved.databaseVersion || getLocalServerDatabaseLabel(),
        phpVersion: saved.phpVersion || getLocalServerPhpVersionLabel(),
        webServer: saved.webServer || getLocalServerWebServerLabel(),
        wordpressVersion: saved.wordpressVersion || "Detected from folder",
        extractedCount: saved.extractedCount || null,
        lastStartedAt: saved.lastStartedAt || null,
        status: apacheRunning ? "running" : "stopped",
        sslPath: saved.sslPath || `${siteName}.crt`,
        isWordPress: true,
        multisite: {
          enabled: multisiteEnabled,
          prepared: multisitePrepared,
          networkConfigured: multisiteNetworkConfigured
        }
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { htdocsPath, apacheRunning, xamppServiceStatus: serviceStatus, sites: scannedSites };
}

function sanitizeDbName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "wordpress";
}

function findBestWordPressFolderForUrl(url, settings = getSettings()) {
  const htdocsPath = getResolvedHtdocsPath(settings);
  if (!htdocsPath || !fs.existsSync(htdocsPath)) {
    return "";
  }

  let pathname = "";
  try {
    const parsed = new URL(url);
    pathname = decodeURIComponent(parsed.pathname || "");
  } catch (_) {
    return "";
  }

  const normalizedPathname = pathname.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalizedPathname) {
    return "";
  }

  const wordpressFolders = findWordPressFolders(htdocsPath, 12)
    .map((folderPath) => ({
      folderPath,
      relativePath: path.relative(htdocsPath, folderPath).replace(/\\/g, "/").replace(/^\/+/, "")
    }))
    .filter((entry) => entry.relativePath);

  const matching = wordpressFolders
    .filter((entry) =>
      normalizedPathname === entry.relativePath ||
      normalizedPathname.startsWith(`${entry.relativePath}/`)
    )
    .sort((left, right) => right.relativePath.length - left.relativePath.length);

  return matching[0]?.folderPath || "";
}

function getSiteRootFolderNameFromUrl(url, settings = getSettings()) {
  try {
    const parsed = new URL(url);

    if (parsed.protocol === "file:") {
      const filePath = decodeURIComponent(parsed.pathname || "").replace(/^\/+/, "");
      const normalizedPath = filePath.replace(/\//g, path.sep);
      let currentPath = hasWordPressFiles(normalizedPath)
        ? normalizedPath
        : path.dirname(normalizedPath);

      while (currentPath && currentPath !== path.dirname(currentPath)) {
        if (hasWordPressFiles(currentPath)) {
          return path.basename(currentPath);
        }
        currentPath = path.dirname(currentPath);
      }

      return path.basename(path.dirname(normalizedPath));
    }

    if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      return "";
    }

    const bestFolderPath = findBestWordPressFolderForUrl(url, settings);
    if (bestFolderPath) {
      return path.basename(bestFolderPath);
    }

    const pathname = decodeURIComponent(parsed.pathname || "");
    const segments = pathname.split("/").filter(Boolean);
    if (!segments.length) {
      return "";
    }

    return segments.at(-1) || segments[0];
  } catch (_) {
    return "";
  }
}

function parseWpConfig(sitePath) {
  const configPath = path.join(sitePath, "wp-config.php");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const source = fs.readFileSync(configPath, "utf8");
  const readConstant = (name) => {
    const match = source.match(
      new RegExp(`define\\(\\s*['"]${name}['"]\\s*,\\s*(['"])(.*?)\\1\\s*\\)`, "s")
    );
    return match?.[2] ?? null;
  };

  const dbHostRaw = readConstant("DB_HOST") || "127.0.0.1";
  let host = dbHostRaw;
  let port = 3306;

  const hostMatch = dbHostRaw.match(/^\s*([^:]+):(\d+)\s*$/);
  if (hostMatch) {
    host = hostMatch[1];
    port = Number(hostMatch[2]);
  }

  return {
    dbName: readConstant("DB_NAME") || null,
    dbUser: readConstant("DB_USER") || null,
    dbPassword: readConstant("DB_PASSWORD") || "",
    dbHost: host,
    dbPort: port,
    allowMultisite: Boolean(source.match(/define\(\s*['"]WP_ALLOW_MULTISITE['"]\s*,\s*true\s*\)/i)),
    networkConfigured: Boolean(
      source.match(/define\(\s*['"]MULTISITE['"]\s*,\s*true\s*\)/i) &&
      source.match(/define\(\s*['"]DOMAIN_CURRENT_SITE['"]\s*,/i) &&
      source.match(/define\(\s*['"]PATH_CURRENT_SITE['"]\s*,/i)
    )
  };
}

function enableWordPressMultisite(sitePath) {
  const configPath = path.join(sitePath, "wp-config.php");
  if (!fs.existsSync(configPath)) {
    return false;
  }

  const source = fs.readFileSync(configPath, "utf8");
  if (/define\(\s*['"]WP_ALLOW_MULTISITE['"]\s*,\s*true\s*\)/i.test(source)) {
    return false;
  }

  const marker = /\/\* That's all, stop editing! Happy publishing\. \*\//;
  const insertion = "define('WP_ALLOW_MULTISITE', true);\n\n";
  const nextSource = marker.test(source)
    ? source.replace(marker, `${insertion}$&`)
    : `${source.trimEnd()}\n\n${insertion}`;

  fs.writeFileSync(configPath, nextSource, "utf8");
  return true;
}

function applyWordPressMultisiteNetworkConfig(sitePath, wpConfigSnippet, htaccessSnippet) {
  const configPath = path.join(sitePath, "wp-config.php");
  const htaccessPath = path.join(sitePath, ".htaccess");
  if (!fs.existsSync(configPath)) {
    throw new Error("wp-config.php was not found.");
  }

  const normalizedWpConfigSnippet = String(wpConfigSnippet || "").trim();
  const normalizedHtaccessSnippet = String(htaccessSnippet || "").trim();
  if (!normalizedWpConfigSnippet || !normalizedHtaccessSnippet) {
    throw new Error("Network setup rules were empty.");
  }

  const source = fs.readFileSync(configPath, "utf8");
  const marker = /\/\* That's all, stop editing! Happy publishing\. \*\//;
  const cleanupPattern = /^\s*define\(\s*'(?:MULTISITE|SUBDOMAIN_INSTALL|DOMAIN_CURRENT_SITE|PATH_CURRENT_SITE|SITE_ID_CURRENT_SITE|BLOG_ID_CURRENT_SITE)'.*?;\s*$/gim;
  const cleanedSource = source.replace(cleanupPattern, "").replace(/\n{3,}/g, "\n\n");
  const insertion = `${normalizedWpConfigSnippet}\n\n`;
  const nextSource = marker.test(cleanedSource)
    ? cleanedSource.replace(marker, `${insertion}$&`)
    : `${cleanedSource.trimEnd()}\n\n${insertion}`;

  fs.writeFileSync(configPath, nextSource, "utf8");
  fs.writeFileSync(htaccessPath, `${normalizedHtaccessSnippet}\n`, "utf8");
}

function buildGeneratedMultisiteConfig(site, settings = getSettings()) {
  const htdocsPath = getResolvedHtdocsPath(settings);
  if (!htdocsPath || !site?.path) {
    throw new Error("Local server document root or site path is missing.");
  }

  const relativePath = (site.relativePath || path.relative(htdocsPath, site.path))
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const pathCurrentSite = relativePath ? `/${relativePath}/` : "/";

  const wpConfigSnippet = [
    "define('MULTISITE', true);",
    "define('SUBDOMAIN_INSTALL', false);",
    "define('DOMAIN_CURRENT_SITE', 'localhost');",
    `define('PATH_CURRENT_SITE', '${pathCurrentSite}');`,
    "define('SITE_ID_CURRENT_SITE', 1);",
    "define('BLOG_ID_CURRENT_SITE', 1);"
  ].join("\n");

  const htaccessSnippet = [
    "RewriteEngine On",
    "RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]",
    `RewriteBase ${pathCurrentSite}`,
    "RewriteRule ^index\\.php$ - [L]",
    "",
    "# add a trailing slash to /wp-admin",
    "RewriteRule ^([_0-9a-zA-Z-]+/)?wp-admin$ $1wp-admin/ [R=301,L]",
    "",
    "RewriteCond %{REQUEST_FILENAME} -f [OR]",
    "RewriteCond %{REQUEST_FILENAME} -d",
    "RewriteRule ^ - [L]",
    "RewriteRule ^([_0-9a-zA-Z-]+/)?(wp-(content|admin|includes).*) $2 [L]",
    "RewriteRule ^([_0-9a-zA-Z-]+/)?(.*\\.php)$ $2 [L]",
    "RewriteRule . index.php [L]"
  ].join("\n");

  return {
    wpConfigSnippet,
    htaccessSnippet,
    pathCurrentSite
  };
}

async function applyMultisiteConfigForSiteFromWindow(win, siteId) {
  if (!win || !siteId) {
    throw new Error("Select a multisite-enabled site first.");
  }

  const sites = getSites();
  const site = sites.find((entry) => entry.id === siteId);
  if (!site) {
    throw new Error("The selected site was not found.");
  }
  if (!site.multisite?.enabled) {
    throw new Error("This site is not marked for WordPress multisite.");
  }
  const settings = getSettings();
  const result = buildGeneratedMultisiteConfig(site, settings);

  if (!site.multisite?.prepared) {
    enableWordPressMultisite(site.path);
  }

  applyWordPressMultisiteNetworkConfig(site.path, result.wpConfigSnippet, result.htaccessSnippet);
  site.multisite.prepared = true;
  site.multisite.networkConfigured = true;
  saveSites(sites);
  emitBrowserNotice(win, {
    message: "Multisite network rules were applied to wp-config.php and .htaccess.",
    type: "success"
  });
  return {
    ok: true,
    message: `Applied multisite rules to wp-config.php and .htaccess using ${result.pathCurrentSite}.`
  };
}

function maybePrepareMultisiteSiteForUrl(win, url) {
  const settings = getSettings();
  const siteRootPath = findBestWordPressFolderForUrl(url, settings);
  if (!siteRootPath || !fs.existsSync(siteRootPath)) {
    return;
  }

  const sites = getSites();
  const site = sites.find((entry) => path.resolve(entry.path || "") === path.resolve(siteRootPath));
  if (!site?.multisite?.enabled || site.multisite?.prepared) {
    return;
  }

  if (!fs.existsSync(path.join(siteRootPath, "wp-config.php"))) {
    return;
  }

  const changed = enableWordPressMultisite(siteRootPath);
  if (!changed) {
    site.multisite.prepared = true;
    saveSites(sites);
    return;
  }

  site.multisite.prepared = true;
  saveSites(sites);
  emitBrowserNotice(win, {
    message: "Multisite support is enabled in wp-config.php. Open wp-admin and use Tools > Network Setup to finish the WordPress network install.",
    type: "success"
  });
}

function isPathInside(parentPath, childPath) {
  if (!parentPath || !childPath) {
    return false;
  }

  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removeDirSafe(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
}

function getBackupTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

function getSiteBackupDirectory(sitePath) {
  const resolvedSitePath = path.resolve(sitePath || "");
  if (!resolvedSitePath) {
    return path.join(app.getPath("documents"), "WP Desktop Backups");
  }

  return path.join(path.dirname(resolvedSitePath), "backups");
}

function getBackupDefaultPath(siteName, sitePath = "") {
  const safeName = (siteName || "wordpress-site").replace(/[^a-z0-9_-]/gi, "-");
  return path.join(getSiteBackupDirectory(sitePath), `${safeName}-backup-${getBackupTimestamp()}.zip`);
}

function getBackupSearchDirectories(settings = getSettings()) {
  const directories = new Set([path.join(app.getPath("documents"), "WP Desktop Backups")]);
  const htdocsPath = getResolvedHtdocsPath(settings);
  if (htdocsPath) {
    directories.add(path.join(htdocsPath, "backups"));
  }
  return Array.from(directories);
}

function readBackupMetadata(backupPath) {
  const zip = new AdmZip(backupPath);
  const entry = zip.getEntries().find((candidate) => /(^|\/)backup\.json$/i.test(candidate.entryName));
  if (!entry) {
    return null;
  }

  try {
    return JSON.parse(entry.getData().toString("utf8"));
  } catch (_) {
    return null;
  }
}

function listSiteBackups(settings = getSettings()) {
  const backups = [];

  for (const directory of getBackupSearchDirectories(settings)) {
    if (!directory || !fs.existsSync(directory)) {
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".zip") {
        continue;
      }

      const backupPath = path.join(directory, entry.name);
      let stats = null;
      try {
        stats = fs.statSync(backupPath);
      } catch (_) {
        continue;
      }

      const metadata = readBackupMetadata(backupPath) || {};
      backups.push({
        id: backupPath,
        path: backupPath,
        fileName: entry.name,
        siteName: metadata.site?.name || entry.name.replace(/-backup-\d{8}-\d{6}\.zip$/i, ""),
        targetPath: metadata.site?.path || "",
        dbName: metadata.database?.name || "",
        createdAt: metadata.createdAt || stats.mtime.toISOString(),
        backupFormat: metadata.backup?.format || "legacy-partial",
        selfContained: metadata.backup?.selfContained === true
      });
    }
  }

  return backups.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

function findWordPressCoreTemplate(targetPath, settings = getSettings()) {
  const htdocsPath = getResolvedHtdocsPath(settings);
  if (!htdocsPath || !fs.existsSync(htdocsPath)) {
    return "";
  }

  const resolvedTargetPath = path.resolve(targetPath);
  const candidates = findWordPressFolders(htdocsPath, 8).filter((folderPath) => {
    const resolvedFolderPath = path.resolve(folderPath);
    return (
      resolvedFolderPath !== resolvedTargetPath &&
      fs.existsSync(path.join(resolvedFolderPath, "wp-admin")) &&
      fs.existsSync(path.join(resolvedFolderPath, "wp-includes"))
    );
  });

  return candidates[0] || "";
}

function copyWordPressCoreTemplate(templatePath, targetPath) {
  const entries = fs.readdirSync(templatePath, { withFileTypes: true });
  for (const entry of entries) {
    if (["wp-content", "wp-config.php", "backups"].includes(entry.name.toLowerCase())) {
      continue;
    }

    fs.cpSync(path.join(templatePath, entry.name), path.join(targetPath, entry.name), {
      recursive: true,
      force: true
    });
  }
}

function resolveRestoreTargetPath(metadata, settings = getSettings()) {
  const htdocsPath = getResolvedHtdocsPath(settings);
  const rawTarget = String(metadata?.site?.path || "").trim();
  if (rawTarget && htdocsPath && isPathInside(path.resolve(htdocsPath), path.resolve(rawTarget))) {
    return path.resolve(rawTarget);
  }

  return path.resolve(htdocsPath || app.getPath("documents"), metadata?.site?.name || "restored-site");
}

async function restoreBackupPackage(payload) {
  const backupPath = String(payload?.backupPath || "").trim();
  if (!backupPath || !fs.existsSync(backupPath)) {
    throw new Error("Backup file was not found.");
  }

  const settings = getSettings();
  const metadata = readBackupMetadata(backupPath);
  if (!metadata?.site?.name) {
    throw new Error("Backup metadata is missing or invalid.");
  }

  const targetPath = resolveRestoreTargetPath(metadata, settings);
  const htdocsPath = getResolvedHtdocsPath(settings);
  if (htdocsPath && !isPathInside(path.resolve(htdocsPath), targetPath)) {
    throw new Error("Refusing to restore outside the configured htdocs folder.");
  }

  ensureDir(targetPath);

  const tempRoot = fs.mkdtempSync(path.join(app.getPath("temp"), "wpdesktop-restore-"));
  try {
    const zip = new AdmZip(backupPath);
    zip.extractAllTo(tempRoot, true);

    const extractedRoot = fs.readdirSync(tempRoot, { withFileTypes: true }).find((entry) => entry.isDirectory());
    if (!extractedRoot) {
      throw new Error("Backup archive is empty.");
    }

    const packageRoot = path.join(tempRoot, extractedRoot.name);
    const fullSiteRoot = path.join(packageRoot, "site-full");
    const hasFullSiteSnapshot = (
      fs.existsSync(path.join(fullSiteRoot, "wp-admin")) &&
      fs.existsSync(path.join(fullSiteRoot, "wp-includes")) &&
      fs.existsSync(path.join(fullSiteRoot, "wp-content"))
    );

    if (hasFullSiteSnapshot) {
      copyDirectoryContentsIfExists(fullSiteRoot, targetPath);
    } else {
      if (!fs.existsSync(path.join(targetPath, "wp-admin")) || !fs.existsSync(path.join(targetPath, "wp-includes"))) {
        const templatePath = findWordPressCoreTemplate(targetPath, settings);
        if (!templatePath) {
          throw new Error("This backup does not include WordPress core files. Keep at least one working local WordPress site to restore older backups.");
        }
        copyWordPressCoreTemplate(templatePath, targetPath);
      }

      copyIfExists(path.join(packageRoot, "site-content", "plugins"), path.join(targetPath, "wp-content", "plugins"));
      copyIfExists(path.join(packageRoot, "site-content", "themes"), path.join(targetPath, "wp-content", "themes"));
      copyIfExists(path.join(packageRoot, "site-content", "uploads"), path.join(targetPath, "wp-content", "uploads"));
      copyIfExists(path.join(packageRoot, "wp-config.php"), path.join(targetPath, "wp-config.php"));
    }

    const sqlDirectory = path.join(packageRoot, "database");
    const sqlFileName = fs.existsSync(sqlDirectory)
      ? fs.readdirSync(sqlDirectory).find((entry) => path.extname(entry).toLowerCase() === ".sql")
      : "";
    if (sqlFileName) {
      const sqlSource = fs.readFileSync(path.join(sqlDirectory, sqlFileName), "utf8");
      const dbProfile = getEffectiveDbProfile(settings);
      const connection = await mysql.createConnection({
        host: dbProfile.host || "127.0.0.1",
        port: Number(dbProfile.port || 3306),
        user: dbProfile.user || "root",
        password: dbProfile.password ?? "",
        multipleStatements: true
      });
      try {
        await connection.query(sqlSource);
      } finally {
        await connection.end();
      }
    }

    const effectiveDbProfile = getEffectiveDbProfile(settings);
    const siteUrl = buildSiteUrl(targetPath);
    const siteRecord = {
      id: metadata.site.id || `site-${Date.now()}`,
      name: metadata.site.name,
      path: targetPath,
      siteUrl,
      adminUrl: `${siteUrl.replace(/\/$/, "")}/wp-admin/`,
      dbName: metadata.database?.name || sanitizeDbName(metadata.site.name),
      dbHost: effectiveDbProfile.host || "127.0.0.1",
      dbPort: String(effectiveDbProfile.port || 3306),
      dbUser: effectiveDbProfile.user || "root",
      dbPassword: effectiveDbProfile.password ?? "",
      relativePath: htdocsPath ? path.relative(htdocsPath, targetPath) : metadata.site.name,
      webServer: getLocalServerWebServerLabel(),
      phpVersion: "Detected from restore target",
      databaseVersion: "Detected from MySQL",
      wordpressVersion: "Restored from backup",
      extractedCount: null,
      multisite: {
        enabled: false,
        prepared: false,
        networkConfigured: false
      }
    };

    const existingSites = getSites().filter((site) => (
      site.id !== siteRecord.id &&
      path.resolve(site.path || "") !== path.resolve(targetPath)
    ));
    existingSites.unshift(siteRecord);
    saveSites(existingSites);

    return {
      ok: true,
      site: siteRecord,
      message: `Restored ${siteRecord.name} from backup.`
    };
  } finally {
    removeDirSafe(tempRoot);
  }
}

function copyIfExists(sourcePath, destinationPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return false;
  }

  ensureDir(path.dirname(destinationPath));
  fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
  return true;
}

function copyDirectoryContentsIfExists(sourcePath, destinationPath, options = {}) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return false;
  }

  const filter = typeof options.filter === "function" ? options.filter : null;
  ensureDir(destinationPath);

  for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    const entrySourcePath = path.join(sourcePath, entry.name);
    const entryDestinationPath = path.join(destinationPath, entry.name);

    if (filter && !filter(entrySourcePath, entryDestinationPath)) {
      continue;
    }

    fs.cpSync(entrySourcePath, entryDestinationPath, {
      recursive: true,
      force: true,
      filter: filter || undefined
    });
  }

  return true;
}

function createBackupSnapshotFilter(excludedPaths = []) {
  const resolvedExcludedPaths = excludedPaths
    .filter(Boolean)
    .map((candidatePath) => path.resolve(candidatePath));

  return (sourcePath) => {
    const resolvedSourcePath = path.resolve(sourcePath);
    return !resolvedExcludedPaths.some((excludedPath) => (
      resolvedSourcePath === excludedPath ||
      resolvedSourcePath.startsWith(`${excludedPath}${path.sep}`)
    ));
  };
}

async function createSqlDump({ connection, dbName }) {
  const escapedDbName = dbName.replace(/`/g, "``");
  const lines = [
    "-- WP Desktop backup",
    `-- Database: ${dbName}`,
    `CREATE DATABASE IF NOT EXISTS \`${escapedDbName}\`;`,
    `USE \`${escapedDbName}\`;`,
    ""
  ];

  const [tableRows] = await connection.query(
    `SHOW FULL TABLES FROM \`${escapedDbName}\` WHERE Table_type = 'BASE TABLE'`
  );
  const tableKey = Object.keys(tableRows[0] || {}).find((key) => /^Tables_in_/i.test(key));
  const tables = tableKey ? tableRows.map((row) => row[tableKey]).filter(Boolean) : [];

  for (const tableName of tables) {
    const escapedTableName = tableName.replace(/`/g, "``");
    const [createRows] = await connection.query(`SHOW CREATE TABLE \`${escapedDbName}\`.\`${escapedTableName}\``);
    const createRow = createRows[0] || {};
    const createSql = createRow["Create Table"];

    if (!createSql) {
      continue;
    }

    lines.push(`DROP TABLE IF EXISTS \`${escapedTableName}\`;`);
    lines.push(`${createSql};`);

    const [rows] = await connection.query(`SELECT * FROM \`${escapedDbName}\`.\`${escapedTableName}\``);
    for (const row of rows) {
      const columns = Object.keys(row).map((column) => `\`${column.replace(/`/g, "``")}\``).join(", ");
      const values = Object.values(row).map((value) => connection.escape(value)).join(", ");
      lines.push(`INSERT INTO \`${escapedTableName}\` (${columns}) VALUES (${values});`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

async function backupSiteResources(payload) {
  const site = payload?.site || payload;
  const manualDatabase = payload?.database || {};

  if (!site?.path || !site?.id) {
    throw new Error("Missing site details.");
  }

  const settings = getSettings();
  const resolvedSitePath = path.resolve(site.path);
  if (!fs.existsSync(resolvedSitePath)) {
    throw new Error("The site folder no longer exists.");
  }

  const wpConfig = parseWpConfig(resolvedSitePath) || {};
  const detectedDb = getEffectiveDbProfile(settings);
  const dbName = sanitizeDbName(
    wpConfig.dbName || site.dbName || site.name || path.basename(resolvedSitePath)
  );
  const databaseProfile = resolveDbProfile(
    {
      host: manualDatabase.host || wpConfig.dbHost || site.dbHost,
      port: manualDatabase.port || wpConfig.dbPort || site.dbPort,
      user: manualDatabase.user || wpConfig.dbUser || site.dbUser,
      password: manualDatabase.password ?? wpConfig.dbPassword ?? site.dbPassword
    },
    detectedDb
  );
  const savePath = String(payload?.savePath || "").trim() || getBackupDefaultPath(site.name, resolvedSitePath);

  if (path.extname(savePath).toLowerCase() !== ".zip") {
    throw new Error("Select a valid backup zip path.");
  }

  ensureDir(path.dirname(savePath));

  const tempRoot = fs.mkdtempSync(path.join(app.getPath("temp"), "wpdesktop-backup-"));
  const packageRoot = path.join(tempRoot, `${site.name || path.basename(resolvedSitePath)}-backup`);
  const sqlPath = path.join(tempRoot, `${site.name || "site"}-database.sql`);
  const metadataPath = path.join(tempRoot, "backup.json");
  const fullSitePath = path.join(packageRoot, "site-full");

  try {
    ensureDir(packageRoot);
    ensureDir(path.join(packageRoot, "database"));
    ensureDir(path.join(packageRoot, "site-content"));
    ensureDir(fullSitePath);

    const connection = await mysql.createConnection({
      host: databaseProfile.host,
      port: Number(databaseProfile.port) || 3306,
      user: databaseProfile.user,
      password: databaseProfile.password
    });

    try {
      const sqlDump = await createSqlDump({ connection, dbName });
      fs.writeFileSync(sqlPath, sqlDump, "utf8");
    } finally {
      await connection.end();
    }

    const metadata = {
      site: {
        id: site.id,
        name: site.name,
        path: resolvedSitePath,
        siteUrl: site.siteUrl || null
      },
      database: {
        name: dbName,
        host: databaseProfile.host,
        port: String(databaseProfile.port || 3306),
        user: databaseProfile.user
      },
      backup: {
        format: "full-site-v2",
        selfContained: true,
        includes: ["site-full", "database"]
      },
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

    const wpContentPath = path.join(resolvedSitePath, "wp-content");
    const backupFilter = createBackupSnapshotFilter([
      getSiteBackupDirectory(resolvedSitePath),
      path.join(resolvedSitePath, "backups")
    ]);
    copyDirectoryContentsIfExists(resolvedSitePath, fullSitePath, { filter: backupFilter });
    copyIfExists(path.join(wpContentPath, "plugins"), path.join(packageRoot, "site-content", "plugins"));
    copyIfExists(path.join(wpContentPath, "themes"), path.join(packageRoot, "site-content", "themes"));
    copyIfExists(path.join(wpContentPath, "uploads"), path.join(packageRoot, "site-content", "uploads"));
    copyIfExists(path.join(resolvedSitePath, "wp-config.php"), path.join(packageRoot, "wp-config.php"));
    fs.copyFileSync(sqlPath, path.join(packageRoot, "database", `${dbName}.sql`));
    fs.copyFileSync(metadataPath, path.join(packageRoot, "backup.json"));

    const zip = new AdmZip();
    zip.addLocalFolder(packageRoot, path.basename(packageRoot));
    zip.writeZip(savePath);

    return {
      ok: true,
      savePath,
      dbName
    };
  } finally {
    removeDirSafe(tempRoot);
  }
}

async function deleteSiteResources(payload) {
  const site = payload?.site || payload;
  const manualDatabase = payload?.database || {};

  if (!site?.path || !site?.id) {
    throw new Error("Missing site details.");
  }

  const settings = getSettings();
  const resolvedSitePath = path.resolve(site.path);
  const htdocsPath = getResolvedHtdocsPath(settings);
  const resolvedHtdocsPath = htdocsPath ? path.resolve(htdocsPath) : "";
  const siteFolderExists = fs.existsSync(resolvedSitePath);

  if (siteFolderExists && resolvedHtdocsPath && !isPathInside(resolvedHtdocsPath, resolvedSitePath)) {
    throw new Error("Refusing to delete a site outside the configured htdocs folder.");
  }

  const backupResult = siteFolderExists
    ? await backupSiteResources({
      site,
      database: manualDatabase,
      savePath: payload?.savePath || getBackupDefaultPath(site.name, resolvedSitePath)
    })
    : null;

  const installerDb = getVault().installerDb || {};
  const wpConfig = siteFolderExists ? (parseWpConfig(resolvedSitePath) || {}) : {};
  const detectedDb = getEffectiveDbProfile(settings);
  const dbName = sanitizeDbName(
    wpConfig.dbName || site.dbName || site.name || path.basename(resolvedSitePath)
  );

  const attempts = [
    {
      label: "manual-ui",
      host: manualDatabase.host,
      port: manualDatabase.port,
      user: manualDatabase.user,
      password: manualDatabase.password
    },
    {
      label: "wp-config",
      host: wpConfig.dbHost,
      port: wpConfig.dbPort,
      user: wpConfig.dbUser,
      password: wpConfig.dbPassword
    },
    {
      label: "site-record",
      host: site.dbHost,
      port: site.dbPort,
      user: site.dbUser,
      password: site.dbPassword
    },
    {
      label: "installer-profile",
      host: installerDb.host,
      port: installerDb.port,
      user: installerDb.user,
      password: installerDb.password
    },
    {
      label: "local-server-detected",
      host: detectedDb?.host,
      port: detectedDb?.port,
      user: detectedDb?.user,
      password: detectedDb?.password
    }
  ]
    .filter((entry) => entry.host || entry.user || entry.password !== undefined)
    .map((entry) => ({
      ...entry,
      host: entry.host || "127.0.0.1",
      port: Number(entry.port || 3306),
      user: entry.user || "root",
      password: entry.password ?? ""
    }))
    .filter(
      (entry, index, all) =>
        all.findIndex((candidate) =>
          candidate.host === entry.host &&
          candidate.port === entry.port &&
          candidate.user === entry.user &&
          candidate.password === entry.password
        ) === index
    );

  let lastError = null;
  for (const dbConfig of attempts) {
    try {
      const connection = await mysql.createConnection({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password
      });
      try {
        await connection.query(`DROP DATABASE IF EXISTS \`${dbName.replace(/`/g, "")}\``);
        lastError = null;
        break;
      } finally {
        await connection.end();
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw new Error(
      `Could not drop database "${dbName}". ${lastError.message}`
    );
  }

  if (siteFolderExists) {
    fs.rmSync(resolvedSitePath, { recursive: true, force: true });
  }

  const remainingSites = getSites().filter((entry) => entry.id !== site.id);
  saveSites(remainingSites);

  return {
    ok: true,
    backupPath: backupResult?.savePath || null,
    deletedSiteId: site.id,
    deletedPath: resolvedSitePath,
    deletedDatabase: dbName,
    skippedMissingFolder: !siteFolderExists
  };
}

function extractZip({ zipPath, targetPath }) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  if (!entries.length) {
    throw new Error("The zip archive is empty.");
  }

  const firstFile = entries.find((entry) => entry.entryName && !entry.entryName.startsWith("__MACOSX/"));
  const rootSegment = firstFile?.entryName.split("/")[0];
  const rootPrefix = rootSegment ? `${rootSegment}/` : "";
  let extractedCount = 0;

  for (const entry of entries) {
    const name = entry.entryName;

    if (!name || name === rootPrefix || name.startsWith("__MACOSX/")) {
      continue;
    }

    const relativeName = rootPrefix && name.startsWith(rootPrefix) ? name.slice(rootPrefix.length) : name;
    if (!relativeName) {
      continue;
    }

    const destination = path.join(targetPath, relativeName);
    if (entry.isDirectory) {
      ensureDir(destination);
      continue;
    }

    ensureDir(path.dirname(destination));
    fs.writeFileSync(destination, entry.getData());
    extractedCount += 1;
  }

  return { extractedCount, rootFolder: rootSegment || null };
}

function getBrowserState(win) {
  if (!browserWindows.has(win.id)) {
    browserWindows.set(win.id, {
      tabs: [],
      tabGroups: [],
      activeTabId: null,
      attachedTabId: null,
      browserBounds: null,
      browserVisible: false,
      downloads: [],
      closedTabs: [],
      autoSaveTimers: {}
    });
  }

  return browserWindows.get(win.id);
}

async function getBrowserSuggestions(win, query) {
  const raw = String(query || "").trim();
  const state = getBrowserState(win);
  const suggestions = [];
  const seenKeys = new Set();

  const pushSuggestion = (entry) => {
    if (!entry?.value) {
      return;
    }

    const key = `${entry.type}:${entry.value}`;
    if (seenKeys.has(key)) {
      return;
    }

    seenKeys.add(key);
    suggestions.push(entry);
  };

  const addLocalSuggestion = (type, title, url, secondaryText, score) => {
    if (!url) {
      return;
    }

    pushSuggestion({
      id: `${type}-${Buffer.from(url).toString("base64").replace(/=+$/g, "")}`,
      type,
      title: title || url,
      value: url,
      secondaryText: secondaryText || url,
      score
    });
  };

  const historyEntries = getBrowserHistory();
  const bookmarkEntries = flattenBrowserBookmarks(getBrowserBookmarks());
  const tabEntries = state.tabs.map((tab) => ({
    title: tab.title,
    url: tab.url
  }));

  if (!raw) {
    bookmarkEntries.slice(0, 4).forEach((bookmark, index) => {
      addLocalSuggestion("bookmark", bookmark.title, bookmark.url, "Bookmark", 200 - index);
    });

    historyEntries
      .sort((left, right) => Number(right.lastVisited || 0) - Number(left.lastVisited || 0))
      .slice(0, 6)
      .forEach((entry, index) => {
        addLocalSuggestion("history", entry.title, entry.url, "Recent history", 160 - index);
      });

    return suggestions.slice(0, 8);
  }

  const resolvedUrl = ensureUrl(raw);
  if (isProbablyUrlInput(raw)) {
    pushSuggestion({
      id: `direct-${Buffer.from(resolvedUrl).toString("base64").replace(/=+$/g, "")}`,
      type: "direct",
      title: `Go to ${resolvedUrl}`,
      value: resolvedUrl,
      secondaryText: "Typed address",
      score: 1000
    });
  }

  pushSuggestion({
    id: `search-${Buffer.from(raw).toString("base64").replace(/=+$/g, "")}`,
    type: "search",
    title: `Search for "${raw}"`,
    value: buildSearchUrl(raw),
    secondaryText: "DuckDuckGo search",
    score: 900
  });

  historyEntries.forEach((entry) => {
    const score = scoreSuggestionMatch(raw, entry.url, entry.title) + Number(entry.visitCount || 0) * 4;
    if (score > 0) {
      addLocalSuggestion("history", entry.title, entry.url, "History", score);
    }
  });

  bookmarkEntries.forEach((entry) => {
    const score = scoreSuggestionMatch(raw, entry.url, entry.title) + 60;
    if (score > 0) {
      addLocalSuggestion("bookmark", entry.title, entry.url, "Bookmark", score);
    }
  });

  tabEntries.forEach((entry) => {
    const score = scoreSuggestionMatch(raw, entry.url, entry.title) + 40;
    if (score > 0) {
      addLocalSuggestion("tab", entry.title, entry.url, "Open tab", score);
    }
  });

  const remoteSuggestions = await fetchRemoteSearchSuggestions(raw);
  remoteSuggestions.forEach((phrase, index) => {
    pushSuggestion({
      id: `search-remote-${index}-${Buffer.from(phrase).toString("base64").replace(/=+$/g, "")}`,
      type: "search",
      title: phrase,
      value: buildSearchUrl(phrase),
      secondaryText: "Search suggestion",
      score: 820 - index
    });
  });

  return suggestions
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .slice(0, 8)
    .map(({ score, ...entry }) => entry);
}

function addDownloadRecord(win, record) {
  const state = getBrowserState(win);
  state.downloads = [record, ...state.downloads.filter((item) => item.id !== record.id)].slice(0, 12);
}

function updateDownloadRecord(win, downloadId, updater) {
  const state = getBrowserState(win);
  const record = state.downloads.find((item) => item.id === downloadId);
  if (!record) {
    return null;
  }

  updater(record);
  return record;
}

function findDownloadRecord(win, downloadId) {
  return getBrowserState(win).downloads.find((item) => item.id === downloadId) || null;
}

function serializeBrowserState(state) {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) || null;
  const navigation = activeTab ? getNavigationApi(activeTab.view.webContents) : null;
  const settings = getSettings();
  return {
    tabs: state.tabs.map((tab) => ({
      groupId: tab.groupId || null,
      groupName: getTabGroupById(state, tab.groupId)?.name || "",
      id: tab.id,
      title: tab.nickname || tab.title || tab.url,
      favicon: tab.favicon || "",
      url: tab.url,
      isLoading: Boolean(tab.isLoading),
      error: tab.error || null,
      pinned: Boolean(tab.pinned),
      muted: Boolean(tab.muted),
      nickname: tab.nickname || "",
      partition: tab.partition,
      sessionProfileName: getSessionProfileName(tab.partition),
      sessionScope: getSessionScopeForUrl(tab.url),
      sessionName: getTabSessionMatchName(tab),
      savedSession: Boolean(findSavedTabSessionEntryForTab(settings, state, tab)),
      autoSavedSession: Boolean(findSavedTabSessionEntryForTab(settings, state, tab)?.autoSave)
    })),
    tabGroups: state.tabGroups.map((group) => ({
      id: group.id,
      name: group.name,
      partition: getTabGroupPartitionName(group),
      tabCount: state.tabs.filter((tab) => tab.groupId === group.id).length
    })),
    activeTabId: state.activeTabId,
    canGoBack: navigation ? navigation.canGoBack() : false,
    canGoForward: navigation ? navigation.canGoForward() : false,
    showBookmarksBar: getBrowserShowBookmarksBar(),
    downloadDirectory: getDownloadDirectory(),
    bookmarks: getBrowserBookmarks(),
    downloads: state.downloads.map((item) => ({
      id: item.id,
      url: item.url,
      filename: item.filename,
      savePath: item.savePath,
      receivedBytes: item.receivedBytes,
      totalBytes: item.totalBytes,
      status: item.status,
      startedAt: item.startedAt
    })),
    savedPermissions: getSavedPermissionsList(),
    sessionSettings: {
      autoSaveLocalTabSessions: settings.autoSaveLocalTabSessions === true,
      autoSaveOnlineTabSessions: settings.autoSaveOnlineTabSessions === true,
      sessionAutoSaveDelaySeconds: Math.max(1, Number(settings.sessionAutoSaveDelaySeconds) || 5),
      savedTabSessionCount: Array.isArray(settings.savedTabSessions) ? settings.savedTabSessions.length : 0
    }
  };
}

function getNavigationApi(webContents) {
  const history = webContents?.navigationHistory;
  if (history && typeof history.canGoBack === "function" && typeof history.goBack === "function") {
    return history;
  }

  return {
    canGoBack: () => (typeof webContents?.canGoBack === "function" ? webContents.canGoBack() : false),
    canGoForward: () => (typeof webContents?.canGoForward === "function" ? webContents.canGoForward() : false),
    goBack: () => {
      if (typeof webContents?.goBack === "function") {
        webContents.goBack();
      }
    },
    goForward: () => {
      if (typeof webContents?.goForward === "function") {
        webContents.goForward();
      }
    }
  };
}

function emitBrowserState(win) {
  if (win.isDestroyed()) {
    return;
  }

  win.webContents.send("browser:state", serializeBrowserState(getBrowserState(win)));
}

function emitBrowserNotice(win, payload) {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.webContents.send("browser:notice", payload);
}

function emitBrowserMenuCommand(win, payload) {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.webContents.send("browser:menu-command", payload);
}

function emitSitesChanged(win) {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.webContents.send("sites:changed");
}

function findTabByWebContents(win, webContents) {
  return getBrowserState(win).tabs.find((tab) => tab.view.webContents === webContents) || null;
}

function getActiveBrowserTab(win) {
  const state = getBrowserState(win);
  return state.tabs.find((tab) => tab.id === state.activeTabId) || null;
}

function attachDownloadTracking(win, browserSession) {
  browserSession.on("will-download", (event, item, webContents) => {
    const downloadDirectory = getDownloadDirectory();
    ensureDir(downloadDirectory);

    const filename = item.getFilename() || "download";
    const savePath = getUniqueDownloadPath(downloadDirectory, filename);
    item.setSavePath(savePath);

    const tab = findTabByWebContents(win, webContents);
    const downloadId = `download-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    addDownloadRecord(win, {
      id: downloadId,
      url: item.getURL(),
      filename,
      savePath,
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      status: "progressing",
      startedAt: new Date().toISOString()
    });
    emitBrowserState(win);

    item.on("updated", (_downloadEvent, state) => {
      updateDownloadRecord(win, downloadId, (record) => {
        record.receivedBytes = item.getReceivedBytes();
        record.totalBytes = item.getTotalBytes();
        record.status = state === "interrupted" ? "interrupted" : "progressing";
      });
      emitBrowserState(win);
    });

    item.once("done", (_downloadEvent, state) => {
      updateDownloadRecord(win, downloadId, (record) => {
        record.receivedBytes = item.getReceivedBytes();
        record.totalBytes = item.getTotalBytes();
        record.status = state;
      });
      emitBrowserState(win);

      if (state === "completed" && win && !win.isDestroyed()) {
        const sourceLabel = tab?.title || tab?.url || "Current tab";
        win.webContents.send("browser:download-complete", {
          id: downloadId,
          filename,
          savePath,
          sourceLabel
        });
      }
    });
  });
}

function detachActiveView(win) {
  const state = getBrowserState(win);
  if (!state.attachedTabId) {
    return;
  }

  const active = state.tabs.find((tab) => tab.id === state.attachedTabId);
  if (active) {
    try {
      win.removeBrowserView(active.view);
    } catch (_) {
      // Ignore double-removal.
    }
  }

  state.attachedTabId = null;
}

function attachActiveView(win) {
  const state = getBrowserState(win);
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);

  if (!active || !state.browserVisible || !state.browserBounds) {
    detachActiveView(win);
    return;
  }

  if (state.attachedTabId !== active.id) {
    detachActiveView(win);
    win.setBrowserView(active.view);
    state.attachedTabId = active.id;
  }

  active.view.setBounds(state.browserBounds);
  active.view.setAutoResize({ width: true, height: true });
}

function buildContextMenu(win, tab, params) {
  const linkUrl = params.linkURL || tab.url;
  const menu = Menu.buildFromTemplate([
    {
      label: "Open link in new tab",
      enabled: Boolean(linkUrl),
      click: () => createBrowserTab(win, linkUrl, tab.mode || "auto", true, null, {
        groupId: tab.groupId || null
      })
    },
    {
      label: "Open link in new window",
      enabled: Boolean(linkUrl),
      click: () => createWindow({ startupUrl: linkUrl, startupMode: "auto" })
    },
    {
      label: "Open link in InPrivate window",
      enabled: Boolean(linkUrl),
      click: () => createWindow({ startupUrl: linkUrl, startupMode: "isolated" })
    },
    {
      label: "Open link in split screen window",
      enabled: Boolean(linkUrl),
      click: () => createWindow({ startupUrl: linkUrl, startupMode: "auto", splitScreen: true })
    },
    {
      label: "Open link as Personal",
      enabled: Boolean(linkUrl),
      click: () => createBrowserTab(win, linkUrl, "personal", true)
    },
    { type: "separator" },
    {
      label: "Save link as",
      enabled: Boolean(linkUrl),
      click: async () => {
        const defaultName = (() => {
          try {
            return path.basename(new URL(linkUrl).pathname) || "download";
          } catch (_) {
            return "download";
          }
        })();
        const saveResult = await dialog.showSaveDialog(win, { defaultPath: defaultName });
        if (saveResult.canceled || !saveResult.filePath) {
          return;
        }
        const response = await fetch(linkUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(saveResult.filePath, buffer);
      }
    },
    {
      label: "Copy link",
      enabled: Boolean(linkUrl),
      click: () => clipboard.writeText(linkUrl)
    },
    {
      label: "Visual Search",
      enabled: Boolean(linkUrl),
      click: () => createBrowserTab(
        win,
        `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(linkUrl)}`,
        tab.mode || "auto",
        true,
        null,
        { groupId: tab.groupId || null }
      )
    },
    {
      label: "More tools",
      submenu: [
        {
          label: "Open developer tools",
          click: () => tab.view.webContents.openDevTools({ mode: "detach" })
        }
      ]
    },
    {
      label: "Inspect",
      click: () => {
        tab.view.webContents.openDevTools({ mode: "detach" });
        tab.view.webContents.inspectElement(params.x, params.y);
      }
    }
  ]);

  menu.popup({ window: win });
}

function showBookmarkContextMenu(win, bookmark, showBookmarksBar) {
  const buildFolderSubmenu = (nodes = []) =>
    (nodes || [])
      .filter((node) => node?.type === "folder")
      .map((folder) => {
        const nestedItems = buildFolderSubmenu(folder.children || []);
        return {
          label: folder.title,
          submenu: [
            {
              label: "Move here",
              click: () => {
                moveBrowserBookmark(bookmark.id, { parentId: folder.id });
                emitBrowserState(win);
              }
            },
            ...(nestedItems.length ? [{ type: "separator" }, ...nestedItems] : [])
          ]
        };
      });

  const moveToFolderSubmenu = [
    {
      label: "Favorites bar",
      click: () => {
        moveBrowserBookmark(bookmark.id, { parentId: null });
        emitBrowserState(win);
      }
    }
  ];

  const nestedFolderItems = buildFolderSubmenu(getBrowserBookmarks());
  if (nestedFolderItems.length) {
    moveToFolderSubmenu.push(
      { type: "separator" },
      ...nestedFolderItems
    );
  }

  moveToFolderSubmenu.push(
    { type: "separator" },
    {
      label: "Create new folder and move here",
      click: () => win.webContents.send("browser:bookmark-create-folder-and-move", bookmark)
    }
  );

  const menu = Menu.buildFromTemplate([
    {
      label: "Open in new tab",
      click: () => createBrowserTab(win, bookmark.url, "auto", true)
    },
    {
      label: "Open in new window",
      click: () => createWindow({ startupUrl: bookmark.url, startupMode: "auto" })
    },
    {
      label: "Open in InPrivate window",
      click: () => createWindow({ startupUrl: bookmark.url, startupMode: "isolated" })
    },
    { type: "separator" },
    {
      label: "Edit",
      click: () => win.webContents.send("browser:bookmark-edit", bookmark)
    },
    {
      label: bookmark.iconOnly ? "Hide icon only" : "Show icon only",
      click: () => {
        updateBrowserBookmark(bookmark.id, { iconOnly: !bookmark.iconOnly });
        emitBrowserState(win);
      }
    },
    {
      label: "Move to folder",
      submenu: moveToFolderSubmenu
    },
    { type: "separator" },
    {
      label: "Cut",
      click: () => {
        copyBrowserBookmark(bookmark.id, true);
        emitBrowserState(win);
      }
    },
    {
      label: "Copy",
      click: () => copyBrowserBookmark(bookmark.id, false)
    },
    {
      label: "Paste",
      click: () => {
        pasteBrowserBookmark();
        emitBrowserState(win);
      }
    },
    {
      label: "Delete",
      click: () => {
        removeBrowserBookmark(bookmark.id);
        emitBrowserState(win);
      }
    },
    { type: "separator" },
    {
      label: showBookmarksBar ? "Hide bookmarks bar" : "Show bookmarks bar",
      click: () => {
        setBrowserShowBookmarksBar(!showBookmarksBar);
        emitBrowserState(win);
      }
    },
    {
      label: "Manage bookmarks",
      click: () => win.webContents.send("browser:bookmark-manage")
    }
  ]);

  menu.popup({ window: win });
}

function showBookmarkFolderContextMenu(win, folder, showBookmarksBar) {
  const active = getActiveBrowserTab(win);
  const raw = clipboard.readText().trim();
  let canPaste = false;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    canPaste = Boolean(parsed?.bookmark && (parsed?.type === "wpdesktop-bookmark" || parsed?.type === "wpdesktop-bookmark-node"));
  } catch (_) {
    canPaste = false;
  }

  const menu = Menu.buildFromTemplate([
    {
      label: "Open folder",
      click: () => win.webContents.send("browser:bookmark-folder-open", folder)
    },
    {
      label: "Open in new window",
      click: () => openBookmarkFolderItems(win, folder, { inNewWindow: true })
    },
    {
      label: "Open in InPrivate window",
      click: () => openBookmarkFolderItems(win, folder, { inNewWindow: true, isolated: true })
    },
    {
      label: "Open in new tab group",
      click: () => {
        openBookmarkFolderInNewTabGroup(win, folder);
      }
    },
    { type: "separator" },
    {
      label: "Rename",
      click: () => win.webContents.send("browser:bookmark-folder-edit", folder)
    },
    { type: "separator" },
    {
      label: "Cut",
      click: () => {
        copyBrowserBookmark(folder.id, true);
        emitBrowserState(win);
      }
    },
    {
      label: "Copy",
      click: () => copyBrowserBookmark(folder.id, false)
    },
    {
      label: "Paste",
      enabled: canPaste,
      click: () => {
        pasteBrowserBookmarkIntoParent(folder.id);
        emitBrowserState(win);
      }
    },
    { type: "separator" },
    {
      label: "Delete",
      click: () => {
        removeBrowserBookmark(folder.id);
        emitBrowserState(win);
      }
    },
    { type: "separator" },
    {
      label: "Add this page to favorites",
      enabled: Boolean(active?.url),
      click: () => {
        if (!active?.url) {
          return;
        }
        saveBrowserBookmark({
          title: active.title || active.url,
          url: active.url,
          parentId: folder.id
        });
        emitBrowserState(win);
      }
    },
    {
      label: "Add folder",
      click: () => win.webContents.send("browser:bookmark-folder-add-child", folder)
    },
    { type: "separator" },
    {
      label: showBookmarksBar ? "Hide bookmarks bar" : "Show bookmarks bar",
      click: () => {
        setBrowserShowBookmarksBar(!showBookmarksBar);
        emitBrowserState(win);
      }
    },
    {
      label: "Manage bookmarks",
      click: () => win.webContents.send("browser:bookmark-manage")
    }
  ]);

  menu.popup({ window: win });
}

function findTabById(win, tabId) {
  return getBrowserState(win).tabs.find((tab) => tab.id === tabId) || null;
}

function getTabGroupById(state, groupId) {
  if (!groupId) {
    return null;
  }

  return state.tabGroups.find((group) => group.id === groupId) || null;
}

function getTabGroupForTab(state, tab) {
  if (!tab?.groupId) {
    return null;
  }

  return getTabGroupById(state, tab.groupId);
}

function createTabGroupRecord(state, name = "") {
  const groupId = `group-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const normalizedName = String(name || "").trim() || `Group ${state.tabGroups.length + 1}`;
  const group = {
    id: groupId,
    name: normalizedName,
    partition: buildTabGroupProfilePartition(groupId)
  };
  state.tabGroups.push(group);
  return group;
}

function deleteEmptyTabGroup(state, groupId) {
  if (!groupId) {
    return false;
  }

  if (state.tabs.some((tab) => tab.groupId === groupId)) {
    return false;
  }

  const index = state.tabGroups.findIndex((group) => group.id === groupId);
  if (index === -1) {
    return false;
  }

  state.tabGroups.splice(index, 1);
  return true;
}

function snapshotClosedTab(tab) {
  return {
    url: tab.url,
    mode: tab.mode || "auto",
    nickname: tab.nickname || "",
    groupId: tab.groupId || null,
    pinned: Boolean(tab.pinned),
    muted: Boolean(tab.muted)
  };
}

function rememberClosedTab(win, tab) {
  const state = getBrowserState(win);
  state.closedTabs = [snapshotClosedTab(tab), ...state.closedTabs].slice(0, 12);
}

function insertTabAt(state, tab, insertIndex = null) {
  if (typeof insertIndex === "number" && insertIndex >= 0 && insertIndex <= state.tabs.length) {
    state.tabs.splice(insertIndex, 0, tab);
    return;
  }

  state.tabs.push(tab);
}

function reorderTab(win, tabId, targetIndex) {
  const state = getBrowserState(win);
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return false;
  }

  const boundedIndex = Math.max(0, Math.min(targetIndex, state.tabs.length - 1));
  if (index === boundedIndex) {
    return true;
  }

  const [tab] = state.tabs.splice(index, 1);
  state.tabs.splice(boundedIndex, 0, tab);
  emitBrowserState(win);
  return true;
}

function setTabPinned(win, tabId, pinned) {
  const state = getBrowserState(win);
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return false;
  }

  const [tab] = state.tabs.splice(index, 1);
  tab.pinned = Boolean(pinned);

  if (tab.pinned) {
    const firstUnpinnedIndex = state.tabs.findIndex((item) => !item.pinned);
    const nextIndex = firstUnpinnedIndex === -1 ? state.tabs.length : firstUnpinnedIndex;
    state.tabs.splice(nextIndex, 0, tab);
  } else {
    const lastPinnedIndex = state.tabs.reduce((found, item, itemIndex) => (item.pinned ? itemIndex : found), -1);
    state.tabs.splice(lastPinnedIndex + 1, 0, tab);
  }

  emitBrowserState(win);
  return true;
}

function setTabMuted(win, tabId, muted) {
  const tab = findTabById(win, tabId);
  if (!tab) {
    return false;
  }

  tab.muted = Boolean(muted);
  tab.view.webContents.setAudioMuted(tab.muted);
  emitBrowserState(win);
  return true;
}

function setTabNickname(win, tabId, nickname) {
  const tab = findTabById(win, tabId);
  if (!tab) {
    return false;
  }

  tab.nickname = String(nickname || "").trim();
  const state = getBrowserState(win);
  syncSavedSessionPartitionForTab(win, tab, state);
  scheduleAutoSaveForTab(win, tab);
  emitBrowserState(win);
  return true;
}

function clearAutoSaveTimer(win, tabId) {
  const state = getBrowserState(win);
  const timer = state.autoSaveTimers?.[tabId];
  if (timer) {
    clearTimeout(timer);
    delete state.autoSaveTimers[tabId];
  }
}

function isAutoSaveEnabledForScope(settings, scope) {
  return scope === "local"
    ? settings.autoSaveLocalTabSessions === true
    : settings.autoSaveOnlineTabSessions === true;
}

function syncSavedSessionPartitionForTab(win, tab, state = getBrowserState(win)) {
  if (!tab) {
    return false;
  }

  const nextPartition = resolvePartitionForTab(state, tab);
  if (!nextPartition || nextPartition === tab.partition) {
    return false;
  }

  return replaceTabViewWithPartition(win, tab, nextPartition, tab.url);
}

function saveCurrentTabSession(win, tabId, { autoSave = false } = {}) {
  const state = getBrowserState(win);
  const tab = findTabById(win, tabId);
  if (!tab) {
    return { ok: false, message: "Active tab not found." };
  }

  const descriptor = getSavedTabSessionDescriptorForTab(state, tab);
  if (!descriptor?.tabName) {
    return { ok: false, message: "Open a tab with a name before saving its session." };
  }

  const nextSettings = saveNamedTabSession(getSettings(), descriptor, autoSave);
  saveSettings(nextSettings);
  syncSavedSessionPartitionForTab(win, tab, state);
  emitBrowserState(win);
  return {
    ok: true,
    descriptor,
    autoSave,
    message: autoSave
      ? `Autosave is enabled for "${descriptor.tabName}".`
      : `Saved session for "${descriptor.tabName}".`
  };
}

function unsaveCurrentTabSession(win, tabId) {
  const state = getBrowserState(win);
  const tab = findTabById(win, tabId);
  if (!tab) {
    return { ok: false, message: "Active tab not found." };
  }

  const descriptor = getSavedTabSessionDescriptorForTab(state, tab);
  if (!descriptor?.tabName) {
    return { ok: false, message: "Open a tab with a name before removing its saved session." };
  }

  const currentSettings = getSettings();
  const matchingEntry = findSavedTabSessionEntryForTab(currentSettings, state, tab);
  const nextSettings = matchingEntry
    ? removeNamedTabSessionByPartition(currentSettings, tab.partition)
    : removeNamedTabSession(currentSettings, descriptor);
  saveSettings(nextSettings);
  clearAutoSaveTimer(win, tab.id);
  const nextPartition = getPartitionForUrl(tab.url, tab.id, tab.mode, getTabGroupForTab(state, tab), { ignoreSavedSessions: true });
  if (nextPartition && nextPartition !== tab.partition) {
    replaceTabViewWithPartition(win, tab, nextPartition, tab.url);
  }
  emitBrowserState(win);
  return {
    ok: true,
    descriptor,
    message: `Forgot saved session for "${descriptor.tabName}".`
  };
}

function scheduleAutoSaveForTab(win, tab) {
  if (!tab) {
    return;
  }

  const state = getBrowserState(win);
  const descriptor = getSavedTabSessionDescriptorForTab(state, tab);
  const settings = getSettings();
  const savedEntry = findSavedTabSessionEntryForTab(settings, state, tab);
  clearAutoSaveTimer(win, tab.id);

  if (!savedEntry?.autoSave || !isAutoSaveEnabledForScope(settings, descriptor?.scope)) {
    return;
  }

  const delay = Math.max(1, Number(settings.sessionAutoSaveDelaySeconds) || 5) * 1000;
  state.autoSaveTimers[tab.id] = setTimeout(() => {
    delete state.autoSaveTimers[tab.id];
    const nextDescriptor = getSavedTabSessionDescriptorForTab(state, tab);
    const nextSettings = saveNamedTabSession(getSettings(), nextDescriptor, true);
    saveSettings(nextSettings);
    syncSavedSessionPartitionForTab(win, tab, state);
    emitBrowserState(win);
  }, delay);
}

function replaceTabViewWithPartition(win, tab, nextPartition, nextUrl = null) {
  if (!tab || !nextPartition) {
    return false;
  }

  const state = getBrowserState(win);
  const resolvedUrl = ensureUrl(nextUrl || tab.url || getDefaultStartupUrl());
  const wasActive = state.activeTabId === tab.id;

  tab.partition = nextPartition;
  tab.url = resolvedUrl;
  tab.error = null;
  tab.isLoading = true;

  if (state.attachedTabId === tab.id) {
    detachActiveView(win);
  }

  try {
    tab.view.webContents.close({ waitForBeforeUnload: false });
  } catch (_) {
    // Ignore teardown issues while replacing a tab view.
  }

  configureBrowserSession(win, nextPartition);
  tab.view = new BrowserView({
    webPreferences: buildBrowserWebPreferences(nextPartition)
  });
  wireTabEvents(win, tab);
  tab.view.webContents.setAudioMuted(Boolean(tab.muted));
  wcSafeLoadURL(tab.view.webContents, resolvedUrl);

  if (wasActive) {
    attachActiveView(win);
  }

  return true;
}

function renameTabGroup(win, groupId, name) {
  const state = getBrowserState(win);
  const group = getTabGroupById(state, groupId);
  if (!group) {
    return false;
  }

  group.name = String(name || "").trim() || group.name;
  state.tabs
    .filter((tab) => tab.groupId === group.id)
    .forEach((tab) => {
      syncSavedSessionPartitionForTab(win, tab, state);
      scheduleAutoSaveForTab(win, tab);
    });
  emitBrowserState(win);
  return true;
}

function moveTabToGroup(win, tabId, groupId) {
  const state = getBrowserState(win);
  const tab = findTabById(win, tabId);
  const group = getTabGroupById(state, groupId);
  if (!tab || !group) {
    return false;
  }

  const previousGroupId = tab.groupId || null;
  tab.groupId = group.id;
  replaceTabViewWithPartition(win, tab, resolvePartitionForTab(state, tab, { group }), tab.url);
  deleteEmptyTabGroup(state, previousGroupId);
  emitBrowserState(win);
  return true;
}

function removeTabFromGroup(win, tabId) {
  const state = getBrowserState(win);
  const tab = findTabById(win, tabId);
  if (!tab?.groupId) {
    return false;
  }

  const previousGroupId = tab.groupId;
  tab.groupId = null;
  replaceTabViewWithPartition(win, tab, resolvePartitionForTab(state, tab, { group: null }), tab.url);
  deleteEmptyTabGroup(state, previousGroupId);
  emitBrowserState(win);
  return true;
}

function createTabGroupFromTab(win, tabId, groupName = "") {
  const state = getBrowserState(win);
  const tab = findTabById(win, tabId);
  if (!tab) {
    return null;
  }

  const previousGroupId = tab.groupId || null;
  const group = createTabGroupRecord(state, groupName || tab.nickname || tab.title || "Tab group");
  tab.groupId = group.id;
  replaceTabViewWithPartition(win, tab, resolvePartitionForTab(state, tab, { group }), tab.url);
  deleteEmptyTabGroup(state, previousGroupId);
  emitBrowserState(win);
  return group;
}

function dissolveTabGroup(win, groupId) {
  const state = getBrowserState(win);
  const group = getTabGroupById(state, groupId);
  if (!group) {
    return false;
  }

  state.tabs
    .filter((tab) => tab.groupId === groupId)
    .forEach((tab) => {
      tab.groupId = null;
      replaceTabViewWithPartition(win, tab, resolvePartitionForTab(state, tab, { group: null }), tab.url);
    });

  deleteEmptyTabGroup(state, groupId);
  emitBrowserState(win);
  return true;
}

function duplicateBrowserTab(win, tabId) {
  const state = getBrowserState(win);
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return false;
  }

  const source = state.tabs[index];
  createBrowserTab(win, source.url, source.mode || "auto", true, index + 1, {
    nickname: source.nickname || "",
    groupId: source.groupId || null,
    pinned: Boolean(source.pinned),
    muted: Boolean(source.muted)
  });
  return true;
}

function reopenClosedBrowserTab(win) {
  const state = getBrowserState(win);
  const snapshot = state.closedTabs.shift();
  if (!snapshot) {
    return false;
  }

  createBrowserTab(win, snapshot.url, snapshot.mode || "auto", true, null, snapshot);
  return true;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildBookmarkDialogHtml(requestId, payload = {}) {
  const title = escapeHtml(payload.title || payload.url || "Untitled");
  const hasExisting = payload.mode === "edit" || Boolean(payload.existingId);
  const heading = hasExisting ? "Edit favorite" : "Favorite added";
  const removeStyle = hasExisting ? "" : "display:none;";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>${heading}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Segoe UI", Arial, sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: #232323;
        color: #ffffff;
      }
      body {
        padding: 18px;
      }
      .card {
        width: 100%;
        height: 100%;
        display: grid;
        gap: 14px;
        align-content: start;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .head strong {
        font-size: 1rem;
      }
      .close {
        border: 0;
        background: transparent;
        color: #fff;
        cursor: pointer;
        font-size: 1.3rem;
        line-height: 1;
        padding: 0 4px;
      }
      label {
        display: grid;
        gap: 8px;
        font-size: 0.95rem;
        color: #d3d3d3;
      }
      input, .folder {
        width: 100%;
        border: 1px solid #6b7280;
        border-radius: 12px;
        background: #2b2b2b;
        color: #fff;
        padding: 10px 12px;
        min-height: 42px;
        outline: none;
      }
      input:focus {
        border-color: #f0a202;
        box-shadow: 0 0 0 1px #f0a202;
      }
      .actions {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 8px;
      }
      .right {
        display: flex;
        gap: 10px;
      }
      button {
        border: 1px solid #5a5a5a;
        border-radius: 12px;
        background: #4a4a4a;
        color: #fff;
        padding: 10px 16px;
        cursor: pointer;
        font-size: 0.95rem;
      }
      button.primary {
        background: #f3f4f6;
        border-color: #f3f4f6;
        color: #111827;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="head">
        <strong>${heading}</strong>
        <button id="close-button" class="close" type="button" aria-label="Close">×</button>
      </div>
      <label>
        <span>Name</span>
        <input id="title-input" type="text" value="${title}" placeholder="Bookmark name" />
      </label>
      <label>
        <span>Folder</span>
        <div class="folder">Favorites bar</div>
      </label>
      <div class="actions">
        <button id="more-button" type="button">More</button>
        <div class="right">
          <button id="done-button" class="primary" type="button">Done</button>
          <button id="remove-button" type="button" style="${removeStyle}">Remove</button>
        </div>
      </div>
    </div>
    <script>
      const requestId = ${JSON.stringify(requestId)};
      const input = document.getElementById("title-input");
      const closeButton = document.getElementById("close-button");
      const doneButton = document.getElementById("done-button");
      const removeButton = document.getElementById("remove-button");
      const moreButton = document.getElementById("more-button");

      const send = (result) => window.dialogAPI.sendBookmarkDialogResult({ requestId, result });

      closeButton.addEventListener("click", () => send({ action: "cancel" }));
      doneButton.addEventListener("click", () => {
        send({
          action: "save",
          title: input.value.trim()
        });
      });
      removeButton.addEventListener("click", () => send({ action: "remove" }));
      moreButton.addEventListener("click", () => send({ action: "manage" }));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          doneButton.click();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeButton.click();
        }
      });
      window.addEventListener("DOMContentLoaded", () => {
        input.focus();
        input.select();
      });
    </script>
  </body>
</html>`;
}

function showBookmarkSaveDialog(win, payload = {}) {
  const requestId = `bookmark-dialog-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let child = null;
  let settled = false;

  return new Promise((resolve) => {
    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      ipcMain.removeListener("browser:bookmark-dialog-result", handleResult);

      if (child && !child.isDestroyed()) {
        child.destroy();
      }

      resolve(result || { action: "cancel" });
    };

    const handleResult = (_event, payloadResult) => {
      if (payloadResult?.requestId !== requestId) {
        return;
      }

      finish(payloadResult.result);
    };

    ipcMain.on("browser:bookmark-dialog-result", handleResult);

    child = new BrowserWindow({
      parent: win,
      modal: true,
      show: false,
      width: 420,
      height: 280,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      title: payload.mode === "edit" ? "Edit favorite" : "Favorite added",
      backgroundColor: "#232323",
      webPreferences: {
        preload: path.join(__dirname, "dialog-preload.js"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    });

    child.once("ready-to-show", () => {
      if (!child.isDestroyed()) {
        child.show();
      }
    });

    child.on("closed", () => {
      child = null;
      finish({ action: "cancel" });
    });

    const html = buildBookmarkDialogHtml(requestId, payload);
    child.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}

const configuredSessionsForLogging = new Set();

function configureSessionNetworkLogging(ses) {
  if (configuredSessionsForLogging.has(ses)) {
    return;
  }
  configuredSessionsForLogging.add(ses);

  if (ses.webRequest) {
    ses.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
      const tab = findTabByWebContentsId(details.webContentsId);
      if (tab) {
        tab.networkRequests = tab.networkRequests || [];
        tab.networkRequests.push({
          id: details.id,
          url: details.url,
          method: details.method,
          timestamp: Date.now(),
          status: "pending"
        });
        if (tab.networkRequests.length > 200) {
          tab.networkRequests.shift();
        }
      }
      callback({});
    });

    ses.webRequest.onCompleted({ urls: ["http://*/*", "https://*/*"] }, (details) => {
      const tab = findTabByWebContentsId(details.webContentsId);
      if (tab) {
        tab.networkRequests = tab.networkRequests || [];
        const req = tab.networkRequests.find((r) => r.id === details.id);
        if (req) {
          req.status = "completed";
          req.statusCode = details.statusCode;
        }
      }
    });

    ses.webRequest.onErrorOccurred({ urls: ["http://*/*", "https://*/*"] }, (details) => {
      const tab = findTabByWebContentsId(details.webContentsId);
      if (tab) {
        tab.networkRequests = tab.networkRequests || [];
        const req = tab.networkRequests.find((r) => r.id === details.id);
        if (req) {
          req.status = "failed";
          req.error = details.error;
        }
      }
    });
  }
}

function findTabByWebContentsId(wcId) {
  if (!wcId) return null;
  for (const win of BrowserWindow.getAllWindows()) {
    const state = browserWindows.get(win.id);
    if (state && state.tabs) {
      const tab = state.tabs.find((t) => t.view.webContents.id === wcId);
      if (tab) return tab;
    }
  }
  return null;
}

function findTabAcrossAllWindows(tabId) {
  if (!tabId) return null;
  for (const win of BrowserWindow.getAllWindows()) {
    const state = browserWindows.get(win.id);
    if (state && state.tabs) {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (tab) return { tab, win };
    }
  }
  return null;
}

function wireTabEvents(win, tab) {
  const wc = tab.view.webContents;

  configureSessionNetworkLogging(session.fromPartition(tab.partition));

  wc.on("console-message", (_event, details) => {
    const msg = String(details?.message || "");
    if (msg.startsWith(VAULT_CAPTURE_LOG_PREFIX)) {
      return;
    }
    const lvl = ["verbose", "info", "warning", "error"][details?.level] || "info";
    tab.consoleLogs = tab.consoleLogs || [];
    tab.consoleLogs.push({
      timestamp: Date.now(),
      level: lvl,
      message: msg,
      line: details?.line,
      source: details?.sourceId
    });
    if (tab.consoleLogs.length > 200) {
      tab.consoleLogs.shift();
    }
  });

  wc.on("select-bluetooth-device", (_event, deviceList, callback) => {
    const preferred = (deviceList || []).find((device) => Boolean(device?.deviceId));
    callback(preferred?.deviceId || "");
  });

  wc.setWindowOpenHandler((details) => {
    if (openUrlInExternalBrowser(details.url)) {
      return { action: "deny" };
    }

    if (shouldOpenAsPopupWindow(details)) {
      configureBrowserSession(win, tab.partition);
      return {
        action: "allow",
        overrideBrowserWindowOptions: buildPopupBrowserWindowOptions(win, tab.partition)
      };
    }

    createBrowserTab(win, details.url, tab.mode || "auto", true, null, {
      groupId: tab.groupId || null
    });
    return { action: "deny" };
  });

  wc.on("will-navigate", (event, url) => {
    if (!openUrlInExternalBrowser(url)) {
      return;
    }

    event.preventDefault();
  });

  wc.on("will-redirect", (event, url) => {
    if (!openUrlInExternalBrowser(url)) {
      return;
    }

    event.preventDefault();
  });

  wc.on("did-start-loading", () => {
    tab.isLoading = true;
    tab.error = null;
    emitBrowserState(win);
  });

  wc.on("did-stop-loading", () => {
    tab.isLoading = false;
    scheduleAutoSaveForTab(win, tab);
    emitBrowserState(win);
    void maybeAutoFillWordPressBootstrap(tab);
    maybePrepareMultisiteSiteForUrl(win, tab.url);
  });

  wc.on("page-title-updated", (event, title) => {
    event.preventDefault();
    tab.title = title || tab.url;
    recordBrowserHistoryVisit(tab.url, tab.title, false);
    syncSavedSessionPartitionForTab(win, tab);
    scheduleAutoSaveForTab(win, tab);
    emitBrowserState(win);
  });

  wc.on("page-favicon-updated", (_event, favicons) => {
    tab.favicon = Array.isArray(favicons) ? String(favicons[0] || "").trim() : "";
    emitBrowserState(win);
  });

  wc.on("did-navigate", (_event, url) => {
    tab.url = url;
    tab.error = null;
    recordBrowserHistoryVisit(tab.url, tab.title);
    syncSavedSessionPartitionForTab(win, tab);
    scheduleAutoSaveForTab(win, tab);
    emitBrowserState(win);
    void maybeAutoFillWordPressBootstrap(tab);
    maybePrepareMultisiteSiteForUrl(win, tab.url);
  });

  wc.on("did-navigate-in-page", (_event, url) => {
    tab.url = url;
    recordBrowserHistoryVisit(tab.url, tab.title);
    syncSavedSessionPartitionForTab(win, tab);
    scheduleAutoSaveForTab(win, tab);
    emitBrowserState(win);
    void maybeAutoFillWordPressBootstrap(tab);
    maybePrepareMultisiteSiteForUrl(win, tab.url);
  });

  wc.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) {
      return;
    }

    tab.isLoading = false;
    if (isLocalUrl(validatedURL || tab.url)) {
      tab.error = {
        url: validatedURL || tab.url,
        description: errorDescription || "Local site could not be reached."
      };
    }

    emitBrowserState(win);
  });

  wc.on("context-menu", (_event, params) => {
    buildContextMenu(win, tab, params);
  });

  wc.on("console-message", (_event, details) => {
    const message = String(details?.message || "");
    if (!message.startsWith(VAULT_CAPTURE_LOG_PREFIX)) {
      return;
    }

    try {
      const payload = JSON.parse(message.slice(VAULT_CAPTURE_LOG_PREFIX.length));
      if (!payload?.token || payload.token !== tab.pendingCredentialCaptureToken) {
        return;
      }

      const key = String(payload.key || "");
      const username = String(payload.username || "");
      const password = String(payload.password || "");
      if (!key || (!username && !password)) {
        return;
      }

      tab.pendingCredentialCaptureToken = null;
      win.webContents.send("browser:prompt-save-credentials", {
        key,
        url: tab.url || "",
        username,
        password
      });
    } catch (_) {
      // Ignore malformed page messages.
    }
  });
}

function createBrowserTab(win, url, mode = "auto", activate = true, insertIndex = null, tabOptions = {}) {
  const state = getBrowserState(win);
  const resolvedUrl = ensureUrl(url);
  if (openUrlInExternalBrowser(resolvedUrl)) {
    return null;
  }

  const id = `tab-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const group = getTabGroupById(state, tabOptions.groupId);
  const partition = getPartitionForUrl(resolvedUrl, id, mode, group, {
    tabName: String(tabOptions.nickname || "").trim()
  });
  configureBrowserSession(win, partition);
  const view = new BrowserView({
    webPreferences: buildBrowserWebPreferences(partition)
  });

  const tab = {
    id,
    title: "New Tab",
    favicon: "",
    nickname: String(tabOptions.nickname || "").trim(),
    groupId: group?.id || null,
    url: resolvedUrl,
    isLoading: true,
    mode,
    partition,
    error: null,
    pinned: Boolean(tabOptions.pinned),
    muted: Boolean(tabOptions.muted),
    pendingCredentialCaptureToken: null,
    consoleLogs: [],
    networkRequests: [],
    view
  };

  wireTabEvents(win, tab);
  view.webContents.setAudioMuted(tab.muted);
  insertTabAt(state, tab, insertIndex);

  if (activate || !state.activeTabId) {
    state.activeTabId = id;
  }

  wcSafeLoadURL(view.webContents, resolvedUrl);
  attachActiveView(win);
  emitBrowserState(win);
  return tab;
}

function wcSafeLoadURL(webContents, url) {
  webContents.loadURL(url).catch(() => {
    // Errors are surfaced through did-fail-load and browser state.
  });
}

function activateBrowserTab(win, tabId) {
  const state = getBrowserState(win);
  if (!state.tabs.some((tab) => tab.id === tabId)) {
    return;
  }

  state.activeTabId = tabId;
  attachActiveView(win);
  emitBrowserState(win);
}

function closeBrowserTab(win, tabId) {
  const state = getBrowserState(win);
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return;
  }

  const [tab] = state.tabs.splice(index, 1);
  const previousGroupId = tab.groupId || null;
  rememberClosedTab(win, tab);
  clearAutoSaveTimer(win, tab.id);
  if (state.attachedTabId === tab.id) {
    detachActiveView(win);
  }
  tab.view.webContents.close({ waitForBeforeUnload: false });
  deleteEmptyTabGroup(state, previousGroupId);

  if (!state.tabs.length) {
    createBrowserTab(win, getDefaultStartupUrl(), "auto", true);
    return;
  }

  if (state.activeTabId === tabId) {
    state.activeTabId = state.tabs[Math.max(0, index - 1)].id;
  }

  attachActiveView(win);
  emitBrowserState(win);
}

function navigateActiveBrowserTab(win, url) {
  const state = getBrowserState(win);
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  const resolvedUrl = ensureUrl(url);
  if (openUrlInExternalBrowser(resolvedUrl)) {
    return;
  }

  if (!active) {
    createBrowserTab(win, resolvedUrl, "auto", true);
    return;
  }

  const nextPartition = getPartitionForUrl(resolvedUrl, active.id, active.mode, getTabGroupForTab(state, active), {
    tabName: getTabSessionMatchName({ ...active, url: resolvedUrl })
  });

  if (nextPartition !== active.partition) {
    const wasActive = state.activeTabId === active.id;
    active.partition = nextPartition;
    active.url = resolvedUrl;
    active.error = null;

    if (state.attachedTabId === active.id) {
      detachActiveView(win);
    }

    active.view.webContents.close({ waitForBeforeUnload: false });
    configureBrowserSession(win, nextPartition);
    active.view = new BrowserView({
      webPreferences: buildBrowserWebPreferences(nextPartition)
    });
    wireTabEvents(win, active);
    wcSafeLoadURL(active.view.webContents, resolvedUrl);
    if (wasActive) {
      attachActiveView(win);
    }
  } else {
    active.url = resolvedUrl;
    active.error = null;
    wcSafeLoadURL(active.view.webContents, resolvedUrl);
  }

  emitBrowserState(win);
}

function goBack(win) {
  const active = getBrowserState(win).tabs.find((tab) => tab.id === getBrowserState(win).activeTabId);
  const navigation = active ? getNavigationApi(active.view.webContents) : null;
  if (navigation?.canGoBack()) {
    navigation.goBack();
  }
}

function goForward(win) {
  const active = getBrowserState(win).tabs.find((tab) => tab.id === getBrowserState(win).activeTabId);
  const navigation = active ? getNavigationApi(active.view.webContents) : null;
  if (navigation?.canGoForward()) {
    navigation.goForward();
  }
}

function reloadActive(win) {
  const state = getBrowserState(win);
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  if (!active) {
    return;
  }

  active.error = null;
  attachActiveView(win);

  const webContents = active.view.webContents;
  const navigation = getNavigationApi(webContents);
  const canUseReload = Boolean(navigation?.canGoBack?.() || navigation?.canGoForward?.());

  if (active.url && (!canUseReload || isLocalUrl(active.url))) {
    wcSafeLoadURL(webContents, active.url);
  } else {
    webContents.reload();
  }

  emitBrowserState(win);
}

function getWordPressBootstrapAutofillPayload(url, settings = getSettings()) {
  const dbProfile = getEffectiveDbProfile(settings);
  const siteRootFolderName = getSiteRootFolderNameFromUrl(url || "", settings);

  return {
    dbConfig: {
      dbName: sanitizeDbName(siteRootFolderName || "wordpress"),
      dbUser: dbProfile.user || "root",
      dbPassword: dbProfile.password || "",
      dbHost: dbProfile.port && dbProfile.port !== "3306"
        ? `${dbProfile.host}:${dbProfile.port}`
        : dbProfile.host,
      tablePrefix: "wp_"
    },
    installConfig: {
      siteTitle: siteRootFolderName || "WordPress",
      username: settings.wpInstallUsername || "admin",
      password: settings.wpInstallPassword ?? "root",
      email: settings.wpInstallEmail || "",
      discourageSearchEngines: true
    }
  };
}

function buildWordPressBootstrapAutofillScript(payload, options = {}) {
  const autoSubmitCapture = Boolean(options.autoSubmitCapture);

  return `
    (() => {
      const dbConfig = ${JSON.stringify(payload.dbConfig)};
      const installConfig = ${JSON.stringify(payload.installConfig)};
      const autoSubmitCapture = ${JSON.stringify(autoSubmitCapture)};

      const fireInputEvents = (element) => {
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };

      const pickFirstVisible = (selectors) => {
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          if (!node) continue;

          const style = window.getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") continue;
          if (node.disabled || node.readOnly) continue;
          return node;
        }

        return null;
      };

      const fillField = (selectors, value) => {
        if (!value && value !== "") {
          return { filled: false, selector: null };
        }

        const field = pickFirstVisible(selectors);
        if (!field) {
          return { filled: false, selector: null };
        }

        field.focus();
        field.value = value;
        fireInputEvents(field);
        return {
          filled: true,
          selector: field.id || field.name || field.type || null
        };
      };

      const isWordPressDatabaseSetupPage = () => {
        const bodyText = String(document.body?.innerText || "");
        return (
          /\\/wp-admin\\/setup-config\\.php/i.test(window.location.pathname) &&
          Boolean(document.querySelector("#dbname, input[name='dbname'], #uname, input[name='uname'], #dbhost, input[name='dbhost']"))
        ) || /database connection details/i.test(bodyText);
      };

      if (isWordPressDatabaseSetupPage()) {
        const dbNameResult = fillField(["#dbname", "input[name='dbname']"], dbConfig.dbName);
        const dbUserResult = fillField(["#uname", "input[name='uname']"], dbConfig.dbUser);
        const dbPasswordResult = fillField(["#pwd", "input[name='pwd']"], dbConfig.dbPassword);
        const dbHostResult = fillField(["#dbhost", "input[name='dbhost']"], dbConfig.dbHost);
        const prefixField = pickFirstVisible(["#prefix", "input[name='prefix']"]);
        let filledPrefix = false;

        if (prefixField) {
          prefixField.focus();
          prefixField.value = dbConfig.tablePrefix;
          fireInputEvents(prefixField);
          filledPrefix = true;
        }

        return {
          mode: "wordpress-db",
          filledDbName: dbNameResult.filled,
          filledDbUser: dbUserResult.filled,
          filledDbPassword: dbPasswordResult.filled,
          filledDbHost: dbHostResult.filled,
          filledPrefix
        };
      }

      const isWordPressInstallPage = () => {
        const bodyText = String(document.body?.innerText || "");
        return (
          /\\/wp-admin\\/install\\.php/i.test(window.location.pathname) &&
          Boolean(
            document.querySelector("#weblog_title, input[name='weblog_title'], #user_login, input[name='user_name'], #admin_email, input[name='admin_email']")
          )
        ) || /Please provide the following information/i.test(bodyText);
      };

      if (isWordPressInstallPage()) {
        const siteTitleResult = fillField(["#weblog_title", "input[name='weblog_title']"], installConfig.siteTitle);
        const usernameResult = fillField(["#user_login", "input[name='user_name']", "input[name='user_login']"], installConfig.username);
        const passwordResult = fillField(["#pass1-text", "#pass1", "input[name='admin_password']"], installConfig.password);
        const hiddenPasswordConfirm = document.querySelector("input[name='admin_password2'], #pass2");
        if (hiddenPasswordConfirm && !hiddenPasswordConfirm.disabled) {
          hiddenPasswordConfirm.value = installConfig.password;
          fireInputEvents(hiddenPasswordConfirm);
        }
        const emailResult = fillField(["#admin_email", "input[name='admin_email']"], installConfig.email);

        const weakCheckbox = document.querySelector("#pw-weak, input[name='pw_weak']");
        if (weakCheckbox && !weakCheckbox.checked) {
          weakCheckbox.click();
        }

        const searchVisibilityCheckbox = document.querySelector("#blog_public, input[name='blog_public']");
        let filledSearchVisibility = false;
        if (searchVisibilityCheckbox) {
          const shouldCheck = Boolean(installConfig.discourageSearchEngines);
          if (Boolean(searchVisibilityCheckbox.checked) !== shouldCheck) {
            searchVisibilityCheckbox.click();
          }
          filledSearchVisibility = Boolean(searchVisibilityCheckbox.checked) === shouldCheck;
        }

        if (autoSubmitCapture) {
          const form = document.querySelector("form");
          if (form && !form.dataset.wpDesktopBootstrapAutofill) {
            form.dataset.wpDesktopBootstrapAutofill = "true";
          }
        }

        return {
          mode: "wordpress-install",
          filledSiteTitle: siteTitleResult.filled,
          filledInstallUsername: usernameResult.filled,
          filledInstallPassword: passwordResult.filled,
          filledInstallEmail: emailResult.filled,
          filledSearchVisibility
        };
      }

      return { mode: "none" };
    })();
  `;
}

function shouldAutoFillWordPressBootstrap(url) {
  try {
    const parsed = new URL(url);
    if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      return false;
    }

    return /\/wp-admin\/(setup-config\.php|install\.php)$/i.test(parsed.pathname);
  } catch (_) {
    return false;
  }
}

async function maybeAutoFillWordPressBootstrap(tab) {
  if (!tab?.view?.webContents || !shouldAutoFillWordPressBootstrap(tab.url || "")) {
    return;
  }

  const payload = getWordPressBootstrapAutofillPayload(tab.url || "");
  const script = buildWordPressBootstrapAutofillScript(payload, { autoSubmitCapture: false });

  try {
    await tab.view.webContents.executeJavaScript(script, true);
  } catch (_) {
    // Ignore autofill failures on transitional setup pages.
  }
}

async function autofillActiveBrowserTab(win, credentials = {}) {
  const state = getBrowserState(win);
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  if (!active?.view?.webContents) {
    return { ok: false, message: "No active page available for autofill." };
  }

  const username = String(credentials.username || "");
  const password = String(credentials.password || "");
  const { dbConfig, installConfig } = getWordPressBootstrapAutofillPayload(active.url || "");
  const captureToken = `vault-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  active.pendingCredentialCaptureToken = captureToken;

  if (!username && !password && !dbConfig.dbName) {
    return { ok: false, message: "Save a username or password before using autofill." };
  }

  const bootstrapScript = buildWordPressBootstrapAutofillScript({ dbConfig, installConfig }, { autoSubmitCapture: true });
  const script = `
    (() => {
      const usernameValue = ${JSON.stringify(username)};
      const passwordValue = ${JSON.stringify(password)};
      const bootstrapResult = ${bootstrapScript};
      if (bootstrapResult?.mode === "wordpress-db" || bootstrapResult?.mode === "wordpress-install") {
        return bootstrapResult;
      }

      const pickFirstVisible = (selectors) => {
        for (const selector of selectors) {
          const node = document.querySelector(selector);
          if (!node) continue;

          const style = window.getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") continue;
          if (node.disabled || node.readOnly) continue;
          return node;
        }

        return null;
      };

      const fireInputEvents = (element) => {
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      };

      const usernameField = pickFirstVisible([
        "#user_login",
        "input[name='log']",
        "input[name='username']",
        "input[name='email']",
        "input[name='user_login']",
        "input[type='email']",
        "input[autocomplete='username']",
        "input[id*='user']",
        "input[id*='email']",
        "input[placeholder*='user' i]",
        "input[placeholder*='email' i]",
        "form input[type='text']"
      ]);

      const passwordField = pickFirstVisible([
        "#user_pass",
        "input[name='pwd']",
        "input[name='password']",
        "input[type='password']",
        "input[autocomplete='current-password']"
      ]);

      let filledUsername = false;
      let filledPassword = false;

      if (usernameField && usernameValue) {
        usernameField.focus();
        usernameField.value = usernameValue;
        fireInputEvents(usernameField);
        filledUsername = true;
      }

      if (passwordField && passwordValue) {
        passwordField.focus();
        passwordField.value = passwordValue;
        fireInputEvents(passwordField);
        filledPassword = true;
      }

      return {
        filledUsername,
        filledPassword,
        usernameSelector: usernameField ? usernameField.id || usernameField.name || usernameField.type : null,
        passwordSelector: passwordField ? passwordField.id || passwordField.name || passwordField.type : null
      };
    })();
  `;

  try {
    const result = await active.view.webContents.executeJavaScript(script, true);
    if (result?.mode === "wordpress-db") {
      active.pendingCredentialCaptureToken = null;
      if (result.filledDbName || result.filledDbUser || result.filledDbPassword || result.filledDbHost || result.filledPrefix) {
        return {
          ok: true,
          message: `WordPress database fields filled for "${dbName}".`,
          details: result
        };
      }

      return {
        ok: false,
        message: "WordPress database setup form was detected, but no editable database fields were found.",
        details: result || null
      };
    }

    if (result?.mode === "wordpress-install") {
      if (result.filledSiteTitle || result.filledInstallUsername || result.filledInstallPassword || result.filledInstallEmail) {
        return {
          ok: true,
          message: `WordPress install fields filled for "${installConfig.siteTitle}" and the credentials will be saved on submit.`,
          details: result
        };
      }

      active.pendingCredentialCaptureToken = null;
      return {
        ok: false,
        message: "WordPress install page was detected, but no editable setup fields were found.",
        details: result || null
      };
    }

    if (result?.filledUsername || result?.filledPassword) {
      active.pendingCredentialCaptureToken = null;
      return {
        ok: true,
        message: "Credentials filled into the current page.",
        details: result
      };
    }

    active.pendingCredentialCaptureToken = null;
    return {
      ok: false,
      message: "No compatible login fields were found on the current page.",
      details: result || null
    };
  } catch (error) {
    active.pendingCredentialCaptureToken = null;
    return {
      ok: false,
      message: `Autofill failed: ${error.message}`
    };
  }
}

function buildTabNicknameDialogHtml(requestId, payload = {}) {
  const nickname = escapeHtml(payload.nickname || payload.title || "");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Nickname tab</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Segoe UI", Arial, sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: #232323;
        color: #ffffff;
      }
      body {
        padding: 18px;
      }
      .card {
        width: 100%;
        height: 100%;
        display: grid;
        gap: 14px;
        align-content: start;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .close {
        border: 0;
        background: transparent;
        color: #fff;
        cursor: pointer;
        font-size: 1.3rem;
        line-height: 1;
        padding: 0 4px;
      }
      label {
        display: grid;
        gap: 8px;
        font-size: 0.95rem;
        color: #d3d3d3;
      }
      input {
        width: 100%;
        border: 1px solid #6b7280;
        border-radius: 12px;
        background: #2b2b2b;
        color: #fff;
        padding: 10px 12px;
        min-height: 42px;
        outline: none;
      }
      input:focus {
        border-color: #f0a202;
        box-shadow: 0 0 0 1px #f0a202;
      }
      .note {
        color: #b8bec8;
        font-size: 0.92rem;
        line-height: 1.5;
      }
      .actions {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 8px;
      }
      .right {
        display: flex;
        gap: 10px;
      }
      button {
        border: 1px solid #5a5a5a;
        border-radius: 12px;
        background: #4a4a4a;
        color: #fff;
        padding: 10px 16px;
        cursor: pointer;
        font-size: 0.95rem;
      }
      button.primary {
        background: #f3f4f6;
        border-color: #f3f4f6;
        color: #111827;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="head">
        <strong>Set a fixed tab name</strong>
        <button id="close-button" class="close" type="button" aria-label="Close">x</button>
      </div>
      <label>
        <span>Nickname</span>
        <input id="nickname-input" type="text" value="${nickname}" placeholder="Enter a nickname for this tab" />
      </label>
      <div class="note">This name stays on the tab even when the page title changes.</div>
      <div class="actions">
        <button id="clear-button" type="button">Clear</button>
        <div class="right">
          <button id="save-button" class="primary" type="button">Save</button>
        </div>
      </div>
    </div>
    <script>
      const requestId = ${JSON.stringify(requestId)};
      const input = document.getElementById("nickname-input");
      const closeButton = document.getElementById("close-button");
      const saveButton = document.getElementById("save-button");
      const clearButton = document.getElementById("clear-button");

      const send = (result) => {
        window.dialogAPI.sendTabNicknameDialogResult({
          requestId,
          result
        });
      };

      closeButton.addEventListener("click", () => send({ action: "cancel" }));
      saveButton.addEventListener("click", () => send({ action: "save", nickname: input.value.trim() }));
      clearButton.addEventListener("click", () => send({ action: "save", nickname: "" }));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          saveButton.click();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeButton.click();
        }
      });
      window.addEventListener("DOMContentLoaded", () => {
        input.focus();
        input.select();
      });
    </script>
  </body>
</html>`;
}

function showTabNicknameDialog(win, payload = {}) {
  return new Promise((resolve) => {
    const requestId = `tab-nickname-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    let child = null;
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      ipcMain.removeListener("browser:tab-nickname-dialog-result", handleResult);

      if (child && !child.isDestroyed()) {
        child.destroy();
      }

      resolve(result || { action: "cancel" });
    };

    const handleResult = (_event, payloadResult) => {
      if (payloadResult?.requestId !== requestId) {
        return;
      }

      finish(payloadResult.result);
    };

    ipcMain.on("browser:tab-nickname-dialog-result", handleResult);

    child = new BrowserWindow({
      parent: win,
      modal: true,
      show: false,
      width: 420,
      height: 220,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      title: "Nickname tab",
      backgroundColor: "#232323",
      webPreferences: {
        preload: path.join(__dirname, "dialog-preload.js"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    });

    child.once("ready-to-show", () => {
      if (!child.isDestroyed()) {
        child.show();
      }
    });

    child.on("closed", () => {
      child = null;
      finish({ action: "cancel" });
    });

    const html = buildTabNicknameDialogHtml(requestId, payload);
    child.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}

function buildTabGroupDialogHtml(requestId, payload = {}) {
  const value = escapeHtml(payload.value || "");
  const title = escapeHtml(payload.title || "Tab group");
  const heading = escapeHtml(payload.heading || "Name tab group");
  const description = escapeHtml(payload.description || "Tabs in the same group reuse one persistent session profile.");
  const confirmLabel = escapeHtml(payload.confirmLabel || "Save");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Segoe UI", Arial, sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: #232323;
        color: #ffffff;
      }
      body {
        padding: 18px;
      }
      .card {
        width: 100%;
        height: 100%;
        display: grid;
        gap: 14px;
        align-content: start;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .close {
        border: 0;
        background: transparent;
        color: #fff;
        cursor: pointer;
        font-size: 1.3rem;
        line-height: 1;
        padding: 0 4px;
      }
      label {
        display: grid;
        gap: 8px;
        font-size: 0.95rem;
        color: #d3d3d3;
      }
      input {
        width: 100%;
        border: 1px solid #6b7280;
        border-radius: 12px;
        background: #2b2b2b;
        color: #fff;
        padding: 10px 12px;
        min-height: 42px;
        outline: none;
      }
      input:focus {
        border-color: #f0a202;
        box-shadow: 0 0 0 1px #f0a202;
      }
      .note {
        color: #b8bec8;
        font-size: 0.92rem;
        line-height: 1.5;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 8px;
      }
      button {
        border: 1px solid #5a5a5a;
        border-radius: 12px;
        background: #4a4a4a;
        color: #fff;
        padding: 10px 16px;
        cursor: pointer;
        font-size: 0.95rem;
      }
      button.primary {
        background: #f3f4f6;
        border-color: #f3f4f6;
        color: #111827;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="head">
        <strong>${heading}</strong>
        <button id="close-button" class="close" type="button" aria-label="Close">x</button>
      </div>
      <label>
        <span>Group name</span>
        <input id="group-name-input" type="text" value="${value}" placeholder="Enter a group name" />
      </label>
      <div class="note">${description}</div>
      <div class="actions">
        <button id="cancel-button" type="button">Cancel</button>
        <button id="save-button" class="primary" type="button">${confirmLabel}</button>
      </div>
    </div>
    <script>
      const requestId = ${JSON.stringify(requestId)};
      const input = document.getElementById("group-name-input");
      const closeButton = document.getElementById("close-button");
      const cancelButton = document.getElementById("cancel-button");
      const saveButton = document.getElementById("save-button");

      const send = (result) => {
        window.dialogAPI.sendTabGroupDialogResult({
          requestId,
          result
        });
      };

      closeButton.addEventListener("click", () => send({ action: "cancel" }));
      cancelButton.addEventListener("click", () => send({ action: "cancel" }));
      saveButton.addEventListener("click", () => send({ action: "save", name: input.value.trim() }));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          saveButton.click();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeButton.click();
        }
      });
      window.addEventListener("DOMContentLoaded", () => {
        input.focus();
        input.select();
      });
    </script>
  </body>
</html>`;
}

function showTabGroupDialog(win, payload = {}) {
  return new Promise((resolve) => {
    const requestId = `tab-group-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    let child = null;
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      ipcMain.removeListener("browser:tab-group-dialog-result", handleResult);

      if (child && !child.isDestroyed()) {
        child.destroy();
      }

      resolve(result || { action: "cancel" });
    };

    const handleResult = (_event, payloadResult) => {
      if (payloadResult?.requestId !== requestId) {
        return;
      }

      finish(payloadResult.result);
    };

    ipcMain.on("browser:tab-group-dialog-result", handleResult);

    child = new BrowserWindow({
      parent: win,
      modal: true,
      show: false,
      width: 430,
      height: 240,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      title: payload.title || "Tab group",
      backgroundColor: "#232323",
      webPreferences: {
        preload: path.join(__dirname, "dialog-preload.js"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    });

    child.once("ready-to-show", () => {
      if (!child.isDestroyed()) {
        child.show();
      }
    });

    child.on("closed", () => {
      child = null;
      finish({ action: "cancel" });
    });

    const html = buildTabGroupDialogHtml(requestId, payload);
    child.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}

function buildBrowserHistoryHtml() {
  const entries = getBrowserHistory()
    .sort((left, right) => Number(right.lastVisited || 0) - Number(left.lastVisited || 0))
    .slice(0, 100);

  const items = entries.length
    ? entries.map((entry) => `
        <a class="history-item" href="${entry.url}">
          <strong>${entry.title || entry.url}</strong>
          <span>${entry.url}</span>
          <small>Visited ${new Date(entry.lastVisited || Date.now()).toLocaleString()} · ${entry.visitCount || 1} visit(s)</small>
        </a>
      `).join("")
    : `<div class="history-empty">No browser history yet.</div>`;

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>History</title>
      <style>
        body { font-family: "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #f3f1ee; color: #17212b; }
        h1 { margin: 0 0 16px; }
        .history-list { display: grid; gap: 12px; }
        .history-item, .history-empty {
          display: grid; gap: 6px; padding: 14px 16px; border-radius: 14px; text-decoration: none;
          border: 1px solid #ddd7d1; background: rgba(255,255,255,0.88); color: inherit;
        }
        .history-item:hover { border-color: #58bf7b; box-shadow: 0 12px 24px rgba(20,34,45,0.08); }
        .history-item span, .history-item small, .history-empty { color: #6b7280; }
      </style>
    </head>
    <body>
      <h1>History</h1>
      <div class="history-list">${items}</div>
    </body>
  </html>`;
}

function openHistoryTab(win) {
  createBrowserTab(win, `data:text/html;charset=utf-8,${encodeURIComponent(buildBrowserHistoryHtml())}`, "auto", true);
}

function getActiveWebContents(win) {
  return getActiveBrowserTab(win)?.view?.webContents || null;
}

function adjustZoom(win, delta) {
  const webContents = getActiveWebContents(win);
  if (!webContents) {
    return 1;
  }

  const nextZoom = Math.min(3, Math.max(0.3, webContents.getZoomFactor() + delta));
  webContents.setZoomFactor(nextZoom);
  return nextZoom;
}

function resetZoom(win) {
  const webContents = getActiveWebContents(win);
  if (!webContents) {
    return 1;
  }

  webContents.setZoomFactor(1);
  return 1;
}

function getZoomLabel(win) {
  const webContents = getActiveWebContents(win);
  const zoomFactor = webContents ? webContents.getZoomFactor() : 1;
  return `${Math.round(zoomFactor * 100)}%`;
}

async function saveBrowserScreenshot(win) {
  const webContents = getActiveWebContents(win);
  if (!webContents) {
    emitBrowserNotice(win, { type: "error", message: "Open a page before taking a screenshot." });
    return;
  }

  const targetUrl = getActiveBrowserTab(win)?.url || "page";
  const suggestedName = `screenshot-${Date.now()}.png`;
  const result = await dialog.showSaveDialog(win, {
    title: "Save screenshot",
    defaultPath: path.join(app.getPath("pictures"), suggestedName),
    filters: [{ name: "PNG Image", extensions: ["png"] }]
  });

  if (result.canceled || !result.filePath) {
    return;
  }

  const image = await webContents.capturePage();
  fs.writeFileSync(result.filePath, image.toPNG());
  emitBrowserNotice(win, {
    type: "success",
    message: `Saved screenshot for ${targetUrl} to ${result.filePath}.`
  });
}

function clearActiveBrowserData(win) {
  clearBrowserHistory();
  const state = getBrowserState(win);
  state.downloads = state.downloads.filter((item) => item.status === "progressing");
  const settings = getSettings();
  settings.browserPermissions = {};
  saveSettings(settings);
  emitBrowserState(win);
  emitBrowserNotice(win, {
    type: "success",
    message: "Cleared browser history, finished downloads, and saved permissions."
  });
}

function showBrowserAppMenu(win, position = {}) {
  const activeTab = getActiveBrowserTab(win);
  const activeUrl = activeTab?.url || getDefaultStartupUrl();

  const menu = Menu.buildFromTemplate([
    {
      label: "New tab",
      accelerator: "Ctrl+T",
      click: () => createBrowserTab(win, getDefaultStartupUrl(), "auto", true)
    },
    {
      label: "New window",
      accelerator: "Ctrl+N",
      click: () => createWindow({ startupUrl: getDefaultStartupUrl(), startupMode: "auto" })
    },
    {
      label: "New InPrivate window",
      accelerator: "Ctrl+Shift+N",
      click: () => createWindow({ startupUrl: getDefaultStartupUrl(), startupMode: "isolated" })
    },
    { type: "separator" },
    {
      label: `Zoom (${getZoomLabel(win)})`,
      submenu: [
        { label: "Zoom in", accelerator: "Ctrl+=", click: () => adjustZoom(win, 0.1) },
        { label: "Zoom out", accelerator: "Ctrl+-", click: () => adjustZoom(win, -0.1) },
        { label: "Reset zoom", accelerator: "Ctrl+0", click: () => resetZoom(win) }
      ]
    },
    { type: "separator" },
    {
      label: "Favorites",
      accelerator: "Ctrl+Shift+O",
      click: () => emitBrowserMenuCommand(win, { action: "favorites" })
    },
    {
      label: "History",
      accelerator: "Ctrl+H",
      click: () => openHistoryTab(win)
    },
    {
      label: "Tab groups",
      submenu: buildWindowTabGroupsMenu(win)
    },
    {
      label: "Downloads",
      accelerator: "Ctrl+J",
      click: () => emitBrowserMenuCommand(win, { action: "downloads" })
    },
    {
      label: "Extensions",
      submenu: [
        {
          label: "Manage extensions",
          click: () => emitBrowserMenuCommand(win, { action: "extensions" })
        },
        {
          label: "Install extension from folder",
          click: () => emitBrowserMenuCommand(win, { action: "extensions-install-folder" })
        },
        {
          label: "Install extension from zip",
          click: () => emitBrowserMenuCommand(win, { action: "extensions-install-zip" })
        }
      ]
    },
    {
      label: "Passwords",
      click: () => emitBrowserMenuCommand(win, { action: "passwords" })
    },
    { type: "separator" },
    {
      label: "Delete browsing data",
      accelerator: "Ctrl+Shift+Delete",
      click: () => clearActiveBrowserData(win)
    },
    {
      label: "Print",
      accelerator: "Ctrl+P",
      click: () => getActiveWebContents(win)?.print({ printBackground: true })
    },
    {
      label: "Translate",
      enabled: false
    },
    {
      label: "Split screen",
      click: () => createWindow({ splitScreen: true, startupUrl: activeUrl, startupMode: activeTab?.mode || "auto" })
    },
    {
      label: "Screenshot",
      accelerator: "Ctrl+Shift+S",
      click: () => void saveBrowserScreenshot(win)
    },
    {
      label: "Find on page",
      accelerator: "Ctrl+F",
      click: () => emitBrowserMenuCommand(win, { action: "find" })
    },
    {
      label: "More tools",
      submenu: [
        { label: "Developer tools", click: () => getActiveWebContents(win)?.openDevTools({ mode: "detach" }) },
        { label: "View source", click: () => createBrowserTab(win, `view-source:${activeUrl}`, "auto", true) }
      ]
    },
    { type: "separator" },
    {
      label: "Settings",
      click: () => emitBrowserMenuCommand(win, { action: "settings" })
    },
    {
      label: "Help and feedback",
      submenu: [
        { label: "Open README", click: () => void shell.openPath(path.join(__dirname, "README.md")) },
        { label: "About WP Desktop", click: () => emitBrowserNotice(win, { type: "info", message: "WP Desktop: local WordPress browser and installer." }) }
      ]
    },
    { type: "separator" },
    {
      label: "Close WP Desktop",
      click: () => app.quit()
    }
  ]);

  menu.popup({
    window: win,
    x: typeof position.x === "number" ? Math.round(position.x) : undefined,
    y: typeof position.y === "number" ? Math.round(position.y) : undefined
  });
}

function showBrowserTabContextMenu(win, tabId) {
  const state = getBrowserState(win);
  const tab = findTabById(win, tabId);
  if (!tab) {
    return false;
  }

  const currentGroup = getTabGroupForTab(state, tab);
  const index = state.tabs.findIndex((item) => item.id === tab.id);
  const hasOtherTabs = state.tabs.length > 1;
  const hasTabsToRight = index >= 0 && index < state.tabs.length - 1;
  const availableGroups = state.tabGroups.filter((group) => group.id !== currentGroup?.id);

  const menu = Menu.buildFromTemplate([
    {
      label: "New tab to the right",
      click: () => createBrowserTab(win, getDefaultStartupUrl(), tab.mode || "auto", true, index + 1, {
        groupId: tab.groupId || null
      })
    },
    {
      label: currentGroup ? `Tab group: ${currentGroup.name}` : "Tab groups",
      submenu: [
        {
          label: "Create new group from tab",
          click: async () => {
            const result = await showTabGroupDialog(win, {
              title: "Create tab group",
              heading: "Create a tab group",
              value: tab.nickname || tab.title || "",
              confirmLabel: "Create"
            });

            if (result?.action === "save") {
              createTabGroupFromTab(win, tab.id, result.name);
            }
          }
        },
        {
          label: "Add to existing group",
          enabled: availableGroups.length > 0,
          submenu: availableGroups.length > 0
            ? availableGroups.map((group) => ({
                label: `${group.name} (${state.tabs.filter((item) => item.groupId === group.id).length} tab${state.tabs.filter((item) => item.groupId === group.id).length === 1 ? "" : "s"})`,
                click: () => moveTabToGroup(win, tab.id, group.id)
              }))
            : [{ label: "No other groups", enabled: false }]
        },
        {
          label: "Remove from current group",
          enabled: Boolean(currentGroup),
          click: () => removeTabFromGroup(win, tab.id)
        },
        { type: "separator" },
        {
          label: "Rename current group",
          enabled: Boolean(currentGroup),
          click: async () => {
            if (!currentGroup) {
              return;
            }

            const result = await showTabGroupDialog(win, {
              title: "Rename tab group",
              heading: "Rename current tab group",
              value: currentGroup.name,
              confirmLabel: "Save"
            });

            if (result?.action === "save") {
              renameTabGroup(win, currentGroup.id, result.name);
            }
          }
        },
        {
          label: "New tab in current group",
          enabled: Boolean(currentGroup),
          click: () => {
            if (!currentGroup) {
              return;
            }

            createBrowserTab(win, getDefaultStartupUrl(), tab.mode || "auto", true, index + 1, {
              groupId: currentGroup.id
            });
          }
        },
        {
          label: "Delete current group",
          enabled: Boolean(currentGroup),
          click: () => {
            if (currentGroup) {
              dissolveTabGroup(win, currentGroup.id);
            }
          }
        }
      ]
    },
    { type: "separator" },
    {
      label: "Refresh",
      accelerator: "Ctrl+R",
      click: () => {
        activateBrowserTab(win, tab.id);
        reloadActive(win);
      }
    },
    {
      label: "Duplicate tab",
      accelerator: "Ctrl+Shift+K",
      click: () => duplicateBrowserTab(win, tab.id)
    },
    {
      label: "Move tab to",
      submenu: [
        {
          label: "Start",
          enabled: index > 0,
          click: () => reorderTab(win, tab.id, 0)
        },
        {
          label: "End",
          enabled: hasTabsToRight,
          click: () => reorderTab(win, tab.id, state.tabs.length - 1)
        },
        {
          label: "New window",
          click: () => createWindow({ startupUrl: tab.url, startupMode: tab.mode || "auto" })
        }
      ]
    },
    {
      label: tab.pinned ? "Unpin tab" : "Pin tab",
      click: () => setTabPinned(win, tab.id, !tab.pinned)
    },
    {
      label: tab.muted ? "Unmute tab" : "Mute tab",
      accelerator: "Ctrl+M",
      click: () => setTabMuted(win, tab.id, !tab.muted)
    },
    {
      label: "Nickname tab",
      click: async () => {
        const result = await showTabNicknameDialog(win, {
          nickname: tab.nickname || "",
          title: tab.title || tab.url
        });

        if (result?.action === "save") {
          setTabNickname(win, tab.id, result.nickname || "");
        }
      }
    },
    { type: "separator" },
    {
      label: "Send tab to your devices",
      enabled: false
    },
    {
      label: "Reopen closed tab",
      accelerator: "Ctrl+Shift+T",
      enabled: state.closedTabs.length > 0,
      click: () => reopenClosedBrowserTab(win)
    },
    {
      label: "Turn on vertical tabs",
      enabled: false
    },
    { type: "separator" },
    {
      label: "Close tab",
      accelerator: "Ctrl+W",
      click: () => closeBrowserTab(win, tab.id)
    },
    {
      label: "Close other tabs",
      enabled: hasOtherTabs,
      click: () => {
        state.tabs
          .filter((item) => item.id !== tab.id)
          .map((item) => item.id)
          .forEach((id) => closeBrowserTab(win, id));
      }
    },
    {
      label: "Close tabs to the right",
      enabled: hasTabsToRight,
      click: () => {
        state.tabs
          .slice(index + 1)
          .map((item) => item.id)
          .forEach((id) => closeBrowserTab(win, id));
      }
    },
    {
      label: "More tools",
      submenu: [
        {
          label: "Open in new window",
          click: () => createWindow({ startupUrl: tab.url, startupMode: tab.mode || "auto" })
        },
        {
          label: "Open in InPrivate window",
          click: () => createWindow({ startupUrl: tab.url, startupMode: "isolated" })
        },
        {
          label: "Copy tab URL",
          click: () => clipboard.writeText(tab.url)
        }
      ]
    }
  ]);

  menu.popup({ window: win });
  return true;
}

function sendUrlToWindow(win, startupUrl, startupMode = "auto") {
  if (!win || win.isDestroyed() || !startupUrl) {
    return;
  }

  createBrowserTab(win, startupUrl, startupMode, true);
  win.webContents.send("browser:focus");
}

function buildWindowTabGroupsMenu(win) {
  const state = getBrowserState(win);
  if (!state.tabGroups.length) {
    return [{ label: "No groups yet", enabled: false }];
  }

  return state.tabGroups.map((group) => {
    const groupTabs = state.tabs.filter((tab) => tab.groupId === group.id);
    return {
      label: `${group.name} (${groupTabs.length})`,
      submenu: [
        {
          label: "Open new tab in this group",
          click: () => createBrowserTab(win, getDefaultStartupUrl(), "auto", true, null, { groupId: group.id })
        },
        {
          label: "Rename group",
          click: async () => {
            const result = await showTabGroupDialog(win, {
              title: "Rename tab group",
              heading: "Rename tab group",
              value: group.name,
              confirmLabel: "Save"
            });

            if (result?.action === "save") {
              renameTabGroup(win, group.id, result.name);
            }
          }
        },
        {
          label: "Delete group",
          click: () => dissolveTabGroup(win, group.id)
        }
      ]
    };
  });
}

function openSiteShell(targetPath) {
  const resolved = path.resolve(targetPath);
  spawn("cmd.exe", ["/K", `cd /d "${resolved}"`], {
    cwd: resolved,
    detached: true,
    stdio: "ignore",
    windowsHide: false
  }).unref();
}

function getApacheScriptPaths(settings = getSettings()) {
  const serverPaths = getLocalServerPathsSummary(settings);
  if (!serverPaths.apacheStartPath || !serverPaths.apacheStopPath) {
    return null;
  }

  return {
    startPath: serverPaths.apacheStartPath,
    stopPath: serverPaths.apacheStopPath
  };
}

function runDetachedBatch(batchPath) {
  spawn("cmd.exe", ["/c", `"${batchPath}"`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  }).unref();
}

async function performSiteMenuAction(win, site, action) {
  if (!site) {
    return;
  }

  if (action === "open-site") {
    createBrowserTab(win, site.siteUrl, "auto", true);
    win.webContents.send("browser:focus");
    return;
  }

  if (action === "open-admin") {
    createBrowserTab(win, site.adminUrl || site.siteUrl, "auto", true);
    win.webContents.send("browser:focus");
    return;
  }

  if (action === "site-folder") {
    await shell.openPath(site.path);
    return;
  }

  if (action === "site-shell") {
    openSiteShell(site.path);
    return;
  }

  if (action === "delete") {
    await deleteSiteResources({ site });
    emitSitesChanged(win);
    return;
  }

  const apacheScripts = getApacheScriptPaths(getSettings());
  if (!apacheScripts) {
    return;
  }

  if (action === "start") {
    runDetachedBatch(apacheScripts.startPath);
    emitSitesChanged(win);
    return;
  }

  if (action === "stop") {
    runDetachedBatch(apacheScripts.stopPath);
    emitSitesChanged(win);
    return;
  }

  if (action === "restart") {
    runDetachedBatch(apacheScripts.stopPath);
    setTimeout(() => runDetachedBatch(apacheScripts.startPath), 1200);
    emitSitesChanged(win);
  }
}

function showSiteContextMenu(win, site) {
  const apacheScripts = getApacheScriptPaths(getSettings());
  const canManageApache = Boolean(apacheScripts);
  const template = [
    {
      label: "Open site",
      click: () => void performSiteMenuAction(win, site, "open-site")
    },
    {
      label: "Admin dashboard",
      click: () => void performSiteMenuAction(win, site, "open-admin")
    },
    { type: "separator" },
    {
      label: "Site folder",
      click: () => void performSiteMenuAction(win, site, "site-folder")
    },
    {
      label: "Site shell",
      click: () => void performSiteMenuAction(win, site, "site-shell")
    },
    { type: "separator" },
    {
      label: "Restart",
      enabled: canManageApache,
      click: () => void performSiteMenuAction(win, site, "restart")
    },
    {
      label: "Stop",
      enabled: canManageApache,
      click: () => void performSiteMenuAction(win, site, "stop")
    },
    {
      label: "Start",
      enabled: canManageApache,
      click: () => void performSiteMenuAction(win, site, "start")
    },
    { type: "separator" },
    {
      label: "Clone site",
      enabled: false
    },
    {
      label: "Export",
      enabled: false
    },
    {
      label: "Save as Blueprint",
      enabled: false
    },
    { type: "separator" },
    {
      label: "Move to new group",
      enabled: false
    },
    { type: "separator" },
    {
      label: "Change domain",
      enabled: false
    },
    {
      label: "Rename",
      enabled: false
    },
    { type: "separator" },
    {
      label: "Delete",
      click: () => void performSiteMenuAction(win, site, "delete")
    }
  ];

  Menu.buildFromTemplate(template).popup({ window: win });
}

function createWindow(options = {}) {
  const isSplit = Boolean(options.splitScreen);
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: isSplit ? Math.floor(workArea.width / 2) : 1440,
    height: isSplit ? workArea.height : 920,
    minWidth: 1100,
    minHeight: 760,
    icon: path.join(__dirname, "wp desktop.ico"),
    backgroundColor: "#f3f1ee",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  if (isSplit) {
    win.setPosition(workArea.x + Math.floor(workArea.width / 2), workArea.y);
  }

  getBrowserState(win);
  win.loadFile(path.join(__dirname, "src", "index.html"));
  win.on("focus", () => {
    lastFocusedWindow = win;
  });
  win.on("enter-full-screen", () => {
    win.webContents.send("browser:fullscreen-changed", true);
  });
  win.on("leave-full-screen", () => {
    win.webContents.send("browser:fullscreen-changed", false);
  });
  win.on("closed", () => {
    const state = browserWindows.get(win.id);
    state?.tabs.forEach((tab) => tab.view.webContents.close({ waitForBeforeUnload: false }));
    browserWindows.delete(win.id);
  });
  win.webContents.once("did-finish-load", () => {
    createBrowserTab(win, options.startupUrl || getDefaultStartupUrl(), options.startupMode || "auto", true);
  });
  lastFocusedWindow = win;
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", (_event, argv) => {
  const launchUrl = findLaunchUrl(argv);
  const target = lastFocusedWindow || BrowserWindow.getAllWindows()[0];
  if (!target) {
    createWindow({ startupUrl: launchUrl || getDefaultStartupUrl() });
    return;
  }

  if (target.isMinimized()) {
    target.restore();
  }
  target.focus();

  if (launchUrl) {
    sendUrlToWindow(target, launchUrl);
  }
});

app.whenReady().then(() => {
  createWindow({ startupUrl: findLaunchUrl() || getDefaultStartupUrl() });
  startEmbeddedMcpServer().catch((error) => {
    embeddedMcpState.lastError = error.message || "Embedded MCP server failed to start.";
  });
  const settings = getSettings();
  if (settings.sftpServer?.enabled) {
    startLocalSftpServer(settings.sftpServer).catch((error) => {
      localSftpServerState.lastError = error.message || "SFTP server failed to start.";
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({ startupUrl: getDefaultStartupUrl() });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (embeddedMcpRuntime) {
      void stopEmbeddedMcpServer();
    }
    if (localSftpServer) {
      localSftpServer.close();
      localSftpServer = null;
    }
    app.quit();
  }
});

app.on("login", (event, _webContents, details, authInfo, callback) => {
  const urlKey = (() => {
    try {
      return new URL(details?.url || details?.requestingUrl || "").origin;
    } catch (_) {
      return null;
    }
  })();
  const authKey = `${authInfo.host}:${authInfo.port || ""}:${authInfo.realm || ""}`;
  const vault = getVault();
  const saved = getPreferredVaultCredential(vault, urlKey) || getPreferredVaultCredential(vault, authKey);

  if (!saved) {
    return;
  }

  event.preventDefault();
  callback(saved.username, saved.password);
});

ipcMain.handle("dialog:pick-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select folder",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("dialog:pick-zip", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select WordPress zip",
    properties: ["openFile"],
    filters: [{ name: "Zip archives", extensions: ["zip"] }]
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("dialog:pick-extension-archive", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select extension zip",
    properties: ["openFile"],
    filters: [{ name: "Zip archives", extensions: ["zip"] }]
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("dialog:pick-workspace-resource", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select workspace resource",
    properties: ["openFile"],
    filters: [
      { name: "Supported files", extensions: ["xlsx", "xls", "csv", "png", "jpg", "jpeg", "gif", "webp", "svg", "mp4", "webm", "mp3", "wav", "pdf", "doc", "docx", "ppt", "pptx"] },
      { name: "Excel and spreadsheets", extensions: ["xlsx", "xls", "csv"] },
      { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
      { name: "Media", extensions: ["mp4", "webm", "mp3", "wav"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("dialog:save-backup", async (_event, siteName) => {
  const result = await dialog.showSaveDialog({
    title: "Save site backup",
    defaultPath: getBackupDefaultPath(siteName),
    filters: [{ name: "Zip archives", extensions: ["zip"] }]
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  return result.filePath;
});

ipcMain.handle("browser:create-tab", (event, { url, mode }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    createBrowserTab(win, url, mode || "auto", true);
  }
});

ipcMain.handle("browser:activate-tab", (event, tabId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    activateBrowserTab(win, tabId);
  }
});

ipcMain.handle("browser:close-tab", (event, tabId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    closeBrowserTab(win, tabId);
  }
});

ipcMain.handle("browser:navigate", (event, url) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    navigateActiveBrowserTab(win, url);
  }
});

ipcMain.handle("browser:get-suggestions", async (event, query) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return [];
  }

  return getBrowserSuggestions(win, query);
});

ipcMain.handle("browser:go-back", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    goBack(win);
  }
});

ipcMain.handle("browser:go-forward", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    goForward(win);
  }
});

ipcMain.handle("browser:reload", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    reloadActive(win);
  }
});

ipcMain.handle("browser:autofill-credentials", async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return { ok: false, message: "Browser window not found." };
  }

  return autofillActiveBrowserTab(win, payload || {});
});

ipcMain.handle("browser:show-app-menu", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return false;
  }

  showBrowserAppMenu(win, payload || {});
  return true;
});

ipcMain.handle("browser:find-in-page", (event, text) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const webContents = win ? getActiveWebContents(win) : null;
  const query = String(text || "").trim();
  if (!webContents || !query) {
    return false;
  }

  webContents.findInPage(query, { findNext: false, forward: true });
  return true;
});

ipcMain.handle("browser:update-layout", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return;
  }

  const state = getBrowserState(win);
  state.browserVisible = Boolean(payload.visible);
  state.browserBounds = payload.visible
    ? {
        x: Math.round(payload.x),
        y: Math.round(payload.y),
        width: Math.max(1, Math.round(payload.width)),
        height: Math.max(1, Math.round(payload.height))
      }
    : null;

  attachActiveView(win);
});

ipcMain.handle("browser:pick-download-directory", async () => {
  const selected = await dialog.showOpenDialog({
    title: "Select downloads folder",
    properties: ["openDirectory", "createDirectory"]
  });

  if (selected.canceled || !selected.filePaths[0]) {
    return null;
  }

  return setDownloadDirectory(selected.filePaths[0]);
});

ipcMain.handle("browser:open-download", async (event, downloadId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const record = win ? findDownloadRecord(win, downloadId) : null;
  if (!record?.savePath || !fs.existsSync(record.savePath)) {
    throw new Error("Download file was not found.");
  }

  const result = await shell.openPath(record.savePath);
  if (result) {
    throw new Error(result);
  }

  return true;
});

ipcMain.handle("browser:show-download", async (event, downloadId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const record = win ? findDownloadRecord(win, downloadId) : null;
  if (!record?.savePath || !fs.existsSync(record.savePath)) {
    throw new Error("Download file was not found.");
  }

  shell.showItemInFolder(record.savePath);
  return true;
});

ipcMain.handle("browser:clear-downloads", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return false;
  }

  const state = getBrowserState(win);
  state.downloads = state.downloads.filter((item) => item.status === "progressing");
  emitBrowserState(win);
  return true;
});

ipcMain.handle("browser:clear-permission", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const changed = clearPermissionDecision(payload?.origin, payload?.permission);
  if (win && changed) {
    emitBrowserState(win);
  }
  return changed;
});

ipcMain.handle("browser:add-bookmark", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const bookmark = saveBrowserBookmark(payload || {});
  if (win) {
    emitBrowserState(win);
  }
  return bookmark;
});

ipcMain.handle("browser:add-bookmark-folder", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const folder = createBrowserBookmarkFolder(payload || {});
  if (win) {
    emitBrowserState(win);
  }
  return folder;
});

ipcMain.handle("browser:remove-bookmark", (event, bookmarkId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const changed = removeBrowserBookmark(bookmarkId);
  if (win && changed) {
    emitBrowserState(win);
  }
  return changed;
});

ipcMain.handle("browser:update-bookmark", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const bookmark = updateBrowserBookmark(payload?.id, payload);
  if (win) {
    emitBrowserState(win);
  }
  return bookmark;
});

ipcMain.handle("browser:move-bookmark", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const bookmark = moveBrowserBookmark(payload?.id, payload || {});
  if (win) {
    emitBrowserState(win);
  }
  return bookmark;
});

ipcMain.handle("browser:copy-bookmark", (event, bookmarkId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const bookmark = copyBrowserBookmark(bookmarkId, false);
  if (win) {
    emitBrowserState(win);
  }
  return bookmark;
});

ipcMain.handle("browser:cut-bookmark", (event, bookmarkId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const bookmark = copyBrowserBookmark(bookmarkId, true);
  if (win) {
    emitBrowserState(win);
  }
  return bookmark;
});

ipcMain.handle("browser:paste-bookmark", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const bookmark = pasteBrowserBookmark();
  if (win) {
    emitBrowserState(win);
  }
  return bookmark;
});

ipcMain.handle("browser:set-bookmarks-bar-visible", (event, visible) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const nextVisible = setBrowserShowBookmarksBar(visible);
  if (win) {
    emitBrowserState(win);
  }
  return nextVisible;
});

ipcMain.handle("browser:create-window", (_event, payload) => {
  createWindow({
    startupUrl: payload?.url || getDefaultStartupUrl(),
    startupMode: payload?.mode || "auto"
  });
  return true;
});

ipcMain.handle("browser:show-bookmark-context-menu", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !payload?.bookmark?.id) {
    return false;
  }

  if (payload.bookmark.type === "folder") {
    showBookmarkFolderContextMenu(win, payload.bookmark, payload.showBookmarksBar !== false);
  } else {
    if (!payload.bookmark.url) {
      return false;
    }
    showBookmarkContextMenu(win, payload.bookmark, payload.showBookmarksBar !== false);
  }
  return true;
});

ipcMain.handle("browser:open-extension-popup", (event, extensionId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !extensionId) {
    return false;
  }
  return openBrowserExtensionPopup(win, extensionId);
});

ipcMain.handle("browser:show-tab-context-menu", (event, tabId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !tabId) {
    return false;
  }

  return showBrowserTabContextMenu(win, tabId);
});

ipcMain.handle("browser:set-tab-nickname", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !payload?.tabId) {
    return false;
  }

  return setTabNickname(win, payload.tabId, payload.nickname || "");
});

ipcMain.handle("browser:save-tab-session", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return { ok: false, message: "Browser window not found." };
  }

  const state = getBrowserState(win);
  const activeTabId = payload?.tabId || state.activeTabId;
  return saveCurrentTabSession(win, activeTabId, { autoSave: payload?.autoSave === true });
});

ipcMain.handle("browser:unsave-tab-session", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return { ok: false, message: "Browser window not found." };
  }

  const state = getBrowserState(win);
  const activeTabId = payload?.tabId || state.activeTabId;
  return unsaveCurrentTabSession(win, activeTabId);
});

ipcMain.handle("browser:show-bookmark-save-dialog", async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return { action: "cancel" };
  }

  return showBookmarkSaveDialog(win, payload || {});
});

ipcMain.handle("db:test", async (_event, config) => {
  const settings = getSettings();
  const effective = getEffectiveDbProfile(settings);
  const connection = await mysql.createConnection({
    host: config?.host || effective.host,
    port: Number(config?.port || effective.port) || 3306,
    user: config?.user || effective.user,
    password: config?.password ?? effective.password
  });

  const [rows] = await connection.query("SELECT VERSION() AS version");
  await connection.end();

  return { ok: true, version: rows[0]?.version || "unknown" };
});

ipcMain.handle("vault:get-info", () => ({
  encryptionAvailable: safeStorage.isEncryptionAvailable(),
  storageBackend: process.platform === "linux"
    ? safeStorage.getSelectedStorageBackend()
    : process.platform === "win32"
      ? "dpapi"
      : process.platform
}));

ipcMain.handle("vault:get-installer-db", () => getVault().installerDb);

ipcMain.handle("vault:save-installer-db", (_event, profile) => {
  const vault = getVault();
  vault.installerDb = {
    host: profile.host || "127.0.0.1",
    port: String(profile.port || "3306"),
    user: profile.user || "root",
    password: profile.password || ""
  };
  saveVault(vault);
  return true;
});

ipcMain.handle("vault:clear-installer-db", () => {
  const vault = getVault();
  vault.installerDb = null;
  saveVault(vault);
  return true;
});

ipcMain.handle("vault:get-site-credentials", (_event, key) => {
  if (!key) {
    return null;
  }
  return serializeVaultCredentialResponse(getVault().siteCredentials[key], key);
});

let syncManager = null;

function getSyncManager() {
  if (!syncManager) {
    const SyncManager = require("./src/syncManager.js");
    syncManager = new SyncManager(app.getPath("userData"));
  }
  return syncManager;
}

ipcMain.handle("browser:toggle-fullscreen", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return false;
  }
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});

ipcMain.handle("meeting:get-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 }
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id || "",
    thumbnail: source.thumbnail.isEmpty() ? "" : source.thumbnail.toDataURL()
  }));
});

ipcMain.handle("sync:get-status", () => getSyncManager().getAuthStatus());

ipcMain.handle("sync:auth-google", (event) =>
  getSyncManager().authenticateGoogle(BrowserWindow.fromWebContents(event.sender))
);

ipcMain.handle("sync:auth-microsoft", (event) =>
  getSyncManager().authenticateMicrosoft(BrowserWindow.fromWebContents(event.sender))
);

ipcMain.handle("sync:disconnect-google", () => {
  getSyncManager().disconnectGoogle();
  return { ok: true };
});

ipcMain.handle("sync:disconnect-microsoft", () => {
  getSyncManager().disconnectMicrosoft();
  return { ok: true };
});

ipcMain.handle("vault:save-site-credentials", (_event, payload) => {
  const vault = getVault();
  const collection = saveVaultCredential(vault, payload);
  saveVault(vault);
  return serializeVaultCredentialResponse(collection, payload.key);
});

ipcMain.handle("vault:clear-site-credentials", (_event, payload) => {
  const key = typeof payload === "string" ? payload : payload?.key;
  const id = typeof payload === "string" ? "" : payload?.id || "";
  if (!key) {
    return true;
  }

  const vault = getVault();
  removeVaultCredential(vault, key, id);
  saveVault(vault);
  return true;
});

ipcMain.handle("settings:get", async () => {
  const settings = getSettings();
  return buildSettingsPayload(settings);
});

ipcMain.handle("mcp-server:get-status", () => getEmbeddedMcpStatus());

ipcMain.handle("mcp-server:start", async (_event, config = {}) => {
  const settings = getSettings();
  settings.mcpServer = {
    ...settings.mcpServer,
    ...config,
    enabled: true
  };
  saveSettings(settings);
  return startEmbeddedMcpServer(settings);
});

ipcMain.handle("mcp-server:stop", async () => {
  const settings = getSettings();
  settings.mcpServer = {
    ...settings.mcpServer,
    enabled: false
  };
  saveSettings(settings);
  return stopEmbeddedMcpServer();
});

ipcMain.handle("settings:set-htdocs", async (_event, htdocsPath) => {
  const settings = getSettings();
  settings.htdocsPath = htdocsPath || "";
  const derivedRootPath = getLocalServerRootFromDocumentRoot(settings.htdocsPath, settings.localServerType);
  if (derivedRootPath) {
    settings[getRootPathSettingKey(settings.localServerType)] = derivedRootPath;
  }
  saveSettings(settings);
  return buildSettingsPayload(settings);
});

ipcMain.handle("settings:set-local-server-type", async (_event, localServerType) => {
  const settings = getSettings();
  settings.localServerType = normalizeLocalServerType(localServerType);
  settings.htdocsPath = getDocumentRootFromRoot(
    getResolvedRootPath(settings, settings.localServerType),
    settings.localServerType
  );
  saveSettings(settings);
  return buildSettingsPayload(settings);
});

ipcMain.handle("settings:set-xampp-root", async (_event, xamppRootPath) => {
  const settings = getSettings();
  settings.xamppRootPath = xamppRootPath || "";
  settings.localServerType = "xampp";
  settings.htdocsPath = xamppRootPath ? getDocumentRootFromRoot(xamppRootPath, "xampp") : "";
  saveSettings(settings);
  return buildSettingsPayload(settings);
});

ipcMain.handle("settings:set-local-server-root", async (_event, payload) => {
  const settings = getSettings();
  const localServerType = normalizeLocalServerType(payload?.localServerType);
  const rootPath = String(payload?.rootPath || "").trim();
  settings.localServerType = localServerType;
  settings[getRootPathSettingKey(localServerType)] = rootPath;
  settings.htdocsPath = rootPath ? getDocumentRootFromRoot(rootPath, localServerType) : "";
  saveSettings(settings);
  return buildSettingsPayload(settings);
});

ipcMain.handle("settings:set-local-session-sharing", async (_event, enabled) => {
  const settings = getSettings();
  settings.shareLocalSiteSessions = enabled !== false;
  saveSettings(settings);
  return buildSettingsPayload(settings);
});

ipcMain.handle("settings:set-online-session-sharing", async (_event, enabled) => {
  const settings = getSettings();
  settings.shareOnlineSiteSessions = enabled === true;
  saveSettings(settings);
  return buildSettingsPayload(settings);
});

ipcMain.handle("settings:save-mysql-config", async (_event, payload) => {
  const settings = getSettings();
  const serverPaths = getLocalServerPathsSummary(settings);
  if (!serverPaths.mysqlConfigPath) {
    throw new Error("MySQL config file was not found.");
  }

  fs.writeFileSync(serverPaths.mysqlConfigPath, String(payload.content || ""), "utf8");
  settings.dbUser = String(payload.dbUser || "root").trim() || "root";
  settings.dbPassword = payload.dbPassword ?? "";
  settings.wpInstallUsername = String(payload.wpInstallUsername || "admin").trim() || "admin";
  settings.wpInstallPassword = payload.wpInstallPassword ?? "root";
  settings.wpInstallEmail = String(payload.wpInstallEmail || "").trim();
  saveSettings(settings);
  return buildSettingsPayload(settings);
});

ipcMain.handle("settings:set-session-autosave-scope", async (_event, payload) => {
  const settings = getSettings();
  const scope = payload?.scope === "local" ? "local" : "online";
  if (scope === "local") {
    settings.autoSaveLocalTabSessions = payload?.enabled === true;
  } else {
    settings.autoSaveOnlineTabSessions = payload?.enabled === true;
  }
  saveSettings(settings);
  return buildSettingsPayload(settings);
});

ipcMain.handle("settings:set-session-autosave-delay", async (_event, seconds) => {
  const settings = getSettings();
  settings.sessionAutoSaveDelaySeconds = Math.max(1, Number(seconds) || 5);
  saveSettings(settings);
  return buildSettingsPayload(settings);
});

ipcMain.handle("settings:save-wp-install-defaults", async (_event, payload) => {
  const settings = getSettings();
  settings.wpInstallUsername = String(payload?.wpInstallUsername || "admin").trim() || "admin";
  settings.wpInstallPassword = payload?.wpInstallPassword ?? "root";
  settings.wpInstallEmail = String(payload?.wpInstallEmail || "").trim();
  saveSettings(settings);
  return buildSettingsPayload(settings);
});

ipcMain.handle("settings:install-browser-extension-folder", async (_event, folderPath) => {
  const extension = await installBrowserExtensionFromFolder(folderPath);
  return {
    extension,
    settings: getSettings()
  };
});

ipcMain.handle("settings:install-browser-extension-archive", async (_event, archivePath) => {
  const extension = await installBrowserExtensionFromArchive(archivePath);
  return {
    extension,
    settings: getSettings()
  };
});

ipcMain.handle("settings:set-browser-extension-enabled", async (_event, payload) => {
  const extension = await setBrowserExtensionEnabled(payload?.id, payload?.enabled);
  return {
    extension,
    settings: getSettings()
  };
});

ipcMain.handle("settings:set-browser-extension-pinned", async (_event, payload) => {
  const extension = setBrowserExtensionPinned(payload?.id, payload?.pinned);
  return {
    extension,
    settings: getSettings()
  };
});

ipcMain.handle("settings:remove-browser-extension", async (_event, extensionId) => {
  const extension = await removeBrowserExtension(extensionId);
  return {
    extension,
    settings: getSettings()
  };
});

ipcMain.handle("sites:list", async () => buildSitesFromHtdocs());
ipcMain.handle("backups:list", async () => ({
  backups: listSiteBackups()
}));

ipcMain.handle("sites:backup", async (_event, payload) => {
  return backupSiteResources(payload);
});

ipcMain.handle("backups:restore", async (_event, payload) => {
  return restoreBackupPackage(payload);
});

ipcMain.handle("sites:apply-multisite-config", async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return applyMultisiteConfigForSiteFromWindow(win, payload?.siteId);
});

ipcMain.handle("sites:delete", async (_event, site) => {
  return deleteSiteResources(site);
});

ipcMain.handle("sites:show-context-menu", async (event, site) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    showSiteContextMenu(win, site);
  }
  return true;
});

ipcMain.handle("installer:run", async (_event, payload) => {
  const settings = getSettings();
  const serviceStatus = await getXamppServiceStatus(settings);
  if (!serviceStatus.apacheRunning || !serviceStatus.mysqlRunning) {
    const apachePortsLabel = serviceStatus.apachePorts.join(", ");
    throw new Error(
      `Start Apache on port ${apachePortsLabel} and MySQL on ${serviceStatus.mysqlHost}:${serviceStatus.mysqlPort} before using the installer.`
    );
  }
  const resolvedHtdocsPath = getResolvedHtdocsPath(settings);
  const basePath = (payload.basePath || resolvedHtdocsPath || "").trim();
  const folderName = (payload.folderName || "").trim();
  const zipPath = (payload.zipPath || "").trim();
  const multisiteEnabled = payload?.multisite?.enabled === true;

  if (!basePath) {
    throw new Error("Select a base folder.");
  }
  if (!zipPath || path.extname(zipPath).toLowerCase() !== ".zip") {
    throw new Error("Select a valid .zip file.");
  }
  if (!fs.existsSync(zipPath)) {
    throw new Error("The selected zip file no longer exists.");
  }

  const targetPath = folderName ? path.join(basePath, folderName) : basePath;
  ensureDir(targetPath);

  const logs = [`Target folder ready: ${targetPath}`];
  const extracted = extractZip({ zipPath, targetPath });
  logs.push(`Extracted ${extracted.extractedCount} files.`);

  const dbName = sanitizeDbName(path.basename(targetPath));
  const db = { created: false, name: dbName };
  const settingsDbProfile = getEffectiveDbProfile(settings);
  const databaseProfile = resolveDbProfile(payload.database || {}, settingsDbProfile);

  if (payload.database?.create) {
    const connection = await mysql.createConnection({
      host: databaseProfile.host,
      port: Number(databaseProfile.port) || 3306,
      user: databaseProfile.user,
      password: databaseProfile.password
    });

    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName.replace(/`/g, "")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.end();

    db.created = true;
    logs.push(`Database ready: ${dbName}`);
  }

  const siteName = path.basename(targetPath);
  const siteRecord = {
    id: siteName.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
    name: siteName,
    domain: `${siteName}.site`,
    path: targetPath,
    shellPath: targetPath,
    siteUrl: buildSiteUrl(targetPath),
    adminUrl: `${buildSiteUrl(targetPath).replace(/\/$/, "")}/wp-admin/install.php`,
    dbName,
    dbHost: databaseProfile.host,
    dbPort: String(databaseProfile.port),
    dbUser: databaseProfile.user,
    dbPassword: databaseProfile.password,
    databaseVersion: getLocalServerDatabaseLabel(),
    phpVersion: payload.phpVersion || getLocalServerPhpVersionLabel(),
    webServer: getLocalServerWebServerLabel(),
    wordpressVersion: payload.wordpressVersion || "From zip package",
    extractedCount: extracted.extractedCount,
    lastStartedAt: new Date().toISOString(),
    status: "running",
    sslPath: `${siteName}.crt`,
    isWordPress: true,
    multisite: {
      enabled: multisiteEnabled,
      prepared: false,
      networkConfigured: false
    }
  };

  if (multisiteEnabled) {
    logs.push("Multisite preparation enabled. WP_ALLOW_MULTISITE will be added after wp-config.php is created.");
  }


  const existingSites = getSites().filter((site) => site.id !== siteRecord.id);
  existingSites.unshift(siteRecord);
  saveSites(existingSites);

  return {
    ok: true,
    logs,
    targetPath,
    extractedCount: extracted.extractedCount,
    siteUrl: buildSiteUrl(targetPath),
    db,
    site: siteRecord
  };
});

ipcMain.handle("shell:open-external", async (_event, url) => {
  await shell.openExternal(url);
});

ipcMain.handle("shell:open-path", async (_event, targetPath) => {
  await shell.openPath(targetPath);
});

ipcMain.handle("workspace:copy-media", async (_event, targetPath) => {
  const resolvedPath = String(targetPath || "").trim();
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return { ok: false, message: "Media file was not found." };
  }

  const image = nativeImage.createFromPath(resolvedPath);
  if (image.isEmpty()) {
    clipboard.writeText(resolvedPath);
    return { ok: true, message: "Copied media path." };
  }

  clipboard.writeImage(image);
  return { ok: true, message: "Copied image to clipboard." };
});

ipcMain.handle("workspace:open-with", async (_event, targetPath) => {
  const resolvedPath = String(targetPath || "").trim();
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return { ok: false, message: "Media file was not found." };
  }

  if (process.platform === "win32") {
    return await new Promise((resolve) => {
      const child = spawn(
        path.join(process.env.WINDIR || "C:\\Windows", "System32", "rundll32.exe"),
        ["shell32.dll,OpenAs_RunDLL", resolvedPath],
        { windowsHide: true, detached: true, stdio: "ignore" }
      );

      child.on("error", (error) => {
        resolve({ ok: false, message: error.message || "Could not open the Open with dialog." });
      });

      child.unref();
      resolve({ ok: true, message: "Opened the Open with dialog." });
    });
  }

  await shell.openPath(resolvedPath);
  return { ok: true, message: "Opened the media file." };
});

function getSftpHostKeyPath() {
  return path.join(app.getPath("userData"), "sftp-host-key.pem");
}

function getOrCreateSftpHostKey() {
  const keyPath = getSftpHostKeyPath();
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath);
  }

  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  return Buffer.from(privateKey);
}

function getLocalSftpStatus(settings = getSettings()) {
  return {
    ...localSftpServerState,
    ...settings.sftpServer,
    running: Boolean(localSftpServer),
    clients: localSftpServerState.clients,
    lastError: localSftpServerState.lastError || ""
  };
}

function resolveSftpServerPath(rootPath, remotePath = "/") {
  const root = path.resolve(rootPath || "");
  const normalizedRemote = String(remotePath || "/").replace(/\\/g, "/");
  const relative = path.posix.normalize(`/${normalizedRemote}`).replace(/^\/+/, "");
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    const error = new Error("Path escapes the configured SFTP root.");
    error.code = "EACCES";
    throw error;
  }
  return target;
}

function toSftpAttrs(stats) {
  return {
    mode: stats.mode,
    uid: 0,
    gid: 0,
    size: stats.size,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000)
  };
}

function toSftpStatusCode(error) {
  if (!error) {
    return STATUS_CODE.OK;
  }
  if (error.code === "ENOENT") {
    return STATUS_CODE.NO_SUCH_FILE;
  }
  if (error.code === "EACCES" || error.code === "EPERM") {
    return STATUS_CODE.PERMISSION_DENIED;
  }
  return STATUS_CODE.FAILURE;
}

function fsFlagsFromSftpFlags(flags) {
  const canRead = Boolean(flags & OPEN_MODE.READ);
  const canWrite = Boolean(flags & OPEN_MODE.WRITE);
  const append = Boolean(flags & OPEN_MODE.APPEND);
  const create = Boolean(flags & OPEN_MODE.CREAT);
  const truncate = Boolean(flags & OPEN_MODE.TRUNC);
  const exclusive = Boolean(flags & OPEN_MODE.EXCL);

  if (append && canRead) return exclusive ? "ax+" : "a+";
  if (append) return exclusive ? "ax" : "a";
  if (canWrite && canRead) return truncate || create ? (exclusive ? "wx+" : "w+") : "r+";
  if (canWrite) return truncate || create ? (exclusive ? "wx" : "w") : "r+";
  return "r";
}

function makeSftpHandle(id) {
  const handle = Buffer.alloc(4);
  handle.writeUInt32BE(id, 0);
  return handle;
}

function readSftpHandle(handle, handles) {
  if (!Buffer.isBuffer(handle) || handle.length !== 4) {
    return null;
  }
  return handles.get(handle.readUInt32BE(0));
}

function attachLocalSftpHandlers(sftp, rootPath) {
  const handles = new Map();
  let nextHandleId = 1;

  function storeHandle(value) {
    const id = nextHandleId++;
    handles.set(id, value);
    return makeSftpHandle(id);
  }

  function sendFailure(reqid, error) {
    sftp.status(reqid, toSftpStatusCode(error));
  }

  function statPath(reqid, remotePath) {
    try {
      sftp.attrs(reqid, toSftpAttrs(fs.statSync(resolveSftpServerPath(rootPath, remotePath))));
    } catch (error) {
      sendFailure(reqid, error);
    }
  }

  sftp.on("REALPATH", (reqid, remotePath) => {
    try {
      const target = resolveSftpServerPath(rootPath, remotePath);
      const stats = fs.statSync(target);
      const filename = path.posix.normalize(`/${String(remotePath || "/").replace(/\\/g, "/")}`) || "/";
      sftp.name(reqid, [{ filename, longname: filename, attrs: toSftpAttrs(stats) }]);
    } catch (error) {
      sendFailure(reqid, error);
    }
  });

  sftp.on("STAT", statPath);
  sftp.on("LSTAT", statPath);

  sftp.on("FSTAT", (reqid, handle) => {
    const entry = readSftpHandle(handle, handles);
    if (!entry || entry.type !== "file") {
      return sftp.status(reqid, STATUS_CODE.FAILURE);
    }
    fs.fstat(entry.fd, (error, stats) => {
      if (error) return sendFailure(reqid, error);
      sftp.attrs(reqid, toSftpAttrs(stats));
    });
  });

  sftp.on("OPENDIR", (reqid, remotePath) => {
    try {
      const localPath = resolveSftpServerPath(rootPath, remotePath);
      const names = fs.readdirSync(localPath).map((filename) => {
        const itemPath = path.join(localPath, filename);
        const stats = fs.statSync(itemPath);
        return { filename, longname: filename, attrs: toSftpAttrs(stats) };
      });
      sftp.handle(reqid, storeHandle({ type: "dir", names, sent: false }));
    } catch (error) {
      sendFailure(reqid, error);
    }
  });

  sftp.on("READDIR", (reqid, handle) => {
    const entry = readSftpHandle(handle, handles);
    if (!entry || entry.type !== "dir") {
      return sftp.status(reqid, STATUS_CODE.FAILURE);
    }
    if (entry.sent) {
      return sftp.status(reqid, STATUS_CODE.EOF);
    }
    entry.sent = true;
    sftp.name(reqid, entry.names);
  });

  sftp.on("OPEN", (reqid, filename, flags) => {
    try {
      const localPath = resolveSftpServerPath(rootPath, filename);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.open(localPath, fsFlagsFromSftpFlags(flags), (error, fd) => {
        if (error) return sendFailure(reqid, error);
        sftp.handle(reqid, storeHandle({ type: "file", fd }));
      });
    } catch (error) {
      sendFailure(reqid, error);
    }
  });

  sftp.on("READ", (reqid, handle, offset, length) => {
    const entry = readSftpHandle(handle, handles);
    if (!entry || entry.type !== "file") {
      return sftp.status(reqid, STATUS_CODE.FAILURE);
    }
    const buffer = Buffer.alloc(length);
    fs.read(entry.fd, buffer, 0, length, offset, (error, bytesRead) => {
      if (error) return sendFailure(reqid, error);
      if (!bytesRead) return sftp.status(reqid, STATUS_CODE.EOF);
      sftp.data(reqid, buffer.slice(0, bytesRead));
    });
  });

  sftp.on("WRITE", (reqid, handle, offset, data) => {
    const entry = readSftpHandle(handle, handles);
    if (!entry || entry.type !== "file") {
      return sftp.status(reqid, STATUS_CODE.FAILURE);
    }
    fs.write(entry.fd, data, 0, data.length, offset, (error) => {
      sftp.status(reqid, toSftpStatusCode(error));
    });
  });

  sftp.on("CLOSE", (reqid, handle) => {
    const id = Buffer.isBuffer(handle) && handle.length === 4 ? handle.readUInt32BE(0) : null;
    const entry = id ? handles.get(id) : null;
    if (!entry) {
      return sftp.status(reqid, STATUS_CODE.FAILURE);
    }
    handles.delete(id);
    if (entry.type !== "file") {
      return sftp.status(reqid, STATUS_CODE.OK);
    }
    fs.close(entry.fd, (error) => sftp.status(reqid, toSftpStatusCode(error)));
  });

  sftp.on("MKDIR", (reqid, remotePath) => {
    try {
      fs.mkdirSync(resolveSftpServerPath(rootPath, remotePath), { recursive: true });
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (error) {
      sendFailure(reqid, error);
    }
  });

  sftp.on("RMDIR", (reqid, remotePath) => {
    try {
      fs.rmdirSync(resolveSftpServerPath(rootPath, remotePath));
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (error) {
      sendFailure(reqid, error);
    }
  });

  sftp.on("REMOVE", (reqid, remotePath) => {
    try {
      fs.unlinkSync(resolveSftpServerPath(rootPath, remotePath));
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (error) {
      sendFailure(reqid, error);
    }
  });

  sftp.on("RENAME", (reqid, oldPath, newPath) => {
    try {
      fs.renameSync(resolveSftpServerPath(rootPath, oldPath), resolveSftpServerPath(rootPath, newPath));
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (error) {
      sendFailure(reqid, error);
    }
  });
}

async function startLocalSftpServer(overrides = {}) {
  if (localSftpServer) {
    return getLocalSftpStatus();
  }

  const settings = getSettings();
  settings.sftpServer = { ...settings.sftpServer, ...overrides, enabled: true };
  saveSettings(settings);

  const config = normalizeSettings(settings).sftpServer;
  const rootPath = path.resolve(config.rootPath || getResolvedHtdocsPath(settings) || app.getPath("documents"));
  fs.mkdirSync(rootPath, { recursive: true });

  return await new Promise((resolve, reject) => {
    const server = new SshServer({ hostKeys: [getOrCreateSftpHostKey()] }, (client) => {
      localSftpServerState.clients++;
      client.on("authentication", (ctx) => {
        const usernameOk = ctx.username === config.username;
        const passwordOk = ctx.method === "password" && ctx.password === config.password;
        if (usernameOk && passwordOk) {
          ctx.accept();
        } else {
          ctx.reject();
        }
      });
      client.on("ready", () => {
        client.on("session", (accept) => {
          const session = accept();
          session.on("sftp", (accept) => attachLocalSftpHandlers(accept(), rootPath));
        });
      });
      client.on("close", () => {
        localSftpServerState.clients = Math.max(0, localSftpServerState.clients - 1);
      });
    });

    server.once("error", (error) => {
      localSftpServerState.lastError = error.message || "SFTP server failed to start.";
      reject(error);
    });

    server.listen(config.port, config.host, () => {
      localSftpServer = server;
      localSftpServerState = {
        running: true,
        host: config.host,
        port: config.port,
        rootPath,
        username: config.username,
        clients: 0,
        lastError: ""
      };
      resolve(getLocalSftpStatus());
    });
  });
}

async function stopLocalSftpServer() {
  const settings = getSettings();
  settings.sftpServer = { ...settings.sftpServer, enabled: false };
  saveSettings(settings);

  if (!localSftpServer) {
    localSftpServerState.running = false;
    return getLocalSftpStatus();
  }

  await new Promise((resolve) => {
    localSftpServer.close(() => resolve());
  });
  localSftpServer = null;
  localSftpServerState.running = false;
  localSftpServerState.clients = 0;
  return getLocalSftpStatus();
}

function getSshConnection(config) {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    
    conn.on("ready", () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(new Error("SFTP subsystem failed: " + err.message));
        }
        resolve({ conn, sftp });
      });
    });

    conn.on("error", (err) => {
      reject(new Error("SSH connection error: " + err.message));
    });

    const connSettings = {
      host: config.host,
      port: Number(config.port) || 22,
      username: config.username,
      readyTimeout: 15000
    };

    if (config.authType === "key") {
      if (!config.keyPath) {
        return reject(new Error("SSH Private Key path is required."));
      }
      try {
        connSettings.privateKey = fs.readFileSync(config.keyPath);
      } catch (err) {
        return reject(new Error("Could not read SSH Private Key: " + err.message));
      }
    } else {
      connSettings.password = config.password;
    }

    conn.connect(connSettings);
  });
}

function getAllLocalFiles(dirPath, originalDirPath = dirPath) {
  let results = [];
  if (!fs.existsSync(dirPath)) return results;
  const list = fs.readdirSync(dirPath);
  list.forEach((file) => {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    const relativePath = path.relative(originalDirPath, filePath).replace(/\\/g, '/');
    if (stat && stat.isDirectory()) {
      results.push({ type: 'directory', relativePath, absolutePath: filePath });
      results = results.concat(getAllLocalFiles(filePath, originalDirPath));
    } else {
      results.push({ type: 'file', relativePath, absolutePath: filePath });
    }
  });
  return results;
}

async function getAllRemoteFiles(sftp, remoteDir, originalRemoteDir = remoteDir) {
  let results = [];
  const list = await new Promise((resolve, reject) => {
    sftp.readdir(remoteDir, (err, files) => {
      if (err) return reject(err);
      resolve(files || []);
    });
  });

  for (const file of list) {
    if (file.filename === "." || file.filename === "..") continue;
    const remotePath = (remoteDir === '/' ? '/' : remoteDir + '/') + file.filename;
    const relativePath = path.relative(originalRemoteDir, remotePath).replace(/\\/g, '/');
    const isDir = ((file.attrs.mode & 0o170000) === 0o040000) || (file.longname && file.longname.startsWith('d'));
    if (isDir) {
      results.push({ type: 'directory', relativePath, remotePath });
      const subResults = await getAllRemoteFiles(sftp, remotePath, originalRemoteDir);
      results = results.concat(subResults);
    } else {
      results.push({ type: 'file', relativePath, remotePath });
    }
  }
  return results;
}

async function ensureRemoteDirExists(sftp, remotePath) {
  const normalized = remotePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  let current = normalized.startsWith('/') ? '/' : '';
  for (const part of parts) {
    current = (current === '/' ? '/' : current + '/') + part;
    try {
      await new Promise((resolve, reject) => {
        sftp.stat(current, (err, stat) => {
          if (err) {
            sftp.mkdir(current, (mkdirErr) => {
              if (mkdirErr) reject(mkdirErr);
              else resolve();
            });
          } else {
            resolve();
          }
        });
      });
    } catch (err) {
      throw new Error(`Failed to check or create remote directory ${current}: ${err.message}`);
    }
  }
}

async function uploadDirectoryRecursive(win, sftp, localDir, remoteDir, subpath = "") {
  const fullLocalDir = subpath ? path.join(localDir, subpath) : localDir;
  const fullRemoteDir = subpath ? (remoteDir + "/" + subpath).replace(/\/+/g, "/") : remoteDir;

  await ensureRemoteDirExists(sftp, fullRemoteDir);

  const localItems = getAllLocalFiles(fullLocalDir);
  const total = localItems.filter(item => item.type === 'file').length;
  let completed = 0;

  win.webContents.send("sftp:progress", { statusText: "Scanning local files...", progress: 0 });

  for (const item of localItems) {
    const itemRemotePath = (fullRemoteDir + "/" + item.relativePath).replace(/\/+/g, "/");
    if (item.type === 'directory') {
      await ensureRemoteDirExists(sftp, itemRemotePath);
    } else {
      win.webContents.send("sftp:progress", { 
        statusText: `Uploading ${item.relativePath}...`, 
        progress: Math.round((completed / total) * 100),
        logLine: `Uploading ${item.relativePath}`
      });
      
      await new Promise((resolve, reject) => {
        sftp.fastPut(item.absolutePath, itemRemotePath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      completed++;
    }
  }

  win.webContents.send("sftp:progress", { 
    statusText: "Upload complete!", 
    progress: 100, 
    logLine: `Uploaded ${completed} files successfully.`
  });
}

async function downloadDirectoryRecursive(win, sftp, remoteDir, localDir, subpath = "") {
  const fullRemoteDir = subpath ? (remoteDir + "/" + subpath).replace(/\/+/g, "/") : remoteDir;
  const fullLocalDir = subpath ? path.join(localDir, subpath) : localDir;

  fs.mkdirSync(fullLocalDir, { recursive: true });

  win.webContents.send("sftp:progress", { statusText: "Scanning remote files...", progress: 0 });
  const remoteItems = await getAllRemoteFiles(sftp, fullRemoteDir);
  const total = remoteItems.filter(item => item.type === 'file').length;
  let completed = 0;

  for (const item of remoteItems) {
    const itemLocalPath = path.join(fullLocalDir, item.relativePath);
    if (item.type === 'directory') {
      fs.mkdirSync(itemLocalPath, { recursive: true });
    } else {
      win.webContents.send("sftp:progress", { 
        statusText: `Downloading ${item.relativePath}...`, 
        progress: Math.round((completed / total) * 100),
        logLine: `Downloading ${item.relativePath}`
      });

      fs.mkdirSync(path.dirname(itemLocalPath), { recursive: true });

      await new Promise((resolve, reject) => {
        sftp.fastGet(item.remotePath, itemLocalPath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      completed++;
    }
  }

  win.webContents.send("sftp:progress", { 
    statusText: "Download complete!", 
    progress: 100, 
    logLine: `Downloaded ${completed} files successfully.`
  });
}

ipcMain.handle("dialog:pick-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select File",
    properties: ["openFile"],
    filters: [{ name: "All files", extensions: ["*"] }]
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("dialog:save-file", async (_event, defaultPath) => {
  const result = await dialog.showSaveDialog({
    title: "Save File",
    defaultPath: defaultPath || undefined,
    buttonLabel: "Save"
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  return result.filePath;
});

ipcMain.handle("file:write", async (_event, { filePath, content }) => {
  if (!filePath) {
    throw new Error("No file path provided.");
  }
  fs.writeFileSync(filePath, String(content || ""), "utf8");
  return { ok: true };
});

ipcMain.handle("sftp:save-config", async (_event, { siteId, config }) => {
  const sites = getSites();
  const index = sites.findIndex(site => site.id === siteId);
  if (index === -1) {
    throw new Error("Site not found: " + siteId);
  }

  sites[index].sftp = {
    host: String(config.host || "").trim(),
    port: String(config.port || "22").trim(),
    username: String(config.username || "").trim(),
    authType: String(config.authType || "password").trim(),
    password: String(config.password || ""),
    keyPath: String(config.keyPath || "").trim(),
    remoteDir: String(config.remoteDir || "").trim()
  };

  saveSites(sites);
  return { ok: true, site: sites[index] };
});

ipcMain.handle("sftp-server:get-status", () => getLocalSftpStatus());

ipcMain.handle("sftp-server:save-settings", async (_event, config) => {
  const settings = getSettings();
  settings.sftpServer = {
    ...settings.sftpServer,
    host: String(config?.host || settings.sftpServer.host || "127.0.0.1").trim() || "127.0.0.1",
    port: Math.max(1, Math.min(65535, Number(config?.port || settings.sftpServer.port || 2222))),
    username: String(config?.username || settings.sftpServer.username || "wpdesktop").trim() || "wpdesktop",
    password: String(config?.password ?? settings.sftpServer.password ?? ""),
    rootPath: String(config?.rootPath || settings.sftpServer.rootPath || "").trim(),
    enabled: Boolean(localSftpServer)
  };
  saveSettings(settings);
  return getLocalSftpStatus(settings);
});

ipcMain.handle("sftp-server:start", async (_event, config) => startLocalSftpServer(config || {}));

ipcMain.handle("sftp-server:stop", async () => stopLocalSftpServer());

ipcMain.handle("sftp:test", async (_event, config) => {
  try {
    const { conn, sftp } = await getSshConnection(config);
    
    const remoteDir = String(config.remoteDir || "/").trim() || "/";
    await new Promise((resolve, reject) => {
      sftp.stat(remoteDir, (err, stats) => {
        if (err) {
          reject(new Error("Remote directory does not exist or is not readable: " + err.message));
        } else {
          resolve();
        }
      });
    });

    // Store the connection with a unique ID for future use
    const connectionId = `sftp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    activeSftpConnections.set(connectionId, { conn, sftp, config });
    
    // Auto-cleanup after 1 hour of inactivity
    setTimeout(() => {
      if (activeSftpConnections.has(connectionId)) {
        const { conn: oldConn } = activeSftpConnections.get(connectionId);
        oldConn.end();
        activeSftpConnections.delete(connectionId);
      }
    }, 3600000);

    return { ok: true, connectionId };
  } catch (err) {
    throw new Error("SFTP connection test failed: " + err.message);
  }
});

ipcMain.handle("sftp:list-dir", async (_event, payload) => {
  const { connectionId, remotePath } = payload;
  
  if (!activeSftpConnections.has(connectionId)) {
    throw new Error("SFTP connection not found or closed.");
  }

  const { sftp } = activeSftpConnections.get(connectionId);
  const dirPath = String(remotePath || "/").trim() || "/";

  return new Promise((resolve, reject) => {
    sftp.readdir(dirPath, (err, list) => {
      if (err) {
        return reject(new Error(`Failed to list directory: ${err.message}`));
      }
      
      const files = (list || []).map(item => ({
        name: item.filename,
        type: item.longname?.startsWith('d') ? 'directory' : 'file',
        size: item.attrs?.size || 0,
        modTime: item.attrs?.mtime ? new Date(item.attrs.mtime * 1000).toISOString() : null
      }));
      
      resolve(files);
    });
  });
});

ipcMain.handle("sftp:read-file", async (_event, payload) => {
  const { connectionId, remotePath } = payload;
  
  if (!activeSftpConnections.has(connectionId)) {
    throw new Error("SFTP connection not found or closed.");
  }

  const { sftp } = activeSftpConnections.get(connectionId);
  const filePath = String(remotePath || "").trim();

  if (!filePath) {
    throw new Error("Remote file path is required.");
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    const readStream = sftp.createReadStream(filePath);
    
    readStream.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    readStream.on('end', () => {
      const content = Buffer.concat(chunks).toString('utf8');
      resolve(content);
    });
    
    readStream.on('error', (err) => {
      reject(new Error(`Failed to read file: ${err.message}`));
    });
  });
});

ipcMain.handle("sftp:close-connection", (_event, connectionId) => {
  if (activeSftpConnections.has(connectionId)) {
    const { conn } = activeSftpConnections.get(connectionId);
    conn.end();
    activeSftpConnections.delete(connectionId);
  }
  return { ok: true };
});

ipcMain.handle("sftp:transfer", async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { siteId, direction, subpath } = payload;
  const sites = getSites();
  const site = sites.find(s => s.id === siteId);
  if (!site) {
    throw new Error("Site not found: " + siteId);
  }

  if (!site.sftp || !site.sftp.host) {
    throw new Error("SFTP is not configured for this site.");
  }

  win.webContents.send("sftp:progress", { 
    statusText: "Connecting to remote server...", 
    progress: 0,
    logLine: `Connecting to ${site.sftp.username}@${site.sftp.host}:${site.sftp.port}...`
  });

  const { conn, sftp } = await getSshConnection(site.sftp);

  try {
    const remoteBaseDir = site.sftp.remoteDir || "/";
    const localBaseDir = site.path;

    if (direction === "upload") {
      win.webContents.send("sftp:progress", { statusText: "Starting upload...", logLine: "Starting recursive upload..." });
      await uploadDirectoryRecursive(win, sftp, localBaseDir, remoteBaseDir, subpath);
    } else {
      win.webContents.send("sftp:progress", { statusText: "Starting download...", logLine: "Starting recursive download..." });
      await downloadDirectoryRecursive(win, sftp, remoteBaseDir, localBaseDir, subpath);
    }

    conn.end();
    return { ok: true };
  } catch (err) {
    conn.end();
    win.webContents.send("sftp:progress", { 
      statusText: "Transfer failed", 
      isError: true,
      logLine: `Error: ${err.message}`
    });
    throw err;
  }
});

ipcMain.handle("extensions:read-file", async (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("File not found: " + filePath);
  }
  return fs.readFileSync(filePath, "utf8");
});

// ═══════════════════════════════════════════════════════════════════
// TAILSCALE ADMIN TOOLKIT — Main Process Service Layer
// ═══════════════════════════════════════════════════════════════════

const tailscaleRuntime = {
  cliPath: null,
  localApiAvailable: false,
  monitorTimer: null,
  lastPeerSnapshot: null,
  initialized: false
};

// ─── Security: sanitize all CLI argument values ────────────────────
function sanitizeTailscaleArg(value) {
  const str = String(value || "");
  // Strip shell metacharacters — we use spawn with args array anyway,
  // but defense-in-depth is good practice.
  return str.replace(/[;&|`$<>(){}\\!\n\r]/g, "").trim().slice(0, 512);
}

// ─── CLI detection ─────────────────────────────────────────────────
const TAILSCALE_CLI_CANDIDATES = process.platform === "win32"
  ? [
      "C:\\Program Files\\Tailscale\\tailscale.exe",
      "C:\\Program Files (x86)\\Tailscale\\tailscale.exe",
      "tailscale"
    ]
  : process.platform === "darwin"
  ? ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "tailscale"]
  : ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "tailscale"];

function findTailscaleCli() {
  for (const candidate of TAILSCALE_CLI_CANDIDATES) {
    try {
      if (!candidate.startsWith("/") && !candidate.includes("\\")) {
        // PATH lookup
        const result = spawnSync(process.platform === "win32" ? "where" : "which", [candidate], {
          encoding: "utf8", windowsHide: true
        });
        if (result.status === 0 && result.stdout.trim()) {
          return candidate;
        }
      } else if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_) {
      // continue
    }
  }
  return null;
}

// ─── Run a Tailscale CLI command via spawn (Promise) ──────────────
function runTailscaleCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const cliPath = tailscaleRuntime.cliPath;
    if (!cliPath) {
      return reject(new Error("Tailscale CLI not found. Install Tailscale and ensure it is on PATH."));
    }

    const safeArgs = args.map(sanitizeTailscaleArg);
    const proc = spawn(cliPath, safeArgs, {
      encoding: "utf8",
      windowsHide: true,
      timeout: options.timeout || 30000
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    proc.on("error", reject);
  });
}

// ─── LocalAPI HTTP probe ───────────────────────────────────────────
const TS_LOCAL_API_BASE = "http://localhost:41112/localapi/v0";

function tailscaleLocalApiGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${TS_LOCAL_API_BASE}${path}`, {
      headers: { "Tailscale-Cap": "58" },
      timeout: 3000
    }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (_) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("LocalAPI timeout")); });
  });
}

// ─── Get Tailscale status (LocalAPI → CLI fallback) ───────────────
async function getTailscaleStatus() {
  if (tailscaleRuntime.localApiAvailable) {
    try {
      const res = await tailscaleLocalApiGet("/status");
      if (res.status === 200) return { source: "localapi", data: res.data };
    } catch (_) {
      tailscaleRuntime.localApiAvailable = false;
    }
  }

  // CLI fallback
  const result = await runTailscaleCli(["status", "--json"]);
  if (result.code !== 0 && !result.stdout.trim()) {
    throw new Error(result.stderr || "tailscale status failed");
  }
  return { source: "cli", data: JSON.parse(result.stdout) };
}

// ─── Peer online state helpers ────────────────────────────────────
function classifyPeerState(peer) {
  if (!peer) return "unknown";
  if (peer.Online) return peer.Relay ? "relay" : "online";
  if (peer.LastSeen) return "offline";
  return "unknown";
}

function normalizePeers(statusData) {
  const peers = statusData?.Peer ? Object.values(statusData.Peer) : [];
  const self = statusData?.Self || null;
  return { peers, self };
}

// ─── Device monitor (background polling) ──────────────────────────
async function tailscaleMonitorTick() {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) return;

    const { data } = await getTailscaleStatus();
    const { peers } = normalizePeers(data);

    const lastSnapshot = tailscaleRuntime.lastPeerSnapshot || {};
    const newSnapshot = {};

    for (const peer of peers) {
      const id = peer.ID || peer.PublicKey || peer.HostName;
      const state = classifyPeerState(peer);
      newSnapshot[id] = state;

      if (lastSnapshot[id] !== undefined && lastSnapshot[id] !== state) {
        // State changed — send desktop notification
        const name = peer.HostName || peer.DNSName || id;
        const notifTitle = state === "online" ? `${name} connected` : `${name} went ${state}`;
        const { Notification } = require("electron");
        if (Notification.isSupported()) {
          new Notification({ title: "Tailscale", body: notifTitle }).show();
        }
        win.webContents.send("tailscale:notification", { type: state, name, id });
      }
    }

    tailscaleRuntime.lastPeerSnapshot = newSnapshot;
    win.webContents.send("tailscale:peer-update", { peers, timestamp: Date.now() });
  } catch (_) {
    // Silent — monitor failures don't crash the app
  }
}

// ═══════════════════════════════════════════════════════════════════
// IPC Handlers — Tailscale
// ═══════════════════════════════════════════════════════════════════

// ─── detect ───────────────────────────────────────────────────────
ipcMain.handle("tailscale:detect", async () => {
  tailscaleRuntime.cliPath = findTailscaleCli();

  // Probe LocalAPI
  try {
    const res = await tailscaleLocalApiGet("/status");
    tailscaleRuntime.localApiAvailable = res.status === 200;
  } catch (_) {
    tailscaleRuntime.localApiAvailable = false;
  }

  tailscaleRuntime.initialized = true;

  // Get version if CLI found
  let version = null;
  if (tailscaleRuntime.cliPath) {
    try {
      const r = await runTailscaleCli(["version"]);
      version = r.stdout.split("\n")[0].trim();
    } catch (_) {}
  }

  return {
    found: Boolean(tailscaleRuntime.cliPath),
    cliPath: tailscaleRuntime.cliPath,
    localApiAvailable: tailscaleRuntime.localApiAvailable,
    apiSource: tailscaleRuntime.localApiAvailable ? "localapi" : "cli",
    version
  };
});

// ─── status ───────────────────────────────────────────────────────
ipcMain.handle("tailscale:status", async () => {
  const { source, data } = await getTailscaleStatus();
  return { source, data };
});

// ─── peers ────────────────────────────────────────────────────────
ipcMain.handle("tailscale:peers", async () => {
  const { source, data } = await getTailscaleStatus();
  const { peers, self } = normalizePeers(data);
  return {
    source,
    self,
    peers: peers.map((peer) => ({
      id: peer.ID || peer.PublicKey,
      name: peer.HostName || peer.DNSName || "",
      dnsName: peer.DNSName || "",
      os: peer.OS || "",
      user: peer.UserID ? (data?.User?.[peer.UserID]?.LoginName || "") : "",
      tailscaleIPs: peer.TailscaleIPs || [],
      ip: (peer.TailscaleIPs || [])[0] || "",
      online: peer.Online || false,
      relay: peer.Relay || "",
      state: classifyPeerState(peer),
      lastSeen: peer.LastSeen || null,
      exitNode: peer.ExitNode || false,
      exitNodeOption: peer.ExitNodeOption || false,
      tags: peer.Tags || [],
      allowedIPs: peer.AllowedIPs || []
    }))
  };
});

// ─── ping ─────────────────────────────────────────────────────────
ipcMain.handle("tailscale:ping", async (_event, host) => {
  const safeHost = sanitizeTailscaleArg(host);
  if (!safeHost) throw new Error("Host is required.");
  const result = await runTailscaleCli(["ping", "--c", "3", safeHost], { timeout: 15000 });
  return { stdout: result.stdout, stderr: result.stderr, code: result.code };
});

// ─── ssh ──────────────────────────────────────────────────────────
ipcMain.handle("tailscale:ssh", async (_event, payload) => {
  const host = sanitizeTailscaleArg(payload?.host || "");
  const user = sanitizeTailscaleArg(payload?.user || "");
  if (!host) throw new Error("Host is required for SSH.");

  const target = user ? `${user}@${host}` : host;
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "cmd", "/k", "tailscale", "ssh", target], { detached: true, windowsHide: false });
  } else if (process.platform === "darwin") {
    spawn("osascript", ["-e", `tell app "Terminal" to do script "tailscale ssh ${target}"`], { detached: true });
  } else {
    spawn("x-terminal-emulator", ["-e", `tailscale ssh ${target}`], { detached: true });
  }
  return { ok: true };
});

// ─── rdp (Windows only) ───────────────────────────────────────────
ipcMain.handle("tailscale:rdp", async (_event, ip) => {
  const safeIp = sanitizeTailscaleArg(ip);
  if (!safeIp) throw new Error("IP is required for RDP.");
  if (process.platform !== "win32") throw new Error("RDP is only available on Windows.");
  spawn("mstsc", [`/v:${safeIp}`], { detached: true, windowsHide: false });
  return { ok: true };
});

// ─── whois ────────────────────────────────────────────────────────
ipcMain.handle("tailscale:whois", async (_event, ip) => {
  const safeIp = sanitizeTailscaleArg(ip);
  if (!safeIp) throw new Error("IP is required for whois.");
  const result = await runTailscaleCli(["whois", safeIp]);
  return { stdout: result.stdout, stderr: result.stderr };
});

// ─── exit nodes ───────────────────────────────────────────────────
ipcMain.handle("tailscale:exit-nodes", async () => {
  const { data } = await getTailscaleStatus();
  const { peers } = normalizePeers(data);
  const exitNodes = peers.filter((p) => p.ExitNodeOption || p.ExitNode);
  return {
    exitNodes: exitNodes.map((p) => ({
      id: p.ID || p.PublicKey,
      name: p.HostName || p.DNSName || "",
      ip: (p.TailscaleIPs || [])[0] || "",
      online: p.Online || false,
      active: p.ExitNode || false,
      country: p.Location?.Country || "",
      city: p.Location?.City || ""
    })),
    activeNodeId: peers.find((p) => p.ExitNode)?.ID || null
  };
});

// ─── set exit node ────────────────────────────────────────────────
ipcMain.handle("tailscale:set-exit-node", async (_event, node) => {
  const safeNode = sanitizeTailscaleArg(node || "");
  if (!safeNode) {
    // Disconnect
    const result = await runTailscaleCli(["set", "--exit-node="]);
    return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
  }
  const result = await runTailscaleCli(["set", `--exit-node=${safeNode}`]);
  return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
});

// ─── serve status ─────────────────────────────────────────────────
ipcMain.handle("tailscale:serve-status", async () => {
  const result = await runTailscaleCli(["serve", "status", "--json"]);
  if (result.code !== 0 && !result.stdout.trim()) {
    return { routes: [], raw: result.stderr };
  }
  try {
    return { data: JSON.parse(result.stdout), routes: [], raw: result.stdout };
  } catch (_) {
    return { raw: result.stdout, routes: [] };
  }
});

// ─── serve add ────────────────────────────────────────────────────
ipcMain.handle("tailscale:serve-add", async (_event, payload) => {
  const protocol = sanitizeTailscaleArg(payload?.protocol || "https");
  const port = sanitizeTailscaleArg(String(payload?.port || "443"));
  const target = sanitizeTailscaleArg(payload?.target || "");
  if (!target) throw new Error("Target is required.");

  const args = ["serve", "--bg", `--${protocol}=${port}`, target];
  const result = await runTailscaleCli(args);
  return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
});

// ─── serve remove ─────────────────────────────────────────────────
ipcMain.handle("tailscale:serve-remove", async (_event, payload) => {
  const protocol = sanitizeTailscaleArg(payload?.protocol || "https");
  const port = sanitizeTailscaleArg(String(payload?.port || "443"));
  const result = await runTailscaleCli(["serve", `--${protocol}=${port}`, "off"]);
  return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
});

// ─── funnel status ────────────────────────────────────────────────
ipcMain.handle("tailscale:funnel-status", async () => {
  const result = await runTailscaleCli(["funnel", "status", "--json"]);
  try {
    return { data: JSON.parse(result.stdout), raw: result.stdout };
  } catch (_) {
    return { raw: result.stdout || result.stderr };
  }
});

// ─── funnel set ───────────────────────────────────────────────────
ipcMain.handle("tailscale:funnel-set", async (_event, payload) => {
  const port = sanitizeTailscaleArg(String(payload?.port || "443"));
  const enable = Boolean(payload?.enable);

  if (enable) {
    let target = "";
    let protocol = "https";
    try {
      const statusRes = await runTailscaleCli(["serve", "status", "--json"]);
      if (statusRes.code === 0 && statusRes.stdout.trim()) {
        const data = JSON.parse(statusRes.stdout);
        if (data.Web) {
          for (const [hostPort, hostCfg] of Object.entries(data.Web)) {
            const parts = hostPort.split(":");
            const p = parts[parts.length - 1] || "443";
            if (p === port && hostCfg.Handlers) {
              const handler = hostCfg.Handlers["/"] || Object.values(hostCfg.Handlers)[0];
              target = handler?.Proxy || handler?.Path || "";
              protocol = "https";
              break;
            }
          }
        }
        if (!target && data.TCP && data.TCP[port]) {
          target = data.TCP[port].To || "";
          protocol = "tcp";
        }
      }
    } catch (_) {}

    if (!target) {
      target = `localhost:${port === "443" ? "80" : port}`;
    }

    const args = ["funnel", "--bg", `--${protocol}=${port}`, target];
    const result = await runTailscaleCli(args);
    return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
  } else {
    let protocol = "https";
    try {
      const statusRes = await runTailscaleCli(["serve", "status", "--json"]);
      if (statusRes.code === 0 && statusRes.stdout.trim()) {
        const data = JSON.parse(statusRes.stdout);
        if (data.TCP && data.TCP[port]) {
          protocol = "tcp";
        }
      }
    } catch (_) {}

    const args = ["funnel", `--${protocol}=${port}`, "off"];
    const result = await runTailscaleCli(args);
    return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
  }
});

// ─── netcheck ─────────────────────────────────────────────────────
ipcMain.handle("tailscale:netcheck", async () => {
  const result = await runTailscaleCli(["netcheck", "--format=json"], { timeout: 20000 });
  try {
    return { data: JSON.parse(result.stdout), raw: result.stdout };
  } catch (_) {
    // netcheck sometimes outputs human-readable on stderr
    return { raw: result.stdout || result.stderr };
  }
});

// ─── dns ──────────────────────────────────────────────────────────
ipcMain.handle("tailscale:dns", async () => {
  if (tailscaleRuntime.localApiAvailable) {
    try {
      const prefs = await tailscaleLocalApiGet("/prefs");
      const netmap = await tailscaleLocalApiGet("/netmap");
      return {
        source: "localapi",
        magicDns: prefs.data?.MagicDNS || false,
        coreDNS: prefs.data?.CorpDNS || false,
        domains: netmap.data?.DNS?.Domains || [],
        nameservers: netmap.data?.DNS?.Resolvers || []
      };
    } catch (_) {}
  }
  // Fallback: parse from status
  const { data } = await getTailscaleStatus();
  return {
    source: "cli-status",
    magicDns: data?.MagicDNS?.Enabled || false,
    domains: [],
    nameservers: []
  };
});

// ─── login ────────────────────────────────────────────────────────
ipcMain.handle("tailscale:login", async () => {
  const result = await runTailscaleCli(["login", "--json"]);
  try {
    const parsed = JSON.parse(result.stdout);
    const url = parsed?.url || parsed?.authURL || "";
    if (url) shell.openExternal(url);
    return { url, raw: result.stdout };
  } catch (_) {
    // Non-JSON output — look for URL in stdout/stderr
    const combined = result.stdout + result.stderr;
    const urlMatch = combined.match(/https:\/\/[^\s]+/);
    const url = urlMatch ? urlMatch[0] : "";
    if (url) shell.openExternal(url);
    return { url, raw: combined };
  }
});

// ─── logout ───────────────────────────────────────────────────────
ipcMain.handle("tailscale:logout", async () => {
  const result = await runTailscaleCli(["logout"]);
  return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
});

// ─── run-command (console) ────────────────────────────────────────
ipcMain.handle("tailscale:run-command", async (_event, argsInput) => {
  const args = Array.isArray(argsInput)
    ? argsInput.map(sanitizeTailscaleArg)
    : String(argsInput || "").split(/\s+/).filter(Boolean).map(sanitizeTailscaleArg);

  if (!args.length) throw new Error("No command arguments provided.");

  // Blocklist dangerous subcommands
  const blocked = ["up", "down", "set", "login", "logout", "configure"];
  // Allow all read-only commands freely; block state-mutating ones through console
  // (users can still run them via explicit buttons)
  const result = await runTailscaleCli(args, { timeout: 20000 });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code,
    args
  };
});

// ─── file pick ────────────────────────────────────────────────────
ipcMain.handle("tailscale:file-pick", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: "Select file to send",
    properties: ["openFile"]
  });
  return result.canceled ? null : result.filePaths[0];
});

// ─── file send ────────────────────────────────────────────────────
ipcMain.handle("tailscale:file-send", async (_event, payload) => {
  const target = sanitizeTailscaleArg(payload?.target || "");
  const filePath = String(payload?.filePath || "").trim();
  if (!target) throw new Error("Target device is required.");
  if (!filePath || !fs.existsSync(filePath)) throw new Error("File not found.");

  const result = await runTailscaleCli(["file", "cp", filePath, `${target}:`], { timeout: 120000 });
  return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr };
});

// ─── cert ─────────────────────────────────────────────────────────
ipcMain.handle("tailscale:cert-get", async (_event, hostname) => {
  const safeHostname = sanitizeTailscaleArg(hostname);
  if (!safeHostname) throw new Error("Hostname is required.");

  const certDir = app.getPath("userData");
  const certPath = path.join(certDir, `${safeHostname}.crt`);
  const keyPath = path.join(certDir, `${safeHostname}.key`);

  const result = await runTailscaleCli(["cert", "--cert-file", certPath, "--key-file", keyPath, safeHostname], { timeout: 30000 });
  if (result.code !== 0) throw new Error(result.stderr || "Certificate generation failed.");

  let expiry = null;
  try {
    // Try to parse cert for expiry using openssl if available
    const opensslResult = spawnSync("openssl", ["x509", "-noout", "-enddate", "-in", certPath], {
      encoding: "utf8", windowsHide: true, timeout: 5000
    });
    if (opensslResult.status === 0) {
      const match = opensslResult.stdout.match(/notAfter=(.+)/);
      expiry = match ? match[1].trim() : null;
    }
  } catch (_) {}

  return { ok: true, certPath, keyPath, expiry, directory: certDir };
});

// ─── metrics ──────────────────────────────────────────────────────
ipcMain.handle("tailscale:metrics", async () => {
  const result = await runTailscaleCli(["metrics"]);
  return { raw: result.stdout, stderr: result.stderr, code: result.code };
});

// ─── device monitor start ─────────────────────────────────────────
ipcMain.handle("tailscale:start-monitor", (_event, intervalMs) => {
  if (tailscaleRuntime.monitorTimer) {
    clearInterval(tailscaleRuntime.monitorTimer);
  }
  const ms = Math.max(3000, Number(intervalMs) || 5000);
  tailscaleRuntime.monitorTimer = setInterval(tailscaleMonitorTick, ms);
  return { ok: true, intervalMs: ms };
});

// ─── device monitor stop ──────────────────────────────────────────
ipcMain.handle("tailscale:stop-monitor", () => {
  if (tailscaleRuntime.monitorTimer) {
    clearInterval(tailscaleRuntime.monitorTimer);
    tailscaleRuntime.monitorTimer = null;
  }
  return { ok: true };
});

// ─── Shell Execution & Database Queries (Integrated Tools Cockpit) ──────
ipcMain.handle("shell:run", async (_event, { command, cwd }) => {
  return new Promise((resolve) => {
    const { exec } = require("child_process");
    exec(command, { cwd: cwd || process.cwd(), timeout: 30000 }, (error, stdout, stderr) => {
      resolve({
        code: error ? error.code : 0,
        stdout: stdout || "",
        stderr: stderr || (error ? error.message : "")
      });
    });
  });
});

ipcMain.handle("db:query", async (_event, { dbType, config, sql }) => {
  if (dbType === "postgres") {
    try {
      let pgClient;
      try {
        const { Client } = require("pg");
        pgClient = new Client({
          host: config.host || "127.0.0.1",
          port: Number(config.port) || 5432,
          user: config.user || "postgres",
          password: config.password || "",
          database: config.database || "postgres",
          connectionTimeoutMillis: 5000
        });
        await pgClient.connect();
        const res = await pgClient.query(sql);
        await pgClient.end();
        return {
          ok: true,
          rows: res.rows || [],
          rowCount: res.rowCount,
          fields: res.fields?.map(f => f.name) || []
        };
      } catch (err) {
        // Fallback to command line psql if pg npm module isn't installed
        const { execSync } = require("child_process");
        const passEnv = config.password ? `set PGPASSWORD=${config.password}&& ` : "";
        const cmd = `${passEnv}psql -h ${config.host || "127.0.0.1"} -p ${config.port || 5432} -U ${config.user || "postgres"} -d ${config.database || "postgres"} -t -A -c "${sql.replace(/"/g, '\\"')}"`;
        const output = execSync(cmd, { encoding: "utf8", timeout: 8000 });
        const lines = output.trim().split("\n").filter(Boolean);
        const rows = lines.map(line => {
          const vals = line.split("|");
          return vals.reduce((acc, v, idx) => {
            acc[`col_${idx}`] = v;
            return acc;
          }, {});
        });
        return {
          ok: true,
          rows,
          fields: rows[0] ? Object.keys(rows[0]) : ["result"]
        };
      }
    } catch (error) {
      return { ok: false, error: error.message };
    }
  } else {
    // MySQL
    try {
      const mysql = require("mysql2/promise");
      const connection = await mysql.createConnection({
        host: config.host || "127.0.0.1",
        port: Number(config.port) || 3306,
        user: config.user || "root",
        password: config.password || "",
        database: config.database || ""
      });
      const [rows, fields] = await connection.execute(sql);
      await connection.end();
      
      const rowsArray = Array.isArray(rows) ? rows : [rows];
      const fieldsArray = Array.isArray(fields) ? fields.map(f => f.name) : (rowsArray[0] ? Object.keys(rowsArray[0]) : ["result"]);
      
      return {
        ok: true,
        rows: rowsArray,
        fields: fieldsArray
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
});

