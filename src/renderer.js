const state = {
  browser: {
    tabs: [],
    activeTabId: null,
    canGoBack: false,
    canGoForward: false,
    showBookmarksBar: true,
    bookmarks: [],
    downloads: [],
    savedPermissions: [],
    downloadDirectory: ""
  },
  lastInstall: null,
  vaultOpen: false,
  sites: [],
  selectedSiteId: null,
  isEditingAddress: false,
  htdocsPath: "",
  apacheRunning: false,
  xamppPaths: null
};

const progressState = {
  creating: false,
  deleting: false,
  backingUp: false
};

const uiState = {
  sidebarCollapsed: false
};

let browserFeedbackTimer = null;
let addressSuggestionsToken = 0;

const elements = {
  appShell: document.getElementById("app-shell"),
  appSidebar: document.getElementById("app-sidebar"),
  sidebarToggleButton: document.getElementById("sidebar-toggle-button"),
  navButtons: document.querySelectorAll(".nav-button"),
  screens: document.querySelectorAll(".screen"),
  browserLayout: document.getElementById("browser-layout"),
  tabStrip: document.getElementById("tab-strip"),
  browserHost: document.getElementById("browser-host"),
  browserStage: document.getElementById("browser-stage"),
  browserOverlay: document.getElementById("browser-overlay"),
  addressForm: document.getElementById("address-form"),
  addressInput: document.getElementById("address-input"),
  addressSuggestions: document.getElementById("address-suggestions"),
  backButton: document.getElementById("back-button"),
  forwardButton: document.getElementById("forward-button"),
  reloadButton: document.getElementById("reload-button"),
  newTabButton: document.getElementById("new-tab-button"),
  bookmarkPageButton: document.getElementById("bookmark-page-button"),
  browserFeedback: document.getElementById("browser-feedback"),
  bookmarkBar: document.getElementById("bookmark-bar"),
  bookmarkContextMenu: document.getElementById("bookmark-context-menu"),
  bookmarkModal: document.getElementById("bookmark-modal"),
  closeBookmarkModalButton: document.getElementById("close-bookmark-modal-button"),
  bookmarkNameInput: document.getElementById("bookmark-name-input"),
  bookmarkMoreButton: document.getElementById("bookmark-more-button"),
  bookmarkDoneButton: document.getElementById("bookmark-done-button"),
  bookmarkRemoveButton: document.getElementById("bookmark-remove-button"),
  vaultToggleButton: document.getElementById("vault-toggle-button"),
  vaultPanel: document.getElementById("vault-panel"),
  bookmarksList: document.getElementById("bookmarks-list"),
  vaultSiteLabel: document.getElementById("vault-site-label"),
  vaultUsername: document.getElementById("vault-username"),
  vaultPassword: document.getElementById("vault-password"),
  vaultSaveButton: document.getElementById("vault-save-button"),
  vaultFillButton: document.getElementById("vault-fill-button"),
  vaultClearButton: document.getElementById("vault-clear-button"),
  downloadDirectory: document.getElementById("download-directory"),
  pickDownloadDirectoryButton: document.getElementById("pick-download-directory-button"),
  clearDownloadsButton: document.getElementById("clear-downloads-button"),
  downloadsList: document.getElementById("downloads-list"),
  permissionsList: document.getElementById("permissions-list"),
  sitesList: document.getElementById("sites-list"),
  sitesRunningCount: document.getElementById("sites-running-count"),
  htdocsPath: document.getElementById("htdocs-path"),
  pickHtdocsButton: document.getElementById("pick-htdocs-button"),
  openSidebarPhpMyAdminButton: document.getElementById("open-sidebar-phpmyadmin-button"),
  serverStatus: document.getElementById("server-status"),
  createSiteButton: document.getElementById("create-site-button"),
  createSiteModal: document.getElementById("create-site-modal"),
  closeCreateSiteModal: document.getElementById("close-create-site-modal"),
  createProgressCard: document.getElementById("create-progress-card"),
  createProgressTitle: document.getElementById("create-progress-title"),
  createProgressText: document.getElementById("create-progress-text"),
  siteTitle: document.getElementById("site-title"),
  siteLastStarted: document.getElementById("site-last-started"),
  openFolderButton: document.getElementById("open-folder-button"),
  openShellButton: document.getElementById("open-shell-button"),
  openVSCodeButton: document.getElementById("open-vscode-button"),
  backupSiteButton: document.getElementById("backup-site-button"),
  openSiteButton: document.getElementById("open-site-button"),
  openLiveSiteButton: document.getElementById("open-live-site-button"),
  deleteSiteButton: document.getElementById("delete-site-button"),
  deleteProgressCard: document.getElementById("delete-progress-card"),
  deleteProgressTitle: document.getElementById("delete-progress-title"),
  deleteProgressText: document.getElementById("delete-progress-text"),
  openPhpMyAdminButton: document.getElementById("open-phpmyadmin-button"),
  zipPath: document.getElementById("zip-path"),
  basePath: document.getElementById("base-path"),
  folderName: document.getElementById("folder-name"),
  dbHost: document.getElementById("db-host"),
  dbPort: document.getElementById("db-port"),
  dbUser: document.getElementById("db-user"),
  dbPassword: document.getElementById("db-password"),
  createDb: document.getElementById("create-db"),
  saveDbProfile: document.getElementById("save-db-profile"),
  installButton: document.getElementById("install-button"),
  statusText: document.getElementById("status-text"),
  resultCard: document.getElementById("result-card"),
  resultTarget: document.getElementById("result-target"),
  resultUrl: document.getElementById("result-url"),
  resultDb: document.getElementById("result-db"),
  resultFiles: document.getElementById("result-files"),
  resultLogs: document.getElementById("result-logs"),
  detailDomain: document.getElementById("detail-domain"),
  detailSsl: document.getElementById("detail-ssl"),
  detailWebServer: document.getElementById("detail-web-server"),
  detailPhpVersion: document.getElementById("detail-php-version"),
  detailDbVersion: document.getElementById("detail-db-version"),
  detailWordpressVersion: document.getElementById("detail-wordpress-version"),
  overviewEmptyCard: document.getElementById("overview-empty-card"),
  pickXamppRootButton: document.getElementById("pick-xampp-root-button"),
  settingsPickHtdocsButton: document.getElementById("settings-pick-htdocs-button"),
  settingsXamppRoot: document.getElementById("settings-xampp-root"),
  settingsHtdocsPath: document.getElementById("settings-htdocs-path"),
  xamppSettingsNote: document.getElementById("xampp-settings-note"),
  openXamppRootButton: document.getElementById("open-xampp-root-button"),
  openSettingsHtdocsButton: document.getElementById("open-settings-htdocs-button"),
  settingsApacheStart: document.getElementById("settings-apache-start"),
  settingsApacheStop: document.getElementById("settings-apache-stop"),
  settingsApacheConfig: document.getElementById("settings-apache-config"),
  settingsMysqlConfig: document.getElementById("settings-mysql-config"),
  settingsControlPanel: document.getElementById("settings-control-panel"),
  settingsPhpExe: document.getElementById("settings-php-exe"),
  settingsPhpConfig: document.getElementById("settings-php-config"),
  settingsPhpMyAdmin: document.getElementById("settings-phpmyadmin"),
  openApacheStartButton: document.getElementById("open-apache-start-button"),
  openApacheStopButton: document.getElementById("open-apache-stop-button"),
  openApacheConfigButton: document.getElementById("open-apache-config-button"),
  openMysqlConfigButton: document.getElementById("open-mysql-config-button"),
  openControlPanelButton: document.getElementById("open-control-panel-button"),
  openPhpExeButton: document.getElementById("open-php-exe-button"),
  openPhpConfigButton: document.getElementById("open-php-config-button"),
  openPhpMyAdminFolderButton: document.getElementById("open-phpmyadmin-folder-button"),
  siteTabs: document.querySelectorAll(".site-tab"),
  siteTabPanels: document.querySelectorAll(".site-tab-panel")
};

