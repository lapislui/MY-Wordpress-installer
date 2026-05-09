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
  currentVaultCredentials: null,
  bookmarkFolderTrail: [],
  sites: [],
  selectedSiteId: null,
  isEditingAddress: false,
  htdocsPath: "",
  apacheRunning: false,
  xamppPaths: null,
  xamppServiceStatus: null
};

const progressState = {
  creating: false,
  deleting: false,
  backingUp: false
};

const uiState = {
  sidebarCollapsed: false,
  browserFocusMode: false,
  showTabSessionInfo: false
};

let browserFeedbackTimer = null;
let addressSuggestionsToken = 0;
let draggedBrowserToolSection = null;
let bookmarkFolderDialogContext = null;
let draggedBookmarkId = null;
let xamppStatusRefreshTimer = null;
let xamppStatusRefreshInFlight = null;
const BROWSER_TOOL_ORDER_KEY = "wp-desktop.browser-tool-order";
const BROWSER_TOOL_COLLAPSE_KEY = "wp-desktop.browser-tool-collapse";
const XAMPP_STATUS_REFRESH_INTERVAL_MS = 5000;
const DEFAULT_BROWSER_TOOL_ORDER = ["sessions", "credentials", "bookmarks", "downloads", "permissions"];
const DEFAULT_BROWSER_TOOL_COLLAPSE = {
  sessions: false,
  credentials: false,
  bookmarks: true,
  downloads: true,
  permissions: true
};
state.effectiveDbProfile = {
  host: "127.0.0.1",
  port: "3306",
  user: "root",
  password: ""
};
state.mysqlConfigContent = "";
state.shareLocalSiteSessions = true;
state.shareOnlineSiteSessions = true;
state.autoSaveLocalTabSessions = false;
state.autoSaveOnlineTabSessions = false;
state.sessionAutoSaveDelaySeconds = 5;
state.browserExtensions = [];

function isInstallerReady() {
  return state.xamppServiceStatus?.installerReady === true;
}

function getInstallerBlockedMessage() {
  const serviceStatus = state.xamppServiceStatus;
  if (!serviceStatus) {
    return "Checking Apache and MySQL status...";
  }

  const missing = [];
  if (!serviceStatus.apacheRunning) {
    missing.push(`start Apache on port ${serviceStatus.apachePorts?.join(", ") || "80"}`);
  }
  if (!serviceStatus.mysqlRunning) {
    missing.push(`start MySQL on ${serviceStatus.mysqlHost || "127.0.0.1"}:${serviceStatus.mysqlPort || 3306}`);
  }

  return missing.length
    ? `${missing.join(" and ")} before using the installer.`
    : "";
}

function renderInstallerServiceStatus() {
  if (!elements.installerServiceSummary || !elements.installerApacheStatus || !elements.installerMysqlStatus) {
    return;
  }

  const serviceStatus = state.xamppServiceStatus;
  if (!serviceStatus) {
    elements.installerServiceSummary.textContent = "Checking Apache and MySQL...";
    elements.installerApacheStatus.textContent = "Checking...";
    elements.installerMysqlStatus.textContent = "Checking...";
    return;
  }

  elements.installerApacheStatus.textContent = serviceStatus.apacheRunning
    ? `Running on ${serviceStatus.apachePorts.join(", ")}`
    : `Stopped on ${serviceStatus.apachePorts.join(", ")}`;
  elements.installerMysqlStatus.textContent = serviceStatus.mysqlRunning
    ? `Running on ${serviceStatus.mysqlHost}:${serviceStatus.mysqlPort}`
    : `Stopped on ${serviceStatus.mysqlHost}:${serviceStatus.mysqlPort}`;
  elements.installerServiceSummary.textContent = isInstallerReady()
    ? "Installer ready"
    : "Start Apache and MySQL to use the installer";
}

function applyXamppServiceStatusSnapshot(payload = {}) {
  state.apacheRunning = Boolean(payload.apacheRunning);
  state.xamppServiceStatus = payload.xamppServiceStatus || state.xamppServiceStatus || null;
  renderSitesList();
  renderSiteDetails();
  renderInstallerServiceStatus();
}

