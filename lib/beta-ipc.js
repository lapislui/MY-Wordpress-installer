// IPC wiring for the beta tools (Server Monitor, Deployment Manager, CI/CD
// Runner, AI Assistant, Password Vault, MCP connectors).

const path = require("path");
const crypto = require("crypto");
const { getSystemStats } = require("./system-monitor");
const { createDeployService } = require("./deploy");
const { createPipelineRunner, loadPipeline, savePipeline } = require("./pipeline-runner");

function registerBetaIpc({ ipcMain, app, secureStore, aiAssistant, mcpConnectors, findSite, getSshConnection, createSqlDump, getLocalDbProfile }) {
  const send = (event, channel, payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(channel, payload);
    }
  };

  // --- Server Monitor -------------------------------------------------------
  ipcMain.handle("monitor:get-stats", (_event, options) => getSystemStats(options || {}));

  // --- Deployment Manager ---------------------------------------------------
  const deploy = createDeployService({ findSite, getSshConnection, createSqlDump, getLocalDbProfile });
  let deployCancelled = false;

  ipcMain.handle("deploy:get-config", async (_event, siteId) => {
    const site = await findSite(siteId);
    const saved = secureStore.get(`deploy.${siteId}`) || {};
    return {
      hasSftp: Boolean(site?.sftp?.host),
      target: site?.sftp?.host ? `${site.sftp.username}@${site.sftp.host}:${site.sftp.remoteDir || "~"}` : "",
      remoteDb: saved.remoteDb || { host: "localhost", name: "", user: "" },
      hasRemoteDbPassword: Boolean(saved.remoteDbPassword),
      remoteUrl: saved.remoteUrl || ""
    };
  });

  ipcMain.handle("deploy:save-config", (_event, { siteId, remoteDb, remoteDbPassword, remoteUrl }) => {
    const saved = secureStore.get(`deploy.${siteId}`) || {};
    const next = {
      ...saved,
      remoteDb: {
        host: String(remoteDb?.host || "localhost").trim(),
        name: String(remoteDb?.name || "").trim(),
        user: String(remoteDb?.user || "").trim()
      },
      remoteUrl: String(remoteUrl || "").trim()
    };
    if (remoteDbPassword) {
      next.remoteDbPassword = String(remoteDbPassword);
    }
    secureStore.set(`deploy.${siteId}`, next);
    return { ok: true };
  });

  ipcMain.handle("deploy:plan", (event, siteId) =>
    deploy.plan(siteId, { onProgress: (payload) => send(event, "deploy:progress", payload) }));

  ipcMain.handle("deploy:push-files", async (event, { siteId, files }) => {
    deployCancelled = false;
    return deploy.pushFiles(siteId, {
      files,
      onProgress: (payload) => send(event, "deploy:progress", payload),
      isCancelled: () => deployCancelled
    });
  });

  ipcMain.handle("deploy:cancel", () => {
    deployCancelled = true;
    return true;
  });

  ipcMain.handle("deploy:push-database", (event, { siteId, localUrl }) => {
    const saved = secureStore.get(`deploy.${siteId}`) || {};
    return deploy.pushDatabase(siteId, {
      remoteDb: saved.remoteDb,
      remoteDbPassword: saved.remoteDbPassword,
      searchReplace: saved.remoteUrl && localUrl ? { from: localUrl.replace(/\/+$/, ""), to: saved.remoteUrl.replace(/\/+$/, "") } : null,
      onProgress: (payload) => send(event, "deploy:progress", payload)
    });
  });

  // --- CI/CD Runner -----------------------------------------------------------
  const pipelines = createPipelineRunner({ historyPath: path.join(app.getPath("userData"), "pipeline-history.json") });
  const getSitePath = async (siteId) => {
    const site = await findSite(siteId);
    if (!site?.path) {
      throw new Error("Site not found.");
    }
    return site;
  };

  ipcMain.handle("cicd:load", async (_event, siteId) => {
    const site = await getSitePath(siteId);
    return { ...loadPipeline(site.path), running: pipelines.isRunning(), history: pipelines.history(siteId).slice(0, 10) };
  });
  ipcMain.handle("cicd:save", async (_event, { siteId, steps }) => savePipeline((await getSitePath(siteId)).path, steps));
  ipcMain.handle("cicd:run", async (event, { siteId, steps }) => {
    const site = await getSitePath(siteId);
    return pipelines.run({ siteId, siteName: site.name, sitePath: site.path, steps }, (payload) => send(event, "cicd:event", payload));
  });
  ipcMain.handle("cicd:cancel", () => pipelines.cancel());

  // --- AI Assistant -------------------------------------------------------------
  ipcMain.handle("ai:get-config", () => aiAssistant.getPublicConfig());
  ipcMain.handle("ai:save-config", (_event, config) => aiAssistant.saveConfig(config || {}));
  ipcMain.handle("ai:list-ollama-models", (_event, url) => aiAssistant.listOllamaModels(url));
  ipcMain.handle("ai:chat", (event, payload) => {
    const requestId = payload?.requestId || crypto.randomUUID();
    // Stream in the background; the renderer listens on ai:event.
    void aiAssistant.chat({ ...payload, requestId }, (data) => send(event, "ai:event", { requestId, ...data }));
    return { requestId };
  });
  ipcMain.handle("ai:cancel", (_event, requestId) => aiAssistant.cancel(requestId));

  // --- Password Vault (encrypted) -----------------------------------------------
  const readEntries = () => secureStore.get("vault.entries") || [];
  ipcMain.handle("pwvault:list", () => readEntries().map(({ password, ...rest }) => ({ ...rest, hasPassword: Boolean(password) })));
  ipcMain.handle("pwvault:reveal", (_event, id) => readEntries().find((entry) => entry.id === id)?.password || "");
  ipcMain.handle("pwvault:save", (_event, entry) => {
    const entries = readEntries();
    const clean = {
      id: entry?.id || crypto.randomUUID(),
      label: String(entry?.label || "").trim(),
      username: String(entry?.username || "").trim(),
      url: String(entry?.url || "").trim(),
      notes: String(entry?.notes || "").trim(),
      updatedAt: new Date().toISOString()
    };
    if (!clean.label) {
      throw new Error("Give the entry a name.");
    }
    const index = entries.findIndex((item) => item.id === clean.id);
    const password = entry?.password ? String(entry.password) : (index >= 0 ? entries[index].password : "");
    const next = { ...clean, password };
    if (index >= 0) {
      entries[index] = next;
    } else {
      entries.unshift(next);
    }
    secureStore.set("vault.entries", entries);
    return { id: clean.id };
  });
  ipcMain.handle("pwvault:delete", (_event, id) => {
    secureStore.set("vault.entries", readEntries().filter((entry) => entry.id !== id));
    return true;
  });
  ipcMain.handle("pwvault:generate", (_event, length = 20) => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";
    const size = Math.max(12, Math.min(64, Number(length) || 20));
    return Array.from(crypto.randomBytes(size), (byte) => alphabet[byte % alphabet.length]).join("");
  });

  // --- MCP connectors -----------------------------------------------------------
  ipcMain.handle("connectors:list", () => mcpConnectors.list());
  ipcMain.handle("connectors:save", (_event, { id, ...changes }) => mcpConnectors.save(id, changes));
  ipcMain.handle("connectors:clear-secret", (_event, { id, key }) => mcpConnectors.clearSecret(id, key));
  ipcMain.handle("connectors:test", (_event, id) => mcpConnectors.test(id));
  ipcMain.handle("connectors:call-tool", (_event, { name, args }) => mcpConnectors.callTool(name, args));
}

module.exports = { registerBetaIpc };