state.addressSuggestions = [];
state.activeAddressSuggestionIndex = -1;

function setStatus(message) {
  elements.statusText.textContent = message;
}

function setBrowserFeedback(message, type = "info") {
  if (!message) {
    elements.browserFeedback.textContent = "";
    elements.browserFeedback.classList.add("hidden");
    elements.browserFeedback.dataset.type = "";
    return;
  }

  elements.browserFeedback.textContent = message;
  elements.browserFeedback.dataset.type = type;
  elements.browserFeedback.classList.remove("hidden");

  if (browserFeedbackTimer) {
    clearTimeout(browserFeedbackTimer);
  }

  browserFeedbackTimer = setTimeout(() => {
    elements.browserFeedback.classList.add("hidden");
  }, 2600);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hideAddressSuggestions() {
  addressSuggestionsToken += 1;
  state.addressSuggestions = [];
  state.activeAddressSuggestionIndex = -1;
  elements.addressSuggestions.innerHTML = "";
  elements.addressSuggestions.classList.add("hidden");
}

function renderAddressSuggestions() {
  const suggestions = state.addressSuggestions || [];
  elements.addressSuggestions.innerHTML = "";

  if (!suggestions.length) {
    elements.addressSuggestions.classList.add("hidden");
    return;
  }

  suggestions.forEach((suggestion, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `address-suggestion${index === state.activeAddressSuggestionIndex ? " active" : ""}`;
    button.dataset.index = String(index);
    button.innerHTML = `
      <span class="address-suggestion-badge">${escapeHtml(suggestion.type)}</span>
      <span class="address-suggestion-copy">
        <span class="address-suggestion-title">${escapeHtml(suggestion.title || suggestion.value)}</span>
        <span class="address-suggestion-meta">${escapeHtml(suggestion.secondaryText || suggestion.value)}</span>
      </span>
    `;

    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    button.addEventListener("click", () => {
      applyAddressSuggestion(index);
    });

    elements.addressSuggestions.appendChild(button);
  });

  elements.addressSuggestions.classList.remove("hidden");
}

async function requestAddressSuggestions(query) {
  const token = ++addressSuggestionsToken;
  let suggestions = [];

  try {
    suggestions = await window.desktopAPI.browserGetSuggestions(query);
  } catch (_) {
    suggestions = [];
  }

  if (token !== addressSuggestionsToken) {
    return;
  }

  state.addressSuggestions = Array.isArray(suggestions) ? suggestions : [];
  state.activeAddressSuggestionIndex = -1;
  renderAddressSuggestions();
}

function moveAddressSuggestion(step) {
  if (!state.addressSuggestions.length) {
    return;
  }

  const length = state.addressSuggestions.length;
  const nextIndex = state.activeAddressSuggestionIndex < 0
    ? 0
    : (state.activeAddressSuggestionIndex + step + length) % length;

  state.activeAddressSuggestionIndex = nextIndex;
  renderAddressSuggestions();
}

function applyAddressSuggestion(index = state.activeAddressSuggestionIndex) {
  const suggestion = state.addressSuggestions[index];
  if (!suggestion) {
    return;
  }

  state.isEditingAddress = false;
  hideAddressSuggestions();
  elements.addressInput.value = suggestion.value;
  window.desktopAPI.browserNavigate(suggestion.value);
}

async function openBookmarkSaveDialogForCurrentPage() {
  const active = getActiveBrowserTab();
  if (!active?.url) {
    setBrowserFeedback("Open a page before saving a bookmark.", "error");
    return;
  }

  const existing = state.browser.bookmarks.find((bookmark) => bookmark.url === active.url) || null;

  try {
    const result = await window.desktopAPI.browserShowBookmarkSaveDialog({
      mode: existing ? "edit" : "add",
      existingId: existing?.id || null,
      url: active.url,
      title: existing?.title || active.title || active.url
    });

    if (result?.action === "manage") {
      state.vaultOpen = true;
      renderVaultPanel();
      setBrowserFeedback("Manage bookmarks in Browser Tools.", "info");
      return;
    }

    if (result?.action === "remove" && existing?.id) {
      await window.desktopAPI.browserRemoveBookmark(existing.id);
      setBrowserFeedback(`Removed bookmark for ${existing.title || existing.url}.`, "success");
      return;
    }

    if (result?.action !== "save") {
      return;
    }

    const nextTitle = result.title?.trim() || existing?.title || active.title || active.url;
    const bookmark = existing?.id
      ? await window.desktopAPI.browserUpdateBookmark({
          id: existing.id,
          title: nextTitle,
          url: active.url
        })
      : await window.desktopAPI.browserAddBookmark({
          title: nextTitle,
          url: active.url
        });

    setBrowserFeedback(`Saved bookmark for ${bookmark.title || bookmark.url}.`, "success");
  } catch (error) {
    setBrowserFeedback(`Bookmark failed: ${error.message}`, "error");
  }
}

async function openBookmarkSaveDialogForBookmark(bookmark) {
  if (!bookmark?.id || !bookmark.url) {
    return;
  }

  try {
    const result = await window.desktopAPI.browserShowBookmarkSaveDialog({
      mode: "edit",
      existingId: bookmark.id,
      url: bookmark.url,
      title: bookmark.title || bookmark.url
    });

    if (result?.action === "manage") {
      state.vaultOpen = true;
      renderVaultPanel();
      setBrowserFeedback("Manage bookmarks in Browser Tools.", "info");
      return;
    }

    if (result?.action === "remove") {
      await window.desktopAPI.browserRemoveBookmark(bookmark.id);
      setBrowserFeedback(`Removed bookmark for ${bookmark.title || bookmark.url}.`, "success");
      return;
    }

    if (result?.action !== "save") {
      return;
    }

    const updated = await window.desktopAPI.browserUpdateBookmark({
      id: bookmark.id,
      title: result.title?.trim() || bookmark.title || bookmark.url,
      url: bookmark.url
    });
    setBrowserFeedback(`Saved bookmark for ${updated.title || updated.url}.`, "success");
  } catch (error) {
    setBrowserFeedback(`Bookmark action failed: ${error.message}`, "error");
  }
}

function renderSidebarState() {
  elements.appShell.classList.toggle("sidebar-collapsed", uiState.sidebarCollapsed);
  elements.sidebarToggleButton.setAttribute("aria-label", uiState.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
  elements.sidebarToggleButton.querySelector(".sidebar-toggle-glyph").textContent = uiState.sidebarCollapsed ? ">>" : "<<";
  syncBrowserLayoutSoon();
}

function toggleSidebar() {
  uiState.sidebarCollapsed = !uiState.sidebarCollapsed;
  localStorage.setItem("wpdesktop.sidebarCollapsed", uiState.sidebarCollapsed ? "1" : "0");
  renderSidebarState();
}

function showScreen(screenName) {
  elements.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.screen === screenName);
  });

  elements.screens.forEach((screen) => {
    screen.classList.toggle("active", screen.id === `${screenName}-screen`);
  });

  syncBrowserLayoutSoon();
}

