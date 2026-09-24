// Install browser extensions straight from the Chrome Web Store, Microsoft
// Edge Add-ons and Firefox Add-ons (AMO).
//
// Chrome/Edge serve signed .crx packages; we strip the CRX header, keep the
// store's public key as manifest "key" so the extension keeps its real ID,
// and unpack the zip. Firefox serves .xpi zips written against the
// `browser.*` namespace, so we add Mozilla's webextension-polyfill and
// rewrite the few manifest shapes Chromium refuses to load.

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const { applyExtensionShims, describeCompatibility } = require("./extension-shims");

const CHROME_ID = /^[a-p]{32}$/;
const POLYFILL_FILE = "wpd-browser-polyfill.js";
const FIREFOX_SW_FILE = "wpd-background-worker.js";

const STORE_LABELS = {
  chrome: "Chrome Web Store",
  edge: "Edge Add-ons",
  firefox: "Firefox Add-ons"
};

function parseStoreUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return null;
  }
  if (CHROME_ID.test(raw)) {
    return { store: "chrome", id: raw };
  }

  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "chromewebstore.google.com" || (host === "chrome.google.com" && segments[0] === "webstore")) {
    const id = segments.find((segment) => CHROME_ID.test(segment));
    return id ? { store: "chrome", id } : null;
  }

  if (host === "microsoftedge.microsoft.com" && segments[0] === "addons") {
    const id = segments.find((segment) => CHROME_ID.test(segment));
    return id ? { store: "edge", id } : null;
  }

  if (host === "addons.mozilla.org") {
    const addonIndex = segments.indexOf("addon");
    const slug = addonIndex >= 0 ? segments[addonIndex + 1] : "";
    return slug ? { store: "firefox", id: decodeURIComponent(slug) } : null;
  }

  return null;
}

function getChromeDownloadUrl(id) {
  const prodVersion = process.versions.chrome || "126.0.0.0";
  return "https://clients2.google.com/service/update2/crx?response=redirect"
    + `&prodversion=${encodeURIComponent(prodVersion)}&acceptformat=crx2,crx3`
    + `&x=${encodeURIComponent(`id=${id}&uc`)}`;
}

function getEdgeDownloadUrl(id) {
  return "https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&prod=chromiumcrx&prodchannel="
    + `&x=${encodeURIComponent(`id=${id}&installsource=ondemand&uc`)}`;
}

// Inside Electron use Chromium's network stack (system proxy, certificates);
// fall back to Node's fetch when running outside Electron (tests).
function storeFetch(url, options) {
  try {
    const { net } = require("electron");
    if (net && typeof net.fetch === "function") {
      return net.fetch(url, options);
    }
  } catch (_) {
    // Not running inside Electron.
  }
  return fetch(url, options);
}

async function fetchBuffer(url) {
  const response = await storeFetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed (HTTP ${response.status}).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw new Error("The store returned an empty package. The extension may not be available for this browser.");
  }
  return buffer;
}

async function getFirefoxAddonInfo(slug) {
  const response = await storeFetch(`https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(slug)}/`);
  if (response.status === 404) {
    throw new Error(`Firefox add-on "${slug}" was not found.`);
  }
  if (!response.ok) {
    throw new Error(`Firefox Add-ons lookup failed (HTTP ${response.status}).`);
  }
  const info = await response.json();
  const fileUrl = info?.current_version?.file?.url;
  if (!fileUrl) {
    throw new Error("This Firefox add-on has no downloadable version.");
  }
  if (info.type && info.type !== "extension") {
    throw new Error(`"${slug}" is a Firefox ${info.type}, not an extension.`);
  }
  return { fileUrl, slug: info.slug || slug };
}

// --- CRX parsing ---------------------------------------------------------

function readVarint(buffer, offset) {
  let result = 0;
  let shift = 0;
  let position = offset;
  while (position < buffer.length) {
    const byte = buffer[position++];
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      return { value: result, next: position };
    }
    shift += 7;
  }
  throw new Error("Malformed CRX header.");
}

// Minimal protobuf reader: returns [{ field, bytes }] for length-delimited fields.
function readProtoFields(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset);
    offset = key.next;
    const field = Math.floor(key.value / 8);
    const wireType = key.value % 8;
    if (wireType === 2) {
      const length = readVarint(buffer, offset);
      fields.push({ field, bytes: buffer.subarray(length.next, length.next + length.value) });
      offset = length.next + length.value;
    } else if (wireType === 0) {
      offset = readVarint(buffer, offset).next;
    } else if (wireType === 5) {
      offset += 4;
    } else if (wireType === 1) {
      offset += 8;
    } else {
      throw new Error("Unsupported CRX header field.");
    }
  }
  return fields;
}

function extensionIdFromPublicKey(publicKey) {
  const hash = crypto.createHash("sha256").update(publicKey).digest("hex").slice(0, 32);
  return hash.replace(/[0-9a-f]/g, (char) => String.fromCharCode(97 + parseInt(char, 16)));
}

