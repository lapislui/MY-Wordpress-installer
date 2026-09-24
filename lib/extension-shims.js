// Electron implements only part of the chrome.* extension API. Many store
// extensions touch alarms, notifications, context menus or windows during
// startup and crash when those namespaces are undefined. These shims fill the
// gaps (real timers for alarms, real notifications, inert stubs for menus and
// windows) without ever replacing an API Electron does provide.

const fs = require("fs");
const path = require("path");

const SHIM_FILE = "wpd-api-shims.js";
const SW_WRAPPER_FILE = "wpd-service-worker.js";

// APIs Electron 31 provides to extensions (docs: "Supported Extensions APIs").
const SUPPORTED_PERMISSIONS = new Set([
  "activeTab", "storage", "unlimitedStorage", "tabs", "scripting", "webRequest",
  "webRequestBlocking", "management", "i18n", "runtime", "extension",
  // Shimmed below: present and non-crashing, with the limits noted.
  "alarms", "notifications", "contextMenus", "menus", "permissions"
]);

// Permissions whose absence breaks the extension's core purpose.
const UNSUPPORTED_EXPLANATIONS = {
  declarativeNetRequest: "content blocking rules",
  declarativeNetRequestWithHostAccess: "content blocking rules",
  declarativeNetRequestFeedback: "content blocking rules",
  offscreen: "offscreen documents",
  sidePanel: "the side panel",
  identity: "Google sign-in",
  cookies: "cookie access",
  downloads: "downloads",
  history: "browsing history",
  bookmarks: "bookmarks",
  proxy: "proxy settings",
  tts: "text-to-speech",
  webNavigation: "navigation events",
  userScripts: "user scripts",
  nativeMessaging: "native helper apps",
  debugger: "the debugger API",
  pageCapture: "page capture",
  tabCapture: "tab capture",
  desktopCapture: "screen capture",
  privacy: "privacy settings",
  sessions: "recently closed tabs",
  topSites: "top sites",
  fontSettings: "font settings",
  search: "search engines",
  tabGroups: "tab groups"
};