elements.navButtons.forEach((button) => {
  button.addEventListener("click", () => showScreen(button.dataset.screen));
});
elements.sidebarToggleButton.addEventListener("click", toggleSidebar);

function showSiteTab(name) {
  elements.siteTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.siteTab === name);
  });
  elements.siteTabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${name}-panel`);
  });
}

elements.siteTabs.forEach((tab) => {
  tab.addEventListener("click", () => showSiteTab(tab.dataset.siteTab));
});

function ensureUrl(input) {
  const raw = input.trim();
  if (!raw) {
    return "http://localhost/";
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (/^(localhost|127\.0\.0\.1|::1)(:\d+)?(\/.*)?$/i.test(raw)) {
    return `http://${raw}`;
  }
  return `https://${raw}`;
}

function getSelectedSite() {
  return state.sites.find((site) => site.id === state.selectedSiteId) || null;
}

function getActiveBrowserTab() {
  return state.browser.tabs.find((tab) => tab.id === state.browser.activeTabId) || null;
}

function getCredentialKeyFromUrl(url) {
  try {
    return new URL(url).origin;
  } catch (_) {
    return null;
  }
}

async function syncVaultPanel() {
  const active = getActiveBrowserTab();
  const key = active ? getCredentialKeyFromUrl(active.url) : null;

  if (!key) {
    elements.vaultSiteLabel.textContent = "Open a page to manage saved credentials.";
    elements.vaultUsername.value = "";
    elements.vaultPassword.value = "";
    return;
  }

  elements.vaultSiteLabel.textContent = key;
  const saved = await window.desktopAPI.getSiteCredentials(key);
  elements.vaultUsername.value = saved?.username || "";
  elements.vaultPassword.value = saved?.password || "";
}

function refreshControls() {
  const active = getActiveBrowserTab();
  if (!state.isEditingAddress && !state.addressSuggestions.length) {
    elements.addressInput.value = active?.url || "";
  }
  elements.backButton.disabled = !state.browser.canGoBack;
  elements.forwardButton.disabled = !state.browser.canGoForward;
  elements.bookmarkPageButton.disabled = !active?.url;
  elements.bookmarkPageButton.textContent = active?.url && state.browser.bookmarks.some((bookmark) => bookmark.url === active.url)
    ? "Bookmarked"
    : "Bookmark";
  renderBookmarks();
  renderDownloads();
  renderPermissions();
  void syncVaultPanel();
}

function renderVaultPanel() {
  elements.vaultPanel.classList.toggle("hidden", !state.vaultOpen);
  elements.vaultToggleButton.classList.toggle("active", state.vaultOpen);
  elements.browserLayout.classList.toggle("with-vault", state.vaultOpen);
  syncBrowserLayoutSoon();
}

function formatPathValue(value) {
  return value || "Not found";
}

function bindSettingsPath(labelElement, buttonElement, targetPath) {
  labelElement.textContent = formatPathValue(targetPath);
  buttonElement.disabled = !targetPath;
}

function renderXamppSettings() {
  const paths = state.xamppPaths || {};

  elements.settingsXamppRoot.value = paths.xamppRootPath || "";
  elements.settingsHtdocsPath.value = paths.htdocsPath || state.htdocsPath || "";
  elements.xamppSettingsNote.textContent = paths.xamppRootPath
    ? "This XAMPP root is used to auto-detect service files and support local site management."
    : "Set the XAMPP root to auto-detect Apache, PHP, MySQL, and phpMyAdmin files.";

  elements.openXamppRootButton.disabled = !paths.xamppRootPath;
  elements.openSettingsHtdocsButton.disabled = !paths.htdocsPath;
  bindSettingsPath(elements.settingsApacheStart, elements.openApacheStartButton, paths.apacheStartPath);
  bindSettingsPath(elements.settingsApacheStop, elements.openApacheStopButton, paths.apacheStopPath);
  bindSettingsPath(elements.settingsApacheConfig, elements.openApacheConfigButton, paths.apacheConfigPath);
  bindSettingsPath(elements.settingsMysqlConfig, elements.openMysqlConfigButton, paths.mysqlConfigPath);
  bindSettingsPath(elements.settingsControlPanel, elements.openControlPanelButton, paths.controlPanelPath);
  bindSettingsPath(elements.settingsPhpExe, elements.openPhpExeButton, paths.phpExecutablePath);
  bindSettingsPath(elements.settingsPhpConfig, elements.openPhpConfigButton, paths.phpConfigPath);
  bindSettingsPath(elements.settingsPhpMyAdmin, elements.openPhpMyAdminFolderButton, paths.phpMyAdminPath);
}

