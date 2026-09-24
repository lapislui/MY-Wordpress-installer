// Small encrypted key/value store for secrets (API keys, connector tokens,
// password vault entries). Encrypted with Electron safeStorage (DPAPI on
// Windows); refuses to persist secrets in plain text when encryption is
// unavailable.

const fs = require("fs");
const path = require("path");

function createSecureStore({ app, safeStorage, fileName = "secure-store.bin" }) {
  const filePath = () => path.join(app.getPath("userData"), fileName);
  let cache = null;

  function load() {
    if (cache) {
      return cache;
    }
    try {
      if (!fs.existsSync(filePath())) {
        cache = {};
        return cache;
      }
      const raw = fs.readFileSync(filePath());
      cache = JSON.parse(safeStorage.decryptString(raw));
    } catch (_) {
      cache = {};
    }
    return cache;
  }

  function persist() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable on this system, so secrets can't be saved.");
    }
    fs.writeFileSync(filePath(), safeStorage.encryptString(JSON.stringify(cache)));
  }

  return {
    get(key, fallback = null) {
      const data = load();
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
    },
    set(key, value) {
      load();
      if (value === undefined || value === null || value === "") {
        delete cache[key];
      } else {
        cache[key] = value;
      }
      persist();
    },
    has(key) {
      const value = load()[key];
      return value !== undefined && value !== null && value !== "";
    }
  };
}

module.exports = { createSecureStore };