const SHIM_SOURCE = String.raw`/* WP Desktop extension API shims */
(function () {
  var g = typeof globalThis !== "undefined" ? globalThis : self;
  var c = g.chrome;
  if (!c || !c.runtime) { return; }

  function makeEvent() {
    var listeners = [];
    return {
      addListener: function (fn) { if (listeners.indexOf(fn) < 0) { listeners.push(fn); } },
      removeListener: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) { listeners.splice(i, 1); } },
      hasListener: function (fn) { return listeners.indexOf(fn) >= 0; },
      hasListeners: function () { return listeners.length > 0; },
      _dispatch: function () { var args = arguments; listeners.slice().forEach(function (fn) { try { fn.apply(null, args); } catch (e) { console.error(e); } }); }
    };
  }
  function done(cb, value) {
    if (typeof cb === "function") { setTimeout(function () { cb(value); }, 0); return undefined; }
    return Promise.resolve(value);
  }

  // Electron exposes chrome.storage.sync but every call on it fails (there is
  // no account to sync to), and the property can't be redefined, so swap in a
  // copy of chrome.storage whose "sync" area is the local one.
  var isElectron = typeof navigator !== "undefined" && /Electron\//.test(navigator.userAgent || "");
  if (isElectron && c.storage && c.storage.local) {
    var original = c.storage;
    var tryGet = function (name) { try { return original[name]; } catch (e) { return undefined; } };
    var replacement = { local: original.local, sync: original.local, onChanged: tryGet("onChanged") };
    var sessionArea = tryGet("session");
    var managedArea = tryGet("managed");
    if (sessionArea) { replacement.session = sessionArea; }
    if (managedArea) { replacement.managed = managedArea; }
    try { Object.defineProperty(c, "storage", { value: replacement, configurable: true, enumerable: true, writable: true }); } catch (e) { /* frozen */ }
  }

  if (c.extension) {
    if (typeof c.extension.isAllowedFileSchemeAccess !== "function") {
      c.extension.isAllowedFileSchemeAccess = function (cb) { return done(cb, true); };
    }
    if (typeof c.extension.isAllowedIncognitoAccess !== "function") {
      c.extension.isAllowedIncognitoAccess = function (cb) { return done(cb, false); };
    }
    if (typeof c.extension.getURL !== "function") {
      c.extension.getURL = function (p) { return c.runtime.getURL(p); };
    }
  }

  if (!c.alarms) {
    var alarms = {};
    var onAlarm = makeEvent();
    var fire = function (name) {
      var alarm = alarms[name];
      if (!alarm) { return; }
      onAlarm._dispatch({ name: name, scheduledTime: alarm.scheduledTime, periodInMinutes: alarm.periodInMinutes });
      if (alarm.periodInMinutes) {
        alarm.scheduledTime = Date.now() + alarm.periodInMinutes * 60000;
        alarm.timer = setTimeout(function () { fire(name); }, alarm.periodInMinutes * 60000);
      } else {
        delete alarms[name];
      }
    };
    var clearOne = function (name) {
      var alarm = alarms[name];
      if (!alarm) { return false; }
      clearTimeout(alarm.timer);
      delete alarms[name];
      return true;
    };
    var publicAlarm = function (name) {
      var a = alarms[name];
      return a ? { name: name, scheduledTime: a.scheduledTime, periodInMinutes: a.periodInMinutes } : undefined;
    };
    c.alarms = {
      onAlarm: onAlarm,
      create: function (name, info, cb) {
        if (typeof name === "object") { cb = info; info = name; name = ""; }
        info = info || {};
        clearOne(name);
        var delayMs = info.when ? Math.max(0, info.when - Date.now())
          : (info.delayInMinutes != null ? info.delayInMinutes : (info.periodInMinutes || 0)) * 60000;
        alarms[name] = { scheduledTime: Date.now() + delayMs, periodInMinutes: info.periodInMinutes };
        alarms[name].timer = setTimeout(function () { fire(name); }, delayMs);
        return done(cb);
      },
      get: function (name, cb) { if (typeof name === "function") { cb = name; name = ""; } return done(cb, publicAlarm(name || "")); },
      getAll: function (cb) { return done(cb, Object.keys(alarms).map(publicAlarm)); },
      clear: function (name, cb) { if (typeof name === "function") { cb = name; name = ""; } return done(cb, clearOne(name || "")); },
      clearAll: function (cb) { var had = Object.keys(alarms).length > 0; Object.keys(alarms).forEach(clearOne); return done(cb, had); }
    };
  }

  if (!c.notifications) {
    var shown = {};
    var counter = 0;
    c.notifications = {
      onClicked: makeEvent(), onClosed: makeEvent(), onButtonClicked: makeEvent(),
      create: function (id, options, cb) {
        if (typeof id === "object") { cb = options; options = id; id = ""; }
        id = id || "wpd-notification-" + (++counter);
        options = options || {};
        var icon = options.iconUrl ? c.runtime.getURL(String(options.iconUrl).replace(/^\//, "")) : undefined;
        try {
          if (g.registration && g.registration.showNotification) {
            g.registration.showNotification(options.title || "", { body: options.message || "", icon: icon, tag: id });
          } else if (typeof g.Notification === "function") {
            shown[id] = new g.Notification(options.title || "", { body: options.message || "", icon: icon, tag: id });
          }
        } catch (e) { /* Notifications can be blocked by the OS. */ }
        return done(cb, id);
      },
      update: function (id, options, cb) { return done(cb, false); },
      clear: function (id, cb) { if (shown[id]) { shown[id].close(); delete shown[id]; } return done(cb, true); },
      getAll: function (cb) { var all = {}; Object.keys(shown).forEach(function (k) { all[k] = true; }); return done(cb, all); },
      getPermissionLevel: function (cb) { return done(cb, "granted"); }
    };
  }

  if (!c.contextMenus) {
    var menuCounter = 0;
    c.contextMenus = {
      onClicked: makeEvent(),
      ACTION_MENU_TOP_LEVEL_LIMIT: 6,
      create: function (props, cb) { if (typeof cb === "function") { setTimeout(cb, 0); } return (props && props.id) || ++menuCounter; },
      update: function (id, props, cb) { return done(cb); },
      remove: function (id, cb) { return done(cb); },
      removeAll: function (cb) { return done(cb); }
    };
  }
  if (!c.menus) { c.menus = c.contextMenus; }

  if (!c.windows) {
    var win = { id: 1, focused: true, top: 0, left: 0, width: 1280, height: 800, incognito: false, type: "normal", state: "normal", alwaysOnTop: false };
    c.windows = {
      WINDOW_ID_NONE: -1, WINDOW_ID_CURRENT: -2,
      onCreated: makeEvent(), onRemoved: makeEvent(), onFocusChanged: makeEvent(), onBoundsChanged: makeEvent(),
      get: function (id, info, cb) { if (typeof info === "function") { cb = info; } return done(cb, win); },
      getCurrent: function (info, cb) { if (typeof info === "function") { cb = info; } return done(cb, win); },
      getLastFocused: function (info, cb) { if (typeof info === "function") { cb = info; } return done(cb, win); },
      getAll: function (info, cb) { if (typeof info === "function") { cb = info; } return done(cb, [win]); },
      create: function (info, cb) {
        if (info && info.url && c.tabs && c.tabs.create) { c.tabs.create({ url: Array.isArray(info.url) ? info.url[0] : info.url }); }
        return done(cb, win);
      },
      update: function (id, info, cb) { return done(cb, win); },
      remove: function (id, cb) { return done(cb); }
    };
  }

  if (!c.permissions) {
    // Everything declared in the manifest was granted at install time.
    var manifest = c.runtime.getManifest ? c.runtime.getManifest() : {};
    var granted = {
      permissions: [].concat(manifest.permissions || [], manifest.optional_permissions || []).filter(function (p) { return p.indexOf("://") < 0 && p !== "<all_urls>"; }),
      origins: [].concat(manifest.host_permissions || [], (manifest.permissions || []).filter(function (p) { return p.indexOf("://") >= 0 || p === "<all_urls>"; }))
    };
    var covers = function (request) {
      request = request || {};
      var perms = request.permissions || [];
      var origins = request.origins || [];
      return perms.every(function (p) { return granted.permissions.indexOf(p) >= 0; })
        && (origins.length === 0 || granted.origins.length > 0);
    };
    c.permissions = {
      onAdded: makeEvent(), onRemoved: makeEvent(),
      getAll: function (cb) { return done(cb, { permissions: granted.permissions.slice(), origins: granted.origins.slice() }); },
      contains: function (request, cb) { return done(cb, covers(request)); },
      request: function (request, cb) { return done(cb, covers(request)); },
      remove: function (request, cb) { return done(cb, false); }
    };
  }

  if (!c.commands) {
    c.commands = { onCommand: makeEvent(), getAll: function (cb) { return done(cb, []); } };
  }

  var action = c.action || c.browserAction;
  if (!action) {
    action = {};
    c.action = action;
  }
  ["setBadgeText", "setBadgeBackgroundColor", "setBadgeTextColor", "setTitle", "setIcon", "setPopup", "enable", "disable"].forEach(function (name) {
    if (typeof action[name] !== "function") { action[name] = function () { var cb = arguments[arguments.length - 1]; return done(typeof cb === "function" ? cb : null); }; }
  });
  ["getBadgeText", "getTitle", "getPopup"].forEach(function (name) {
    if (typeof action[name] !== "function") { action[name] = function (d, cb) { return done(cb, ""); }; }
  });
  if (!action.onClicked) { action.onClicked = makeEvent(); }
  if (!c.browserAction) { c.browserAction = action; }
})();
`;