function setCreateProgress(active, message = "Preparing files, database, and local site records...") {
  progressState.creating = active;
  elements.createProgressCard.classList.toggle("hidden", !active);
  elements.createProgressTitle.textContent = "Creating site";
  elements.createProgressText.textContent = message;
  elements.installButton.disabled = active;
  elements.closeCreateSiteModal.disabled = active;
}

function setDeleteProgress(active, siteName = "") {
  progressState.deleting = active;
  elements.deleteProgressCard.classList.toggle("hidden", !active);
  elements.deleteProgressTitle.textContent = siteName ? `Deleting ${siteName}` : "Deleting site";
  elements.deleteProgressText.textContent = active
    ? "Removing files and database. This can take a moment..."
    : "Removing files and database...";
  elements.deleteSiteButton.disabled = active || !getSelectedSite();
  elements.createSiteButton.disabled = active;
}

function setBackupProgress(active) {
  progressState.backingUp = active;
  const site = getSelectedSite();
  elements.backupSiteButton.disabled = active || !site || progressState.deleting;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function renderBookmarks() {
  elements.bookmarkBar.classList.toggle("hidden", !state.browser.showBookmarksBar);
  elements.bookmarkBar.innerHTML = "";
  elements.bookmarksList.innerHTML = "";

  if (!state.browser.bookmarks.length) {
    if (state.browser.showBookmarksBar) {
      const emptyChip = document.createElement("div");
      emptyChip.className = "bookmark-bar-empty";
      emptyChip.textContent = "No bookmarks";
      elements.bookmarkBar.appendChild(emptyChip);
    }

    const empty = document.createElement("div");
    empty.className = "browser-tool-empty";
    empty.textContent = "No bookmarks yet.";
    elements.bookmarksList.appendChild(empty);
    return;
  }

  state.browser.bookmarks.forEach((bookmark) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "bookmark-chip";
    chip.textContent = bookmark.iconOnly
      ? (bookmark.title || bookmark.url).trim().charAt(0).toUpperCase() || "*"
      : (bookmark.title || bookmark.url);
    chip.title = bookmark.url;
    chip.addEventListener("click", () => {
      openUrlInAppBrowser(bookmark.url);
    });
    chip.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      try {
        await window.desktopAPI.browserShowBookmarkContextMenu({
          bookmark,
          showBookmarksBar: state.browser.showBookmarksBar
        });
      } catch (error) {
        setBrowserFeedback(`Bookmark menu failed: ${error.message}`, "error");
      }
    });
    elements.bookmarkBar.appendChild(chip);

    const item = document.createElement("div");
    item.className = "browser-tool-item";
    item.innerHTML = `
      <div class="browser-tool-item-copy">
        <strong>${bookmark.title || bookmark.url}</strong>
        <span>${bookmark.url}</span>
      </div>
      <div class="button-row compact">
        <button type="button" data-open-bookmark="${bookmark.id}">Open</button>
        <button type="button" data-remove-bookmark="${bookmark.id}">Remove</button>
      </div>
    `;

    item.querySelector("[data-open-bookmark]")?.addEventListener("click", () => {
      openUrlInAppBrowser(bookmark.url);
    });

    item.querySelector("[data-remove-bookmark]")?.addEventListener("click", async () => {
      await window.desktopAPI.browserRemoveBookmark(bookmark.id);
      setBrowserFeedback(`Removed bookmark for ${bookmark.title || bookmark.url}.`, "info");
    });

    elements.bookmarksList.appendChild(item);
  });
}

function formatDownloadProgress(download) {
  const received = formatBytes(download.receivedBytes);
  const total = download.totalBytes ? formatBytes(download.totalBytes) : "?";
  return `${received} / ${total}`;
}

function renderDownloads() {
  elements.downloadDirectory.value = state.browser.downloadDirectory || "";
  elements.downloadsList.innerHTML = "";

  if (!state.browser.downloads.length) {
    const empty = document.createElement("div");
    empty.className = "browser-tool-empty";
    empty.textContent = "No downloads yet.";
    elements.downloadsList.appendChild(empty);
    return;
  }

  state.browser.downloads.forEach((download) => {
    const item = document.createElement("div");
    item.className = "browser-tool-item";

    const canOpen = download.status === "completed";
    item.innerHTML = `
      <div class="browser-tool-item-copy">
        <strong>${download.filename}</strong>
        <span>${download.status} · ${formatDownloadProgress(download)}</span>
      </div>
      <div class="button-row compact">
        <button type="button" data-open-download="${download.id}" ${canOpen ? "" : "disabled"}>Open</button>
        <button type="button" data-show-download="${download.id}" ${canOpen ? "" : "disabled"}>Show</button>
      </div>
    `;

    const openButton = item.querySelector("[data-open-download]");
    openButton?.addEventListener("click", async () => {
      try {
        await window.desktopAPI.browserOpenDownload(download.id);
      } catch (error) {
        setStatus(`Open download failed: ${error.message}`);
      }
    });

    const showButton = item.querySelector("[data-show-download]");
    showButton?.addEventListener("click", async () => {
      try {
        await window.desktopAPI.browserShowDownload(download.id);
      } catch (error) {
        setStatus(`Show download failed: ${error.message}`);
      }
    });

    elements.downloadsList.appendChild(item);
  });
}

function renderPermissions() {
  elements.permissionsList.innerHTML = "";

  if (!state.browser.savedPermissions.length) {
    const empty = document.createElement("div");
    empty.className = "browser-tool-empty";
    empty.textContent = "No saved site permissions yet.";
    elements.permissionsList.appendChild(empty);
    return;
  }

  state.browser.savedPermissions.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "browser-tool-item";
    item.innerHTML = `
      <div class="browser-tool-item-copy">
        <strong>${entry.origin}</strong>
        <span>${entry.permission} · ${entry.decision}</span>
      </div>
      <div class="button-row compact">
        <button type="button" data-clear-permission="${entry.id}">Forget</button>
      </div>
    `;

    item.querySelector("[data-clear-permission]")?.addEventListener("click", async () => {
      await window.desktopAPI.browserClearPermission({
        origin: entry.origin,
        permission: entry.permission
      });
      setStatus(`Cleared saved permission for ${entry.origin}.`);
    });

    elements.permissionsList.appendChild(item);
  });
}