const elements = {
  appShell: document.getElementById("app-shell"),
  appSidebar: document.getElementById("app-sidebar"),
  sidebarToggleButton: document.getElementById("sidebar-toggle-button"),
  navButtons: document.querySelectorAll(".nav-button"),
  screens: document.querySelectorAll(".screen"),
  browserLayout: document.getElementById("browser-layout"),
  tabStrip: document.getElementById("tab-strip"),
  tabStripTooltipLayer: document.getElementById("tab-strip-tooltip-layer"),
  browserHost: document.getElementById("browser-host"),
  browserStage: document.getElementById("browser-stage"),
  browserOverlay: document.getElementById("browser-overlay"),
  addressForm: document.getElementById("address-form"),
  addressInput: document.getElementById("address-input"),
  addressSuggestions: document.getElementById("address-suggestions"),
  backButton: document.getElementById("back-button"),
  forwardButton: document.getElementById("forward-button"),
  reloadButton: document.getElementById("reload-button"),
  tabSessionInfoButton: document.getElementById("tab-session-info-button"),
  newTabButton: document.getElementById("new-tab-button"),
  browserMenuButton: document.getElementById("browser-menu-button"),
  extensionsMenuButton: document.getElementById("extensions-menu-button"),
  extensionsMenuPopup: document.getElementById("extensions-menu-popup"),
  bookmarkPageButton: document.getElementById("bookmark-page-button"),
  browserFullscreenButton: document.getElementById("browser-fullscreen-button"),
  browserFeedback: document.getElementById("browser-feedback"),
  bookmarkBar: document.getElementById("bookmark-bar"),
  bookmarkContextMenu: document.getElementById("bookmark-context-menu"),
  bookmarkModal: document.getElementById("bookmark-modal"),
  closeBookmarkModalButton: document.getElementById("close-bookmark-modal-button"),
  bookmarkNameInput: document.getElementById("bookmark-name-input"),
  bookmarkMoreButton: document.getElementById("bookmark-more-button"),
  bookmarkDoneButton: document.getElementById("bookmark-done-button"),
  bookmarkRemoveButton: document.getElementById("bookmark-remove-button"),
  bookmarkFolderModal: document.getElementById("bookmark-folder-modal"),
  closeBookmarkFolderModalButton: document.getElementById("close-bookmark-folder-modal-button"),
  bookmarkFolderNameInput: document.getElementById("bookmark-folder-name-input"),
  bookmarkFolderParentDisplay: document.getElementById("bookmark-folder-parent-display"),
  bookmarkFolderCancelButton: document.getElementById("bookmark-folder-cancel-button"),
  bookmarkFolderCreateButton: document.getElementById("bookmark-folder-create-button"),
  vaultToggleButton: document.getElementById("vault-toggle-button"),
  vaultPanel: document.getElementById("vault-panel"),
  bookmarksList: document.getElementById("bookmarks-list"),
  vaultSiteLabel: document.getElementById("vault-site-label"),
  vaultCredentialList: document.getElementById("vault-credential-list"),
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
  applyMultisiteButton: document.getElementById("apply-multisite-button"),
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
  enableMultisite: document.getElementById("enable-multisite"),
  installerServiceSummary: document.getElementById("installer-service-summary"),
  installerApacheStatus: document.getElementById("installer-apache-status"),
  installerMysqlStatus: document.getElementById("installer-mysql-status"),
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
  sessionRulesCopy: document.getElementById("session-rules-copy"),
  xamppSettingsNote: document.getElementById("xampp-settings-note"),
  openXamppRootButton: document.getElementById("open-xampp-root-button"),
  openSettingsHtdocsButton: document.getElementById("open-settings-htdocs-button"),
  settingsApacheStart: document.getElementById("settings-apache-start"),
  settingsApacheStop: document.getElementById("settings-apache-stop"),
  settingsApacheConfig: document.getElementById("settings-apache-config"),
  settingsMysqlConfig: document.getElementById("settings-mysql-config"),
  settingsControlPanel: document.getElementById("settings-control-panel"),
  settingsDbUser: document.getElementById("settings-db-user"),
  settingsDbPassword: document.getElementById("settings-db-password"),
  settingsWpInstallUsername: document.getElementById("settings-wp-install-username"),
  settingsWpInstallPassword: document.getElementById("settings-wp-install-password"),
  settingsWpInstallEmail: document.getElementById("settings-wp-install-email"),
  saveWpInstallDefaultsButton: document.getElementById("save-wp-install-defaults-button"),
  settingsShareLocalSessions: document.getElementById("settings-share-local-sessions"),
  settingsShareOnlineSessions: document.getElementById("settings-share-online-sessions"),
  sessionSaveActiveCopy: document.getElementById("session-save-active-copy"),
  sessionAutosaveButton: document.getElementById("session-autosave-button"),
  sessionSaveButton: document.getElementById("session-save-button"),
  sessionUnsaveButton: document.getElementById("session-unsave-button"),
  settingsAutosaveLocalSessions: document.getElementById("settings-autosave-local-sessions"),
  settingsAutosaveOnlineSessions: document.getElementById("settings-autosave-online-sessions"),
  settingsSessionAutosaveDelay: document.getElementById("settings-session-autosave-delay"),
  settingsMysqlEditor: document.getElementById("settings-mysql-editor"),
  saveMysqlConfigButton: document.getElementById("save-mysql-config-button"),
  installExtensionFolderButton: document.getElementById("install-extension-folder-button"),
  installExtensionArchiveButton: document.getElementById("install-extension-archive-button"),
  openChromeWebStoreButton: document.getElementById("open-chrome-web-store-button"),
  openEdgeAddonsButton: document.getElementById("open-edge-addons-button"),
  openFirefoxAddonsButton: document.getElementById("open-firefox-addons-button"),
  extensionsList: document.getElementById("extensions-list"),
  settingsDarkAccent: document.getElementById("settings-dark-accent"),
  settingsDarkAccentHex: document.getElementById("settings-dark-accent-hex"),
  settingsLightAccent: document.getElementById("settings-light-accent"),
  settingsLightAccentHex: document.getElementById("settings-light-accent-hex"),
  saveThemeAccentsButton: document.getElementById("save-theme-accents-button"),
  resetThemeAccentsButton: document.getElementById("reset-theme-accents-button"),
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

  const existing = flattenBookmarkNodes(state.browser.bookmarks).find((bookmark) => bookmark.url === active.url) || null;

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
  elements.appShell.classList.toggle("browser-focus-mode", uiState.browserFocusMode);
  elements.sidebarToggleButton.setAttribute("aria-label", uiState.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
  elements.sidebarToggleButton.querySelector(".sidebar-toggle-glyph").textContent = uiState.sidebarCollapsed ? ">>" : "<<";
  elements.browserFullscreenButton.setAttribute("aria-label", uiState.browserFocusMode ? "Exit Full Screen" : "Full Screen");
  elements.browserFullscreenButton.title = uiState.browserFocusMode ? "Exit Full Screen" : "Full Screen";
  elements.browserFullscreenButton.querySelector(".toolbar-icon-glyph").textContent = uiState.browserFocusMode ? "×" : "⛶";
  syncBrowserLayoutSoon();
}

function toggleSidebar() {
  uiState.sidebarCollapsed = !uiState.sidebarCollapsed;
  localStorage.setItem("wpdesktop.sidebarCollapsed", uiState.sidebarCollapsed ? "1" : "0");
  renderSidebarState();
}

function toggleBrowserFocusMode(forceValue) {
  uiState.browserFocusMode = typeof forceValue === "boolean" ? forceValue : !uiState.browserFocusMode;
  if (uiState.browserFocusMode && state.vaultOpen) {
    state.vaultOpen = false;
    renderVaultPanel();
  }
  renderSidebarState();
}

function showScreen(screenName) {
  if (screenName !== "browser" && uiState.browserFocusMode) {
    uiState.browserFocusMode = false;
  }

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

initBrowserToolSections();

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

function maskPassword(value) {
  const password = String(value || "");
  if (!password) {
    return "empty";
  }

  return "\u2022".repeat(Math.min(Math.max(password.length, 4), 12));
}

function renderVaultCredentialOptions(saved) {
  const select = elements.vaultCredentialList;
  const entries = Array.isArray(saved?.entries) ? saved.entries : [];
  const selectedId = saved?.selectedId || "";

  select.innerHTML = "";

  const newOption = document.createElement("option");
  newOption.value = "";
  newOption.textContent = "New credential";
  select.appendChild(newOption);

  entries.forEach((entry, index) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = `${entry.username || `Credential ${index + 1}`} (${maskPassword(entry.password)})`;
    select.appendChild(option);
  });

  select.value = entries.some((entry) => entry.id === selectedId) ? selectedId : "";
}

function loadVaultCredentialFromSelection(saved) {
  const selectedId = elements.vaultCredentialList.value;
  const entries = Array.isArray(saved?.entries) ? saved.entries : [];
  const selected = entries.find((entry) => entry.id === selectedId);

  if (!selected) {
    elements.vaultUsername.value = "";
    elements.vaultPassword.value = "";
    return;
  }

  elements.vaultUsername.value = selected.username || "";
  elements.vaultPassword.value = selected.password || "";
}

async function syncVaultPanel() {
  const active = getActiveBrowserTab();
  const key = active ? getCredentialKeyFromUrl(active.url) : null;

  if (!key) {
    elements.vaultSiteLabel.textContent = "Open a page to manage saved credentials.";
    state.currentVaultCredentials = null;
    renderVaultCredentialOptions(null);
    elements.vaultUsername.value = "";
    elements.vaultPassword.value = "";
    return;
  }

  elements.vaultSiteLabel.textContent = key;
  const saved = await window.desktopAPI.getSiteCredentials(key);
  state.currentVaultCredentials = saved;
  renderVaultCredentialOptions(saved);
  if (elements.vaultCredentialList.value) {
    loadVaultCredentialFromSelection(saved);
    return;
  }
  elements.vaultUsername.value = saved?.username || "";
  elements.vaultPassword.value = saved?.password || "";
}

function refreshControls() {
  const active = getActiveBrowserTab();
  if (!state.isEditingAddress && !state.addressSuggestions.length) {
    elements.addressInput.value = active?.url || "";
  }
  const isBookmarked = Boolean(active?.url && state.browser.bookmarks.some((bookmark) => bookmark.url === active.url));
  elements.backButton.disabled = !state.browser.canGoBack;
  elements.forwardButton.disabled = !state.browser.canGoForward;
  elements.bookmarkPageButton.disabled = !active?.url;
  elements.bookmarkPageButton.innerHTML = `<span class="toolbar-icon-glyph">${isBookmarked ? "&#x2605;" : "&#x2606;"}</span>`;
  elements.bookmarkPageButton.title = isBookmarked ? "Bookmarked" : "Bookmark";
  elements.bookmarkPageButton.setAttribute("aria-label", isBookmarked ? "Bookmarked" : "Bookmark");
  renderBookmarks();
  renderDownloads();
  renderPermissions();
  renderSavedSessionControls();
  void syncVaultPanel();
}

function renderVaultPanel() {
  elements.vaultPanel.classList.toggle("hidden", !state.vaultOpen);
  elements.vaultToggleButton.classList.toggle("active", state.vaultOpen);
  elements.browserLayout.classList.toggle("with-vault", state.vaultOpen);
  syncBrowserLayoutSoon();
}

async function openBrowserMenu() {
  const rect = elements.browserMenuButton.getBoundingClientRect();
  await window.desktopAPI.browserShowAppMenu({
    x: rect.left,
    y: rect.bottom + 4
  });
}

async function handleBrowserMenuCommand(payload) {
  const action = payload?.action;
  if (!action) {
    return;
  }

  if (action === "favorites" || action === "downloads" || action === "passwords") {
    showScreen("browser");
    state.vaultOpen = true;
    renderVaultPanel();
    setBrowserFeedback(
      action === "downloads"
        ? "Open Browser Tools to review downloads."
        : action === "passwords"
          ? "Open Browser Tools to manage saved passwords."
          : "Open Browser Tools to manage favorites.",
      "info"
    );
    return;
  }

  if (action === "extensions") {
    showScreen("settings");
    setStatus("Open Settings to manage browser extensions.");
    return;
  }

  if (action === "extensions-install-folder") {
    showScreen("settings");
    elements.installExtensionFolderButton?.click();
    return;
  }

  if (action === "extensions-install-zip") {
    showScreen("settings");
    elements.installExtensionArchiveButton?.click();
    return;
  }

  if (action === "settings") {
    showScreen("settings");
    return;
  }

  if (action === "find") {
    const query = window.prompt("Find on page", "");
    if (!query?.trim()) {
      return;
    }

    const found = await window.desktopAPI.browserFindInPage(query.trim());
    if (!found) {
      setBrowserFeedback("Could not search the current page.", "error");
    }
    return;
  }

}

function formatPathValue(value) {
  return value || "Not found";
}

function getEffectiveDbProfile() {
  return state.effectiveDbProfile || {
    host: "127.0.0.1",
    port: "3306",
    user: "root",
    password: ""
  };
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
  elements.settingsDbUser.value = getEffectiveDbProfile().user || "root";
  elements.settingsDbPassword.value = getEffectiveDbProfile().password || "";
  elements.settingsWpInstallUsername.value = state.wpInstallUsername || "admin";
  elements.settingsWpInstallPassword.value = state.wpInstallPassword ?? "root";
  elements.settingsWpInstallEmail.value = state.wpInstallEmail || "";
  elements.settingsMysqlEditor.value = state.mysqlConfigContent || "";
  elements.settingsMysqlEditor.readOnly = !paths.mysqlConfigPath;
  elements.saveMysqlConfigButton.disabled = !paths.mysqlConfigPath;
  bindSettingsPath(elements.settingsPhpExe, elements.openPhpExeButton, paths.phpExecutablePath);
  bindSettingsPath(elements.settingsPhpConfig, elements.openPhpConfigButton, paths.phpConfigPath);
  bindSettingsPath(elements.settingsPhpMyAdmin, elements.openPhpMyAdminFolderButton, paths.phpMyAdminPath);
}

function renderSessionRules() {
  if (elements.settingsShareLocalSessions) {
    elements.settingsShareLocalSessions.checked = state.shareLocalSiteSessions !== false;
    elements.settingsShareLocalSessions.disabled = false;
  }
  if (elements.settingsShareOnlineSessions) {
    elements.settingsShareOnlineSessions.checked = state.shareOnlineSiteSessions === true;
    elements.settingsShareOnlineSessions.disabled = false;
  }

  if (!elements.sessionRulesCopy) {
    return;
  }

  const localShared = !elements.settingsShareLocalSessions || elements.settingsShareLocalSessions.checked;
  const onlineShared = Boolean(elements.settingsShareOnlineSessions?.checked);
  const localRule = localShared
    ? "Local tabs reuse persist:local-shared."
    : "Each new local tab gets its own persistent profile.";
  const onlineRule = onlineShared
    ? "Online tabs reuse persist:online-shared."
    : "Each new online tab gets its own persistent profile.";

  const ruleText = `${localRule} ${onlineRule} Saved sessions match by tab name and group name.`;
  elements.sessionRulesCopy.textContent = ruleText;
}

function renderSavedSessionControls() {
  if (elements.settingsAutosaveLocalSessions) {
    elements.settingsAutosaveLocalSessions.checked = state.autoSaveLocalTabSessions === true;
  }
  if (elements.settingsAutosaveOnlineSessions) {
    elements.settingsAutosaveOnlineSessions.checked = state.autoSaveOnlineTabSessions === true;
  }
  if (elements.settingsSessionAutosaveDelay) {
    elements.settingsSessionAutosaveDelay.value = String(Math.max(1, Number(state.sessionAutoSaveDelaySeconds) || 5));
  }

  const active = getActiveBrowserTab();
  if (!elements.sessionSaveActiveCopy || !elements.sessionAutosaveButton || !elements.sessionSaveButton || !elements.sessionUnsaveButton) {
    return;
  }

  if (!active) {
    elements.sessionSaveActiveCopy.textContent = "Open a tab to save or autosave its session.";
    elements.sessionAutosaveButton.disabled = true;
    elements.sessionSaveButton.disabled = true;
    elements.sessionUnsaveButton.disabled = true;
    return;
  }

  const groupName = active.groupName ? ` in ${active.groupName}` : "";
  const saveState = active.savedSession
    ? active.autoSavedSession ? "Autosaved" : "Saved"
    : "Not saved";
  elements.sessionSaveActiveCopy.textContent = `${saveState}: ${active.sessionName || active.title || active.url}${groupName}.`;
  elements.sessionAutosaveButton.disabled = false;
  elements.sessionSaveButton.disabled = false;
  elements.sessionUnsaveButton.disabled = !active.savedSession;
}

function renderExtensionsSettings() {
  if (!elements.extensionsList) {
    return;
  }

  elements.extensionsList.innerHTML = "";
  if (!state.browserExtensions.length) {
    const empty = document.createElement("div");
    empty.className = "settings-note";
    empty.textContent = "No browser extensions installed yet.";
    elements.extensionsList.appendChild(empty);
    return;
  }

  state.browserExtensions.forEach((extension) => {
    const item = document.createElement("div");
    item.className = "settings-item";
    item.innerHTML = `
      <div class="settings-item-copy">
        <strong>${escapeHtml(extension.name || "Extension")}</strong>
        <span>${escapeHtml(extension.version || "Version unknown")} · ${escapeHtml(extension.sourceType === "zip" ? "zip import" : "folder import")} · ${extension.enabled ? "enabled" : "disabled"}</span>
        <span>${escapeHtml(extension.unpackedPath || "")}</span>
      </div>
      <div class="button-row compact">
        <button type="button" data-toggle-extension="${extension.id}">${extension.enabled ? "Disable" : "Enable"}</button>
        <button type="button" data-open-extension="${extension.id}">Open</button>
        <button type="button" data-remove-extension="${extension.id}">Remove</button>
      </div>
    `;

    item.querySelector("[data-toggle-extension]")?.addEventListener("click", async () => {
      try {
        const result = await window.desktopAPI.setBrowserExtensionEnabled({
          id: extension.id,
          enabled: !extension.enabled
        });
        applySettingsPayload(result.settings);
        setStatus(`${extension.name} ${extension.enabled ? "disabled" : "enabled"}.`);
      } catch (error) {
        setStatus(`Extension update failed: ${error.message}`);
      }
    });

    item.querySelector("[data-open-extension]")?.addEventListener("click", () =>
      void openExistingPath(extension.unpackedPath, "Extension folder was not found.")
    );

    item.querySelector("[data-remove-extension]")?.addEventListener("click", async () => {
      try {
        const result = await window.desktopAPI.removeBrowserExtension(extension.id);
        applySettingsPayload(result.settings);
        setStatus(`Removed ${extension.name}.`);
      } catch (error) {
        setStatus(`Extension removal failed: ${error.message}`);
      }
    });

    elements.extensionsList.appendChild(item);
  });
}

function normalizeThemeHex(value, fallback) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toLowerCase();
  }
  const shortMatch = raw.match(/^#([0-9a-fA-F]{3})$/);
  if (shortMatch) {
    const part = shortMatch[1].toLowerCase();
    return `#${part[0]}${part[0]}${part[1]}${part[1]}${part[2]}${part[2]}`;
  }
  return fallback;
}