function readManifest(extensionRoot) {
  return JSON.parse(fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8").replace(/^﻿/, ""));
}

function getCompatibilityReport(manifest) {
  const permissions = [
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions : [])
  ].filter((permission) => typeof permission === "string" && !permission.includes("://") && permission !== "<all_urls>");

  const missing = [...new Set(permissions.filter((permission) => UNSUPPORTED_EXPLANATIONS[permission]))];
  const features = [...new Set(missing.map((permission) => UNSUPPORTED_EXPLANATIONS[permission]))];
  const unknown = permissions.filter((permission) => !SUPPORTED_PERMISSIONS.has(permission) && !UNSUPPORTED_EXPLANATIONS[permission]);

  let level = "full";
  if (missing.some((permission) => permission.startsWith("declarativeNetRequest") || permission === "offscreen")) {
    level = "broken";
  } else if (missing.length) {
    level = "partial";
  }

  return { level, missingPermissions: missing, missingFeatures: features, otherPermissions: unknown };
}

function describeCompatibility(report) {
  if (report.level === "full") {
    return "";
  }
  const prefix = report.level === "broken"
    ? "Likely won't work here: it relies on"
    : "Some features may not work: it uses";
  return `${prefix} ${report.missingFeatures.join(", ")}, which WP Desktop's browser engine doesn't provide.`;
}