function toggleCreateSiteModal(open) {
  if (!open && progressState.creating) {
    return;
  }

  elements.createSiteModal.classList.toggle("hidden", !open);
}

function openUrlInAppBrowser(url, mode = "auto") {
  if (!url) {
    return;
  }

  showScreen("browser");
  window.desktopAPI.browserCreateTab({ url, mode });
}

function renderBrowserTabs() {
  elements.tabStrip.innerHTML = "";

  state.browser.tabs.forEach((tab) => {
    const button = document.createElement("button");
    button.className = `tab-button${tab.id === state.browser.activeTabId ? " active" : ""}`;
    button.innerHTML = `
      <span class="tab-title">${tab.title || tab.url}</span>
      <span class="tab-close" data-close="${tab.id}">x</span>
    `;

    button.addEventListener("click", (event) => {
      const closeId = event.target.dataset.close;
      if (closeId) {
        window.desktopAPI.browserCloseTab(closeId);
        return;
      }
      window.desktopAPI.browserActivateTab(tab.id);
    });

    elements.tabStrip.appendChild(button);
  });

  renderBrowserOverlay();
}

function renderBrowserOverlay() {
  const active = getActiveBrowserTab();
  elements.browserOverlay.innerHTML = "";

  if (!active?.error) {
    syncBrowserLayoutSoon();
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "browser-error-card";
  overlay.innerHTML = `
    <span class="eyebrow">Local site error</span>
    <h3>Could not open this local site</h3>
    <p><strong>URL:</strong> ${active.error.url}</p>
    <p><strong>Reason:</strong> ${active.error.description}</p>
    <div class="button-row compact">
      <button type="button" id="browser-error-retry">Retry</button>
      <button type="button" id="browser-error-open-installer">Open Installer</button>
    </div>
  `;

  overlay.querySelector("#browser-error-retry").addEventListener("click", () => {
    window.desktopAPI.browserReload();
  });
  overlay.querySelector("#browser-error-open-installer").addEventListener("click", () => {
    showScreen("installer");
  });

  elements.browserOverlay.appendChild(overlay);
  syncBrowserLayoutSoon();
}

let layoutFrame = null;

function syncBrowserLayoutSoon() {
  if (layoutFrame) {
    cancelAnimationFrame(layoutFrame);
  }

  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = null;
    const browserScreenActive = document.getElementById("browser-screen").classList.contains("active");
    const active = getActiveBrowserTab();
    const visible = browserScreenActive && Boolean(active) && !active.error;

    if (!visible) {
      elements.browserHost.style.setProperty("--browser-stage-offset", "0px");
      window.desktopAPI.browserUpdateLayout({ visible: false });
      return;
    }

    const hostRect = elements.browserHost.getBoundingClientRect();
    const suggestionsVisible = !elements.addressSuggestions.classList.contains("hidden");
    let stageOffset = 0;

    if (suggestionsVisible) {
      const suggestionsRect = elements.addressSuggestions.getBoundingClientRect();
      if (suggestionsRect.height > 0) {
        stageOffset = Math.max(0, Math.ceil(suggestionsRect.bottom - hostRect.top + 8));
      }
    }

    elements.browserHost.style.setProperty("--browser-stage-offset", `${stageOffset}px`);
    const rect = elements.browserStage.getBoundingClientRect();
    window.desktopAPI.browserUpdateLayout({
      visible: rect.width > 0 && rect.height > 0,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    });
  });
}

function formatLastStarted(value) {
  if (!value) {
    return "Last started: never";
  }
  return `Last started: ${new Date(value).toLocaleDateString()}`;
}

function renderSitesList() {
  elements.sitesList.innerHTML = "";
  const running = state.apacheRunning ? state.sites.length : 0;
  elements.sitesRunningCount.textContent = `${running} site${running === 1 ? "" : "s"} running`;
  elements.serverStatus.textContent = `Apache status: ${state.apacheRunning ? "running" : "stopped"}`;

  if (!state.sites.length) {
    const empty = document.createElement("div");
    empty.className = "site-list-empty";
    empty.textContent = state.htdocsPath
      ? "No sites found in the selected htdocs folder."
      : "Set your XAMPP htdocs folder to load sites from the shared server.";
    elements.sitesList.appendChild(empty);
    return;
  }

  state.sites.forEach((site) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `site-list-item${site.id === state.selectedSiteId ? " active" : ""}`;
    item.innerHTML = `
      <span class="site-dot"></span>
      <span class="site-list-name">${site.name}</span>
    `;
    item.addEventListener("click", () => {
      state.selectedSiteId = site.id;
      renderSitesList();
      renderSiteDetails();
    });
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      state.selectedSiteId = site.id;
      renderSitesList();
      renderSiteDetails();
      void window.desktopAPI.showSiteContextMenu(site);
    });
    elements.sitesList.appendChild(item);
  });
}

function renderSiteDetails() {
  const site = getSelectedSite();

  if (!site) {
    elements.siteTitle.textContent = "Create a new site";
    elements.siteLastStarted.textContent = "Last started: never";
    elements.resultTarget.textContent = "-";
    elements.resultUrl.textContent = "-";
    elements.resultDb.textContent = "-";
    elements.resultFiles.textContent = "-";
    elements.detailDomain.textContent = "-";
    elements.detailSsl.textContent = "-";
    elements.detailWebServer.textContent = "-";
    elements.detailPhpVersion.textContent = "-";
    elements.detailDbVersion.textContent = "-";
    elements.detailWordpressVersion.textContent = "-";
    elements.backupSiteButton.disabled = true;
    elements.deleteSiteButton.disabled = true;
    elements.overviewEmptyCard.classList.remove("hidden");
    return;
  }

  elements.siteTitle.textContent = site.name;
  elements.siteLastStarted.textContent = formatLastStarted(site.lastStartedAt);
  elements.resultTarget.textContent = site.path || "-";
  elements.resultUrl.textContent = site.siteUrl || "-";
  elements.resultDb.textContent = site.dbName || "-";
  elements.resultFiles.textContent = site.extractedCount ? String(site.extractedCount) : "-";
  elements.detailDomain.textContent = site.domain || "-";
  elements.detailSsl.textContent = site.sslPath || "-";
  elements.detailWebServer.textContent = site.webServer || "-";
  elements.detailPhpVersion.textContent = site.phpVersion || "-";
  elements.detailDbVersion.textContent = site.databaseVersion || "-";
  elements.detailWordpressVersion.textContent = site.wordpressVersion || "-";
  elements.dbHost.value = site.dbHost || elements.dbHost.value || "127.0.0.1";
  elements.dbPort.value = site.dbPort || elements.dbPort.value || "3306";
  elements.dbUser.value = site.dbUser || elements.dbUser.value || "root";
  elements.dbPassword.value = site.dbPassword ?? elements.dbPassword.value ?? "";
  elements.backupSiteButton.disabled = progressState.backingUp || progressState.deleting;
  elements.deleteSiteButton.disabled = progressState.deleting;
  elements.overviewEmptyCard.classList.add("hidden");
}

