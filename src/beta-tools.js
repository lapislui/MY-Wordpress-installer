// Beta tools: Server Monitor, Deployment Manager, CI/CD Runner, AI Assistant,
// Password Vault, team room (chat, presence, activity feed), Site
// Permissions and MCP connector screens. Loaded after renderer.js and uses
// its helpers (escapeHtml, getSelectedSite, setStatus, renderWorkspaceMarkdownToHtml).

(function () {
  const api = window.desktopAPI;
  const byId = (id) => document.getElementById(id);

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    const units = ["B", "KB", "MB", "GB", "TB"];
    let index = 0;
    let size = value;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
  }

  function formatDuration(ms) {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  }

  function formatUptime(totalSeconds) {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
  }

  function timeAgo(iso) {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
    return new Date(iso).toLocaleDateString();
  }

  function isScreenActive(id) {
    return byId(`${id}-screen`)?.classList.contains("active");
  }

  function readLocal(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      // Storage full or unavailable; nothing else to do.
    }
  }

  function errorText(error) {
    return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  }

  // ─── Server Monitor ─────────────────────────────────────────────────────
  let monitorTimer = null;
  let monitorBusy = false;

  async function refreshMonitor() {
    if (monitorBusy) return;
    monitorBusy = true;
    try {
      const site = getSelectedSite();
      const stats = await api.getSystemStats({ siteUrl: site?.siteUrl || "" });
      byId("monitor-cpu-value").textContent = `${stats.cpu.percent}%`;
      byId("monitor-cpu-bar").style.width = `${Math.min(100, stats.cpu.percent)}%`;
      byId("monitor-cpu-model").textContent = `${stats.cpu.cores} threads · ${stats.cpu.model}`;
      byId("monitor-ram-value").textContent = `${stats.memory.percent}%`;
      byId("monitor-ram-bar").style.width = `${Math.min(100, stats.memory.percent)}%`;
      byId("monitor-ram-detail").textContent = `${formatBytes(stats.memory.used)} of ${formatBytes(stats.memory.total)}`;
      byId("monitor-uptime").textContent = formatUptime(stats.uptimeSeconds);
      byId("monitor-host").textContent = `${stats.hostname} · ${stats.platform}`;
      if (stats.site) {
        byId("monitor-latency").textContent = stats.site.ok ? `${stats.site.latencyMs} ms` : "Down";
        byId("monitor-site-detail").textContent = stats.site.ok ? `${stats.site.url} · HTTP ${stats.site.status}` : `${stats.site.url} · ${stats.site.error}`;
      } else {
        byId("monitor-latency").textContent = "–";
        byId("monitor-site-detail").textContent = "Select a site to measure its response time.";
      }
      byId("monitor-services").innerHTML = stats.services.map((service) => `
        <div class="settings-item beta-row">
          <div class="settings-item-copy"><strong>${escapeHtml(service.name)}</strong><span>Port ${service.port}</span></div>
          <span class="beta-pill ${service.open ? "is-ok" : "is-off"}">${service.open ? `Running · ${Math.round(service.latencyMs)} ms` : "Not running"}</span>
        </div>`).join("");
      byId("monitor-disks").innerHTML = stats.disks.map((disk) => {
        const percent = Math.round((disk.used / disk.total) * 100);
        return `
          <div class="settings-item beta-disk">
            <div class="beta-row"><strong>${escapeHtml(disk.mount)}</strong><span class="beta-muted">${formatBytes(disk.free)} free of ${formatBytes(disk.total)}</span></div>
            <div class="beta-meter ${percent >= 95 ? "is-danger" : percent >= 85 ? "is-warn" : ""}"><div style="width:${percent}%"></div></div>
          </div>`;
      }).join("") || '<p class="beta-muted">No drives found.</p>';
    } catch (error) {
      setStatus(`Server monitor: ${errorText(error)}`);
    } finally {
      monitorBusy = false;
    }
  }

  let monitorBound = false;
  window.initServerMonitorScreen = function initServerMonitorScreen() {
    void refreshMonitor();
    if (!monitorBound) {
      monitorBound = true;
      byId("monitor-refresh-btn")?.addEventListener("click", () => void refreshMonitor());
    }
    clearInterval(monitorTimer);
    monitorTimer = setInterval(() => {
      if (!isScreenActive("devops_monitor")) {
        clearInterval(monitorTimer);
        return;
      }
      if (byId("monitor-auto-refresh")?.checked) {
        void refreshMonitor();
      }
    }, 5000);
  };

  // ─── Deployment Manager ─────────────────────────────────────────────────
  let deployPlan = null;
  let deployBusy = false;
  let deployBound = false;

  function deployLog(line, isError = false) {
    const output = byId("deploy-output");
    if (!output) return;
    const row = document.createElement("div");
    row.textContent = line;
    if (isError) row.className = "is-error";
    output.appendChild(row);
    output.scrollTop = output.scrollHeight;
  }

  function setDeployBusy(busy) {
    deployBusy = busy;
    byId("deploy-plan-btn").disabled = busy;
    byId("deploy-db-btn").disabled = busy;
    byId("deploy-files-btn").disabled = busy || !deployPlan?.changed?.length;
    byId("deploy-cancel-btn").classList.toggle("hidden", !busy);
  }

  function renderDeployPlan() {
    const list = byId("deploy-plan-list");
    if (!deployPlan) return;
    const reasons = { new: "new", size: "changed", newer: "newer" };
    byId("deploy-plan-summary").textContent = `${deployPlan.changed.length} to upload (${formatBytes(deployPlan.changedBytes)}) · ${deployPlan.localCount} local files · ${deployPlan.remoteCount} on server`;
    if (!deployPlan.changed.length) {
      list.innerHTML = '<p class="beta-muted">Everything on the server is up to date.</p>';
    } else {
      const shown = deployPlan.changed.slice(0, 400);
      list.innerHTML = shown.map((file) => `<div class="beta-file"><span class="beta-tag">${reasons[file.reason] || file.reason}</span><code>${escapeHtml(file.path)}</code><span class="beta-muted">${formatBytes(file.size)}</span></div>`).join("")
        + (deployPlan.changed.length > shown.length ? `<p class="beta-muted">…and ${deployPlan.changed.length - shown.length} more.</p>` : "");
    }
    if (deployPlan.remoteOnlyCount) {
      list.insertAdjacentHTML("beforeend", `<p class="beta-muted">${deployPlan.remoteOnlyCount} file${deployPlan.remoteOnlyCount === 1 ? " exists" : "s exist"} only on the server; they're left alone.</p>`);
    }
    byId("deploy-files-btn").disabled = deployBusy || !deployPlan.changed.length;
  }

  async function loadDeployConfig() {
    const site = getSelectedSite();
    deployPlan = null;
    byId("deploy-plan-list").innerHTML = '<p class="beta-muted">Click Compare files to see what differs between this computer and the server.</p>';
    byId("deploy-plan-summary").textContent = "";
    byId("deploy-site-name").textContent = site ? site.name : "No site selected";
    if (!site) {
      byId("deploy-target").textContent = "–";
      byId("deploy-no-sftp").classList.add("hidden");
      byId("deploy-plan-btn").disabled = true;
      byId("deploy-db-btn").disabled = true;
      return;
    }
    const config = await api.getDeployConfig(site.id);
    byId("deploy-target").textContent = config.target || "Not configured";
    byId("deploy-no-sftp").classList.toggle("hidden", config.hasSftp);
    byId("deploy-plan-btn").disabled = !config.hasSftp;
    byId("deploy-db-btn").disabled = !config.hasSftp;
    byId("deploy-db-host").value = config.remoteDb.host || "localhost";
    byId("deploy-db-name").value = config.remoteDb.name || "";
    byId("deploy-db-user").value = config.remoteDb.user || "";
    byId("deploy-db-pass").value = "";
    byId("deploy-db-pass").placeholder = config.hasRemoteDbPassword ? "saved (leave empty to keep)" : "";
    byId("deploy-remote-url").value = config.remoteUrl || "";
  }

  async function saveDeployConfig() {
    const site = getSelectedSite();
    if (!site) return false;
    await api.saveDeployConfig({
      siteId: site.id,
      remoteDb: { host: byId("deploy-db-host").value, name: byId("deploy-db-name").value, user: byId("deploy-db-user").value },
      remoteDbPassword: byId("deploy-db-pass").value,
      remoteUrl: byId("deploy-remote-url").value
    });
    byId("deploy-db-pass").value = "";
    return true;
  }

  window.initDeployScreen = function initDeployScreen() {
    void loadDeployConfig().catch((error) => deployLog(errorText(error), true));
    if (deployBound) return;
    deployBound = true;

    api.onDeployProgress((payload) => {
      if (payload.logLine) deployLog(payload.logLine, payload.isError);
      if (typeof payload.progress === "number") byId("deploy-progress-bar").style.width = `${payload.progress}%`;
    });

    byId("deploy-plan-btn").addEventListener("click", async () => {
      const site = getSelectedSite();
      if (!site || deployBusy) return;
      byId("deploy-output").innerHTML = "";
      byId("deploy-progress-bar").style.width = "0%";
      setDeployBusy(true);
      try {
        deployPlan = await api.planDeploy(site.id);
        deployLog(`Compared ${deployPlan.localCount} local files with ${deployPlan.target}.`);
        renderDeployPlan();
      } catch (error) {
        deployLog(errorText(error), true);
      } finally {
        setDeployBusy(false);
      }
    });

    byId("deploy-files-btn").addEventListener("click", async () => {
      const site = getSelectedSite();
      if (!site || !deployPlan?.changed?.length || deployBusy) return;
      if (!confirm(`Upload ${deployPlan.changed.length} file(s) to ${deployPlan.target}?`)) return;
      setDeployBusy(true);
      byId("deploy-progress-bar").style.width = "0%";
      try {
        const result = await api.pushDeployFiles({ siteId: site.id, files: deployPlan.changed.map((file) => file.path) });
        deployLog(`Uploaded ${result.uploaded} of ${result.total} files.`);
        window.logTeamActivity?.(`deployed ${result.uploaded} file(s) of ${site.name} to ${deployPlan.target}`);
        deployPlan = null;
        byId("deploy-plan-summary").textContent = "Uploaded. Compare again to verify.";
      } catch (error) {
        deployLog(errorText(error), true);
      } finally {
        setDeployBusy(false);
      }
    });

    byId("deploy-cancel-btn").addEventListener("click", () => void api.cancelDeploy());

    byId("deploy-db-save-btn").addEventListener("click", async () => {
      try {
        await saveDeployConfig();
        setStatus("Remote database settings saved.");
        void loadDeployConfig();
      } catch (error) {
        setStatus(errorText(error));
      }
    });

    byId("deploy-db-btn").addEventListener("click", async () => {
      const site = getSelectedSite();
      if (!site || deployBusy) return;
      const dbName = byId("deploy-db-name").value.trim();
      if (!dbName || !byId("deploy-db-user").value.trim()) {
        deployLog("Enter the remote database name and user first.", true);
        return;
      }
      const typed = prompt(`This replaces every table in the remote database "${dbName}" with your local copy of ${site.name}.\nA backup of the remote database is saved on the server first.\n\nType the database name to continue:`);
      if (typed !== dbName) return;
      setDeployBusy(true);
      byId("deploy-output").innerHTML = "";
      try {
        await saveDeployConfig();
        const result = await api.pushDeployDatabase({ siteId: site.id, localUrl: site.siteUrl || "" });
        deployLog(`Remote backup: ${result.backupFile}`);
        (result.notes || []).filter(Boolean).forEach((note) => deployLog(note));
        window.logTeamActivity?.(`pushed the ${site.name} database to ${dbName}`);
      } catch (error) {
        deployLog(errorText(error), true);
      } finally {
        setDeployBusy(false);
        void loadDeployConfig();
      }
    });
  };

  // ─── CI/CD Runner ───────────────────────────────────────────────────────
  let pipelineSteps = [];
  let pipelineSource = "";
  let pipelineRunning = false;
  let cicdBound = false;
  let cicdSiteId = null;

  function renderPipelineSteps(stepStates = {}) {
    const container = byId("cicd-steps");
    byId("cicd-source").textContent = pipelineSource === "saved" ? "Saved pipeline" : (pipelineSteps.length ? "Detected from the project" : "");
    if (!pipelineSteps.length) {
      container.innerHTML = '<p class="beta-muted">No package.json or composer.json found in the site, its themes or plugins. Add steps below.</p>';
      return;
    }
    container.innerHTML = pipelineSteps.map((step, index) => `
      <div class="settings-item beta-row">
        <div class="settings-item-copy">
          <strong>${index + 1}. ${escapeHtml(step.name)}</strong>
          <span><code>${escapeHtml(step.command)}</code>${step.cwd && step.cwd !== "." ? ` in ${escapeHtml(step.cwd)}` : ""}</span>
        </div>
        <div class="beta-row">
          ${stepStates[index] ? `<span class="beta-pill ${stepStates[index] === "passed" ? "is-ok" : stepStates[index] === "running" ? "is-busy" : "is-bad"}">${stepStates[index]}</span>` : ""}
          <button type="button" class="beta-icon-btn" data-step-up="${index}" title="Move up" ${index === 0 || pipelineRunning ? "disabled" : ""}>↑</button>
          <button type="button" class="beta-icon-btn" data-step-remove="${index}" title="Remove" ${pipelineRunning ? "disabled" : ""}>✕</button>
        </div>
      </div>`).join("");
  }

  function renderPipelineHistory(history) {
    byId("cicd-history").innerHTML = (history || []).map((run) => `
      <div class="settings-item beta-row">
        <div class="settings-item-copy"><strong>${escapeHtml(timeAgo(run.startedAt))}</strong><span>${run.steps.length} step${run.steps.length === 1 ? "" : "s"}${run.finishedAt ? ` · ${formatDuration(new Date(run.finishedAt) - new Date(run.startedAt))}` : ""}</span></div>
        <span class="beta-pill ${run.status === "passed" ? "is-ok" : "is-bad"}">${escapeHtml(run.status)}</span>
      </div>`).join("") || '<p class="beta-muted">No runs yet.</p>';
  }

  async function loadPipelineForSite() {
    const site = getSelectedSite();
    cicdSiteId = site?.id || null;
    if (!site) {
      pipelineSteps = [];
      byId("cicd-steps").innerHTML = '<p class="beta-muted">Select a site first.</p>';
      byId("cicd-run-btn").disabled = true;
      return;
    }
    const data = await api.loadPipeline(site.id);
    pipelineSteps = data.steps;
    pipelineSource = data.source;
    pipelineRunning = data.running;
    byId("cicd-run-btn").disabled = pipelineRunning;
    renderPipelineSteps();
    renderPipelineHistory(data.history);
  }

  const stepStates = {};
  function appendCicdOutput(text, className = "") {
    const output = byId("cicd-output");
    const span = document.createElement("span");
    span.textContent = text;
    if (className) span.className = className;
    output.appendChild(span);
    output.scrollTop = output.scrollHeight;
  }

  window.initCicdRunnerScreen = function initCicdRunnerScreen() {
    if (getSelectedSite()?.id !== cicdSiteId || !cicdBound) {
      void loadPipelineForSite().catch((error) => appendCicdOutput(`${errorText(error)}\n`, "is-error"));
    }
    if (cicdBound) return;
    cicdBound = true;

    api.onPipelineEvent((event) => {
      if (event.type === "run-start") {
        Object.keys(stepStates).forEach((key) => delete stepStates[key]);
        byId("cicd-output").innerHTML = "";
        byId("cicd-status").textContent = "Running…";
      } else if (event.type === "step-start") {
        stepStates[event.index] = "running";
        appendCicdOutput(`\n▶ ${event.name}\n$ ${event.command}\n`, "is-step");
      } else if (event.type === "output") {
        appendCicdOutput(event.text, event.stream === "stderr" ? "is-stderr" : "");
      } else if (event.type === "step-end") {
        stepStates[event.index] = event.status;
        appendCicdOutput(`${event.status === "passed" ? "✔" : "✖"} ${event.status} in ${formatDuration(event.durationMs)}${event.code && event.code !== 0 ? ` (exit ${event.code})` : ""}\n`, event.status === "passed" ? "is-ok" : "is-error");
      } else if (event.type === "run-end") {
        pipelineRunning = false;
        byId("cicd-status").textContent = `Pipeline ${event.status}`;
        byId("cicd-run-btn").disabled = false;
        byId("cicd-cancel-btn").classList.add("hidden");
        window.logTeamActivity?.(`ran the ${event.record.siteName} pipeline: ${event.status}`);
        void api.loadPipeline(event.record.siteId).then((data) => renderPipelineHistory(data.history));
      }
      renderPipelineSteps(stepStates);
    });

    byId("cicd-run-btn").addEventListener("click", async () => {
      const site = getSelectedSite();
      if (!site || pipelineRunning || !pipelineSteps.length) return;
      pipelineRunning = true;
      byId("cicd-run-btn").disabled = true;
      byId("cicd-cancel-btn").classList.remove("hidden");
      try {
        await api.runPipeline({ siteId: site.id, steps: pipelineSteps });
      } catch (error) {
        appendCicdOutput(`${errorText(error)}\n`, "is-error");
        pipelineRunning = false;
        byId("cicd-run-btn").disabled = false;
        byId("cicd-cancel-btn").classList.add("hidden");
      }
    });
    byId("cicd-cancel-btn").addEventListener("click", () => void api.cancelPipeline());

    byId("cicd-steps").addEventListener("click", (event) => {
      const up = event.target.closest("[data-step-up]");
      const remove = event.target.closest("[data-step-remove]");
      if (up) {
        const index = Number(up.dataset.stepUp);
        [pipelineSteps[index - 1], pipelineSteps[index]] = [pipelineSteps[index], pipelineSteps[index - 1]];
      } else if (remove) {
        pipelineSteps.splice(Number(remove.dataset.stepRemove), 1);
      } else {
        return;
      }
      pipelineSource = "edited";
      renderPipelineSteps();
    });

    byId("cicd-add-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const command = byId("cicd-add-command").value.trim();
      if (!command) return;
      pipelineSteps.push({ name: byId("cicd-add-name").value.trim() || command, command, cwd: byId("cicd-add-cwd").value.trim() || "." });
      byId("cicd-add-name").value = "";
      byId("cicd-add-command").value = "";
      pipelineSource = "edited";
      renderPipelineSteps();
    });

    byId("cicd-save-btn").addEventListener("click", async () => {
      const site = getSelectedSite();
      if (!site) return;
      try {
        const saved = await api.savePipeline({ siteId: site.id, steps: pipelineSteps });
        pipelineSteps = saved.steps;
        pipelineSource = "saved";
        renderPipelineSteps();
        setStatus(`Pipeline saved to ${site.name}/.wpdesktop/pipeline.json`);
      } catch (error) {
        setStatus(errorText(error));
      }
    });

    byId("cicd-detect-btn").addEventListener("click", async () => {
      const site = getSelectedSite();
      if (!site) return;
      if (pipelineSource === "saved" && !confirm("Replace the steps with freshly detected ones? Your saved pipeline stays on disk until you save.")) return;
      const data = await api.loadPipeline(site.id);
      pipelineSteps = data.source === "saved" ? [] : data.steps;
      if (data.source === "saved") {
        // Detection is skipped when a saved pipeline exists; clear to show detected steps next load.
        await api.savePipeline({ siteId: site.id, steps: [] });
        const fresh = await api.loadPipeline(site.id);
        pipelineSteps = fresh.steps;
      }
      pipelineSource = "detected";
      renderPipelineSteps();
    });
  };

  // ─── AI Assistant ───────────────────────────────────────────────────────
  const AI_HISTORY_KEY = "wpdesktop.ai.chat";
  let aiMessages = readLocal(AI_HISTORY_KEY, []);
  let aiRequestId = null;
  let aiStreamingEl = null;
  let aiStreamingText = "";
  let aiConfig = null;
  let aiBound = false;

  function aiBubble(role, text, extraClass = "") {
    const bubble = document.createElement("div");
    bubble.className = `ai-bubble ai-${role} ${extraClass}`.trim();
    if (role === "assistant") {
      bubble.innerHTML = renderWorkspaceMarkdownToHtml(text || "…");
    } else {
      bubble.textContent = text;
    }
    return bubble;
  }

  function renderAiChat() {
    const output = byId("ai-chat-output");
    if (!aiMessages.length) {
      output.querySelectorAll(".ai-bubble").forEach((node) => node.remove());
      output.querySelector(".ai-empty")?.classList.remove("hidden");
      return;
    }
    output.querySelector(".ai-empty")?.classList.add("hidden");
    output.querySelectorAll(".ai-bubble").forEach((node) => node.remove());
    aiMessages.forEach((message) => output.appendChild(aiBubble(message.role, message.content)));
    output.scrollTop = output.scrollHeight;
  }

  function setAiBusy(busy) {
    byId("ai-send-btn").classList.toggle("hidden", busy);
    byId("ai-stop-btn").classList.toggle("hidden", !busy);
  }

  function describeAiProvider() {
    if (!aiConfig) return "";
    if (aiConfig.provider === "ollama") {
      return aiConfig.ollamaModel ? `Using Ollama · ${aiConfig.ollamaModel}` : "Pick an Ollama model.";
    }
    const model = aiConfig.claudeModels.find((item) => item.id === aiConfig.claudeModel);
    return aiConfig.hasClaudeKey ? `Using ${model?.label || aiConfig.claudeModel}` : "Add your Anthropic API key to start.";
  }

  function syncAiSettingsVisibility() {
    const provider = byId("ai-provider").value;
    document.querySelectorAll("#ai-settings-panel .ai-claude-only").forEach((node) => node.classList.toggle("hidden", provider !== "claude"));
    document.querySelectorAll("#ai-settings-panel .ai-ollama-only").forEach((node) => node.classList.toggle("hidden", provider !== "ollama"));
  }

  async function loadAiConfig() {
    aiConfig = await api.getAiConfig();
    byId("ai-provider").value = aiConfig.provider;
    byId("ai-claude-model").innerHTML = aiConfig.claudeModels.map((model) => `<option value="${model.id}">${escapeHtml(model.label)}</option>`).join("");
    byId("ai-claude-model").value = aiConfig.claudeModel;
    byId("ai-api-key").value = "";
    byId("ai-api-key").placeholder = aiConfig.hasClaudeKey ? "saved (leave empty to keep)" : "sk-ant-…";
    byId("ai-ollama-url").value = aiConfig.ollamaUrl;
    byId("ai-ollama-model").innerHTML = aiConfig.ollamaModel ? `<option>${escapeHtml(aiConfig.ollamaModel)}</option>` : '<option value="">Click Refresh models</option>';
    byId("ai-settings-note").textContent = describeAiProvider();
    syncAiSettingsVisibility();
    const needsSetup = aiConfig.provider === "claude" ? !aiConfig.hasClaudeKey : !aiConfig.ollamaModel;
    if (needsSetup) byId("ai-settings-panel").classList.remove("hidden");
  }

  async function refreshOllamaModels() {
    const select = byId("ai-ollama-model");
    try {
      const models = await api.listOllamaModels(byId("ai-ollama-url").value.trim());
      const current = aiConfig?.ollamaModel || "";
      select.innerHTML = models.length
        ? models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.id)} (${formatBytes(model.sizeBytes)})</option>`).join("")
        : '<option value="">No models. Run: ollama pull llama3.2</option>';
      if (models.some((model) => model.id === current)) select.value = current;
      byId("ai-settings-note").textContent = `${models.length} Ollama model${models.length === 1 ? "" : "s"} found.`;
    } catch (error) {
      select.innerHTML = '<option value="">Ollama not reachable</option>';
      byId("ai-settings-note").textContent = `Can't reach Ollama: ${errorText(error)}`;
    }
  }

  async function sendAiMessage(text) {
    const content = String(text || "").trim();
    if (!content || aiRequestId) return;
    aiMessages.push({ role: "user", content });
    renderAiChat();
    aiStreamingText = "";
    aiStreamingEl = aiBubble("assistant", "", "is-streaming");
    byId("ai-chat-output").appendChild(aiStreamingEl);
    setAiBusy(true);
    const site = getSelectedSite();
    try {
      const { requestId } = await api.aiChat({
        messages: aiMessages,
        context: site ? { site: { name: site.name, siteUrl: site.siteUrl, path: site.path, wordpressVersion: site.wordpressVersion, phpVersion: site.phpVersion, webServer: site.webServer } } : null
      });
      aiRequestId = requestId;
    } catch (error) {
      finishAiStream(`**Error:** ${errorText(error)}`, true);
    }
  }

  function finishAiStream(finalText, isError = false) {
    if (aiStreamingEl) {
      aiStreamingEl.remove();
      aiStreamingEl = null;
    }
    if (isError) {
      byId("ai-chat-output").appendChild(aiBubble("assistant", finalText, "is-error"));
      // Drop the unanswered question so a retry doesn't send it twice.
      if (aiMessages[aiMessages.length - 1]?.role === "user") {
        const lastQuestion = aiMessages.pop();
        byId("ai-input").value = byId("ai-input").value || lastQuestion.content;
      }
    } else if (finalText.trim()) {
      aiMessages.push({ role: "assistant", content: finalText });
      writeLocal(AI_HISTORY_KEY, aiMessages.slice(-60));
      renderAiChat();
    }
    aiRequestId = null;
    setAiBusy(false);
  }

  let aiRenderQueued = false;
  function handleAiEvent(event) {
    if (event.requestId !== aiRequestId && !(aiRequestId === null && aiStreamingEl)) return;
    if (event.type === "delta") {
      aiStreamingText += event.text;
      if (!aiRenderQueued) {
        aiRenderQueued = true;
        requestAnimationFrame(() => {
          aiRenderQueued = false;
          if (aiStreamingEl) {
            aiStreamingEl.innerHTML = renderWorkspaceMarkdownToHtml(aiStreamingText || "…");
            byId("ai-chat-output").scrollTop = byId("ai-chat-output").scrollHeight;
          }
        });
      }
    } else if (event.type === "notice") {
      aiStreamingText += `\n\n_${event.text}_`;
    } else if (event.type === "error") {
      finishAiStream(`**Error:** ${event.message}`, true);
    } else if (event.type === "done") {
      finishAiStream(aiStreamingText + (event.cancelled ? "\n\n_Stopped._" : ""));
    }
  }

  window.initAiScreen = function initAiScreen() {
    renderAiChat();
    if (aiBound) return;
    aiBound = true;
    void loadAiConfig().catch((error) => setStatus(errorText(error)));
    api.onAiEvent(handleAiEvent);

    byId("ai-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = byId("ai-input");
      const text = input.value;
      input.value = "";
      void sendAiMessage(text);
    });
    byId("ai-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        byId("ai-form").requestSubmit();
      }
    });
    byId("ai-stop-btn").addEventListener("click", () => aiRequestId && void api.aiCancel(aiRequestId));
    byId("ai-clear-btn").addEventListener("click", () => {
      if (aiRequestId) return;
      aiMessages = [];
      writeLocal(AI_HISTORY_KEY, []);
      renderAiChat();
    });
    byId("ai-chat-output").addEventListener("click", (event) => {
      const button = event.target.closest(".ai-prompt-btn");
      if (button) void sendAiMessage(button.dataset.prompt);
    });
    byId("ai-settings-btn").addEventListener("click", () => byId("ai-settings-panel").classList.toggle("hidden"));
    byId("ai-provider").addEventListener("change", () => {
      syncAiSettingsVisibility();
      if (byId("ai-provider").value === "ollama") void refreshOllamaModels();
    });
    byId("ai-refresh-ollama-btn").addEventListener("click", () => void refreshOllamaModels());
    byId("ai-save-settings-btn").addEventListener("click", async () => {
      try {
        aiConfig = await api.saveAiConfig({
          provider: byId("ai-provider").value,
          claudeModel: byId("ai-claude-model").value,
          anthropicKey: byId("ai-api-key").value.trim() || undefined,
          ollamaUrl: byId("ai-ollama-url").value,
          ollamaModel: byId("ai-ollama-model").value
        });
        byId("ai-api-key").value = "";
        byId("ai-api-key").placeholder = aiConfig.hasClaudeKey ? "saved (leave empty to keep)" : "sk-ant-…";
        byId("ai-settings-note").textContent = describeAiProvider();
        const ready = aiConfig.provider === "claude" ? aiConfig.hasClaudeKey : Boolean(aiConfig.ollamaModel);
        if (ready) byId("ai-settings-panel").classList.add("hidden");
      } catch (error) {
        byId("ai-settings-note").textContent = errorText(error);
      }
    });
  };

  // ─── Password Vault ─────────────────────────────────────────────────────
  let vaultEntries = [];
  let vaultBound = false;

  // Earlier builds kept vault entries unencrypted in localStorage.
  async function migrateLegacyVault() {
    const legacy = readLocal("wpdesktop.vault-entries", null);
    if (!Array.isArray(legacy)) return;
    const demo = new Set(["XAMPP PhpMyAdmin::root::password", "WordPress Administrator::admin::dev-wp-password"]);
    for (const entry of legacy) {
      if (demo.has(`${entry.label}::${entry.user}::${entry.pass}`)) continue;
      await api.saveVaultEntry({ label: entry.label, username: entry.user, password: entry.pass });
    }
    try { localStorage.removeItem("wpdesktop.vault-entries"); } catch (_) { /* ignore */ }
  }

  function resetVaultForm() {
    byId("vault-entry-form").reset();
    byId("vault-entry-id").value = "";
    byId("vault-form-title").textContent = "Add entry";
    byId("vault-entry-pass").placeholder = "";
    byId("vault-cancel-edit-btn").classList.add("hidden");
  }

  function renderVault() {
    const query = byId("vault-search").value.trim().toLowerCase();
    const list = byId("vault-entries-list");
    const matches = vaultEntries.filter((entry) => !query || `${entry.label} ${entry.username} ${entry.url}`.toLowerCase().includes(query));
    list.innerHTML = matches.map((entry) => `
      <div class="settings-item beta-vault-entry" data-id="${escapeHtml(entry.id)}">
        <div class="settings-item-copy">
          <strong>${escapeHtml(entry.label)}</strong>
          <span>${escapeHtml(entry.username || "no username")}${entry.url ? ` · ${escapeHtml(entry.url)}` : ""}</span>
          <span class="beta-secret" data-secret>••••••••</span>
          ${entry.notes ? `<span>${escapeHtml(entry.notes)}</span>` : ""}
        </div>
        <div class="button-row compact">
          <button type="button" data-action="copy-user">Copy user</button>
          <button type="button" data-action="copy-pass">Copy password</button>
          <button type="button" data-action="show">Show</button>
          <button type="button" data-action="edit">Edit</button>
          <button type="button" data-action="delete" class="danger-button">Delete</button>
        </div>
      </div>`).join("") || `<p class="beta-muted">${vaultEntries.length ? "No matches." : "No entries yet."}</p>`;
  }

  async function loadVault() {
    vaultEntries = await api.listVaultEntries();
    renderVault();
  }

  window.initPasswordVaultScreen = function initPasswordVaultScreen() {
    void migrateLegacyVault().then(loadVault).catch((error) => setStatus(errorText(error)));
    if (vaultBound) return;
    vaultBound = true;

    byId("vault-search").addEventListener("input", renderVault);
    byId("vault-generate-btn").addEventListener("click", async () => {
      const input = byId("vault-entry-pass");
      input.value = await api.generatePassword(20);
      input.type = "text";
    });
    byId("vault-cancel-edit-btn").addEventListener("click", resetVaultForm);
    byId("vault-entry-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api.saveVaultEntry({
          id: byId("vault-entry-id").value || undefined,
          label: byId("vault-entry-label").value,
          username: byId("vault-entry-user").value,
          password: byId("vault-entry-pass").value,
          url: byId("vault-entry-url").value,
          notes: byId("vault-entry-notes").value
        });
        byId("vault-entry-pass").type = "password";
        resetVaultForm();
        await loadVault();
      } catch (error) {
        setStatus(errorText(error));
      }
    });
    byId("vault-entries-list").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      const row = event.target.closest("[data-id]");
      if (!button || !row) return;
      const entry = vaultEntries.find((item) => item.id === row.dataset.id);
      if (!entry) return;
      const action = button.dataset.action;
      if (action === "copy-user") {
        await navigator.clipboard.writeText(entry.username || "");
        setStatus("Username copied.");
      } else if (action === "copy-pass") {
        await navigator.clipboard.writeText(await api.revealVaultEntry(entry.id));
        setStatus("Password copied. It stays on the clipboard until you copy something else.");
      } else if (action === "show") {
        const secret = row.querySelector("[data-secret]");
        const showing = button.textContent === "Hide";
        secret.textContent = showing ? "••••••••" : (await api.revealVaultEntry(entry.id)) || "(no password)";
        button.textContent = showing ? "Show" : "Hide";
      } else if (action === "edit") {
        byId("vault-entry-id").value = entry.id;
        byId("vault-entry-label").value = entry.label;
        byId("vault-entry-user").value = entry.username;
        byId("vault-entry-url").value = entry.url;
        byId("vault-entry-notes").value = entry.notes;
        byId("vault-entry-pass").value = "";
        byId("vault-entry-pass").placeholder = "leave empty to keep";
        byId("vault-form-title").textContent = `Edit ${entry.label}`;
        byId("vault-cancel-edit-btn").classList.remove("hidden");
      } else if (action === "delete") {
        if (!confirm(`Delete "${entry.label}"?`)) return;
        await api.deleteVaultEntry(entry.id);
        await loadVault();
      }
    });
  };

  // ─── Team room (PeerJS): chat, presence, activity feed ──────────────────
  // Star topology: the first member claims a peer ID derived from the room
  // code and relays messages; others connect to it. If the host leaves, the
  // remaining members race to take over the host ID.
  const TEAM_KEY = "wpdesktop.team";
  const team = {
    settings: readLocal(TEAM_KEY, { name: "", code: "" }),
    clientId: readLocal("wpdesktop.team.client-id", null) || (() => {
      const id = crypto.randomUUID();
      writeLocal("wpdesktop.team.client-id", id);
      return id;
    })(),
    peer: null,
    isHost: false,
    hostConn: null,
    clients: new Map(),
    members: new Map(),
    selfId: "",
    status: "offline",
    chat: readLocal("wpdesktop.team.chat", []),
    activity: readLocal("wpdesktop.team.activity", []),
    authToken: "",
    hostId: "",
    attempt: 0,
    reconnectTimer: null
  };

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function generateRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  }

  function selfMember() {
    const site = getSelectedSite();
    return { id: team.selfId, name: team.settings.name || "Me", site: site?.name || "", screen: document.querySelector(".screen.active")?.id?.replace(/-screen$/, "") || "", since: team.joinedAt };
  }

  function persistTeamLogs() {
    writeLocal("wpdesktop.team.chat", team.chat.slice(-200));
    writeLocal("wpdesktop.team.activity", team.activity.slice(-300));
  }

  function addChat(message) {
    if (team.chat.some((item) => item.id === message.id)) return;
    team.chat.push(message);
    team.chat.sort((a, b) => a.at.localeCompare(b.at));
    persistTeamLogs();
    renderTeamChat();
  }

  function addActivity(item) {
    if (team.activity.some((entry) => entry.id === item.id)) return;
    team.activity.push(item);
    team.activity.sort((a, b) => a.at.localeCompare(b.at));
    persistTeamLogs();
    renderActivityFeed();
  }

  function broadcast(message, exceptId) {
    if (team.isHost) {
      team.clients.forEach((conn, id) => id !== exceptId && conn.open && conn.send(message));
    } else if (team.hostConn?.open) {
      team.hostConn.send(message);
    }
  }

  function presencePayload() {
    return { type: "presence", members: [...team.members.values()] };
  }

  function handleTeamMessage(message, fromId) {
    if (!message || typeof message !== "object") return;
    if (message.type === "chat" && typeof message.text === "string") {
      const clean = { id: String(message.id), from: String(message.from).slice(0, 60), fromId: String(message.fromId || ""), text: message.text.slice(0, 4000), at: String(message.at) };
      addChat(clean);
      if (team.isHost) broadcast({ type: "chat", ...clean }, fromId);
    } else if (message.type === "activity" && typeof message.text === "string") {
      const clean = { id: String(message.id), from: String(message.from).slice(0, 60), text: message.text.slice(0, 300), at: String(message.at) };
      addActivity(clean);
      if (team.isHost) broadcast({ type: "activity", ...clean }, fromId);
    } else if (message.type === "member" && team.isHost && fromId) {
      team.members.set(fromId, { ...message.member, id: fromId });
      broadcast(presencePayload());
      renderPresence();
    } else if (message.type === "presence" && !team.isHost && Array.isArray(message.members)) {
      team.members = new Map(message.members.map((member) => [member.id, member]));
      renderPresence();
    } else if (message.type === "history" && !team.isHost) {
      (message.chat || []).forEach(addChat);
      (message.activity || []).forEach(addActivity);
    }
  }

  function setTeamStatus(status) {
    team.status = status;
    renderTeamRoomSlots();
  }

  // Each connection attempt gets a generation number; events from older
  // attempts are ignored, so overlapping retries can't clobber the live peer.
  function nextAttempt(run, delayMs = 0) {
    clearTimeout(team.reconnectTimer);
    const attempt = ++team.attempt;
    team.reconnectTimer = setTimeout(() => {
      if (attempt === team.attempt) run(attempt);
    }, delayMs);
  }

  function isCurrent(attempt, peer) {
    if (attempt === team.attempt) return true;
    try { peer.destroy(); } catch (_) { /* already closed */ }
    return false;
  }

  function resetConnection() {
    try { team.peer?.destroy(); } catch (_) { /* already closed */ }
    team.peer = null;
    team.hostConn = null;
    team.clients.clear();
    team.members.clear();
    team.isHost = false;
  }

  function leaveTeamRoom({ keepCode = false } = {}) {
    clearTimeout(team.reconnectTimer);
    team.attempt += 1;
    resetConnection();
    if (!keepCode) {
      team.settings.code = "";
      writeLocal(TEAM_KEY, team.settings);
    }
    setTeamStatus("offline");
    renderPresence();
  }

  async function joinTeamRoom() {
    if (typeof Peer !== "function") {
      setTeamStatus("error:PeerJS failed to load.");
      return;
    }
    const code = team.settings.code.trim().toUpperCase();
    if (!code || !team.settings.name.trim()) return;
    leaveTeamRoom({ keepCode: true });
    setTeamStatus("connecting");
    const roomHash = (await sha256Hex(`wpdesktop-room:${code}`)).slice(0, 32);
    team.authToken = await sha256Hex(`wpdesktop-auth:${code}`);
    team.joinedAt = team.joinedAt || new Date().toISOString();
    team.hostId = `wpd-${roomHash}`;
    nextAttempt(tryBecomeHost);
  }

  // After the host leaves, the relay server can hold its ID for a few
  // seconds; members keep alternating between claiming it and joining.
  function retryRoom(delayMs) {
    resetConnection();
    setTeamStatus("connecting");
    nextAttempt(tryBecomeHost, delayMs);
  }

  function tryBecomeHost(attempt) {
    const peer = new Peer(team.hostId, { debug: 0 });
    team.peer = peer;
    peer.on("open", (id) => {
      if (!isCurrent(attempt, peer)) return;
      team.isHost = true;
      team.selfId = id;
      team.members.set(id, selfMember());
      setTeamStatus("online");
      renderPresence();
    });
    peer.on("connection", (conn) => {
      if (!isCurrent(attempt, peer)) return;
      conn.on("data", (data) => {
        if (!conn.authorized) {
          if (data?.type === "hello" && data.auth === team.authToken) {
            conn.authorized = true;
            team.clients.set(conn.peer, conn);
            team.members.set(conn.peer, { ...data.member, id: conn.peer });
            conn.send({ type: "history", chat: team.chat.slice(-100), activity: team.activity.slice(-150) });
            broadcast(presencePayload());
            renderPresence();
          } else {
            conn.close();
          }
          return;
        }
        handleTeamMessage(data, conn.peer);
      });
      conn.on("close", () => {
        if (attempt !== team.attempt) return;
        team.clients.delete(conn.peer);
        team.members.delete(conn.peer);
        broadcast(presencePayload());
        renderPresence();
      });
    });
    peer.on("error", (error) => {
      if (!isCurrent(attempt, peer)) return;
      if (error.type === "unavailable-id") {
        // Someone else is hosting: join them.
        peer.destroy();
        nextAttempt(joinAsMember);
      } else if (error.type === "network" || error.type === "server-error" || error.type === "socket-error") {
        setTeamStatus("error:Can't reach the PeerJS relay. Check your internet connection.");
        nextAttempt(tryBecomeHost, 10000);
      } else {
        setTeamStatus(`error:${error.message}`);
        retryRoom(5000);
      }
    });
    peer.on("disconnected", () => {
      if (attempt === team.attempt && !peer.destroyed) peer.reconnect();
    });
  }

  function joinAsMember(attempt) {
    const peer = new Peer({ debug: 0 });
    team.peer = peer;
    team.isHost = false;
    peer.on("open", (id) => {
      if (!isCurrent(attempt, peer)) return;
      team.selfId = id;
      const conn = peer.connect(team.hostId, { reliable: true });
      team.hostConn = conn;
      conn.on("open", () => {
        if (attempt !== team.attempt) return;
        conn.send({ type: "hello", auth: team.authToken, member: selfMember() });
        setTeamStatus("online");
      });
      conn.on("data", (data) => {
        if (attempt === team.attempt) handleTeamMessage(data, null);
      });
      conn.on("close", () => {
        // The host left: race the other members to take over.
        if (attempt === team.attempt) retryRoom(300 + Math.random() * 1500);
      });
    });
    peer.on("error", (error) => {
      if (!isCurrent(attempt, peer)) return;
      if (error.type === "peer-unavailable") {
        // The host ID is free (or about to be): claim it.
        retryRoom(500 + Math.random() * 1000);
      } else if (error.type === "network" || error.type === "server-error" || error.type === "socket-error") {
        setTeamStatus("error:Can't reach the PeerJS relay. Check your internet connection.");
        nextAttempt(tryBecomeHost, 10000);
      } else {
        setTeamStatus(`error:${error.message}`);
        retryRoom(5000);
      }
    });
  }

  // Tell the room when the selected site or screen changes.
  let lastPresenceSignature = "";
  setInterval(() => {
    if (team.status !== "online") return;
    const me = selfMember();
    const signature = `${me.name}|${me.site}|${me.screen}`;
    if (signature === lastPresenceSignature) return;
    lastPresenceSignature = signature;
    if (team.isHost) {
      team.members.set(team.selfId, me);
      broadcast(presencePayload());
      renderPresence();
    } else if (team.hostConn?.open) {
      team.hostConn.send({ type: "member", member: me });
    }
  }, 3000);

  function renderTeamRoomSlots() {
    const status = team.status;
    const statusText = status === "online"
      ? `Room ${team.settings.code} · ${team.members.size || 1} online${team.isHost ? " · you're relaying" : ""}`
      : status === "connecting" ? "Connecting…" : status.startsWith("error:") ? status.slice(6) : "Not connected";
    document.querySelectorAll(".team-room-status").forEach((node) => { node.textContent = statusText; });
    document.querySelectorAll(".team-room-slot").forEach((slot) => {
      if (status === "online" || status === "connecting") {
        slot.innerHTML = `
          <div class="settings-card team-room-card">
            <div class="beta-row">
              <div class="settings-item-copy"><strong>${escapeHtml(team.settings.name)}</strong><span>${escapeHtml(statusText)}</span></div>
              <div class="button-row compact">
                <button type="button" data-team="copy">Copy room code</button>
                <button type="button" data-team="leave">Leave room</button>
              </div>
            </div>
          </div>`;
      } else {
        slot.innerHTML = `
          <div class="settings-card team-room-card">
            <div class="card-header"><h3>Join your team</h3></div>
            ${status.startsWith("error:") ? `<p class="extension-load-error">${escapeHtml(status.slice(6))}</p>` : ""}
            <div class="beta-inline-form">
              <input type="text" data-team-field="name" placeholder="Your name" value="${escapeHtml(team.settings.name)}" maxlength="40">
              <input type="text" data-team-field="code" placeholder="Room code" value="${escapeHtml(team.settings.code)}" maxlength="20">
              <button type="button" data-team="join" class="primary-button">Join</button>
              <button type="button" data-team="create">Create new room</button>
            </div>
            <p class="settings-note">Share the room code with teammates. Anyone with the code can join, so treat it like a password.</p>
          </div>`;
      }
    });
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-team]");
    if (!button) return;
    const slot = button.closest(".team-room-slot");
    const readField = (name) => slot?.querySelector(`[data-team-field="${name}"]`)?.value.trim() || "";
    const action = button.dataset.team;
    if (action === "join" || action === "create") {
      const name = readField("name");
      const code = action === "create" ? generateRoomCode() : readField("code").toUpperCase();
      if (!name) { setStatus("Enter your name first."); return; }
      if (!code) { setStatus("Enter a room code, or create a new room."); return; }
      team.settings = { name, code };
      writeLocal(TEAM_KEY, team.settings);
      await joinTeamRoom();
      if (action === "create") {
        await navigator.clipboard.writeText(code).catch(() => {});
        setStatus(`Room ${code} created and copied. Send it to your teammates.`);
      }
    } else if (action === "leave") {
      leaveTeamRoom();
    } else if (action === "copy") {
      await navigator.clipboard.writeText(team.settings.code).catch(() => {});
      setStatus("Room code copied.");
    }
  });

  function renderTeamChat() {
    const stream = byId("collab-chat-stream");
    if (!stream) return;
    if (!team.chat.length) {
      stream.innerHTML = '<p class="beta-muted">No messages yet.</p>';
      return;
    }
    stream.innerHTML = team.chat.slice(-200).map((message) => {
      const mine = message.fromId === team.clientId;
      return `<div class="team-chat-message ${mine ? "is-mine" : ""}"><div class="beta-row"><strong>${escapeHtml(message.from)}</strong><span class="beta-muted">${escapeHtml(new Date(message.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</span></div><div class="team-chat-text">${renderWorkspaceMarkdownToHtml(message.text)}</div></div>`;
    }).join("");
    stream.scrollTop = stream.scrollHeight;
  }

  function renderPresence() {
    // Online slots hold no inputs, so re-rendering them just refreshes the count.
    if (team.status === "online") renderTeamRoomSlots();
    const list = byId("team-presence-list");
    if (!list) return;
    if (team.status !== "online") {
      list.innerHTML = '<p class="beta-muted">Join a team room to see who else is online.</p>';
      return;
    }
    const screenNames = Object.fromEntries((typeof SIDEBAR_ITEMS !== "undefined" ? SIDEBAR_ITEMS : []).map((item) => [item.screen, item.label]));
    list.innerHTML = [...team.members.values()].map((member) => `
      <div class="settings-item beta-row">
        <div class="settings-item-copy">
          <strong>${escapeHtml(member.name)}${member.id === team.selfId ? " (you)" : ""}</strong>
          <span>${member.site ? `Working on ${escapeHtml(member.site)}` : "No site selected"}${member.screen ? ` · ${escapeHtml(screenNames[member.screen] || member.screen)}` : ""}</span>
        </div>
        <span class="beta-pill is-ok">online</span>
      </div>`).join("");
  }

  function renderActivityFeed() {
    const list = byId("collab-activity-list");
    if (!list) return;
    list.innerHTML = team.activity.slice(-300).reverse().map((item) => `
      <li><span class="beta-muted">${escapeHtml(new Date(item.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</span> <strong>${escapeHtml(item.from)}</strong> ${escapeHtml(item.text)}</li>`).join("")
      || '<li class="beta-muted">Deploys, pipeline runs, backups and commits will show up here.</li>';
  }

  // Called from other screens when something noteworthy happens.
  window.logTeamActivity = function logTeamActivity(text) {
    const item = { id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, from: team.settings.name || "You", text: String(text), at: new Date().toISOString() };
    addActivity(item);
    if (team.status === "online") broadcast({ type: "activity", ...item });
  };

  let chatBound = false;
  window.initTeamChatScreen = function initTeamChatScreen() {
    renderTeamRoomSlots();
    renderTeamChat();
    if (chatBound) return;
    chatBound = true;
    byId("collab-chat-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = byId("collab-chat-input");
      const text = input.value.trim();
      if (!text) return;
      if (team.status !== "online") {
        setStatus("Join a team room to chat.");
        return;
      }
      input.value = "";
      const message = { id: `${team.clientId}-${Date.now()}`, from: team.settings.name, fromId: team.clientId, text, at: new Date().toISOString() };
      addChat(message);
      broadcast({ type: "chat", ...message });
    });
  };

  window.initTeamPresenceScreen = function initTeamPresenceScreen() {
    renderTeamRoomSlots();
    renderPresence();
  };

  let feedBound = false;
  window.initActivityFeedScreen = function initActivityFeedScreen() {
    renderTeamRoomSlots();
    renderActivityFeed();
    if (feedBound) return;
    feedBound = true;
    byId("collab-feed-clear").addEventListener("click", () => {
      team.activity = [];
      persistTeamLogs();
      renderActivityFeed();
    });
  };

  // Rejoin the last room on startup.
  if (team.settings.code && team.settings.name) {
    setTimeout(() => void joinTeamRoom(), 1500);
  }

  // ─── Site Permissions ───────────────────────────────────────────────────
  let permissionsBound = false;
  let permissionTypes = [];

  async function loadPermissions() {
    const overview = await api.getPermissionsOverview();
    permissionTypes = overview.types;
    const labelOf = (id) => permissionTypes.find((type) => type.id === id)?.label || id;
    byId("permissions-defaults").innerHTML = overview.types.map((type) => `
      <div class="settings-item beta-row">
        <div class="settings-item-copy"><strong>${escapeHtml(type.label)}</strong></div>
        <select data-permission-default="${escapeHtml(type.id)}">
          <option value="allow" ${type.default === "allow" ? "selected" : ""}>Allow</option>
          <option value="block" ${type.default === "block" ? "selected" : ""}>Block</option>
        </select>
      </div>`).join("");
    byId("permissions-exception-type").innerHTML = overview.types.map((type) => `<option value="${escapeHtml(type.id)}">${escapeHtml(type.label)}</option>`).join("");
    byId("permissions-exceptions").innerHTML = overview.exceptions.map((rule) => `
      <div class="settings-item beta-row">
        <div class="settings-item-copy"><strong>${escapeHtml(rule.origin)}</strong><span>${escapeHtml(labelOf(rule.permission))}</span></div>
        <div class="beta-row">
          <span class="beta-pill ${rule.decision === "allow" ? "is-ok" : "is-bad"}">${rule.decision === "allow" ? "Allowed" : "Blocked"}</span>
          <button type="button" data-remove-exception="${escapeHtml(rule.origin)}" data-permission="${escapeHtml(rule.permission)}">Remove</button>
        </div>
      </div>`).join("") || '<p class="beta-muted">No exceptions. Every site uses the defaults.</p>';
    byId("permissions-recent").innerHTML = overview.recent.map((request) => `
      <div class="settings-item beta-row">
        <div class="settings-item-copy"><strong>${escapeHtml(request.origin)}</strong><span>${escapeHtml(labelOf(request.permission))} · ${escapeHtml(timeAgo(request.at))}</span></div>
        <div class="beta-row">
          <span class="beta-pill ${request.allowed ? "is-ok" : "is-bad"}">${request.allowed ? "Allowed" : "Blocked"}</span>
          <button type="button" data-flip-origin="${escapeHtml(request.origin)}" data-permission="${escapeHtml(request.permission)}" data-decision="${request.allowed ? "block" : "allow"}">${request.allowed ? "Always block" : "Always allow"}</button>
        </div>
      </div>`).join("") || '<p class="beta-muted">No permission requests since WP Desktop started.</p>';
  }

  window.initSitePermissionsScreen = function initSitePermissionsScreen() {
    void loadPermissions().catch((error) => setStatus(errorText(error)));
    if (permissionsBound) return;
    permissionsBound = true;
    const screen = byId("collab_permissions-screen");
    screen.addEventListener("change", async (event) => {
      const select = event.target.closest("[data-permission-default]");
      if (!select) return;
      await api.setPermissionDefault({ permission: select.dataset.permissionDefault, decision: select.value });
      setStatus("Default saved. It applies to new permission requests.");
    });
    screen.addEventListener("click", async (event) => {
      const remove = event.target.closest("[data-remove-exception]");
      const flip = event.target.closest("[data-flip-origin]");
      if (remove) {
        await api.setSitePermission({ origin: remove.dataset.removeException, permission: remove.dataset.permission, decision: null });
      } else if (flip) {
        await api.setSitePermission({ origin: flip.dataset.flipOrigin, permission: flip.dataset.permission, decision: flip.dataset.decision });
      } else if (event.target.id === "permissions-refresh") {
        // Fall through to reload.
      } else {
        return;
      }
      await loadPermissions();
    });
    byId("permissions-exception-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        let origin = byId("permissions-exception-origin").value.trim();
        if (origin && !/^https?:\/\//i.test(origin)) origin = `https://${origin}`;
        await api.setSitePermission({ origin, permission: byId("permissions-exception-type").value, decision: byId("permissions-exception-decision").value });
        byId("permissions-exception-origin").value = "";
        await loadPermissions();
      } catch (error) {
        setStatus(errorText(error));
      }
    });
  };

  // ─── MCP connectors ─────────────────────────────────────────────────────
  function renderConnector(panel, connector) {
    const fields = connector.fields.map((field) => {
      const value = field.secret ? "" : connector.config[field.key] || "";
      const placeholder = field.secret && connector.secretsSet[field.key] ? "saved (leave empty to keep)" : field.placeholder;
      const input = field.type === "textarea"
        ? `<textarea rows="4" data-field="${field.key}" placeholder="${escapeHtml(placeholder)}" spellcheck="false">${escapeHtml(value)}</textarea>`
        : `<input type="${field.type === "password" ? "password" : "text"}" data-field="${field.key}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">`;
      return `<label class="field"><span>${escapeHtml(field.label)}</span>${input}</label>`;
    }).join("");
    const readTools = connector.tools.filter((tool) => !tool.write);
    const writeTools = connector.tools.filter((tool) => tool.write);
    const test = connector.lastTest;
    panel.innerHTML = `
      <div class="settings-grid">
        <div class="settings-card">
          <div class="card-header"><h3>Connection</h3><span class="beta-pill ${connector.enabled || connector.builtIn ? "is-ok" : "is-off"}">${connector.builtIn ? "Built in" : connector.enabled ? "Enabled" : "Off"}</span></div>
          ${connector.builtIn ? '<p class="settings-note">These tools are built into WP Desktop\'s MCP server and are always available while it runs. Manage the server on the MCP Status screen.</p>' : `<div class="form-grid">${fields}</div>`}
          ${test ? `<p class="${test.ok ? "beta-ok-text" : "extension-load-error"}">${escapeHtml(test.message)} <span class="beta-muted">(${escapeHtml(timeAgo(test.at))})</span></p>` : ""}
          <div class="button-row compact">
            ${connector.builtIn ? "" : `<button type="button" class="primary-button" data-connector-action="save">Save</button>`}
            <button type="button" data-connector-action="test">Test connection</button>
            ${connector.builtIn ? "" : `<button type="button" data-connector-action="toggle">${connector.enabled ? "Disable" : "Enable"}</button>`}
          </div>
          ${writeTools.length ? `<label class="beta-inline-toggle"><input type="checkbox" data-connector-action="writes" ${connector.allowWrites ? "checked" : ""}> Allow actions that change things (${writeTools.map((tool) => tool.name).join(", ")})</label>` : ""}
        </div>
        <div class="settings-card">
          <div class="card-header"><h3>Tools for MCP clients</h3></div>
          <div class="settings-list">
            ${connector.builtIn ? '<p class="beta-muted">browser_list_tabs, browser_navigate, browser_click, browser_fill, browser_screenshot, browser_console_logs and more.</p>' : [...readTools, ...writeTools].map((tool) => `
              <div class="settings-item"><div class="settings-item-copy"><strong><code>${escapeHtml(tool.name)}</code>${tool.write ? ` <span class="beta-tag">${connector.allowWrites ? "write" : "write · off"}</span>` : ""}</strong><span>${escapeHtml(tool.description)}</span></div></div>`).join("")}
          </div>
          <p class="settings-note">Point Claude Desktop, Cursor or any MCP client at the address shown on the MCP Status screen. ${connector.builtIn ? "" : "Tools appear once the connector is enabled; reconnect the client to pick up changes."}</p>
        </div>
      </div>`;
  }

  async function loadConnector(panel) {
    const id = panel.dataset.connector;
    const connector = (await api.listConnectors()).find((item) => item.id === id);
    if (connector) renderConnector(panel, connector);
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-connector-action]");
    if (!button || button.type === "checkbox") return;
    const panel = button.closest(".connector-panel");
    const id = panel.dataset.connector;
    const action = button.dataset.connectorAction;
    const readConfig = () => Object.fromEntries([...panel.querySelectorAll("[data-field]")].map((input) => [input.dataset.field, input.value]));
    button.disabled = true;
    try {
      let connector;
      if (action === "save") {
        connector = await api.saveConnector({ id, config: readConfig() });
        connector = await api.testConnector(id);
      } else if (action === "test") {
        if (panel.querySelector("[data-field]")) await api.saveConnector({ id, config: readConfig() });
        connector = await api.testConnector(id);
      } else if (action === "toggle") {
        const current = (await api.listConnectors()).find((item) => item.id === id);
        connector = await api.saveConnector({ id, config: readConfig(), enabled: !current.enabled });
        if (connector.enabled && !connector.lastTest?.ok) connector = await api.testConnector(id);
      }
      if (connector) renderConnector(panel, connector);
    } catch (error) {
      setStatus(errorText(error));
      button.disabled = false;
    }
  });

  document.addEventListener("change", async (event) => {
    const toggle = event.target.closest('input[data-connector-action="writes"]');
    if (!toggle) return;
    const panel = toggle.closest(".connector-panel");
    if (toggle.checked && !confirm("Allow MCP clients to make changes through this connector (post, create, purge or write)?")) {
      toggle.checked = false;
      return;
    }
    renderConnector(panel, await api.saveConnector({ id: panel.dataset.connector, allowWrites: toggle.checked }));
  });

  window.initConnectorScreen = function initConnectorScreen(screen) {
    const panel = document.querySelector(`#${screen}-screen .connector-panel`);
    if (panel) void loadConnector(panel).catch((error) => setStatus(errorText(error)));
  };
})();