// Returns { zip, publicKey } where publicKey is the key whose ID the store signed.
function unpackCrx(buffer) {
  if (buffer.subarray(0, 4).toString("latin1") !== "Cr24") {
    if (buffer.subarray(0, 2).toString("latin1") === "PK") {
      return { zip: buffer, publicKey: null };
    }
    throw new Error("The download is not a CRX package.");
  }

  const version = buffer.readUInt32LE(4);
  if (version === 2) {
    const keyLength = buffer.readUInt32LE(8);
    const signatureLength = buffer.readUInt32LE(12);
    return {
      publicKey: buffer.subarray(16, 16 + keyLength),
      zip: buffer.subarray(16 + keyLength + signatureLength)
    };
  }
  if (version !== 3) {
    throw new Error(`Unsupported CRX version ${version}.`);
  }

  const headerLength = buffer.readUInt32LE(8);
  const header = buffer.subarray(12, 12 + headerLength);
  const zip = buffer.subarray(12 + headerLength);

  const headerFields = readProtoFields(header);
  const signedData = headerFields.find((entry) => entry.field === 10000);
  const crxIdBytes = signedData ? readProtoFields(signedData.bytes).find((entry) => entry.field === 1)?.bytes : null;
  const expectedId = crxIdBytes
    ? crxIdBytes.toString("hex").replace(/[0-9a-f]/g, (char) => String.fromCharCode(97 + parseInt(char, 16)))
    : "";

  const publicKeys = headerFields
    .filter((entry) => entry.field === 2 || entry.field === 3)
    .map((entry) => readProtoFields(entry.bytes).find((proof) => proof.field === 1)?.bytes)
    .filter(Boolean);
  const publicKey = publicKeys.find((key) => extensionIdFromPublicKey(key) === expectedId) || null;

  return { zip, publicKey };
}

// --- manifest helpers ----------------------------------------------------