async function refreshSites() {
  const response = await window.desktopAPI.listSites();
  state.sites = response.sites;
  state.htdocsPath = response.htdocsPath || "";
  state.apacheRunning = Boolean(response.apacheRunning);
  elements.htdocsPath.value = state.htdocsPath;
  if (!state.selectedSiteId && state.sites[0]) {
    state.selectedSiteId = state.sites[0].id;
  }
  if (state.selectedSiteId && !state.sites.some((site) => site.id === state.selectedSiteId)) {
    state.selectedSiteId = state.sites[0]?.id || null;
  }
  renderSitesList();
  renderSiteDetails();
}

function applySettingsPayload(settings) {
  state.htdocsPath = settings.htdocsPath || "";
  state.apacheRunning = Boolean(settings.apacheRunning);
  state.browser.downloadDirectory = settings.downloadDirectory || state.browser.downloadDirectory || "";
  state.xamppPaths = settings.xamppPaths || null;

  elements.htdocsPath.value = state.htdocsPath;
  elements.settingsHtdocsPath.value = state.htdocsPath;

  if (state.htdocsPath) {
    elements.basePath.value = state.htdocsPath;
  }

  renderXamppSettings();
}

async function pickAndSaveXamppRoot() {
  const selected = await window.desktopAPI.pickFolder();
  if (!selected) {
    return;
  }

  const result = await window.desktopAPI.setXamppRootPath(selected);
  applySettingsPayload(result);

  if (result.detectedDbProfile) {
    elements.dbHost.value = result.detectedDbProfile.host || "127.0.0.1";
    elements.dbPort.value = result.detectedDbProfile.port || "3306";
    elements.dbUser.value = result.detectedDbProfile.user || "root";
    elements.dbPassword.value = result.detectedDbProfile.password || "";
  }

  await refreshSites();
  setStatus("Updated XAMPP root path.");
}

async function pickAndSaveHtdocsPath() {
  const selected = await window.desktopAPI.pickFolder();
  if (!selected) {
    return;
  }

  const result = await window.desktopAPI.setHtdocsPath(selected);
  applySettingsPayload(result);

  if (result.detectedDbProfile) {
    elements.dbHost.value = result.detectedDbProfile.host || "127.0.0.1";
    elements.dbPort.value = result.detectedDbProfile.port || "3306";
    elements.dbUser.value = result.detectedDbProfile.user || "root";
    elements.dbPassword.value = result.detectedDbProfile.password || "";
  }

  await refreshSites();
  setStatus("Updated XAMPP htdocs path.");
}

async function openExistingPath(targetPath, emptyMessage) {
  if (!targetPath) {
    setStatus(emptyMessage);
    return;
  }

  await window.desktopAPI.openPath(targetPath);
}

async function saveCurrentSiteCredentials() {
  const active = getActiveBrowserTab();
  const key = active ? getCredentialKeyFromUrl(active.url) : null;

  if (!key) {
    setStatus("Open a site before saving credentials.");
    return;
  }

  await window.desktopAPI.saveSiteCredentials({
    key,
    username: elements.vaultUsername.value,
    password: elements.vaultPassword.value
  });

  setStatus(`Saved credentials for ${key}.`);
}

async function clearCurrentSiteCredentials() {
  const active = getActiveBrowserTab();
  const key = active ? getCredentialKeyFromUrl(active.url) : null;

  if (!key) {
    return;
  }

  await window.desktopAPI.clearSiteCredentials(key);
  elements.vaultUsername.value = "";
  elements.vaultPassword.value = "";
  setStatus(`Cleared credentials for ${key}.`);
}

function autofillCurrentPage() {
  void (async () => {
    const active = getActiveBrowserTab();
    if (!active?.url) {
      setStatus("Open a login page before using autofill.");
      return;
    }

    const result = await window.desktopAPI.browserAutofillCredentials({
      username: elements.vaultUsername.value,
      password: elements.vaultPassword.value
    });

    setStatus(result?.message || "Autofill finished.");
  })();
}

async function openSelectedSiteTarget(kind) {
  const site = getSelectedSite();
  if (!site) {
    setStatus("Create or select a site first.");
    return;
  }

  if (kind === "folder" || kind === "shell" || kind === "vscode") {
    await window.desktopAPI.openPath(site.path);
    return;
  }

  if (kind === "admin") {
    openUrlInAppBrowser(site.adminUrl || site.siteUrl);
    return;
  }

  if (kind === "site") {
    openUrlInAppBrowser(site.siteUrl);
  }
}

async function deleteSelectedSite() {
  if (progressState.deleting) {
    return;
  }

  const site = getSelectedSite();
  if (!site) {
    setStatus("Select a site first.");
    return;
  }

  const approved = window.confirm(
    `Delete "${site.name}"?\n\nThis will permanently remove the site folder and drop the database "${site.dbName || site.name}".`
  );

  if (!approved) {
    return;
  }

  setStatus(`Deleting ${site.name}...`);
  setDeleteProgress(true, site.name);
  showSiteTab("tools");

  try {
    await window.desktopAPI.deleteSite({
      site,
      database: {
        host: elements.dbHost.value,
        port: elements.dbPort.value,
        user: elements.dbUser.value,
        password: elements.dbPassword.value
      }
    });
    if (state.selectedSiteId === site.id) {
      state.selectedSiteId = null;
    }
    await refreshSites();
    setStatus(`Deleted ${site.name}.`);
  } catch (error) {
    setStatus(`Delete failed: ${error.message}`);
  } finally {
    setDeleteProgress(false);
  }
}

