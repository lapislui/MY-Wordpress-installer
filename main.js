const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn } = require("child_process");
const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  session,
  safeStorage,
  screen,
  shell
} = require("electron");
const mysql = require("mysql2/promise");
const AdmZip = require("adm-zip");

let lastFocusedWindow = null;
const browserWindows = new Map();
const configuredBrowserPartitions = new Set();
const AUTO_ALLOWED_BROWSER_PERMISSIONS = new Set([
  "fullscreen",
  "notifications",
  "pointerLock",
  "keyboardLock",
  "idle-detection",
  "local-fonts",
  "storage-access",
  "top-level-storage-access",
  "clipboard-sanitized-write"
]);
const PROMPTED_BROWSER_PERMISSIONS = new Set([
  "geolocation",
  "media",
  "display-capture",
  "clipboard-read",
  "openExternal"
]);

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

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.userAgentFallback = getBrowserUserAgent();

function getVaultPath() {
  return path.join(app.getPath("userData"), "vault.bin");
}

function getSitesPath() {
  return path.join(app.getPath("userData"), "sites.json");
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function getBrowserHistoryPath() {
  return path.join(app.getPath("userData"), "browser-history.json");
}

function getDefaultVault() {
  return {
    installerDb: null,
    siteCredentials: {}
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
      siteCredentials: parsed.siteCredentials || {}
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

function getDefaultHtdocsPath() {
  const candidates = [
    "C:\\xampp\\htdocs",
    "C:\\Users\\Keval\\Saved Games\\xampp\\htdocs"
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function getDefaultXamppRootPath() {
  const defaultHtdocsPath = getDefaultHtdocsPath();
  return defaultHtdocsPath ? getXamppRootFromHtdocs(defaultHtdocsPath) : "";
}

function getXamppRootFromHtdocs(htdocsPath) {
  if (!htdocsPath) {
    return "";
  }

  const resolved = path.resolve(htdocsPath);
  if (path.basename(resolved).toLowerCase() === "htdocs") {
    return path.dirname(resolved);
  }

  return resolved;
}

function getResolvedHtdocsPath(settings) {
  if (settings?.htdocsPath) {
    return settings.htdocsPath;
  }

  if (settings?.xamppRootPath) {
    return path.join(settings.xamppRootPath, "htdocs");
  }

  return getDefaultHtdocsPath();
}

function pickFirstExistingPath(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function getXamppPathsSummary(settings) {
  const xamppRootPath = settings?.xamppRootPath || getXamppRootFromHtdocs(settings?.htdocsPath) || "";
  const htdocsPath = getResolvedHtdocsPath({ ...settings, xamppRootPath });
  const resolvedRoot = xamppRootPath || getXamppRootFromHtdocs(htdocsPath);

  if (!resolvedRoot) {
    return {
      xamppRootPath: "",
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
    xamppRootPath: resolvedRoot,
    htdocsPath,
    controlPanelPath: pickFirstExistingPath([path.join(resolvedRoot, "xampp-control.exe")]),
    apacheStartPath: pickFirstExistingPath([path.join(resolvedRoot, "apache_start.bat")]),
    apacheStopPath: pickFirstExistingPath([path.join(resolvedRoot, "apache_stop.bat")]),
    apacheConfigPath: pickFirstExistingPath([path.join(resolvedRoot, "apache", "conf", "httpd.conf")]),
    phpExecutablePath: pickFirstExistingPath([path.join(resolvedRoot, "php", "php.exe")]),
    phpConfigPath: pickFirstExistingPath([
      path.join(resolvedRoot, "php", "php.ini"),
      path.join(resolvedRoot, "php", "php-development.ini")
    ]),
    mysqlConfigPath: pickFirstExistingPath([
      path.join(resolvedRoot, "mysql", "bin", "my.ini"),
      path.join(resolvedRoot, "mysql", "data", "my.ini"),
      path.join(resolvedRoot, "mysql", "backup", "my.ini")
    ]),
    phpMyAdminPath: pickFirstExistingPath([path.join(resolvedRoot, "phpMyAdmin")])
  };
}

function detectXamppDbProfile(htdocsPath) {
  const xamppRoot = getXamppRootFromHtdocs(htdocsPath);
  if (!xamppRoot) {
    return null;
  }

  const candidates = [
    path.join(xamppRoot, "mysql", "bin", "my.ini"),
    path.join(xamppRoot, "mysql", "data", "my.ini"),
    path.join(xamppRoot, "mysql", "backup", "my.ini")
  ];

  for (const configPath of candidates) {
    if (!fs.existsSync(configPath)) {
      continue;
    }

    const source = fs.readFileSync(configPath, "utf8");
    const portMatch = source.match(/^\s*port\s*=\s*(\d+)\s*$/im);
    return {
      host: "127.0.0.1",
      port: portMatch?.[1] || "3306",
      user: "root",
      password: ""
    };
  }

  return null;
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
  return {
    xamppRootPath: getDefaultXamppRootPath(),
    htdocsPath: getDefaultHtdocsPath(),
    downloadDirectory: app.getPath("downloads"),
    browserPermissions: {},
    browserBookmarks: [],
    browserShowBookmarksBar: true
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
  const bookmarks = Array.isArray(input.browserBookmarks)
    ? input.browserBookmarks
        .map((bookmark) => ({
          id: String(bookmark?.id || "").trim(),
          title: String(bookmark?.title || "").trim(),
          url: String(bookmark?.url || "").trim(),
          iconOnly: Boolean(bookmark?.iconOnly)
        }))
        .filter((bookmark) => bookmark.id && /^https?:\/\//i.test(bookmark.url))
    : [];

  return {
    xamppRootPath: input.xamppRootPath || getXamppRootFromHtdocs(input.htdocsPath || "") || getDefaultXamppRootPath(),
    htdocsPath: input.htdocsPath || (input.xamppRootPath ? path.join(input.xamppRootPath, "htdocs") : getDefaultHtdocsPath()),
    downloadDirectory: input.downloadDirectory || app.getPath("downloads"),
    browserPermissions: permissions,
    browserBookmarks: bookmarks,
    browserShowBookmarksBar: input.browserShowBookmarksBar !== false
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

function getBrowserUserAgent() {
  const chromeVersion = process.versions.chrome || "126.0.0.0";
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
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
    const response = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(raw)}&type=list`, {
      headers: {
        "user-agent": getBrowserUserAgent()
      }
    });

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

function getPartitionForUrl(url, tabId, mode = "auto") {
  if (mode === "personal") {
    try {
      const parsed = new URL(url);
      return `persist:personal-${parsed.origin.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
    } catch (_) {
      return `persist:personal-${tabId}`;
    }
  }

  if (mode === "isolated") {
    return `isolated-${tabId}`;
  }

  try {
    const parsed = new URL(url);
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (isLocal) {
      return `persist:local-${parsed.origin.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
    }
  } catch (_) {
    return `isolated-${tabId}`;
  }

  return `isolated-${tabId}`;
}

function buildBrowserWebPreferences(partition) {
  return {
    partition,
    sandbox: false,
    contextIsolation: true,
    nodeIntegration: false,
    javascript: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: true
  };
}

function getPermissionOrigin(details = {}) {
  const candidate = details.requestingUrl || details.requestingOrigin || details.externalURL || "";

  try {
    return new URL(candidate).origin;
  } catch (_) {
    return candidate || "this site";
  }
}

function promptBrowserPermission(win, permission, details) {
  const target = getPermissionOrigin(details);
  const response = dialog.showMessageBoxSync(win, {
    type: "question",
    buttons: ["Allow", "Block"],
    defaultId: 0,
    cancelId: 1,
    title: "Site permission request",
    message: `${target} wants to use ${permission}.`,
    detail: "Allow access only if you trust this site."
  });

  return response === 0;
}

function checkBrowserPermission(permission, details) {
  const origin = getPermissionOrigin(details);
  const savedDecision = getStoredPermissionDecision(origin, permission);
  if (savedDecision) {
    return savedDecision === "allow";
  }

  return AUTO_ALLOWED_BROWSER_PERMISSIONS.has(permission);
}

function requestBrowserPermission(win, permission, details) {
  const origin = getPermissionOrigin(details);
  const savedDecision = getStoredPermissionDecision(origin, permission);
  if (savedDecision) {
    return savedDecision === "allow";
  }

  if (AUTO_ALLOWED_BROWSER_PERMISSIONS.has(permission)) {
    return true;
  }

  if (PROMPTED_BROWSER_PERMISSIONS.has(permission)) {
    const allowed = promptBrowserPermission(win, permission, details);
    savePermissionDecision(origin, permission, allowed ? "allow" : "block");
    return allowed;
  }

  return false;
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

function saveBrowserBookmark({ title, url }) {
  const normalizedUrl = ensureUrl(url);
  const settings = getSettings();
  const existing = (settings.browserBookmarks || []).find((bookmark) => bookmark.url === normalizedUrl);
  if (existing) {
    existing.title = title || existing.title || normalizedUrl;
    saveSettings(settings);
    return existing;
  }

  const bookmark = {
    id: `bookmark-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: title || normalizedUrl,
    url: normalizedUrl,
    iconOnly: false
  };
  settings.browserBookmarks = [bookmark, ...(settings.browserBookmarks || [])];
  saveSettings(settings);
  return bookmark;
}

function removeBrowserBookmark(bookmarkId) {
  if (!bookmarkId) {
    return false;
  }

  const settings = getSettings();
  const beforeCount = (settings.browserBookmarks || []).length;
  settings.browserBookmarks = (settings.browserBookmarks || []).filter((bookmark) => bookmark.id !== bookmarkId);
  if (settings.browserBookmarks.length === beforeCount) {
    return false;
  }

  saveSettings(settings);
  return true;
}

function updateBrowserBookmark(bookmarkId, changes = {}) {
  if (!bookmarkId) {
    throw new Error("Missing bookmark id.");
  }

  const settings = getSettings();
  const bookmark = (settings.browserBookmarks || []).find((item) => item.id === bookmarkId);
  if (!bookmark) {
    throw new Error("Bookmark not found.");
  }

  if (typeof changes.title === "string") {
    bookmark.title = changes.title.trim() || bookmark.title || bookmark.url;
  }
  if (typeof changes.url === "string") {
    bookmark.url = ensureUrl(changes.url);
  }
  if (typeof changes.iconOnly === "boolean") {
    bookmark.iconOnly = changes.iconOnly;
  }

  saveSettings(settings);
  return bookmark;
}

function copyBrowserBookmark(bookmarkId, removeAfterCopy = false) {
  const settings = getSettings();
  const bookmark = (settings.browserBookmarks || []).find((item) => item.id === bookmarkId);
  if (!bookmark) {
    throw new Error("Bookmark not found.");
  }

  clipboard.writeText(JSON.stringify({
    type: "wpdesktop-bookmark",
    bookmark
  }));

  if (removeAfterCopy) {
    settings.browserBookmarks = (settings.browserBookmarks || []).filter((item) => item.id !== bookmarkId);
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

  if (parsed?.type !== "wpdesktop-bookmark" || !parsed.bookmark?.url) {
    throw new Error("Clipboard does not contain a bookmark.");
  }

  return saveBrowserBookmark({
    title: parsed.bookmark.title,
    url: parsed.bookmark.url
  });
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

function configureBrowserSession(win, partition) {
  if (configuredBrowserPartitions.has(partition)) {
    return;
  }

  const browserSession = session.fromPartition(partition);
  browserSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) =>
    checkBrowserPermission(permission, { requestingOrigin, ...(details || {}) })
  );
  browserSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(requestBrowserPermission(win, permission, details));
  });
  attachDownloadTracking(win, browserSession);
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
  return (await testPort("127.0.0.1", 80)) || (await testPort("127.0.0.1", 443));
}

async function buildSitesFromHtdocs() {
  const settings = getSettings();
  const htdocsPath = getResolvedHtdocsPath(settings);
  const savedSites = getSites();
  const savedMap = new Map(savedSites.map((site) => [site.id, site]));
  const apacheRunning = await isApacheRunning();

  if (!htdocsPath || !fs.existsSync(htdocsPath)) {
    return { htdocsPath, apacheRunning, sites: savedSites };
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
        databaseVersion: saved.databaseVersion || "MySQL via XAMPP",
        phpVersion: saved.phpVersion || "PHP via XAMPP",
        webServer: "Apache via XAMPP",
        wordpressVersion: saved.wordpressVersion || "Detected from folder",
        extractedCount: saved.extractedCount || null,
        lastStartedAt: saved.lastStartedAt || null,
        status: apacheRunning ? "running" : "stopped",
        sslPath: saved.sslPath || `${siteName}.crt`,
        isWordPress: true
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { htdocsPath, apacheRunning, sites: scannedSites };
}

function sanitizeDbName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "wordpress";
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
    dbPort: port
  };
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

function getBackupDefaultPath(siteName) {
  const safeName = (siteName || "wordpress-site").replace(/[^a-z0-9_-]/gi, "-");
  return path.join(app.getPath("documents"), `${safeName}-backup-${getBackupTimestamp()}.zip`);
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
  const savePath = String(payload?.savePath || "").trim();

  if (!site?.path || !site?.id) {
    throw new Error("Missing site details.");
  }

  if (!savePath || path.extname(savePath).toLowerCase() !== ".zip") {
    throw new Error("Select a valid backup zip path.");
  }

  const settings = getSettings();
  const resolvedSitePath = path.resolve(site.path);
  if (!fs.existsSync(resolvedSitePath)) {
    throw new Error("The site folder no longer exists.");
  }

  const wpConfig = parseWpConfig(resolvedSitePath) || {};
  const detectedDb = detectXamppDbProfile(getResolvedHtdocsPath(settings));
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

  ensureDir(path.dirname(savePath));

  const tempRoot = fs.mkdtempSync(path.join(app.getPath("temp"), "wpdesktop-backup-"));
  const sqlPath = path.join(tempRoot, `${site.name || "site"}-database.sql`);
  const metadataPath = path.join(tempRoot, "backup.json");

  try {
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
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

    const zip = new AdmZip();
    zip.addLocalFolder(resolvedSitePath, site.name || path.basename(resolvedSitePath));
    zip.addLocalFile(sqlPath, "database");
    zip.addLocalFile(metadataPath);
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

  if (!fs.existsSync(resolvedSitePath)) {
    throw new Error("The site folder no longer exists.");
  }

  if (resolvedHtdocsPath && !isPathInside(resolvedHtdocsPath, resolvedSitePath)) {
    throw new Error("Refusing to delete a site outside the configured htdocs folder.");
  }

  const installerDb = getVault().installerDb || {};
  const wpConfig = parseWpConfig(resolvedSitePath) || {};
  const detectedDb = detectXamppDbProfile(getResolvedHtdocsPath(settings));
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
      label: "xampp-detected",
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

  fs.rmSync(resolvedSitePath, { recursive: true, force: true });

  const remainingSites = getSites().filter((entry) => entry.id !== site.id);
  saveSites(remainingSites);

  return {
    ok: true,
    deletedSiteId: site.id,
    deletedPath: resolvedSitePath,
    deletedDatabase: dbName
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
      activeTabId: null,
      attachedTabId: null,
      browserBounds: null,
      browserVisible: false,
      downloads: []
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
  const bookmarkEntries = getBrowserBookmarks();
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
  return {
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title || tab.url,
      url: tab.url,
      error: tab.error || null
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
    savedPermissions: getSavedPermissionsList()
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

function emitSitesChanged(win) {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.webContents.send("sites:changed");
}

function findTabByWebContents(win, webContents) {
  return getBrowserState(win).tabs.find((tab) => tab.view.webContents === webContents) || null;
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
      win.contentView.removeChildView(active.view);
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
    win.contentView.addChildView(active.view);
    state.attachedTabId = active.id;
  }

  active.view.setBounds(state.browserBounds);
}

function buildContextMenu(win, tab, params) {
  const linkUrl = params.linkURL || tab.url;
  const menu = Menu.buildFromTemplate([
    {
      label: "Open link in new tab",
      enabled: Boolean(linkUrl),
      click: () => createBrowserTab(win, linkUrl, "auto", true)
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
      click: () => shell.openExternal(`https://www.google.com/searchbyimage?image_url=${encodeURIComponent(linkUrl)}`)
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
      const { ipcRenderer } = require("electron");
      const requestId = ${JSON.stringify(requestId)};
      const input = document.getElementById("title-input");
      const closeButton = document.getElementById("close-button");
      const doneButton = document.getElementById("done-button");
      const removeButton = document.getElementById("remove-button");
      const moreButton = document.getElementById("more-button");

      const send = (result) => ipcRenderer.send("browser:bookmark-dialog-result", { requestId, result });

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
        sandbox: false,
        contextIsolation: false,
        nodeIntegration: true
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

function wireTabEvents(win, tab) {
  const wc = tab.view.webContents;

  wc.setWindowOpenHandler((details) => {
    createBrowserTab(win, details.url, "auto", true);
    return { action: "deny" };
  });

  wc.on("did-start-loading", () => {
    tab.error = null;
    emitBrowserState(win);
  });

  wc.on("page-title-updated", (event, title) => {
    event.preventDefault();
    tab.title = title || tab.url;
    recordBrowserHistoryVisit(tab.url, tab.title, false);
    emitBrowserState(win);
  });

  wc.on("did-navigate", (_event, url) => {
    tab.url = url;
    tab.error = null;
    recordBrowserHistoryVisit(tab.url, tab.title);
    emitBrowserState(win);
  });

  wc.on("did-navigate-in-page", (_event, url) => {
    tab.url = url;
    recordBrowserHistoryVisit(tab.url, tab.title);
    emitBrowserState(win);
  });

  wc.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) {
      return;
    }

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
}

function createBrowserTab(win, url, mode = "auto", activate = true) {
  const state = getBrowserState(win);
  const resolvedUrl = ensureUrl(url);
  const id = `tab-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const partition = getPartitionForUrl(resolvedUrl, id, mode);
  configureBrowserSession(win, partition);
  const view = new WebContentsView({
    webPreferences: buildBrowserWebPreferences(partition)
  });

  const tab = {
    id,
    title: "New Tab",
    url: resolvedUrl,
    mode,
    partition,
    error: null,
    view
  };

  wireTabEvents(win, tab);
  view.webContents.setUserAgent(getBrowserUserAgent());
  state.tabs.push(tab);

  if (activate || !state.activeTabId) {
    state.activeTabId = id;
  }

  wcSafeLoadURL(view.webContents, resolvedUrl);
  attachActiveView(win);
  emitBrowserState(win);
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
  if (state.attachedTabId === tab.id) {
    detachActiveView(win);
  }
  tab.view.webContents.close({ waitForBeforeUnload: false });

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
  if (!active) {
    createBrowserTab(win, url, "auto", true);
    return;
  }

  const resolvedUrl = ensureUrl(url);
  const nextPartition = getPartitionForUrl(resolvedUrl, active.id, active.mode);

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
    active.view = new WebContentsView({
      webPreferences: buildBrowserWebPreferences(nextPartition)
    });
    wireTabEvents(win, active);
    active.view.webContents.setUserAgent(getBrowserUserAgent());
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

function sendUrlToWindow(win, startupUrl, startupMode = "auto") {
  if (!win || win.isDestroyed() || !startupUrl) {
    return;
  }

  createBrowserTab(win, startupUrl, startupMode, true);
  win.webContents.send("browser:focus");
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

function getApacheScriptPaths(htdocsPath) {
  const xamppRoot = getXamppRootFromHtdocs(htdocsPath);
  if (!xamppRoot) {
    return null;
  }

  const startPath = path.join(xamppRoot, "apache_start.bat");
  const stopPath = path.join(xamppRoot, "apache_stop.bat");

  if (!fs.existsSync(startPath) || !fs.existsSync(stopPath)) {
    return null;
  }

  return { startPath, stopPath };
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

  const apacheScripts = getApacheScriptPaths(getResolvedHtdocsPath(getSettings()));
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
  const apacheScripts = getApacheScriptPaths(getResolvedHtdocsPath(getSettings()));
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

function registerAsBrowser() {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient("http", process.execPath, [path.resolve(process.argv[1])]);
    app.setAsDefaultProtocolClient("https", process.execPath, [path.resolve(process.argv[1])]);
    return;
  }

  app.setAsDefaultProtocolClient("http");
  app.setAsDefaultProtocolClient("https");
}

function createWindow(options = {}) {
  const isSplit = Boolean(options.splitScreen);
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: isSplit ? Math.floor(workArea.width / 2) : 1440,
    height: isSplit ? workArea.height : 920,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#f3f1ee",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
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
  registerAsBrowser();
  createWindow({ startupUrl: findLaunchUrl() || getDefaultStartupUrl() });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({ startupUrl: getDefaultStartupUrl() });
    }
  });
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  const target = lastFocusedWindow || BrowserWindow.getAllWindows()[0];
  if (target) {
    sendUrlToWindow(target, url);
  } else {
    createWindow({ startupUrl: url });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
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
  const siteCredentials = getVault().siteCredentials;
  const saved = siteCredentials[urlKey] || siteCredentials[authKey];

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
  if (!win || !payload?.bookmark?.id || !payload?.bookmark?.url) {
    return false;
  }

  showBookmarkContextMenu(win, payload.bookmark, payload.showBookmarksBar !== false);
  return true;
});

ipcMain.handle("browser:show-bookmark-save-dialog", async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return { action: "cancel" };
  }

  return showBookmarkSaveDialog(win, payload || {});
});

ipcMain.handle("db:test", async (_event, config) => {
  const connection = await mysql.createConnection({
    host: config.host || "127.0.0.1",
    port: Number(config.port) || 3306,
    user: config.user || "root",
    password: config.password || ""
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
  return getVault().siteCredentials[key] || null;
});

ipcMain.handle("vault:save-site-credentials", (_event, payload) => {
  if (!payload.key) {
    throw new Error("Missing credential key.");
  }

  const vault = getVault();
  vault.siteCredentials[payload.key] = {
    username: payload.username || "",
    password: payload.password || ""
  };
  saveVault(vault);
  return true;
});

ipcMain.handle("vault:clear-site-credentials", (_event, key) => {
  if (!key) {
    return true;
  }

  const vault = getVault();
  delete vault.siteCredentials[key];
  saveVault(vault);
  return true;
});

ipcMain.handle("settings:get", async () => {
  const settings = getSettings();
  const apacheRunning = await isApacheRunning();
  const xamppPaths = getXamppPathsSummary(settings);
  return {
    ...settings,
    htdocsPath: getResolvedHtdocsPath(settings),
    apacheRunning,
    detectedDbProfile: detectXamppDbProfile(getResolvedHtdocsPath(settings)),
    xamppPaths
  };
});

ipcMain.handle("settings:set-htdocs", async (_event, htdocsPath) => {
  const settings = getSettings();
  settings.htdocsPath = htdocsPath || "";
  settings.xamppRootPath = getXamppRootFromHtdocs(settings.htdocsPath) || settings.xamppRootPath || "";
  saveSettings(settings);
  const apacheRunning = await isApacheRunning();
  const xamppPaths = getXamppPathsSummary(settings);
  const resolvedHtdocsPath = getResolvedHtdocsPath(settings);
  return {
    ...settings,
    htdocsPath: resolvedHtdocsPath,
    apacheRunning,
    detectedDbProfile: detectXamppDbProfile(resolvedHtdocsPath),
    xamppPaths
  };
});

ipcMain.handle("settings:set-xampp-root", async (_event, xamppRootPath) => {
  const settings = getSettings();
  settings.xamppRootPath = xamppRootPath || "";
  settings.htdocsPath = xamppRootPath ? path.join(xamppRootPath, "htdocs") : "";
  saveSettings(settings);
  const apacheRunning = await isApacheRunning();
  const xamppPaths = getXamppPathsSummary(settings);
  const resolvedHtdocsPath = getResolvedHtdocsPath(settings);
  return {
    ...settings,
    htdocsPath: resolvedHtdocsPath,
    apacheRunning,
    detectedDbProfile: detectXamppDbProfile(resolvedHtdocsPath),
    xamppPaths
  };
});

ipcMain.handle("sites:list", async () => buildSitesFromHtdocs());

ipcMain.handle("sites:backup", async (_event, payload) => {
  return backupSiteResources(payload);
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
  const resolvedHtdocsPath = getResolvedHtdocsPath(settings);
  const basePath = (payload.basePath || resolvedHtdocsPath || "").trim();
  const folderName = (payload.folderName || "").trim();
  const zipPath = (payload.zipPath || "").trim();

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
  const detectedDbProfile = detectXamppDbProfile(basePath || resolvedHtdocsPath);
  const databaseProfile = resolveDbProfile(payload.database || {}, detectedDbProfile);

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
    databaseVersion: "MySQL via XAMPP",
    phpVersion: payload.phpVersion || "PHP via XAMPP",
    webServer: "Apache via XAMPP",
    wordpressVersion: payload.wordpressVersion || "From zip package",
    extractedCount: extracted.extractedCount,
    lastStartedAt: new Date().toISOString(),
    status: "running",
    sslPath: `${siteName}.crt`,
    isWordPress: true
  };

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