function readJson(filePath) {
  // Some store manifests carry a UTF-8 BOM.
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function resolveLocalizedString(extensionRoot, manifest, value) {
  const match = /^__MSG_(\w+)__$/.exec(String(value || ""));
  if (!match) {
    return value;
  }
  const localesRoot = path.join(extensionRoot, "_locales");
  const candidates = [manifest.default_locale, "en", "en_US", "en_GB"].filter(Boolean);
  const key = match[1].toLowerCase();
  for (const locale of candidates) {
    const messagesPath = path.join(localesRoot, locale, "messages.json");
    if (!fs.existsSync(messagesPath)) {
      continue;
    }
    try {
      const messages = readJson(messagesPath);
      const entry = Object.entries(messages).find(([name]) => name.toLowerCase() === key);
      if (entry?.[1]?.message) {
        return entry[1].message;
      }
    } catch (_) {
      // Fall through to the next locale.
    }
  }
  return value;
}

function listFiles(root, predicate, results = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "_metadata" && entry.name !== "node_modules") {
        listFiles(fullPath, predicate, results);
      }
    } else if (predicate(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

// --- Firefox → Chromium adaptation ---------------------------------------

function getPolyfillSource() {
  const polyfillPath = require.resolve("webextension-polyfill/dist/browser-polyfill.min.js");
  // Firefox-only namespaces that have a Chromium equivalent.
  const aliases = "\n;(function(){try{var c=globalThis.chrome;if(c&&c.contextMenus&&!c.menus){c.menus=c.contextMenus;}"
    + "var b=globalThis.browser;if(b&&c&&c.contextMenus&&!b.menus&&b.contextMenus){b.menus=b.contextMenus;}}catch(e){}})();\n";
  return fs.readFileSync(polyfillPath, "utf8") + aliases;
}

function adaptFirefoxExtension(extensionRoot) {
  const manifestPath = path.join(extensionRoot, "manifest.json");
  const manifest = readJson(manifestPath);
  const notes = [];

  fs.writeFileSync(path.join(extensionRoot, POLYFILL_FILE), getPolyfillSource());

  delete manifest.browser_specific_settings;
  delete manifest.applications;

  const withPolyfill = (scripts) => [POLYFILL_FILE, ...scripts.filter((script) => script !== POLYFILL_FILE)];

  const background = manifest.background || null;
  if (background) {
    const scripts = Array.isArray(background.scripts) ? background.scripts : [];
    if (manifest.manifest_version >= 3 && scripts.length && !background.service_worker) {
      // Chromium MV3 only runs service-worker backgrounds.
      const specifiers = withPolyfill(scripts).map((script) => JSON.stringify(`/${script.replace(/^\/+/, "")}`));
      const isModule = background.type === "module";
      fs.writeFileSync(
        path.join(extensionRoot, FIREFOX_SW_FILE),
        isModule
          ? specifiers.map((specifier) => `import ${specifier};`).join("\n") + "\n"
          : `importScripts(${specifiers.join(", ")});\n`
      );
      manifest.background = isModule
        ? { service_worker: FIREFOX_SW_FILE, type: "module" }
        : { service_worker: FIREFOX_SW_FILE };
      notes.push("Background scripts now run as a service worker; add-ons that use the DOM in their background page may not work.");
    } else if (scripts.length) {
      manifest.background = { ...background, scripts: withPolyfill(scripts) };
      delete manifest.background.type;
    }
  }

  if (Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts = manifest.content_scripts.map((contentScript) =>
      Array.isArray(contentScript.js) && contentScript.js.length
        ? { ...contentScript, js: withPolyfill(contentScript.js) }
        : contentScript
    );
  }

  const permissionKeys = ["permissions", "optional_permissions"];
  for (const key of permissionKeys) {
    if (Array.isArray(manifest[key]) && manifest[key].includes("menus") && !manifest[key].includes("contextMenus")) {
      manifest[key] = [...manifest[key], "contextMenus"];
    }
  }

  if (manifest.options_ui) {
    delete manifest.options_ui.browser_style;
  }
  if (manifest.action) {
    delete manifest.action.browser_style;
  }
  if (manifest.browser_action) {
    delete manifest.browser_action.browser_style;
  }
  if (manifest.sidebar_action) {
    notes.push("Firefox sidebars are not supported and were left out.");
    delete manifest.sidebar_action;
  }

  // Popups, options pages and background pages load scripts via <script> tags.
  for (const htmlPath of listFiles(extensionRoot, (name) => /\.html?$/i.test(name))) {
    const html = fs.readFileSync(htmlPath, "utf8");
    if (html.includes(POLYFILL_FILE)) {
      continue;
    }
    const tag = `<script src="/${POLYFILL_FILE}"></script>`;
    const patched = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (match) => `${match}${tag}`)
      : `${tag}${html}`;
    fs.writeFileSync(htmlPath, patched);
  }

  writeJson(manifestPath, manifest);
  return notes;
}

// --- install -------------------------------------------------------------

function findManifestRoot(directory, depth = 0) {
  if (fs.existsSync(path.join(directory, "manifest.json"))) {
    return directory;
  }
  if (depth >= 2) {
    return null;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const found = findManifestRoot(path.join(directory, entry.name), depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

async function downloadStoreExtension({ store, id }, targetRoot) {
  let packageBuffer;
  let sourceUrl;
  if (store === "chrome") {
    sourceUrl = getChromeDownloadUrl(id);
  } else if (store === "edge") {
    sourceUrl = getEdgeDownloadUrl(id);
  } else if (store === "firefox") {
    sourceUrl = (await getFirefoxAddonInfo(id)).fileUrl;
  } else {
    throw new Error(`Unknown store "${store}".`);
  }
  packageBuffer = await fetchBuffer(sourceUrl);

  const { zip, publicKey } = store === "firefox"
    ? { zip: packageBuffer, publicKey: null }
    : unpackCrx(packageBuffer);

  const targetDirectory = path.join(targetRoot, `${store}-${id.replace(/[^\w.-]/g, "_")}-${Date.now()}`);
  fs.mkdirSync(targetDirectory, { recursive: true });
  try {
    new AdmZip(Buffer.from(zip)).extractAllTo(targetDirectory, true);
  } catch (error) {
    fs.rmSync(targetDirectory, { recursive: true, force: true });
    throw new Error(`Could not unpack the extension: ${error.message}`);
  }

  const extensionRoot = findManifestRoot(targetDirectory);
  if (!extensionRoot) {
    fs.rmSync(targetDirectory, { recursive: true, force: true });
    throw new Error("The package does not contain a manifest.json.");
  }

  // Chromium refuses to load folders with a leftover signature directory.
  fs.rmSync(path.join(extensionRoot, "_metadata"), { recursive: true, force: true });
  fs.rmSync(path.join(extensionRoot, "META-INF"), { recursive: true, force: true });

  let notes = [];
  if (store === "firefox") {
    notes = adaptFirefoxExtension(extensionRoot);
  } else if (publicKey) {
    const manifestPath = path.join(extensionRoot, "manifest.json");
    const manifest = readJson(manifestPath);
    if (!manifest.key) {
      manifest.key = publicKey.toString("base64");
      writeJson(manifestPath, manifest);
    }
  }

  const compatibility = applyExtensionShims(extensionRoot);
  const compatibilityNote = describeCompatibility(compatibility);
  if (compatibilityNote) {
    notes = [compatibilityNote, ...notes];
  }

  return {
    directory: targetDirectory,
    extensionRoot,
    sourceUrl,
    expectedId: publicKey ? extensionIdFromPublicKey(publicKey) : "",
    compatibility,
    notes
  };
}

function getStorePageUrl(store, id) {
  if (store === "chrome") {
    return `https://chromewebstore.google.com/detail/${id}`;
  }
  if (store === "edge") {
    return `https://microsoftedge.microsoft.com/addons/detail/${id}`;
  }
  return `https://addons.mozilla.org/firefox/addon/${encodeURIComponent(id)}/`;
}

module.exports = {
  STORE_LABELS,
  parseStoreUrl,
  downloadStoreExtension,
  resolveLocalizedString,
  getStorePageUrl,
  // Exported for tests.
  unpackCrx,
  extensionIdFromPublicKey,
  adaptFirefoxExtension
};