async function backupSelectedSite() {
  if (progressState.backingUp) {
    return;
  }

  const site = getSelectedSite();
  if (!site) {
    setStatus("Select a site first.");
    return;
  }

  const savePath = await window.desktopAPI.saveBackup(site.name);
  if (!savePath) {
    return;
  }

  setBackupProgress(true);
  showSiteTab("tools");
  setStatus(`Creating backup for ${site.name}...`);

  try {
    const result = await window.desktopAPI.backupSite({
      site,
      savePath,
      database: {
        host: elements.dbHost.value,
        port: elements.dbPort.value,
        user: elements.dbUser.value,
        password: elements.dbPassword.value
      }
    });
    setStatus(`Backup saved to ${result.savePath}.`);
  } catch (error) {
    setStatus(`Backup failed: ${error.message}`);
  } finally {
    setBackupProgress(false);
    renderSiteDetails();
  }
}

elements.newTabButton.addEventListener("click", () => {
  window.desktopAPI.browserCreateTab({ url: "https://www.google.com", mode: "auto" });
});
elements.vaultToggleButton.addEventListener("click", () => {
  state.vaultOpen = !state.vaultOpen;
  renderVaultPanel();
});
elements.addressForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.activeAddressSuggestionIndex >= 0 && state.addressSuggestions.length) {
    applyAddressSuggestion(state.activeAddressSuggestionIndex);
    return;
  }

  state.isEditingAddress = false;
  hideAddressSuggestions();
  window.desktopAPI.browserNavigate(elements.addressInput.value);
});
elements.addressInput.addEventListener("focus", () => {
  state.isEditingAddress = true;
  void requestAddressSuggestions(elements.addressInput.value);
});
elements.addressInput.addEventListener("input", () => {
  state.isEditingAddress = true;
  void requestAddressSuggestions(elements.addressInput.value);
});
elements.addressInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveAddressSuggestion(1);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveAddressSuggestion(-1);
    return;
  }

  if (event.key === "Escape") {
    hideAddressSuggestions();
    return;
  }

  if (event.key === "Tab" && state.activeAddressSuggestionIndex >= 0 && state.addressSuggestions.length) {
    event.preventDefault();
    const suggestion = state.addressSuggestions[state.activeAddressSuggestionIndex];
    if (suggestion) {
      elements.addressInput.value = suggestion.value;
      hideAddressSuggestions();
    }
  }
});
elements.addressInput.addEventListener("blur", () => {
  window.setTimeout(() => {
    state.isEditingAddress = false;
    hideAddressSuggestions();
    refreshControls();
  }, 120);
});
elements.backButton.addEventListener("click", () => window.desktopAPI.browserGoBack());
elements.forwardButton.addEventListener("click", () => window.desktopAPI.browserGoForward());
elements.reloadButton.addEventListener("click", () => window.desktopAPI.browserReload());
elements.bookmarkPageButton.addEventListener("click", () => void openBookmarkSaveDialogForCurrentPage());
elements.vaultSaveButton.addEventListener("click", () => void saveCurrentSiteCredentials());
elements.vaultClearButton.addEventListener("click", () => void clearCurrentSiteCredentials());
elements.vaultFillButton.addEventListener("click", autofillCurrentPage);
elements.pickDownloadDirectoryButton.addEventListener("click", async () => {
  const selected = await window.desktopAPI.browserPickDownloadDirectory();
  if (selected) {
    state.browser.downloadDirectory = selected;
    renderDownloads();
    setStatus(`Download folder updated to ${selected}.`);
  }
});
elements.clearDownloadsButton.addEventListener("click", async () => {
  await window.desktopAPI.browserClearDownloads();
  setStatus("Cleared finished downloads.");
});
elements.createSiteButton.addEventListener("click", () => toggleCreateSiteModal(true));
elements.closeCreateSiteModal.addEventListener("click", () => toggleCreateSiteModal(false));
elements.createSiteModal.addEventListener("click", (event) => {
  if (event.target === elements.createSiteModal) {
    toggleCreateSiteModal(false);
  }
});
elements.pickHtdocsButton.addEventListener("click", () => void pickAndSaveHtdocsPath());
elements.openSidebarPhpMyAdminButton.addEventListener("click", () => {
  openUrlInAppBrowser("http://localhost/phpmyadmin");
});
elements.pickXamppRootButton.addEventListener("click", () => void pickAndSaveXamppRoot());
elements.settingsPickHtdocsButton.addEventListener("click", () => void pickAndSaveHtdocsPath());
elements.openXamppRootButton.addEventListener("click", () =>
  void openExistingPath(state.xamppPaths?.xamppRootPath, "Set the XAMPP root first.")
);
elements.openSettingsHtdocsButton.addEventListener("click", () =>
  void openExistingPath(state.xamppPaths?.htdocsPath || state.htdocsPath, "Set the XAMPP htdocs folder first.")
);
elements.openApacheStartButton.addEventListener("click", () =>
  void openExistingPath(state.xamppPaths?.apacheStartPath, "Apache start script was not found.")
);
elements.openApacheStopButton.addEventListener("click", () =>
  void openExistingPath(state.xamppPaths?.apacheStopPath, "Apache stop script was not found.")
);
elements.openApacheConfigButton.addEventListener("click", () =>
  void openExistingPath(state.xamppPaths?.apacheConfigPath, "Apache config file was not found.")
);
elements.openMysqlConfigButton.addEventListener("click", () =>
  void openExistingPath(state.xamppPaths?.mysqlConfigPath, "MySQL config file was not found.")
);
elements.openControlPanelButton.addEventListener("click", () =>
  void openExistingPath(state.xamppPaths?.controlPanelPath, "XAMPP control panel was not found.")
);
elements.openPhpExeButton.addEventListener("click", () =>
  void openExistingPath(state.xamppPaths?.phpExecutablePath, "PHP executable was not found.")
);
elements.openPhpConfigButton.addEventListener("click", () =>
  void openExistingPath(state.xamppPaths?.phpConfigPath, "PHP config file was not found.")
);
elements.openPhpMyAdminFolderButton.addEventListener("click", () =>
  void openExistingPath(state.xamppPaths?.phpMyAdminPath, "phpMyAdmin folder was not found.")
);
elements.openFolderButton.addEventListener("click", () => void openSelectedSiteTarget("folder"));
elements.openShellButton.addEventListener("click", () => void openSelectedSiteTarget("shell"));
elements.openVSCodeButton.addEventListener("click", () => void openSelectedSiteTarget("vscode"));
elements.backupSiteButton.addEventListener("click", () => void backupSelectedSite());
elements.openSiteButton.addEventListener("click", () => void openSelectedSiteTarget("admin"));
elements.openLiveSiteButton.addEventListener("click", () => void openSelectedSiteTarget("site"));
elements.deleteSiteButton.addEventListener("click", () => void deleteSelectedSite());