function getThemeAccentApi() {
  return window.wpDesktopThemeAccentApi || null;
}

function renderThemeAccentInputs() {
  const api = getThemeAccentApi();
  if (!api || !elements.settingsDarkAccent) {
    return;
  }

  const accents = api.getAccents();
  elements.settingsDarkAccent.value = accents.dark;
  elements.settingsDarkAccentHex.value = accents.dark;
  elements.settingsLightAccent.value = accents.light;
  elements.settingsLightAccentHex.value = accents.light;
}

function saveThemeAccentSettings() {
  const api = getThemeAccentApi();
  if (!api) {
    setStatus("Theme accent editor is unavailable.");
    return;
  }

  const defaults = api.defaults || { dark: "#e8003d", light: "#6c3ee8" };
  const next = api.setAccents({
    dark: normalizeThemeHex(elements.settingsDarkAccentHex.value || elements.settingsDarkAccent.value, defaults.dark),
    light: normalizeThemeHex(elements.settingsLightAccentHex.value || elements.settingsLightAccent.value, defaults.light)
  });
  renderThemeAccentInputs();
  setStatus(`Saved theme accent colors. Dark: ${next.dark}, Light: ${next.light}.`);
}

function resetThemeAccentSettings() {
  const api = getThemeAccentApi();
  if (!api) {
    setStatus("Theme accent editor is unavailable.");
    return;
  }

  api.resetAccents();
  renderThemeAccentInputs();
  setStatus("Reset theme accent colors to defaults.");
}

function hideExtensionsMenuPopup() {
  elements.extensionsMenuPopup?.classList.add("hidden");
}

function toggleExtensionsMenuPopup() {
  if (!elements.extensionsMenuPopup) {
    return;
  }
  renderExtensionsMenuPopup();
  elements.extensionsMenuPopup.classList.toggle("hidden");
}

function renderExtensionsMenuPopup() {
  if (!elements.extensionsMenuPopup) {
    return;
  }

  elements.extensionsMenuPopup.innerHTML = "";
  const installed = state.browserExtensions.filter((extension) => extension.enabled);

  if (!installed.length) {
    const empty = document.createElement("div");
    empty.className = "extensions-menu-empty";
    empty.textContent = "No enabled extensions.";
    elements.extensionsMenuPopup.appendChild(empty);
    return;
  }

  installed.forEach((extension) => {
    const item = document.createElement("div");
    item.className = "extensions-menu-item";
    item.innerHTML = `
      ${extension.iconPath ? `<img src="${escapeHtml(extension.iconPath)}" alt="${escapeHtml(extension.name || "Extension")}" />` : `<span class="toolbar-icon-glyph">E</span>`}
      <div class="extensions-menu-item-copy">
        <strong>${escapeHtml(extension.name || "Extension")}</strong>
        <span>${escapeHtml(extension.version || "Version unknown")}${extension.popupPath ? "" : " · no popup"}</span>
      </div>
      <button type="button" data-open-extension-popup="${extension.id}" ${extension.popupPath ? "" : "disabled"}>Open</button>
    `;
    item.querySelector("[data-open-extension-popup]")?.addEventListener("click", async () => {
      try {
        await window.desktopAPI.openBrowserExtensionPopup(extension.id);
        hideExtensionsMenuPopup();
      } catch (error) {
        setBrowserFeedback(`Extension popup failed: ${error.message}`, "error");
      }
    });
    elements.extensionsMenuPopup.appendChild(item);
  });
}

