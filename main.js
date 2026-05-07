const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn } = require("child_process");
const {
  app,
  BrowserWindow,
  BrowserView,
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
const VAULT_CAPTURE_LOG_PREFIX = "__WP_DESKTOP_SAVE_CREDENTIAL__:";

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

function getBrowserHistoryPath() {
  return path.join(app.getPath("userData"), "browser-history.json");
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

function readMysqlConfigContent(settings) {
  const mysqlConfigPath = getXamppPathsSummary(settings).mysqlConfigPath;
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
    const parsed = parseMysqlConfigProfile(source);
    return {
      host: parsed.host || "127.0.0.1",
      port: parsed.port || "3306",
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
    dbUser: "root",
    dbPassword: "",
    wpInstallUsername: "admin",
    wpInstallPassword: "root",
    wpInstallEmail: "",
    shareLocalSiteSessions: true,
    shareOnlineSiteSessions: false,
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

  return {
    xamppRootPath: input.xamppRootPath || getXamppRootFromHtdocs(input.htdocsPath || "") || getDefaultXamppRootPath(),
    htdocsPath: input.htdocsPath || (input.xamppRootPath ? path.join(input.xamppRootPath, "htdocs") : getDefaultHtdocsPath()),
    dbUser: String(input.dbUser || "root").trim() || "root",
    dbPassword: input.dbPassword ?? "",
    wpInstallUsername: String(input.wpInstallUsername || "admin").trim() || "admin",
    wpInstallPassword: input.wpInstallPassword ?? "root",
    wpInstallEmail: String(input.wpInstallEmail || "").trim(),
    shareLocalSiteSessions: input.shareLocalSiteSessions !== false,
    shareOnlineSiteSessions: input.shareOnlineSiteSessions === true,
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

function getPartitionForUrl(url, tabId, mode = "auto", group = null) {
  const settings = getSettings();

  if (mode === "isolated") {
    return `${mode}:${tabId}`;
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

function copyBrowserBookmark(bookmarkId, removeAfterCopy = false) {
  const settings = getSettings();
  const found = findBookmarkNodeAndParent(settings.browserBookmarks || [], bookmarkId);
  const bookmark = found?.node;
  if (!bookmark || bookmark.type === "folder") {
    throw new Error("Bookmark not found.");
  }

  clipboard.writeText(JSON.stringify({
    type: "wpdesktop-bookmark",
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
  attachDownloadTracking(win, browserSession);
  browserSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    try {
      const hostname = requestingOrigin ? new URL(requestingOrigin).hostname : "";
      const googleOrigin = hostname === "accounts.google.com" || hostname.endsWith(".google.com");
      if (googleOrigin && ["hid", "usb", "serial"].includes(permission)) {
        return true;
      }
    } catch (_) {
      // Ignore malformed origins.
    }

    return false;
  });

  browserSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    try {
      const requestingUrl = details?.requestingUrl || "";
      const hostname = requestingUrl ? new URL(requestingUrl).hostname : "";
      const googleOrigin = hostname === "accounts.google.com" || hostname.endsWith(".google.com");
      if (googleOrigin && ["hid", "usb", "serial"].includes(permission)) {
        callback(true);
        return;
      }
    } catch (_) {
      // Ignore malformed request origins and fall through to deny.
    }

    callback(false);
  });

  browserSession.setDevicePermissionHandler((details) => {
    try {
      const hostname = details?.origin ? new URL(details.origin).hostname : "";
      const googleOrigin = hostname === "accounts.google.com" || hostname.endsWith(".google.com");
      return googleOrigin && ["hid", "usb", "serial"].includes(details.deviceType);
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
        databaseVersion: saved.databaseVersion || "MySQL via XAMPP",
        phpVersion: saved.phpVersion || "PHP via XAMPP",
        webServer: "Apache via XAMPP",
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

  return { htdocsPath, apacheRunning, sites: scannedSites };
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
    throw new Error("XAMPP htdocs or site path is missing.");
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

function copyIfExists(sourcePath, destinationPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return false;
  }

  ensureDir(path.dirname(destinationPath));
  fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
  return true;
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

  try {
    ensureDir(packageRoot);
    ensureDir(path.join(packageRoot, "database"));
    ensureDir(path.join(packageRoot, "site-content"));

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
        includes: ["wp-content/plugins", "wp-content/themes", "wp-content/uploads", "wp-config.php"]
      },
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

    const wpContentPath = path.join(resolvedSitePath, "wp-content");
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

  if (!fs.existsSync(resolvedSitePath)) {
    throw new Error("The site folder no longer exists.");
  }

  if (resolvedHtdocsPath && !isPathInside(resolvedHtdocsPath, resolvedSitePath)) {
    throw new Error("Refusing to delete a site outside the configured htdocs folder.");
  }

  const backupResult = await backupSiteResources({
    site,
    database: manualDatabase,
    savePath: payload?.savePath || getBackupDefaultPath(site.name, resolvedSitePath)
  });

  const installerDb = getVault().installerDb || {};
  const wpConfig = parseWpConfig(resolvedSitePath) || {};
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
    backupPath: backupResult?.savePath || null,
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
      tabGroups: [],
      activeTabId: null,
      attachedTabId: null,
      browserBounds: null,
      browserVisible: false,
      downloads: [],
      closedTabs: []
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
  return {
    tabs: state.tabs.map((tab) => ({
      groupId: tab.groupId || null,
      groupName: getTabGroupById(state, tab.groupId)?.name || "",
      id: tab.id,
      title: tab.nickname || tab.title || tab.url,
      url: tab.url,
      isLoading: Boolean(tab.isLoading),
      error: tab.error || null,
      pinned: Boolean(tab.pinned),
      muted: Boolean(tab.muted),
      nickname: tab.nickname || "",
      partition: tab.partition,
      sessionProfileName: getSessionProfileName(tab.partition)
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
  emitBrowserState(win);
  return true;
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
  replaceTabViewWithPartition(win, tab, getTabGroupPartitionName(group), tab.url);
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
  replaceTabViewWithPartition(win, tab, getPartitionForUrl(tab.url, tab.id, tab.mode), tab.url);
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
  replaceTabViewWithPartition(win, tab, getTabGroupPartitionName(group), tab.url);
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
      replaceTabViewWithPartition(win, tab, getPartitionForUrl(tab.url, tab.id, tab.mode), tab.url);
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

function wireTabEvents(win, tab) {
  const wc = tab.view.webContents;

  wc.on("select-bluetooth-device", (_event, deviceList, callback) => {
    const preferred = (deviceList || []).find((device) => Boolean(device?.deviceId));
    callback(preferred?.deviceId || "");
  });

  wc.setWindowOpenHandler((details) => {
    createBrowserTab(win, details.url, tab.mode || "auto", true, null, {
      groupId: tab.groupId || null
    });
    return { action: "deny" };
  });

  wc.on("did-start-loading", () => {
    tab.isLoading = true;
    tab.error = null;
    emitBrowserState(win);
  });

  wc.on("did-stop-loading", () => {
    tab.isLoading = false;
    emitBrowserState(win);
    void maybeAutoFillWordPressBootstrap(tab);
    maybePrepareMultisiteSiteForUrl(win, tab.url);
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
    void maybeAutoFillWordPressBootstrap(tab);
    maybePrepareMultisiteSiteForUrl(win, tab.url);
  });

  wc.on("did-navigate-in-page", (_event, url) => {
    tab.url = url;
    recordBrowserHistoryVisit(tab.url, tab.title);
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

      const vault = getVault();
      saveVaultCredential(vault, { key, username, password });
      saveVault(vault);
      tab.pendingCredentialCaptureToken = null;
      win.webContents.send("browser:notice", {
        message: `Saved credentials for ${key} to the vault.`,
        type: "success"
      });
    } catch (_) {
      // Ignore malformed page messages.
    }
  });
}

function createBrowserTab(win, url, mode = "auto", activate = true, insertIndex = null, tabOptions = {}) {
  const state = getBrowserState(win);
  const resolvedUrl = ensureUrl(url);
  const id = `tab-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  const group = getTabGroupById(state, tabOptions.groupId);
  const partition = getPartitionForUrl(resolvedUrl, id, mode, group);
  configureBrowserSession(win, partition);
  const view = new BrowserView({
    webPreferences: buildBrowserWebPreferences(partition)
  });

  const tab = {
    id,
    title: "New Tab",
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
  if (!active) {
    createBrowserTab(win, url, "auto", true);
    return;
  }

  const resolvedUrl = ensureUrl(url);
  const nextPartition = getPartitionForUrl(resolvedUrl, active.id, active.mode, getTabGroupForTab(state, active));

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
      submenu: [{ label: "Coming soon", enabled: false }]
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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({ startupUrl: getDefaultStartupUrl() });
    }
  });
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
  const apacheRunning = await isApacheRunning();
  const xamppPaths = getXamppPathsSummary(settings);
  return {
    ...settings,
    htdocsPath: getResolvedHtdocsPath(settings),
    apacheRunning,
    detectedDbProfile: detectXamppDbProfile(getResolvedHtdocsPath(settings)),
    effectiveDbProfile: getEffectiveDbProfile(settings),
    mysqlConfigContent: readMysqlConfigContent(settings),
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
    effectiveDbProfile: getEffectiveDbProfile(settings),
    mysqlConfigContent: readMysqlConfigContent(settings),
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
    effectiveDbProfile: getEffectiveDbProfile(settings),
    mysqlConfigContent: readMysqlConfigContent(settings),
    xamppPaths
  };
});

ipcMain.handle("settings:set-local-session-sharing", async (_event, enabled) => {
  const settings = getSettings();
  settings.shareLocalSiteSessions = enabled !== false;
  saveSettings(settings);
  const apacheRunning = await isApacheRunning();
  return {
    ...settings,
    htdocsPath: getResolvedHtdocsPath(settings),
    apacheRunning,
    detectedDbProfile: detectXamppDbProfile(getResolvedHtdocsPath(settings)),
    effectiveDbProfile: getEffectiveDbProfile(settings),
    mysqlConfigContent: readMysqlConfigContent(settings),
    xamppPaths: getXamppPathsSummary(settings)
  };
});

ipcMain.handle("settings:set-online-session-sharing", async (_event, enabled) => {
  const settings = getSettings();
  settings.shareOnlineSiteSessions = enabled === true;
  saveSettings(settings);
  const apacheRunning = await isApacheRunning();
  return {
    ...settings,
    htdocsPath: getResolvedHtdocsPath(settings),
    apacheRunning,
    detectedDbProfile: detectXamppDbProfile(getResolvedHtdocsPath(settings)),
    effectiveDbProfile: getEffectiveDbProfile(settings),
    mysqlConfigContent: readMysqlConfigContent(settings),
    xamppPaths: getXamppPathsSummary(settings)
  };
});

ipcMain.handle("settings:save-mysql-config", async (_event, payload) => {
  const settings = getSettings();
  const xamppPaths = getXamppPathsSummary(settings);
  if (!xamppPaths.mysqlConfigPath) {
    throw new Error("MySQL config file was not found.");
  }

  fs.writeFileSync(xamppPaths.mysqlConfigPath, String(payload.content || ""), "utf8");
  settings.dbUser = String(payload.dbUser || "root").trim() || "root";
  settings.dbPassword = payload.dbPassword ?? "";
  settings.wpInstallUsername = String(payload.wpInstallUsername || "admin").trim() || "admin";
  settings.wpInstallPassword = payload.wpInstallPassword ?? "root";
  settings.wpInstallEmail = String(payload.wpInstallEmail || "").trim();
  saveSettings(settings);

  const apacheRunning = await isApacheRunning();
  return {
    ...settings,
    htdocsPath: getResolvedHtdocsPath(settings),
    apacheRunning,
    detectedDbProfile: detectXamppDbProfile(getResolvedHtdocsPath(settings)),
    effectiveDbProfile: getEffectiveDbProfile(settings),
    mysqlConfigContent: readMysqlConfigContent(settings),
    xamppPaths: getXamppPathsSummary(settings)
  };
});

ipcMain.handle("settings:save-wp-install-defaults", async (_event, payload) => {
  const settings = getSettings();
  settings.wpInstallUsername = String(payload?.wpInstallUsername || "admin").trim() || "admin";
  settings.wpInstallPassword = payload?.wpInstallPassword ?? "root";
  settings.wpInstallEmail = String(payload?.wpInstallEmail || "").trim();
  saveSettings(settings);

  const apacheRunning = await isApacheRunning();
  return {
    ...settings,
    htdocsPath: getResolvedHtdocsPath(settings),
    apacheRunning,
    detectedDbProfile: detectXamppDbProfile(getResolvedHtdocsPath(settings)),
    effectiveDbProfile: getEffectiveDbProfile(settings),
    mysqlConfigContent: readMysqlConfigContent(settings),
    xamppPaths: getXamppPathsSummary(settings)
  };
});

ipcMain.handle("sites:list", async () => buildSitesFromHtdocs());

ipcMain.handle("sites:backup", async (_event, payload) => {
  return backupSiteResources(payload);
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
    databaseVersion: "MySQL via XAMPP",
    phpVersion: payload.phpVersion || "PHP via XAMPP",
    webServer: "Apache via XAMPP",
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

ipcMain.handle("shell:open-path", async (_event, targetPath) => {
  await shell.openPath(targetPath);
});