document.getElementById("pick-zip-button").addEventListener("click", async () => {
  const selected = await window.desktopAPI.pickZip();
  if (selected) {
    elements.zipPath.value = selected;
  }
});

document.getElementById("pick-folder-button").addEventListener("click", async () => {
  const selected = await window.desktopAPI.pickFolder();
  if (selected) {
    elements.basePath.value = selected;
  }
});

document.getElementById("test-db-button").addEventListener("click", async () => {
  setStatus("Testing MySQL connection...");

  try {
    const result = await window.desktopAPI.testDb({
      host: elements.dbHost.value,
      port: elements.dbPort.value,
      user: elements.dbUser.value,
      password: elements.dbPassword.value
    });
    setStatus(`Connected. MySQL ${result.version}`);
    elements.detailDbVersion.textContent = result.version;
  } catch (error) {
    setStatus(`Connection failed: ${error.message}`);
  }
});

elements.installButton.addEventListener("click", async () => {
  if (progressState.creating) {
    return;
  }

  setStatus("Creating site...");
  elements.resultCard.classList.add("hidden");
  setCreateProgress(true);

  try {
    if (elements.saveDbProfile.checked) {
      setCreateProgress(true, "Saving database profile...");
      await window.desktopAPI.saveInstallerDbProfile({
        host: elements.dbHost.value,
        port: elements.dbPort.value,
        user: elements.dbUser.value,
        password: elements.dbPassword.value
      });
    } else {
      setCreateProgress(true, "Clearing saved database profile...");
      await window.desktopAPI.clearInstallerDbProfile();
    }

    setCreateProgress(true, "Extracting WordPress files and preparing the local database...");
    const result = await window.desktopAPI.installWordPress({
      zipPath: elements.zipPath.value,
      basePath: elements.basePath.value,
      folderName: elements.folderName.value,
      database: {
        create: elements.createDb.checked,
        host: elements.dbHost.value,
        port: elements.dbPort.value,
        user: elements.dbUser.value,
        password: elements.dbPassword.value
      }
    });

    state.lastInstall = result;
    state.selectedSiteId = result.site.id;
    elements.resultLogs.innerHTML = "";
    result.logs.forEach((logLine) => {
      const item = document.createElement("li");
      item.textContent = logLine;
      elements.resultLogs.appendChild(item);
    });
    elements.resultCard.classList.remove("hidden");
    setCreateProgress(true, "Finalizing local site setup...");
    await refreshSites();
    setCreateProgress(false);
    toggleCreateSiteModal(false);
    showSiteTab("tools");
    setStatus("Site created.");
  } catch (error) {
    setCreateProgress(false);
    setStatus(`Install failed: ${error.message}`);
  }
});

elements.openPhpMyAdminButton.addEventListener("click", () => {
  openUrlInAppBrowser("http://localhost/phpmyadmin");
});

window.desktopAPI.onBrowserState((payload) => {
  state.browser = payload;
  renderBrowserTabs();
  refreshControls();
});

window.desktopAPI.onBrowserDownloadComplete((payload) => {
  if (payload?.filename) {
    setStatus(`Download complete: ${payload.filename}`);
  }
});

window.desktopAPI.onBrowserBookmarkEdit(async (bookmark) => {
  await openBookmarkSaveDialogForBookmark(bookmark);
});

window.desktopAPI.onBrowserBookmarkManage(() => {
  state.vaultOpen = true;
  renderVaultPanel();
  setBrowserFeedback("Manage bookmarks in Browser Tools.", "info");
});


window.desktopAPI.onBrowserOpenUrl((payload) => {
  if (payload?.url) {
    openUrlInAppBrowser(payload.url, payload.mode || "auto");
  }
});

window.desktopAPI.onBrowserFocus(() => {
  showScreen("browser");
});

window.desktopAPI.onSitesChanged(() => {
  void refreshSites();
});

async function loadSavedState() {
  const settings = await window.desktopAPI.getSettings();
  applySettingsPayload(settings);

  const dbProfile = await window.desktopAPI.getInstallerDbProfile();
  const detectedDbProfile = settings.detectedDbProfile || null;
  const explicitSavedProfile = dbProfile && !(
    (dbProfile.host || "127.0.0.1") === "127.0.0.1" &&
    String(dbProfile.port || "3306") === "3306" &&
    (dbProfile.user || "root") === "root" &&
    (dbProfile.password || "") === ""
  );
  const effectiveDbProfile = explicitSavedProfile ? dbProfile : detectedDbProfile || dbProfile;

  if (effectiveDbProfile) {
    elements.dbHost.value = effectiveDbProfile.host || "127.0.0.1";
    elements.dbPort.value = effectiveDbProfile.port || "3306";
    elements.dbUser.value = effectiveDbProfile.user || "root";
    elements.dbPassword.value = effectiveDbProfile.password || "";
  }

  const vaultInfo = await window.desktopAPI.getVaultInfo();
  setStatus(
    vaultInfo.encryptionAvailable
      ? `Secure storage ready. Backend: ${vaultInfo.storageBackend}`
      : "Secure storage unavailable. Saved credentials will be stored in plain text."
  );

  await refreshSites();
  renderDownloads();
  renderPermissions();
  syncBrowserLayoutSoon();
}

const browserResizeObserver = new ResizeObserver(() => {
  syncBrowserLayoutSoon();
});
browserResizeObserver.observe(elements.browserHost);
window.addEventListener("resize", () => syncBrowserLayoutSoon());
window.addEventListener("scroll", () => syncBrowserLayoutSoon(), true);

renderVaultPanel();
showSiteTab("overview");
setCreateProgress(false);
setDeleteProgress(false);
uiState.sidebarCollapsed = localStorage.getItem("wpdesktop.sidebarCollapsed") === "1";
renderSidebarState();
void loadSavedState();