// Inject the shims ahead of every background context. Content scripts are
// left alone; they only get chrome.runtime/storage/i18n in any browser.
function applyExtensionShims(extensionRoot) {
  const manifestPath = path.join(extensionRoot, "manifest.json");
  const manifest = readManifest(extensionRoot);
  fs.writeFileSync(path.join(extensionRoot, SHIM_FILE), SHIM_SOURCE);

  const background = manifest.background || {};
  if (background.service_worker) {
    const workerPath = String(background.service_worker).replace(/^\/+/, "");
    if (background.type === "module") {
      // Module imports resolve against each module's own URL, so a wrapper is safe.
      fs.writeFileSync(
        path.join(extensionRoot, SW_WRAPPER_FILE),
        `import "/${SHIM_FILE}";\nimport ${JSON.stringify(`/${workerPath}`)};\n`
      );
      manifest.background = { ...background, service_worker: SW_WRAPPER_FILE };
    } else {
      // Classic workers resolve importScripts() against the worker URL, so keep
      // the original file in place and prepend the shim to it.
      const absoluteWorker = path.join(extensionRoot, workerPath);
      const original = fs.readFileSync(absoluteWorker, "utf8");
      if (!original.startsWith("/* WP Desktop extension API shims */")) {
        fs.writeFileSync(absoluteWorker, `${SHIM_SOURCE}\n${original}`);
      }
      manifest.background = { ...background, service_worker: workerPath };
    }
  } else if (Array.isArray(background.scripts) && background.scripts.length) {
    manifest.background = { ...background, scripts: [SHIM_FILE, ...background.scripts.filter((script) => script !== SHIM_FILE)] };
  }

  // Background pages, popups and options pages.
  const tag = `<script src="/${SHIM_FILE}"></script>`;
  const stack = [extensionRoot];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "_locales" && entry.name !== "node_modules") {
          stack.push(fullPath);
        }
        continue;
      }
      if (!/\.html?$/i.test(entry.name)) {
        continue;
      }
      const html = fs.readFileSync(fullPath, "utf8");
      if (html.includes(SHIM_FILE)) {
        continue;
      }
      // Run after the Firefox polyfill (if any) so browser.* sees the shims.
      const patched = html.includes("wpd-browser-polyfill.js")
        ? html.replace(/(<script[^>]*wpd-browser-polyfill\.js[^>]*><\/script>)/i, `$1${tag}`)
        : (/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (match) => `${match}${tag}`) : `${tag}${html}`);
      fs.writeFileSync(fullPath, patched);
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return getCompatibilityReport(manifest);
}

module.exports = {
  applyExtensionShims,
  getCompatibilityReport,
  describeCompatibility
};