function getTabSessionLabel(tab) {
  const profileName = String(tab?.sessionProfileName || tab?.partition || "").trim();
  return profileName ? `Profile: ${profileName}` : "Profile: temporary-session";
}

function getDisplaySessionName(rawName) {
  const value = String(rawName || "").trim();
  if (!value) {
    return "temporary-session";
  }
  return value.replace(/^persist(?::)?/i, "");
}

function getTabGroupLabel(tab) {
  const groupName = String(tab?.groupName || "").trim();
  return groupName ? `Group: ${groupName}` : "Group: none";
}

function getTabSessionInfoCopy(tab) {
  if (!tab) {
    return "No active tab is available.";
  }

  const profileName = getDisplaySessionName(tab.sessionProfileName || tab.partition || "temporary-session");
  return `Session: ${profileName}`;
}

function getBrowserToolSections() {
  return Array.from(document.querySelectorAll(".browser-tool-section[data-tool-section]"));
}

function readBrowserToolPrefs(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeBrowserToolPrefs(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    // Ignore renderer preference persistence failures.
  }
}

function saveBrowserToolOrder() {
  const order = getBrowserToolSections().map((section) => section.dataset.toolSection);
  writeBrowserToolPrefs(BROWSER_TOOL_ORDER_KEY, order);
}

function saveBrowserToolCollapseState() {
  const collapsed = Object.fromEntries(
    getBrowserToolSections().map((section) => [section.dataset.toolSection, section.classList.contains("collapsed")])
  );
  writeBrowserToolPrefs(BROWSER_TOOL_COLLAPSE_KEY, collapsed);
}

function applyBrowserToolSectionPrefs() {
  const panel = elements.vaultPanel;
  if (!panel) {
    return;
  }

  const order = readBrowserToolPrefs(BROWSER_TOOL_ORDER_KEY, DEFAULT_BROWSER_TOOL_ORDER);
  const collapsed = readBrowserToolPrefs(BROWSER_TOOL_COLLAPSE_KEY, DEFAULT_BROWSER_TOOL_COLLAPSE);
  const sectionMap = new Map(getBrowserToolSections().map((section) => [section.dataset.toolSection, section]));

  order.forEach((id) => {
    const section = sectionMap.get(id);
    if (section) {
      panel.appendChild(section);
    }
  });

  getBrowserToolSections().forEach((section) => {
    section.classList.toggle("collapsed", Boolean(collapsed[section.dataset.toolSection]));
  });
}

function toggleBrowserToolSection(section) {
  section.classList.toggle("collapsed");
  saveBrowserToolCollapseState();
}

function findBrowserToolDropTarget(pointerY, currentSection) {
  const sections = getBrowserToolSections().filter((section) => section !== currentSection);

  for (const section of sections) {
    const rect = section.getBoundingClientRect();
    if (pointerY < rect.top + rect.height / 2) {
      return { section, position: "before" };
    }
  }

  return { section: sections.at(-1) || null, position: "after" };
}

function initBrowserToolSections() {
  getBrowserToolSections().forEach((section) => {
    const toggleButton = section.querySelector("[data-tool-toggle]");
    toggleButton?.addEventListener("click", (event) => {
      if (event.target.closest(".browser-tool-drag")) {
        return;
      }

      toggleBrowserToolSection(section);
    });

    section.addEventListener("dragstart", (event) => {
      draggedBrowserToolSection = section;
      section.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", section.dataset.toolSection || "");
      }
    });

    section.addEventListener("dragend", () => {
      draggedBrowserToolSection?.classList.remove("dragging");
      draggedBrowserToolSection = null;
      saveBrowserToolOrder();
    });

    section.addEventListener("dragover", (event) => {
      if (!draggedBrowserToolSection || draggedBrowserToolSection === section) {
        return;
      }

      event.preventDefault();
      const target = findBrowserToolDropTarget(event.clientY, draggedBrowserToolSection);
      if (!target.section) {
        return;
      }

      if (target.position === "before") {
        target.section.before(draggedBrowserToolSection);
      } else {
        target.section.after(draggedBrowserToolSection);
      }
    });

    section.addEventListener("drop", (event) => {
      if (!draggedBrowserToolSection) {
        return;
      }

      event.preventDefault();
      saveBrowserToolOrder();
    });
  });

  applyBrowserToolSectionPrefs();
}

function setCreateProgress(active, message = "Preparing files, database, and local site records...") {
  progressState.creating = active;
  elements.createProgressCard.classList.toggle("hidden", !active);
  elements.createProgressTitle.textContent = "Creating site";
  elements.createProgressText.textContent = message;
  elements.installButton.disabled = active || !isInstallerReady();
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

  const newRootFolderChip = document.createElement("button");
  newRootFolderChip.type = "button";
  newRootFolderChip.className = "bookmark-chip bookmark-folder-chip";
  newRootFolderChip.textContent = "+ Folder";
  newRootFolderChip.addEventListener("click", () => {
    openBookmarkFolderDialog({ parentId: null, parentTitle: "Favorites bar" });
  });
  elements.bookmarkBar.appendChild(newRootFolderChip);

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

  const setDropZoneActive = (zone, active) => {
    zone.classList.toggle("active", active);
  };

  const createMoveDropZone = ({ parentId = null, index = 0, depth = 0 }) => {
    const zone = document.createElement("div");
    zone.className = "bookmark-drop-zone";
    zone.style.marginLeft = `${depth * 16}px`;
    zone.addEventListener("dragover", (event) => {
      if (!draggedBookmarkId) {
        return;
      }
      event.preventDefault();
      setDropZoneActive(zone, true);
    });
    zone.addEventListener("dragleave", () => setDropZoneActive(zone, false));
    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      setDropZoneActive(zone, false);
      if (!draggedBookmarkId) {
        return;
      }
      try {
        await window.desktopAPI.browserMoveBookmark({ id: draggedBookmarkId, parentId, index });
      } catch (error) {
        setBrowserFeedback(`Move failed: ${error.message}`, "error");
      }
    });
    return zone;
  };

  const createRootDropZone = () => {
    const zone = document.createElement("div");
    zone.className = "bookmark-drop-zone root";
    zone.textContent = "Drop here to move to Favorites bar";
    zone.addEventListener("dragover", (event) => {
      if (!draggedBookmarkId) {
        return;
      }
      event.preventDefault();
      setDropZoneActive(zone, true);
    });
    zone.addEventListener("dragleave", () => setDropZoneActive(zone, false));
    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      setDropZoneActive(zone, false);
      if (!draggedBookmarkId) {
        return;
      }
      try {
        await window.desktopAPI.browserMoveBookmark({
          id: draggedBookmarkId,
          parentId: null,
          index: state.browser.bookmarks.length
        });
      } catch (error) {
        setBrowserFeedback(`Move failed: ${error.message}`, "error");
      }
    });
    return zone;
  };

  const attachDragHandlers = (element, node) => {
    element.draggable = true;
    element.addEventListener("dragstart", (event) => {
      draggedBookmarkId = node.id;
      element.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", node.id);
    });
    element.addEventListener("dragend", () => {
      draggedBookmarkId = null;
      element.classList.remove("dragging");
      document.querySelectorAll(".bookmark-drop-zone.active").forEach((zone) => zone.classList.remove("active"));
      document.querySelectorAll(".browser-tool-item.bookmark-node.folder-target-active").forEach((item) => item.classList.remove("folder-target-active"));
    });
  };

  const renderBookmarkBarNode = (node) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `bookmark-chip${node.type === "folder" ? " bookmark-folder-chip" : ""}`;
    chip.textContent = node.type === "folder"
      ? ` ${node.title}⬇️`
      : node.iconOnly
        ? (node.title || node.url).trim().charAt(0).toUpperCase() || "*"
        : (node.title || node.url);
    chip.title = node.type === "folder" ? node.title : node.url;

    if (node.type === "folder") {
      chip.dataset.bookmarkId = node.id;
      chip.addEventListener("click", (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        openBookmarkFolderMenu(rect, [node.id]);
      });
      chip.addEventListener("contextmenu", async (event) => {
        event.preventDefault();
        try {
          await window.desktopAPI.browserShowBookmarkContextMenu({
            bookmark: node,
            showBookmarksBar: state.browser.showBookmarksBar
          });
        } catch (error) {
          setBrowserFeedback(`Folder menu failed: ${error.message}`, "error");
        }
      });
      chip.addEventListener("dragover", (event) => {
        if (!draggedBookmarkId) {
          return;
        }
        event.preventDefault();
      });
      chip.addEventListener("drop", async (event) => {
        event.preventDefault();
        if (!draggedBookmarkId) {
          return;
        }
        try {
          await window.desktopAPI.browserMoveBookmark({ id: draggedBookmarkId, parentId: node.id });
        } catch (error) {
          setBrowserFeedback(`Move failed: ${error.message}`, "error");
        }
      });
      elements.bookmarkBar.appendChild(chip);
      return;
    }

    chip.addEventListener("click", () => {
      openUrlInAppBrowser(node.url);
    });
    chip.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      try {
        await window.desktopAPI.browserShowBookmarkContextMenu({
          bookmark: node,
          showBookmarksBar: state.browser.showBookmarksBar
        });
      } catch (error) {
        setBrowserFeedback(`Bookmark menu failed: ${error.message}`, "error");
      }
    });
    elements.bookmarkBar.appendChild(chip);
  };

  const renderBookmarkTreeNode = (node, parentId = null, depth = 0, index = 0) => {
    elements.bookmarksList.appendChild(createMoveDropZone({ parentId, index, depth }));

    const item = document.createElement("div");
    item.className = "browser-tool-item bookmark-node";
    item.style.marginLeft = `${depth * 16}px`;
    attachDragHandlers(item, node);

    if (node.type === "folder") {
      item.innerHTML = `
        <div class="bookmark-row-main">
          <div class="browser-tool-item-copy">
            <strong>[Folder]${node.title}</strong>
            <span>${(node.children || []).length} item${(node.children || []).length === 1 ? "" : "s"}</span>
          </div>
          <div class="bookmark-row-actions">
            <button type="button" class="bookmark-drag-handle" title="Drag to move">Move</button>
            <button type="button" data-add-folder="${node.id}">New folder</button>
            <button type="button" data-remove-bookmark="${node.id}">Remove</button>
          </div>
        </div>
      `;

      item.addEventListener("dragover", (event) => {
        if (!draggedBookmarkId) {
          return;
        }
        event.preventDefault();
        item.classList.add("folder-target-active");
      });
      item.addEventListener("dragleave", () => item.classList.remove("folder-target-active"));
      item.addEventListener("drop", async (event) => {
        event.preventDefault();
        item.classList.remove("folder-target-active");
        if (!draggedBookmarkId) {
          return;
        }
        try {
          await window.desktopAPI.browserMoveBookmark({ id: draggedBookmarkId, parentId: node.id });
        } catch (error) {
          setBrowserFeedback(`Move failed: ${error.message}`, "error");
        }
      });

      item.querySelector("[data-add-folder]")?.addEventListener("click", () => {
        openBookmarkFolderDialog({ parentId: node.id, parentTitle: node.title });
      });
      item.addEventListener("contextmenu", async (event) => {
        event.preventDefault();
        try {
          await window.desktopAPI.browserShowBookmarkContextMenu({
            bookmark: node,
            showBookmarksBar: state.browser.showBookmarksBar
          });
        } catch (error) {
          setBrowserFeedback(`Folder menu failed: ${error.message}`, "error");
        }
      });

      item.querySelector("[data-remove-bookmark]")?.addEventListener("click", async () => {
        await window.desktopAPI.browserRemoveBookmark(node.id);
      });

      elements.bookmarksList.appendChild(item);
      (node.children || []).forEach((child, childIndex) => renderBookmarkTreeNode(child, node.id, depth + 1, childIndex));
      elements.bookmarksList.appendChild(createMoveDropZone({
        parentId: node.id,
        index: (node.children || []).length,
        depth: depth + 1
      }));
      return;
    }

    item.innerHTML = `
      <div class="bookmark-row-main">
        <div class="browser-tool-item-copy">
          <strong>${node.title || node.url}</strong>
          <span>${node.url}</span>
        </div>
        <div class="bookmark-row-actions">
          <button type="button" class="bookmark-drag-handle" title="Drag to move">Move</button>
          <button type="button" data-open-bookmark="${node.id}">Open</button>
          <button type="button" data-remove-bookmark="${node.id}">Remove</button>
        </div>
      </div>
    `;

    item.querySelector("[data-open-bookmark]")?.addEventListener("click", () => {
      openUrlInAppBrowser(node.url);
    });

    item.querySelector("[data-remove-bookmark]")?.addEventListener("click", async () => {
      await window.desktopAPI.browserRemoveBookmark(node.id);
      setBrowserFeedback(`Removed bookmark for ${node.title || node.url}.`, "info");
    });

    elements.bookmarksList.appendChild(item);
  };

  elements.bookmarksList.appendChild(createRootDropZone());
  state.browser.bookmarks.forEach((node) => {
    renderBookmarkBarNode(node);
  });
  state.browser.bookmarks.forEach((node, index) => {
    renderBookmarkTreeNode(node, null, 0, index);
  });
  elements.bookmarksList.appendChild(createMoveDropZone({
    parentId: null,
    index: state.browser.bookmarks.length,
    depth: 0
  }));
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

function flattenBookmarkNodes(nodes, output = []) {
  (nodes || []).forEach((node) => {
    if (!node) {
      return;
    }

    if (node.type === "folder") {
      flattenBookmarkNodes(node.children || [], output);
      return;
    }

    output.push(node);
  });

  return output;
}

function findBookmarkNode(nodes, nodeId) {
  for (const node of nodes || []) {
    if (!node) {
      continue;
    }

    if (node.id === nodeId) {
      return node;
    }

    if (node.type === "folder") {
      const nested = findBookmarkNode(node.children || [], nodeId);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function closeBookmarkFolderDialog() {
  bookmarkFolderDialogContext = null;
  elements.bookmarkFolderNameInput.value = "";
  elements.bookmarkFolderParentDisplay.textContent = "Favorites bar";
  elements.bookmarkFolderModal.classList.add("hidden");
  window.desktopAPI.browserUpdateLayout({
    visible: true,
    x: elements.browserStage.getBoundingClientRect().left,
    y: elements.browserStage.getBoundingClientRect().top,
    width: elements.browserStage.getBoundingClientRect().width,
    height: elements.browserStage.getBoundingClientRect().height
  });
}

function openBookmarkFolderDialog({ parentId = null, parentTitle = "Favorites bar", onCreated = null, moveBookmarkId = null, editFolderId = null, initialTitle = "" } = {}) {
  bookmarkFolderDialogContext = { parentId, parentTitle, onCreated, moveBookmarkId, editFolderId, initialTitle };
  elements.bookmarkFolderParentDisplay.textContent = parentTitle || "Favorites bar";
  elements.bookmarkFolderNameInput.value = initialTitle || "";
  elements.bookmarkFolderModal.classList.remove("hidden");
  window.desktopAPI.browserUpdateLayout({ visible: false });
  window.setTimeout(() => {
    elements.bookmarkFolderNameInput.focus();
    elements.bookmarkFolderNameInput.select();
  }, 0);
}

async function submitBookmarkFolderDialog() {
  const title = elements.bookmarkFolderNameInput.value.trim();
  if (!title) {
    elements.bookmarkFolderNameInput.focus();
    return;
  }

  const context = bookmarkFolderDialogContext || { parentId: null, onCreated: null };
  try {
    const folder = context.editFolderId
      ? await window.desktopAPI.browserUpdateBookmark({
          id: context.editFolderId,
          title
        })
      : await window.desktopAPI.browserAddBookmarkFolder({
          title,
          parentId: context.parentId || null
        });
    if (context.moveBookmarkId && folder?.id) {
      await window.desktopAPI.browserMoveBookmark({
        id: context.moveBookmarkId,
        parentId: folder.id
      });
    }
    closeBookmarkFolderDialog();
    if (typeof context.onCreated === "function") {
      context.onCreated();
    }
  } catch (error) {
    setBrowserFeedback(`Folder creation failed: ${error.message}`, "error");
  }
}

function hideBookmarkFolderMenu() {
  state.bookmarkFolderTrail = [];
  elements.bookmarkContextMenu.classList.add("hidden");
  elements.bookmarkContextMenu.innerHTML = "";
}

function isBookmarkFolderMenuOpen() {
  return !elements.bookmarkContextMenu.classList.contains("hidden");
}

function openBookmarkFolderMenu(anchorRect, trail = []) {
  const folderId = trail.at(-1);
  const folder = folderId ? findBookmarkNode(state.browser.bookmarks, folderId) : null;
  if (!folder || folder.type !== "folder") {
    hideBookmarkFolderMenu();
    return;
  }

  state.bookmarkFolderTrail = trail;
  const menu = elements.bookmarkContextMenu;
  menu.innerHTML = "";

  if (trail.length > 1) {
    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.textContent = "< Back";
    backButton.addEventListener("click", () => {
      openBookmarkFolderMenu(anchorRect, trail.slice(0, -1));
    });
    menu.appendChild(backButton);
  }

  (folder.children || []).forEach((child) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = child.type === "folder" ? `📁 ${child.title}` : child.title || child.url;
    button.addEventListener("click", () => {
      if (child.type === "folder") {
        openBookmarkFolderMenu(anchorRect, [...trail, child.id]);
        return;
      }
      hideBookmarkFolderMenu();
      openUrlInAppBrowser(child.url);
    });
    menu.appendChild(button);
  });

  const divider = document.createElement("div");
  divider.className = "bookmark-context-divider";
  menu.appendChild(divider);

  const newFolderButton = document.createElement("button");
  newFolderButton.type = "button";
  newFolderButton.textContent = "New folder";
  newFolderButton.addEventListener("click", () => {
    openBookmarkFolderDialog({
      parentId: folder.id,
      parentTitle: folder.title,
      onCreated: () => openBookmarkFolderMenu(anchorRect, trail)
    });
  });
  menu.appendChild(newFolderButton);

  menu.classList.remove("hidden");
  menu.style.left = `${anchorRect.left}px`;
  menu.style.top = `${anchorRect.bottom + 6}px`;
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
  elements.tabStripTooltipLayer.innerHTML = "";
  const renderTabButton = (tab) => {
    const button = document.createElement("button");
    button.dataset.tabId = tab.id;
    button.className = `tab-button${tab.id === state.browser.activeTabId ? " active" : ""}${tab.pinned ? " pinned" : ""}`;
    const title = escapeHtml(tab.title || tab.url);
    button.title = `${tab.title || tab.url}\n${getTabSessionInfoCopy(tab)}`;
    button.innerHTML = `
      <span class="tab-copy">
        <span class="tab-title">${tab.pinned ? "[Pin] " : ""}${title}${tab.muted ? " [Muted]" : ""}</span>
      </span>
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

    button.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      try {
        await window.desktopAPI.browserShowTabContextMenu(tab.id);
      } catch (error) {
        setBrowserFeedback(`Tab menu failed: ${error.message}`, "error");
      }
    });

    return button;
  };

  let index = 0;
  while (index < state.browser.tabs.length) {
    const currentTab = state.browser.tabs[index];

    if (currentTab.groupId) {
      const cluster = document.createElement("div");
      cluster.dataset.groupId = currentTab.groupId;
      const activeInGroup = state.browser.tabs.some((tab) => tab.groupId === currentTab.groupId && tab.id === state.browser.activeTabId);
      cluster.className = `tab-group-cluster${activeInGroup ? " active" : ""}`;

      const label = document.createElement("button");
      label.type = "button";
      label.className = "tab-group-chip";
      label.textContent = currentTab.groupName || "Group";
      label.title = `${currentTab.groupName || "Group"}\n${getTabSessionLabel(currentTab)}`;
      label.addEventListener("click", () => {
        window.desktopAPI.browserActivateTab(currentTab.id);
      });
      cluster.appendChild(label);

      while (index < state.browser.tabs.length && state.browser.tabs[index].groupId === currentTab.groupId) {
        cluster.appendChild(renderTabButton(state.browser.tabs[index]));
        index += 1;
      }

      elements.tabStrip.appendChild(cluster);
      continue;
    }

    elements.tabStrip.appendChild(renderTabButton(currentTab));
    index += 1;
  }

  renderTabSessionTooltips();
  renderBrowserOverlay();
}

function renderTabSessionTooltips() {
  const layer = elements.tabStripTooltipLayer;
  if (!layer) {
    return;
  }

  layer.innerHTML = "";
  layer.classList.toggle("hidden", !uiState.showTabSessionInfo);
  if (!uiState.showTabSessionInfo) {
    return;
  }

  const renderedGroups = new Set();

  state.browser.tabs.forEach((tab) => {
    let anchor = null;
    let tooltipText = getTabSessionInfoCopy(tab);

    if (tab.groupId) {
      if (renderedGroups.has(tab.groupId)) {
        return;
      }
      renderedGroups.add(tab.groupId);
      anchor = elements.tabStrip.querySelector(`.tab-group-cluster[data-group-id="${tab.groupId}"]`);
    } else {
      anchor = elements.tabStrip.querySelector(`[data-tab-id="${tab.id}"]`);
    }

    if (!anchor) {
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const tooltip = document.createElement("div");
    tooltip.className = "tab-session-tooltip";
    tooltip.textContent = tooltipText;
    tooltip.style.left = `${anchorRect.left + anchorRect.width / 2}px`;
    tooltip.style.top = `${anchorRect.top - 10}px`;
    layer.appendChild(tooltip);
  });
}

function renderBrowserOverlay() {
  const active = getActiveBrowserTab();
  elements.browserOverlay.innerHTML = "";

  if (!active) {
    syncBrowserLayoutSoon();
    return;
  }

  if (active.isLoading) {
    const progressBar = document.createElement("div");
    progressBar.className = "browser-loading-bar";
    progressBar.innerHTML = `<div class="browser-loading-bar-fill"></div>`;
    elements.browserOverlay.appendChild(progressBar);
  }

  if (!active.error && active.isLoading) {
    const overlay = document.createElement("div");
    overlay.className = "browser-loading-card";
    overlay.innerHTML = `
      <div class="browser-loading-spinner" aria-hidden="true"></div>
      <div class="browser-loading-copy">
        <strong>Loading page</strong>
        <span>${active.url || "Please wait..."}</span>
      </div>
    `;
    elements.browserOverlay.appendChild(overlay);
    syncBrowserLayoutSoon();
    return;
  }

  if (!active.error) {
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
  const serviceStatus = state.xamppServiceStatus;
  if (serviceStatus) {
    const apacheLabel = serviceStatus.apacheRunning
      ? `Apache running on ${serviceStatus.apachePorts.join(", ")}`
      : `Apache stopped on ${serviceStatus.apachePorts.join(", ")}`;
    const mysqlLabel = serviceStatus.mysqlRunning
      ? `MySQL running on ${serviceStatus.mysqlHost}:${serviceStatus.mysqlPort}`
      : `MySQL stopped on ${serviceStatus.mysqlHost}:${serviceStatus.mysqlPort}`;
    elements.serverStatus.textContent = `${apacheLabel} | ${mysqlLabel}`;
  } else {
    elements.serverStatus.textContent = `Apache status: ${state.apacheRunning ? "running" : "stopped"}`;
  }

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
    elements.applyMultisiteButton.disabled = true;
    elements.applyMultisiteButton.classList.add("hidden");
    elements.applyMultisiteButton.textContent = "Apply multisite";
    elements.deleteSiteButton.disabled = true;
    elements.overviewEmptyCard.classList.remove("hidden");
    setCreateProgress(progressState.creating);
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
  const effectiveDbProfile = getEffectiveDbProfile();
  elements.dbHost.value = effectiveDbProfile.host || "127.0.0.1";
  elements.dbPort.value = effectiveDbProfile.port || "3306";
  elements.dbUser.value = effectiveDbProfile.user || "root";
  elements.dbPassword.value = effectiveDbProfile.password || "";
  elements.backupSiteButton.disabled = progressState.backingUp || progressState.deleting;
  const multisiteEnabled = Boolean(site.multisite?.enabled);
  elements.applyMultisiteButton.classList.toggle("hidden", !multisiteEnabled);
  elements.applyMultisiteButton.disabled = progressState.deleting;
  elements.applyMultisiteButton.textContent = site.multisite?.networkConfigured ? "Reapply multisite" : "Apply multisite";
  elements.deleteSiteButton.disabled = progressState.deleting;
  elements.overviewEmptyCard.classList.add("hidden");
  setCreateProgress(progressState.creating);
}

async function refreshSites() {
  const response = await window.desktopAPI.listSites();
  state.sites = response.sites;
  state.htdocsPath = response.htdocsPath || "";
  applyXamppServiceStatusSnapshot(response);
  elements.htdocsPath.value = state.htdocsPath;
  if (!state.selectedSiteId && state.sites[0]) {
    state.selectedSiteId = state.sites[0].id;
  }
  if (state.selectedSiteId && !state.sites.some((site) => site.id === state.selectedSiteId)) {
    state.selectedSiteId = state.sites[0]?.id || null;
  }
}

function applySettingsPayload(settings) {
  state.htdocsPath = settings.htdocsPath || "";
  state.browser.downloadDirectory = settings.downloadDirectory || state.browser.downloadDirectory || "";
  state.xamppPaths = settings.xamppPaths || null;
  state.effectiveDbProfile = settings.effectiveDbProfile || getEffectiveDbProfile();
  state.mysqlConfigContent = settings.mysqlConfigContent || "";
  state.wpInstallUsername = settings.wpInstallUsername || "admin";
  state.wpInstallPassword = settings.wpInstallPassword ?? "root";
  state.wpInstallEmail = settings.wpInstallEmail || "";
  state.shareLocalSiteSessions = settings.shareLocalSiteSessions !== false;
  state.shareOnlineSiteSessions = settings.shareOnlineSiteSessions === true;
  state.autoSaveLocalTabSessions = settings.autoSaveLocalTabSessions === true;
  state.autoSaveOnlineTabSessions = settings.autoSaveOnlineTabSessions === true;
  state.sessionAutoSaveDelaySeconds = Math.max(1, Number(settings.sessionAutoSaveDelaySeconds) || 5);
  state.browserExtensions = Array.isArray(settings.browserExtensions) ? settings.browserExtensions : [];

  elements.htdocsPath.value = state.htdocsPath;
  elements.settingsHtdocsPath.value = state.htdocsPath;

  if (state.htdocsPath) {
    elements.basePath.value = state.htdocsPath;
  }

  applyXamppServiceStatusSnapshot(settings);
  renderXamppSettings();
  renderSessionRules();
  renderSavedSessionControls();
  renderExtensionsSettings();
  renderExtensionsMenuPopup();
  renderThemeAccentInputs();
}

async function updateLocalSessionSharing() {
  const enabled = elements.settingsShareLocalSessions.checked;
  const result = await window.desktopAPI.setLocalSessionSharing(enabled);
  applySettingsPayload(result);
  const message = enabled 
    ? "All local tabs now share WordPress sign-ins."
    : "Each local tab has its own isolated session.";
  setStatus(message);
}

async function updateOnlineSessionSharing() {
  const enabled = elements.settingsShareOnlineSessions.checked;
  const result = await window.desktopAPI.setOnlineSessionSharing(enabled);
  applySettingsPayload(result);
  const message = enabled 
    ? "Online tabs from the same site now share sessions."
    : "Each online tab has its own isolated session.";
  setStatus(message);
}

async function updateSessionAutoSaveScope(scope) {
  const enabled = scope === "local"
    ? elements.settingsAutosaveLocalSessions.checked
    : elements.settingsAutosaveOnlineSessions.checked;
  const result = await window.desktopAPI.setSessionAutoSaveScope({ scope, enabled });
  applySettingsPayload(result);
  setStatus(
    enabled
      ? `Autosave is enabled for saved ${scope} tabs.`
      : `Autosave is disabled for saved ${scope} tabs.`
  );
}

async function updateSessionAutoSaveDelay() {
  const seconds = Math.max(1, Number(elements.settingsSessionAutosaveDelay.value) || 5);
  elements.settingsSessionAutosaveDelay.value = String(seconds);
  const result = await window.desktopAPI.setSessionAutoSaveDelay(seconds);
  applySettingsPayload(result);
  setStatus(`Session autosave delay set to ${seconds} second${seconds === 1 ? "" : "s"}.`);
}

async function saveActiveTabSession(autoSave = false) {
  const active = getActiveBrowserTab();
  if (!active) {
    setStatus("Open a tab before saving its session.");
    return;
  }

  const result = await window.desktopAPI.browserSaveTabSession({ tabId: active.id, autoSave });
  if (!result?.ok) {
    setStatus(result?.message || "Could not save this tab session.");
    return;
  }

  setStatus(result.message || "Saved the current tab session.");
}

async function unsaveActiveTabSession() {
  const active = getActiveBrowserTab();
  if (!active) {
    setStatus("Open a tab before removing a saved session.");
    return;
  }

  const result = await window.desktopAPI.browserUnsaveTabSession({ tabId: active.id });
  if (result?.ok === false) {
    setStatus(result.message || "Could not remove this saved session.");
    return;
  }
  setStatus(result?.message || "Removed the current tab from saved sessions.");
}

async function pickAndSaveXamppRoot() {
  const selected = await window.desktopAPI.pickFolder();
  if (!selected) {
    return;
  }

  const result = await window.desktopAPI.setXamppRootPath(selected);
  applySettingsPayload(result);

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

async function saveMysqlConfigFromSettings() {
  setStatus("Saving MySQL settings...");

  try {
    const result = await window.desktopAPI.saveMysqlConfig({
      dbUser: elements.settingsDbUser.value,
      dbPassword: elements.settingsDbPassword.value,
      wpInstallUsername: elements.settingsWpInstallUsername.value,
      wpInstallPassword: elements.settingsWpInstallPassword.value,
      wpInstallEmail: elements.settingsWpInstallEmail.value,
      content: elements.settingsMysqlEditor.value
    });

    applySettingsPayload(result);
    setStatus("Saved MySQL config, DB credentials, and WordPress install defaults.");
  } catch (error) {
    setStatus(`Saving MySQL config failed: ${error.message}`);
  }
}

async function saveWpInstallDefaultsFromSettings() {
  setStatus("Saving WordPress install auto-fill values...");

  try {
    const result = await window.desktopAPI.saveWpInstallDefaults({
      wpInstallUsername: elements.settingsWpInstallUsername.value,
      wpInstallPassword: elements.settingsWpInstallPassword.value,
      wpInstallEmail: elements.settingsWpInstallEmail.value
    });

    applySettingsPayload(result);
    setStatus("Saved WordPress install auto-fill values.");
  } catch (error) {
    setStatus(`Saving auto-fill values failed: ${error.message}`);
  }
}

async function refreshXamppServiceStatus({ force = false } = {}) {
  if (xamppStatusRefreshInFlight && !force) {
    return xamppStatusRefreshInFlight;
  }

  const request = (async () => {
    try {
      const settings = await window.desktopAPI.getSettings();
      applyXamppServiceStatusSnapshot(settings);
    } catch (_) {
      // Ignore transient polling failures and keep the last visible state.
    } finally {
      if (xamppStatusRefreshInFlight === request) {
        xamppStatusRefreshInFlight = null;
      }
    }
  })();

  xamppStatusRefreshInFlight = request;
  return request;
}

function startXamppStatusAutoRefresh() {
  if (xamppStatusRefreshTimer) {
    clearInterval(xamppStatusRefreshTimer);
  }

  xamppStatusRefreshTimer = window.setInterval(() => {
    void refreshXamppServiceStatus();
  }, XAMPP_STATUS_REFRESH_INTERVAL_MS);
}

async function saveCurrentSiteCredentials() {
  const active = getActiveBrowserTab();
  const key = active ? getCredentialKeyFromUrl(active.url) : null;

  if (!key) {
    setStatus("Open a site before saving credentials.");
    return;
  }

  const saved = await window.desktopAPI.saveSiteCredentials({
    key,
    username: elements.vaultUsername.value,
    password: elements.vaultPassword.value
  });

  state.currentVaultCredentials = saved;
  renderVaultCredentialOptions(saved);
  if (saved?.selectedId) {
    elements.vaultCredentialList.value = saved.selectedId;
  }
  setStatus(`Saved credentials for ${key}.`);
}

async function clearCurrentSiteCredentials() {
  const active = getActiveBrowserTab();
  const key = active ? getCredentialKeyFromUrl(active.url) : null;

  if (!key) {
    return;
  }

  const selectedId = elements.vaultCredentialList.value;
  await window.desktopAPI.clearSiteCredentials(selectedId ? { key, id: selectedId } : { key });
  await syncVaultPanel();
  setStatus(selectedId ? `Removed one saved credential for ${key}.` : `Cleared credentials for ${key}.`);
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
    const effectiveDbProfile = getEffectiveDbProfile();
    const result = await window.desktopAPI.deleteSite({
      site,
      database: {
        host: effectiveDbProfile.host,
        port: effectiveDbProfile.port,
        user: effectiveDbProfile.user,
        password: effectiveDbProfile.password
      }
    });
    if (state.selectedSiteId === site.id) {
      state.selectedSiteId = null;
    }
    await refreshSites();
    setStatus(`Deleted ${site.name}. Backup saved to ${result?.backupPath || "the backups folder"}.`);
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

  setBackupProgress(true);
  showSiteTab("tools");
  setStatus(`Creating backup for ${site.name}...`);

  try {
    const effectiveDbProfile = getEffectiveDbProfile();
    const result = await window.desktopAPI.backupSite({
      site,
      database: {
        host: effectiveDbProfile.host,
        port: effectiveDbProfile.port,
        user: effectiveDbProfile.user,
        password: effectiveDbProfile.password
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

async function applySelectedSiteMultisiteConfig() {
  const site = getSelectedSite();
  if (!site) {
    setStatus("Select a site first.");
    return;
  }

  if (!site.multisite?.enabled) {
    setStatus("This site was not marked for WordPress multisite.");
    return;
  }

  showSiteTab("tools");
  elements.applyMultisiteButton.disabled = true;
  setStatus(`Applying multisite rules for ${site.name}...`);

  try {
    const result = await window.desktopAPI.applyMultisiteConfig({ siteId: site.id });
    await refreshSites();
    setStatus(result?.message || `Applied multisite rules for ${site.name}.`);
  } catch (error) {
    setStatus(`Apply multisite failed: ${error.message}`);
  } finally {
    renderSiteDetails();
  }
}

elements.newTabButton.addEventListener("click", () => {
  window.desktopAPI.browserCreateTab({ url: "https://www.google.com", mode: "auto" });
});
elements.browserMenuButton.addEventListener("click", () => void openBrowserMenu());
elements.vaultToggleButton.addEventListener("click", () => {
  state.vaultOpen = !state.vaultOpen;
  renderVaultPanel();
});
elements.browserFullscreenButton.addEventListener("click", () => toggleBrowserFocusMode());
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
elements.closeBookmarkFolderModalButton.addEventListener("click", closeBookmarkFolderDialog);
elements.bookmarkFolderCancelButton.addEventListener("click", closeBookmarkFolderDialog);
elements.bookmarkFolderCreateButton.addEventListener("click", () => void submitBookmarkFolderDialog());
elements.bookmarkFolderModal.addEventListener("click", (event) => {
  if (event.target === elements.bookmarkFolderModal) {
    closeBookmarkFolderDialog();
  }
});
elements.bookmarkFolderNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void submitBookmarkFolderDialog();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeBookmarkFolderDialog();
  }
});
elements.extensionsMenuButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleExtensionsMenuPopup();
});
elements.settingsDarkAccent?.addEventListener("input", () => {
  elements.settingsDarkAccentHex.value = elements.settingsDarkAccent.value;
});
elements.settingsLightAccent?.addEventListener("input", () => {
  elements.settingsLightAccentHex.value = elements.settingsLightAccent.value;
});
document.addEventListener("pointerdown", (event) => {
  if (!isBookmarkFolderMenuOpen()) {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".extension-menu-shell")) {
      hideExtensionsMenuPopup();
    }
    return;
  }

  const target = event.target;
  if (target instanceof Element && (
    target.closest("#bookmark-context-menu")
    || target.closest(".bookmark-folder-chip")
  )) {
    if (!target.closest(".extension-menu-shell")) {
      hideExtensionsMenuPopup();
    }
    return;
  }

  hideBookmarkFolderMenu();
  hideExtensionsMenuPopup();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isBookmarkFolderMenuOpen()) {
    hideBookmarkFolderMenu();
  }
  if (event.key === "Escape") {
    hideExtensionsMenuPopup();
  }
});
elements.vaultSaveButton.addEventListener("click", () => void saveCurrentSiteCredentials());
elements.vaultClearButton.addEventListener("click", () => void clearCurrentSiteCredentials());
elements.vaultFillButton.addEventListener("click", autofillCurrentPage);
elements.tabSessionInfoButton.addEventListener("click", () => {
  uiState.showTabSessionInfo = !uiState.showTabSessionInfo;
  elements.tabSessionInfoButton.classList.toggle("active", uiState.showTabSessionInfo);
  renderBrowserTabs();
});
elements.tabStrip.addEventListener("scroll", () => {
  if (uiState.showTabSessionInfo) {
    renderTabSessionTooltips();
  }
});
window.addEventListener("resize", () => {
  if (uiState.showTabSessionInfo) {
    renderTabSessionTooltips();
  }
});
elements.vaultCredentialList.addEventListener("change", () => {
  loadVaultCredentialFromSelection(state.currentVaultCredentials);
});
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
elements.settingsShareLocalSessions.addEventListener("change", () => void updateLocalSessionSharing());
elements.settingsShareOnlineSessions.addEventListener("change", () => void updateOnlineSessionSharing());
elements.sessionAutosaveButton?.addEventListener("click", () => void saveActiveTabSession(true));
elements.sessionSaveButton?.addEventListener("click", () => void saveActiveTabSession(false));
elements.sessionUnsaveButton?.addEventListener("click", () => void unsaveActiveTabSession());
elements.settingsAutosaveLocalSessions?.addEventListener("change", () => void updateSessionAutoSaveScope("local"));
elements.settingsAutosaveOnlineSessions?.addEventListener("change", () => void updateSessionAutoSaveScope("online"));
elements.settingsSessionAutosaveDelay?.addEventListener("change", () => void updateSessionAutoSaveDelay());
elements.settingsSessionAutosaveDelay?.addEventListener("blur", () => void updateSessionAutoSaveDelay());
elements.saveMysqlConfigButton.addEventListener("click", () => void saveMysqlConfigFromSettings());
elements.installExtensionFolderButton?.addEventListener("click", async () => {
  const selected = await window.desktopAPI.pickFolder();
  if (!selected) {
    return;
  }
  try {
    const result = await window.desktopAPI.installBrowserExtensionFromFolder(selected);
    applySettingsPayload(result.settings);
    setStatus(`Installed extension from ${selected}.`);
  } catch (error) {
    setStatus(`Extension install failed: ${error.message}`);
  }
});
elements.installExtensionArchiveButton?.addEventListener("click", async () => {
  const selected = await window.desktopAPI.pickExtensionArchive();
  if (!selected) {
    return;
  }
  try {
    const result = await window.desktopAPI.installBrowserExtensionFromArchive(selected);
    applySettingsPayload(result.settings);
    setStatus(`Installed extension from ${selected}.`);
  } catch (error) {
    setStatus(`Extension install failed: ${error.message}`);
  }
});
elements.openChromeWebStoreButton?.addEventListener("click", () => void openUrlInAppBrowser("https://chromewebstore.google.com/category/extensions"));
elements.openEdgeAddonsButton?.addEventListener("click", () => void openUrlInAppBrowser("https://microsoftedge.microsoft.com/addons/Microsoft-Edge-Extensions-Home"));
elements.openFirefoxAddonsButton?.addEventListener("click", () => void openUrlInAppBrowser("https://addons.mozilla.org/en-US/firefox/extensions/"));
elements.saveThemeAccentsButton?.addEventListener("click", saveThemeAccentSettings);
elements.resetThemeAccentsButton?.addEventListener("click", resetThemeAccentSettings);
elements.saveWpInstallDefaultsButton.addEventListener("click", () => void saveWpInstallDefaultsFromSettings());
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
elements.applyMultisiteButton.addEventListener("click", () => void applySelectedSiteMultisiteConfig());
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
    const effectiveDbProfile = getEffectiveDbProfile();
    const result = await window.desktopAPI.testDb(effectiveDbProfile);
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
  if (!isInstallerReady()) {
    setStatus(getInstallerBlockedMessage());
    return;
  }

  setStatus("Creating site...");
  elements.resultCard.classList.add("hidden");
  setCreateProgress(true);

  try {
    setCreateProgress(true, "Extracting WordPress files and preparing the local database...");
    const effectiveDbProfile = getEffectiveDbProfile();
    const result = await window.desktopAPI.installWordPress({
      zipPath: elements.zipPath.value,
      basePath: elements.basePath.value,
      folderName: elements.folderName.value,
      multisite: {
        enabled: elements.enableMultisite.checked
      },
      database: {
        create: elements.createDb.checked,
        host: effectiveDbProfile.host,
        port: effectiveDbProfile.port,
        user: effectiveDbProfile.user,
        password: effectiveDbProfile.password
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
  if (payload?.sessionSettings) {
    state.autoSaveLocalTabSessions = payload.sessionSettings.autoSaveLocalTabSessions === true;
    state.autoSaveOnlineTabSessions = payload.sessionSettings.autoSaveOnlineTabSessions === true;
    state.sessionAutoSaveDelaySeconds = Math.max(1, Number(payload.sessionSettings.sessionAutoSaveDelaySeconds) || 5);
  }
  renderBrowserTabs();
  refreshControls();
});

window.desktopAPI.onBrowserNotice((payload) => {
  if (payload?.message) {
    setBrowserFeedback(payload.message, payload.type || "info");
  }
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

window.desktopAPI.onBrowserBookmarkFolderEdit((folder) => {
  if (!folder?.id) {
    return;
  }
  openBookmarkFolderDialog({
    parentTitle: "Rename folder",
    editFolderId: folder.id,
    initialTitle: folder.title || ""
  });
});

window.desktopAPI.onBrowserBookmarkFolderOpen((folder) => {
  if (!folder?.id) {
    return;
  }
  const chip = elements.bookmarkBar.querySelector(`[data-bookmark-id="${folder.id}"]`);
  if (!chip) {
    return;
  }
  const rect = chip.getBoundingClientRect();
  openBookmarkFolderMenu(rect, [folder.id]);
});

window.desktopAPI.onBrowserBookmarkFolderAddChild((folder) => {
  if (!folder?.id) {
    return;
  }
  openBookmarkFolderDialog({
    parentId: folder.id,
    parentTitle: folder.title || "Folder"
  });
});

window.desktopAPI.onBrowserBookmarkCreateFolderAndMove((bookmark) => {
  if (!bookmark?.id) {
    return;
  }
  openBookmarkFolderDialog({
    parentId: null,
    parentTitle: "Favorites bar",
    moveBookmarkId: bookmark.id
  });
});


window.desktopAPI.onBrowserOpenUrl((payload) => {
  if (payload?.url) {
    openUrlInAppBrowser(payload.url, payload.mode || "auto");
  }
});

window.desktopAPI.onBrowserFocus(() => {
  showScreen("browser");
});

window.desktopAPI.onBrowserMenuCommand((payload) => {
  void handleBrowserMenuCommand(payload);
});

window.desktopAPI.onSitesChanged(() => {
  void refreshSites();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void refreshXamppServiceStatus({ force: true });
  }
});
window.addEventListener("focus", () => {
  void refreshXamppServiceStatus({ force: true });
});
window.addEventListener("beforeunload", () => {
  if (xamppStatusRefreshTimer) {
    clearInterval(xamppStatusRefreshTimer);
    xamppStatusRefreshTimer = null;
  }
});

async function loadSavedState() {
  const settings = await window.desktopAPI.getSettings();
  applySettingsPayload(settings);
  elements.saveDbProfile.checked = false;
  elements.saveDbProfile.disabled = true;

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
startXamppStatusAutoRefresh();
void loadSavedState();
