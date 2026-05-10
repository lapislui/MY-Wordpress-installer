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
  workspaceClients: [],
  selectedWorkspaceClientId: null,
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
  showTabSessionInfo: false,
  workspaceNotesMode: "edit",
  editingWorkspaceTodoId: null,
  editingWorkspaceEventId: null,
  editingWorkspaceResourceId: null
};

let browserFeedbackTimer = null;
let addressSuggestionsToken = 0;
let draggedBrowserToolSection = null;
let draggedWorkspacePanel = null;
let bookmarkFolderDialogContext = null;
let draggedBookmarkId = null;
let workspaceContextClientId = null;
let workspaceMediaContextResource = null;
let xamppStatusRefreshTimer = null;
let xamppStatusRefreshInFlight = null;
const BROWSER_TOOL_ORDER_KEY = "wp-desktop.browser-tool-order";
const BROWSER_TOOL_COLLAPSE_KEY = "wp-desktop.browser-tool-collapse";
const XAMPP_STATUS_REFRESH_INTERVAL_MS = 5000;
const WORKSPACE_CLIENTS_KEY = "wpdesktop.workspace.clients";
const WORKSPACE_SELECTED_CLIENT_KEY = "wpdesktop.workspace.selected-client";
const WORKSPACE_PANEL_ORDER_KEY = "wpdesktop.workspace.panel-order";
const WORKSPACE_PANEL_COLLAPSE_KEY = "wpdesktop.workspace.panel-collapse";
const DEFAULT_BROWSER_TOOL_ORDER = ["sessions", "credentials", "bookmarks", "downloads", "permissions"];
const DEFAULT_BROWSER_TOOL_COLLAPSE = {
  sessions: false,
  credentials: false,
  bookmarks: true,
  downloads: true,
  permissions: true
};
const DEFAULT_WORKSPACE_PANEL_ORDER = ["details", "tasks", "calendar", "notes", "resources"];
const DEFAULT_WORKSPACE_PANEL_COLLAPSE = {
  details: false,
  tasks: false,
  calendar: false,
  notes: false,
  resources: false
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
  workspaceAddClientButton: document.getElementById("workspace-add-client-button"),
  workspaceClientList: document.getElementById("workspace-client-list"),
  workspaceContextMenu: document.getElementById("workspace-context-menu"),
  workspaceMediaContextMenu: document.getElementById("workspace-media-context-menu"),
  workspaceGrid: document.getElementById("workspace-grid"),
  workspaceClientTitle: document.getElementById("workspace-client-title"),
  workspaceClientSubtitle: document.getElementById("workspace-client-subtitle"),
  workspaceEditClientButton: document.getElementById("workspace-edit-client-button"),
  workspaceDuplicateClientButton: document.getElementById("workspace-duplicate-client-button"),
  workspaceDeleteClientButton: document.getElementById("workspace-delete-client-button"),
  workspaceClientName: document.getElementById("workspace-client-name"),
  workspaceContactName: document.getElementById("workspace-contact-name"),
  workspaceProjectName: document.getElementById("workspace-project-name"),
  workspaceProjectUrl: document.getElementById("workspace-project-url"),
  workspaceProjectStage: document.getElementById("workspace-project-stage"),
  workspaceContactEmail: document.getElementById("workspace-contact-email"),
  workspaceContactPhone: document.getElementById("workspace-contact-phone"),
  workspaceProjectRepo: document.getElementById("workspace-project-repo"),
  workspaceHosting: document.getElementById("workspace-hosting"),
  workspaceAdminUrl: document.getElementById("workspace-admin-url"),
  workspacePriority: document.getElementById("workspace-priority"),
  workspaceTodoInput: document.getElementById("workspace-todo-input"),
  workspaceTodoDeadline: document.getElementById("workspace-todo-deadline"),
  workspaceTodoEventLink: document.getElementById("workspace-todo-event-link"),
  workspaceTodoResourceLink: document.getElementById("workspace-todo-resource-link"),
  workspaceTodoFormState: document.getElementById("workspace-todo-form-state"),
  workspaceCancelTodoButton: document.getElementById("workspace-cancel-todo-button"),
  workspaceAddTodoButton: document.getElementById("workspace-add-todo-button"),
  workspaceTodoList: document.getElementById("workspace-todo-list"),
  workspaceEventTitle: document.getElementById("workspace-event-title"),
  workspaceEventDate: document.getElementById("workspace-event-date"),
  workspaceEventFormState: document.getElementById("workspace-event-form-state"),
  workspaceCancelEventButton: document.getElementById("workspace-cancel-event-button"),
  workspaceAddEventButton: document.getElementById("workspace-add-event-button"),
  workspaceEventList: document.getElementById("workspace-event-list"),
  workspaceNotes: document.getElementById("workspace-notes"),
  workspaceNotesEditorShell: document.getElementById("workspace-notes-editor-shell"),
  workspaceNotesPreview: document.getElementById("workspace-notes-preview"),
  workspaceNotesPageSelect: document.getElementById("workspace-notes-page-select"),
  workspaceAddNotesPageButton: document.getElementById("workspace-add-notes-page-button"),
  workspaceDeleteNotesPageButton: document.getElementById("workspace-delete-notes-page-button"),
  workspaceNotesPageTitle: document.getElementById("workspace-notes-page-title"),
  workspaceNotesEditButton: document.getElementById("workspace-notes-edit-button"),
  workspaceNotesPreviewButton: document.getElementById("workspace-notes-preview-button"),
  workspaceClearNotesButton: document.getElementById("workspace-clear-notes-button"),
  workspaceResourceType: document.getElementById("workspace-resource-type"),
  workspaceResourceLabel: document.getElementById("workspace-resource-label"),
  workspaceResourceTarget: document.getElementById("workspace-resource-target"),
  workspaceResourceNotes: document.getElementById("workspace-resource-notes"),
  workspacePickResourceButton: document.getElementById("workspace-pick-resource-button"),
  workspaceResourceFormState: document.getElementById("workspace-resource-form-state"),
  workspaceCancelResourceButton: document.getElementById("workspace-cancel-resource-button"),
  workspaceAddResourceButton: document.getElementById("workspace-add-resource-button"),
  workspaceResourceList: document.getElementById("workspace-resource-list"),
  workspaceImageModal: document.getElementById("workspace-image-modal"),
  closeWorkspaceImageModalButton: document.getElementById("close-workspace-image-modal-button"),
  workspaceImageModalTitle: document.getElementById("workspace-image-modal-title"),
  workspaceImageModalMeta: document.getElementById("workspace-image-modal-meta"),
  workspaceImageModalImage: document.getElementById("workspace-image-modal-image"),
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
elements.workspaceAddClientButton?.addEventListener("click", () => {
  const client = buildWorkspaceClientRecord("");
  state.workspaceClients.unshift(client);
  state.selectedWorkspaceClientId = client.id;
  saveWorkspaceClients();
  showScreen("workspace");
  renderWorkspace();
  focusWorkspaceClientNameField();
});
elements.workspaceEditClientButton?.addEventListener("click", () => {
  if (!getSelectedWorkspaceClient()) {
    return;
  }
  focusWorkspaceClientNameField();
});
elements.workspaceDuplicateClientButton?.addEventListener("click", () => {
  duplicateWorkspaceClient(getSelectedWorkspaceClient());
});
elements.workspaceDeleteClientButton?.addEventListener("click", () => {
  const client = getSelectedWorkspaceClient();
  if (!client) {
    return;
  }
  deleteWorkspaceClient(client.id);
});
elements.workspaceAddTodoButton?.addEventListener("click", () => {
  const text = String(elements.workspaceTodoInput.value || "").trim();
  const deadline = String(elements.workspaceTodoDeadline.value || "").trim();
  const eventId = String(elements.workspaceTodoEventLink.value || "").trim();
  const resourceId = String(elements.workspaceTodoResourceLink.value || "").trim();
  if (!text) {
    return;
  }
  updateSelectedWorkspaceClient((client) => {
    const existingTodo = (client.todos || []).find((todo) => todo.id === uiState.editingWorkspaceTodoId);
    if (existingTodo) {
      existingTodo.text = text;
      existingTodo.deadline = deadline;
      existingTodo.eventId = eventId;
      existingTodo.resourceId = resourceId;
      return;
    }

    client.todos.unshift({
      id: `todo-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      text,
      done: false,
      createdAt: Date.now(),
      deadline,
      eventId,
      resourceId
    });
  });
  resetWorkspaceTodoForm();
});
elements.workspaceTodoInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    elements.workspaceAddTodoButton?.click();
  }
});
elements.workspaceCancelTodoButton?.addEventListener("click", resetWorkspaceTodoForm);
elements.workspaceAddEventButton?.addEventListener("click", () => {
  const title = String(elements.workspaceEventTitle.value || "").trim();
  const date = String(elements.workspaceEventDate.value || "").trim();
  if (!title || !date) {
    return;
  }
  updateSelectedWorkspaceClient((client) => {
    const existingEvent = (client.events || []).find((event) => event.id === uiState.editingWorkspaceEventId);
    if (existingEvent) {
      existingEvent.title = title;
      existingEvent.date = date;
      client.todos = (client.todos || []).map((todo) => (
        todo.eventId === existingEvent.id ? { ...todo, deadline: date } : todo
      ));
      return;
    }

    client.events.push({
      id: `event-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      title,
      date
    });
  });
  resetWorkspaceEventForm();
});
elements.workspaceCancelEventButton?.addEventListener("click", resetWorkspaceEventForm);
elements.workspacePickResourceButton?.addEventListener("click", async () => {
  const selected = await window.desktopAPI.pickWorkspaceResource();
  if (selected) {
    elements.workspaceResourceTarget.value = selected;
    const inferredType = inferWorkspaceResourceTypeFromTarget(selected);
    if (inferredType && elements.workspaceResourceType) {
      elements.workspaceResourceType.value = inferredType;
    }
  }
});
elements.workspaceAddResourceButton?.addEventListener("click", () => {
  const type = String(elements.workspaceResourceType.value || "").trim() || "file";
  const label = String(elements.workspaceResourceLabel.value || "").trim();
  const target = String(elements.workspaceResourceTarget.value || "").trim();
  const notes = String(elements.workspaceResourceNotes.value || "").trim();
  if (!target) {
    return;
  }
  const inferredType = inferWorkspaceResourceTypeFromTarget(target);
  const resolvedType = inferredType === "image" || inferredType === "media" ? inferredType : type;

  updateSelectedWorkspaceClient((client) => {
    client.resources = client.resources || [];
    const existingResource = client.resources.find((resource) => resource.id === uiState.editingWorkspaceResourceId);
    const computedLabel = label || target.split(/[\\/]/).pop() || resolvedType;
    if (existingResource) {
      existingResource.type = resolvedType;
      existingResource.label = computedLabel;
      existingResource.target = target;
      existingResource.notes = notes;
      return;
    }

    client.resources.unshift({
      id: `resource-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      type: resolvedType,
      label: computedLabel,
      target,
      notes,
      createdAt: Date.now()
    });
  });
  resetWorkspaceResourceForm();
});
elements.workspaceCancelResourceButton?.addEventListener("click", resetWorkspaceResourceForm);
elements.workspaceTodoEventLink?.addEventListener("change", () => {
  const client = getSelectedWorkspaceClient();
  const linkedEvent = client?.events.find((event) => event.id === elements.workspaceTodoEventLink.value);
  if (linkedEvent?.date) {
    elements.workspaceTodoDeadline.value = linkedEvent.date;
  }
});
[
  "workspaceClientName",
  "workspaceContactName",
  "workspaceProjectName",
  "workspaceProjectUrl",
  "workspaceProjectStage",
  "workspaceContactEmail",
  "workspaceContactPhone",
  "workspaceProjectRepo",
  "workspaceHosting",
  "workspaceAdminUrl",
  "workspacePriority"
].forEach((key) => {
  const map = {
    workspaceClientName: "clientName",
    workspaceContactName: "contactName",
    workspaceProjectName: "projectName",
    workspaceProjectUrl: "projectUrl",
    workspaceProjectStage: "stage",
    workspaceContactEmail: "contactEmail",
    workspaceContactPhone: "contactPhone",
    workspaceProjectRepo: "projectRepo",
    workspaceHosting: "hosting",
    workspaceAdminUrl: "adminUrl",
    workspacePriority: "priority"
  };
  elements[key]?.addEventListener("input", (event) => {
    updateSelectedWorkspaceClient((client) => {
      client[map[key]] = event.target.value;
    });
  });
});
elements.workspaceNotes?.addEventListener("input", (event) => {
  updateSelectedWorkspaceClient((client) => {
    const page = getSelectedWorkspaceNotePage(client);
    if (page) {
      page.content = event.target.value;
    }
  });
});
elements.workspaceNotesPageSelect?.addEventListener("change", (event) => {
  updateSelectedWorkspaceClient((client) => {
    client.selectedNotePageId = String(event.target.value || "");
    ensureWorkspaceNotePages(client);
  });
});
elements.workspaceNotesPageTitle?.addEventListener("input", (event) => {
  updateSelectedWorkspaceClient((client) => {
    const page = getSelectedWorkspaceNotePage(client);
    if (page) {
      page.title = String(event.target.value || "").trimStart();
    }
  });
});
elements.workspaceAddNotesPageButton?.addEventListener("click", () => {
  updateSelectedWorkspaceClient((client) => {
    const pages = ensureWorkspaceNotePages(client);
    const newPage = buildWorkspaceNotePage(`Page ${pages.length + 1}`);
    pages.push(newPage);
    client.selectedNotePageId = newPage.id;
  });
});
elements.workspaceDeleteNotesPageButton?.addEventListener("click", () => {
  updateSelectedWorkspaceClient((client) => {
    const pages = ensureWorkspaceNotePages(client);
    if (pages.length <= 1) {
      pages[0].content = "";
      pages[0].title = "Notes";
      client.selectedNotePageId = pages[0].id;
      return;
    }
    client.notePages = pages.filter((page) => page.id !== client.selectedNotePageId);
    client.selectedNotePageId = client.notePages[0]?.id || "";
  });
});
elements.workspaceNotesEditButton?.addEventListener("click", () => {
  uiState.workspaceNotesMode = "edit";
  renderWorkspaceNotesPanel(getSelectedWorkspaceClient());
});
elements.workspaceNotesPreviewButton?.addEventListener("click", () => {
  uiState.workspaceNotesMode = "preview";
  renderWorkspaceNotesPanel(getSelectedWorkspaceClient());
});
elements.workspaceClearNotesButton?.addEventListener("click", () => {
  if (!getSelectedWorkspaceClient()) {
    return;
  }
  updateSelectedWorkspaceClient((client) => {
    const page = getSelectedWorkspaceNotePage(client);
    if (page) {
      page.content = "";
    }
  });
});

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
initWorkspacePanels();

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

function getWorkspacePanels() {
  return Array.from(document.querySelectorAll(".workspace-panel[data-workspace-panel]"));
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

function getWorkspaceClientById(clientId) {
  return state.workspaceClients.find((client) => client.id === clientId) || null;
}

function getSelectedWorkspaceClient() {
  return getWorkspaceClientById(state.selectedWorkspaceClientId);
}

function saveWorkspaceClients() {
  writeBrowserToolPrefs(WORKSPACE_CLIENTS_KEY, state.workspaceClients);
  try {
    window.localStorage.setItem(WORKSPACE_SELECTED_CLIENT_KEY, state.selectedWorkspaceClientId || "");
  } catch (_) {
    // Ignore workspace selection persistence failures.
  }
}

function buildWorkspaceClientRecord(seedName = "") {
  const label = String(seedName || "").trim() || `Client ${state.workspaceClients.length + 1}`;
  const initialPage = buildWorkspaceNotePage("Notes");
  return {
    id: `client-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    clientName: label,
    contactName: "",
    projectName: "",
    projectUrl: "",
    stage: "",
    contactEmail: "",
    contactPhone: "",
    projectRepo: "",
    hosting: "",
    adminUrl: "",
    priority: "",
    notes: "",
    notePages: [initialPage],
    selectedNotePageId: initialPage.id,
    todos: [],
    events: [],
    resources: [],
    updatedAt: Date.now()
  };
}

function buildWorkspaceNotePage(seedTitle = "Notes", seedContent = "") {
  return {
    id: `note-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    title: String(seedTitle || "").trim() || "Notes",
    content: String(seedContent || "")
  };
}

function ensureWorkspaceNotePages(client) {
  if (!client) {
    return [];
  }

  if (!Array.isArray(client.notePages) || !client.notePages.length) {
    client.notePages = [buildWorkspaceNotePage("Notes", client.notes || "")];
  }
  client.notePages = client.notePages.map((page) => ({
    id: String(page?.id || `note-${Date.now()}`),
    title: String(page?.title || "").trim() || "Notes",
    content: String(page?.content || "")
  }));
  if (!client.selectedNotePageId || !client.notePages.some((page) => page.id === client.selectedNotePageId)) {
    client.selectedNotePageId = client.notePages[0].id;
  }
  return client.notePages;
}

function getSelectedWorkspaceNotePage(client) {
  const pages = ensureWorkspaceNotePages(client);
  return pages.find((page) => page.id === client.selectedNotePageId) || pages[0] || null;
}

function resetWorkspaceTodoForm() {
  uiState.editingWorkspaceTodoId = null;
  if (elements.workspaceTodoInput) {
    elements.workspaceTodoInput.value = "";
  }
  if (elements.workspaceTodoDeadline) {
    elements.workspaceTodoDeadline.value = "";
  }
  if (elements.workspaceTodoEventLink) {
    elements.workspaceTodoEventLink.value = "";
  }
  if (elements.workspaceTodoResourceLink) {
    elements.workspaceTodoResourceLink.value = "";
  }
  renderWorkspaceFormActions();
}

function resetWorkspaceEventForm() {
  uiState.editingWorkspaceEventId = null;
  if (elements.workspaceEventTitle) {
    elements.workspaceEventTitle.value = "";
  }
  if (elements.workspaceEventDate) {
    elements.workspaceEventDate.value = "";
  }
  renderWorkspaceFormActions();
}

function resetWorkspaceResourceForm() {
  uiState.editingWorkspaceResourceId = null;
  if (elements.workspaceResourceType) {
    elements.workspaceResourceType.value = "google-sheet";
  }
  if (elements.workspaceResourceLabel) {
    elements.workspaceResourceLabel.value = "";
  }
  if (elements.workspaceResourceTarget) {
    elements.workspaceResourceTarget.value = "";
  }
  if (elements.workspaceResourceNotes) {
    elements.workspaceResourceNotes.value = "";
  }
  renderWorkspaceFormActions();
}

function closeWorkspaceImageModal() {
  elements.workspaceImageModal?.classList.add("hidden");
  if (elements.workspaceImageModalImage) {
    elements.workspaceImageModalImage.removeAttribute("src");
  }
  if (elements.workspaceImageModalTitle) {
    elements.workspaceImageModalTitle.textContent = "Image preview";
  }
  if (elements.workspaceImageModalMeta) {
    elements.workspaceImageModalMeta.textContent = "";
  }
}

function openWorkspaceImageModal(resource) {
  if (!resource || !elements.workspaceImageModal || !elements.workspaceImageModalImage) {
    return;
  }

  elements.workspaceImageModalImage.src = toWorkspaceTargetUrl(resource.target);
  if (elements.workspaceImageModalTitle) {
    elements.workspaceImageModalTitle.textContent = resource.label || "Image preview";
  }
  if (elements.workspaceImageModalMeta) {
    elements.workspaceImageModalMeta.textContent = resource.target || "";
  }
  elements.workspaceImageModal.classList.remove("hidden");
}

function startEditingWorkspaceTodo(todoId) {
  const client = getSelectedWorkspaceClient();
  const todo = client?.todos.find((entry) => entry.id === todoId);
  if (!todo) {
    return;
  }

  uiState.editingWorkspaceTodoId = todo.id;
  elements.workspaceTodoInput.value = todo.text || "";
  elements.workspaceTodoDeadline.value = todo.deadline || "";
  elements.workspaceTodoEventLink.value = todo.eventId || "";
  elements.workspaceTodoResourceLink.value = todo.resourceId || "";
  elements.workspaceTodoInput?.focus();
  elements.workspaceTodoInput?.select();
  renderWorkspaceFormActions();
}

function startEditingWorkspaceEvent(eventId) {
  const client = getSelectedWorkspaceClient();
  const entry = client?.events.find((event) => event.id === eventId);
  if (!entry) {
    return;
  }

  uiState.editingWorkspaceEventId = entry.id;
  elements.workspaceEventTitle.value = entry.title || "";
  elements.workspaceEventDate.value = entry.date || "";
  elements.workspaceEventTitle?.focus();
  elements.workspaceEventTitle?.select();
  renderWorkspaceFormActions();
}

function startEditingWorkspaceResource(resourceId) {
  const client = getSelectedWorkspaceClient();
  const resource = client?.resources.find((entry) => entry.id === resourceId);
  if (!resource) {
    return;
  }

  uiState.editingWorkspaceResourceId = resource.id;
  elements.workspaceResourceType.value = resource.type || "file";
  elements.workspaceResourceLabel.value = resource.label || "";
  elements.workspaceResourceTarget.value = resource.target || "";
  elements.workspaceResourceNotes.value = resource.notes || "";
  elements.workspaceResourceLabel?.focus();
  elements.workspaceResourceLabel?.select();
  renderWorkspaceFormActions();
}

function hideWorkspaceContextMenu() {
  workspaceContextClientId = null;
  elements.workspaceContextMenu?.classList.add("hidden");
}

function hideWorkspaceMediaContextMenu() {
  workspaceMediaContextResource = null;
  elements.workspaceMediaContextMenu?.classList.add("hidden");
}

function showWorkspaceMediaContextMenu(resource, anchorX, anchorY) {
  const menu = elements.workspaceMediaContextMenu;
  if (!menu || !resource) {
    return;
  }

  workspaceMediaContextResource = resource;
  menu.innerHTML = "";

  const actions = [
    {
      label: "Copy media",
      run: async () => {
        const result = await window.desktopAPI.copyWorkspaceMedia(resource.target);
        setStatus(result?.message || "Copied media.");
      }
    },
    {
      label: "Open with",
      run: async () => {
        const result = await window.desktopAPI.openWorkspaceMediaWith(resource.target);
        if (result?.message) {
          setStatus(result.message);
        }
      }
    }
  ];

  actions.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", async () => {
      hideWorkspaceMediaContextMenu();
      try {
        await action.run();
      } catch (error) {
        setStatus(error?.message || "Workspace media action failed.");
      }
    });
    menu.appendChild(button);
  });

  menu.classList.remove("hidden");
  menu.style.left = `${anchorX}px`;
  menu.style.top = `${anchorY}px`;
}

function focusWorkspaceClientNameField() {
  window.setTimeout(() => {
    elements.workspaceClientName?.focus();
    elements.workspaceClientName?.select();
  }, 0);
}

function duplicateWorkspaceClient(client) {
  if (!client) {
    return;
  }

  const eventIdMap = new Map();
  const resourceIdMap = new Map();
  const notePageIdMap = new Map();
  const duplicatedEvents = (client.events || []).map((event) => {
    const id = `event-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    eventIdMap.set(event.id, id);
    return {
      ...event,
      id
    };
  });
  const duplicatedResources = (client.resources || []).map((resource) => {
    const id = `resource-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    resourceIdMap.set(resource.id, id);
    return {
      ...resource,
      id
    };
  });
  const duplicatedNotePages = ensureWorkspaceNotePages(client).map((page) => {
    const id = `note-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    notePageIdMap.set(page.id, id);
    return {
      ...page,
      id
    };
  });

  const copy = {
    ...client,
    id: `client-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    clientName: `${client.clientName || "Client"} Copy`,
    notePages: duplicatedNotePages,
    selectedNotePageId: notePageIdMap.get(client.selectedNotePageId) || duplicatedNotePages[0]?.id || "",
    todos: (client.todos || []).map((todo) => ({
      ...todo,
      id: `todo-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      eventId: eventIdMap.get(todo.eventId) || "",
      resourceId: resourceIdMap.get(todo.resourceId) || ""
    })),
    events: duplicatedEvents,
    resources: duplicatedResources,
    updatedAt: Date.now()
  };
  state.workspaceClients.unshift(copy);
  state.selectedWorkspaceClientId = copy.id;
  saveWorkspaceClients();
  renderWorkspace();
}

function deleteWorkspaceClient(clientId) {
  const client = getWorkspaceClientById(clientId);
  if (!client) {
    return;
  }

  state.workspaceClients = state.workspaceClients.filter((entry) => entry.id !== clientId);
  if (state.selectedWorkspaceClientId === clientId) {
    state.selectedWorkspaceClientId = state.workspaceClients[0]?.id || null;
    resetWorkspaceTodoForm();
    resetWorkspaceEventForm();
    resetWorkspaceResourceForm();
  }
  saveWorkspaceClients();
  renderWorkspace();
}

function showWorkspaceContextMenu(clientId, anchorX, anchorY) {
  const menu = elements.workspaceContextMenu;
  const client = getWorkspaceClientById(clientId);
  if (!menu || !client) {
    return;
  }

  workspaceContextClientId = clientId;
  menu.innerHTML = "";

  const actions = [
    {
      label: "Open",
      run: () => {
        state.selectedWorkspaceClientId = clientId;
        saveWorkspaceClients();
        showScreen("workspace");
        renderWorkspace();
      }
    },
    {
      label: "Duplicate",
      run: () => duplicateWorkspaceClient(client)
    },
    {
      label: "Rename",
      run: () => {
        state.selectedWorkspaceClientId = clientId;
        saveWorkspaceClients();
        showScreen("workspace");
        renderWorkspace();
        focusWorkspaceClientNameField();
      }
    },
    {
      label: "Delete",
      run: () => deleteWorkspaceClient(clientId)
    }
  ];

  actions.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      hideWorkspaceContextMenu();
      action.run();
    });
    menu.appendChild(button);
  });

  menu.classList.remove("hidden");
  menu.style.left = `${anchorX}px`;
  menu.style.top = `${anchorY}px`;
}

function sortWorkspaceEvents(events) {
  return [...events].sort((left, right) => {
    const leftDate = String(left?.date || "");
    const rightDate = String(right?.date || "");
    return leftDate.localeCompare(rightDate);
  });
}

function formatWorkspaceTimestamp(value) {
  if (!value) {
    return "Created just now";
  }
  return `Created ${new Date(value).toLocaleString()}`;
}

function applyWorkspaceMarkdownInline(text) {
  return String(text || "")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_, alt, src, title) => {
      const safeSrc = escapeHtml(src);
      const safeAlt = escapeHtml(alt);
      const safeTitle = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${safeSrc}" alt="${safeAlt}"${safeTitle}>`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_, label, href, title) => {
      const safeHref = escapeHtml(href);
      const safeTitle = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${safeHref}" target="_blank" rel="noreferrer noopener"${safeTitle}>${label}</a>`;
    })
    .replace(/\$([^$\n]+)\$/g, "<code>$1</code>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

function renderWorkspaceMarkdownToHtml(source) {
  const text = String(source || "").replace(/\r\n?/g, "\n");
  if (!text.trim()) {
    return `<p>Nothing to preview yet.</p>`;
  }

  const tokenStore = [];
  const tokenizeBlock = (markup) => {
    const token = `@@BLOCK_${tokenStore.length}@@`;
    tokenStore.push(markup);
    return token;
  };

  const tokenized = text
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => tokenizeBlock(`<pre><code>${escapeHtml(String(math || "").trim())}</code></pre>`))
    .replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, language, code) => (
      tokenizeBlock(
        `<pre><code${language ? ` data-language="${escapeHtml(language)}"` : ""}>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`
      )
    ));

  const lines = tokenized.split("\n");

  function isBlank(line) {
    return !String(line || "").trim();
  }

  function isTokenLine(line) {
    return /^@@BLOCK_\d+@@$/.test(String(line || "").trim());
  }

  function renderTokenLine(line) {
    return String(line || "").trim().replace(/@@BLOCK_(\d+)@@/g, (_, index) => tokenStore[Number(index)] || "");
  }

  function renderParagraph(blockLines) {
    const paragraph = blockLines
      .map((line) => applyWorkspaceMarkdownInline(escapeHtml(line.trimEnd())))
      .join("<br>");
    return `<p>${paragraph}</p>`;
  }

  function isTableSeparator(line) {
    return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
  }

  function splitTableRow(line) {
    return String(line || "")
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
  }

  function renderTable(headerLine, bodyLines) {
    const headers = splitTableRow(headerLine);
    const rows = bodyLines.map((line) => splitTableRow(line));
    return `
      <table>
        <thead>
          <tr>${headers.map((cell) => `<th>${applyWorkspaceMarkdownInline(escapeHtml(cell))}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `<tr>${headers.map((_, index) => `<td>${applyWorkspaceMarkdownInline(escapeHtml(row[index] || ""))}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    `;
  }

  function renderList(lineSet, startIndex, ordered) {
    const items = [];
    let index = startIndex;
    const itemPattern = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;

    while (index < lineSet.length) {
      const match = lineSet[index].match(itemPattern);
      if (!match) {
        break;
      }

      const itemLines = [match[1]];
      index += 1;
      while (index < lineSet.length) {
        const nextLine = lineSet[index];
        if (isBlank(nextLine)) {
          itemLines.push("");
          index += 1;
          continue;
        }
        if (itemPattern.test(nextLine)) {
          break;
        }
        if (/^\s{2,}|^\t|^>/.test(nextLine)) {
          itemLines.push(nextLine.replace(/^\s{1,4}/, ""));
          index += 1;
          continue;
        }
        break;
      }

      items.push(itemLines.join("\n").trim());
    }

    const tag = ordered ? "ol" : "ul";
    return {
      html: `<${tag}>${items.map((item) => `<li>${renderBlocks(item.split("\n"))}</li>`).join("")}</${tag}>`,
      nextIndex: index
    };
  }

  function renderBlocks(blockLines) {
    const parts = [];
    for (let index = 0; index < blockLines.length;) {
      const line = blockLines[index];
      if (isBlank(line)) {
        index += 1;
        continue;
      }

      if (isTokenLine(line)) {
        parts.push(renderTokenLine(line));
        index += 1;
        continue;
      }

      if (/^#{1,6}\s+/.test(line)) {
        const [, hashes, content] = line.match(/^(#{1,6})\s+([\s\S]+)$/) || [];
        parts.push(`<h${hashes.length}>${applyWorkspaceMarkdownInline(escapeHtml(content || ""))}</h${hashes.length}>`);
        index += 1;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
        parts.push("<hr>");
        index += 1;
        continue;
      }

      if (index + 1 < blockLines.length && /\|/.test(line) && isTableSeparator(blockLines[index + 1])) {
        const body = [];
        index += 2;
        while (index < blockLines.length && /\|/.test(blockLines[index]) && !isBlank(blockLines[index])) {
          body.push(blockLines[index]);
          index += 1;
        }
        parts.push(renderTable(line, body));
        continue;
      }

      if (/^\s*>/.test(line)) {
        const quoteLines = [];
        while (index < blockLines.length && (/^\s*>/.test(blockLines[index]) || isBlank(blockLines[index]))) {
          quoteLines.push(blockLines[index].replace(/^\s*>\s?/, ""));
          index += 1;
        }
        parts.push(`<blockquote>${renderBlocks(quoteLines)}</blockquote>`);
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const result = renderList(blockLines, index, false);
        parts.push(result.html);
        index = result.nextIndex;
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        const result = renderList(blockLines, index, true);
        parts.push(result.html);
        index = result.nextIndex;
        continue;
      }

      if (/^\s*<[^>]+>/.test(line)) {
        const htmlLines = [line];
        index += 1;
        while (index < blockLines.length && !isBlank(blockLines[index])) {
          htmlLines.push(blockLines[index]);
          index += 1;
        }
        parts.push(htmlLines.join("\n"));
        continue;
      }

      const paragraphLines = [line];
      index += 1;
      while (index < blockLines.length) {
        const nextLine = blockLines[index];
        if (
          isBlank(nextLine)
          || isTokenLine(nextLine)
          || /^#{1,6}\s+/.test(nextLine)
          || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(nextLine.trim())
          || /^\s*>/.test(nextLine)
          || /^\s*[-*+]\s+/.test(nextLine)
          || /^\s*\d+\.\s+/.test(nextLine)
          || (/\|/.test(nextLine) && index + 1 < blockLines.length && isTableSeparator(blockLines[index + 1]))
        ) {
          break;
        }
        paragraphLines.push(nextLine);
        index += 1;
      }
      parts.push(renderParagraph(paragraphLines));
    }

    return parts.join("\n");
  }

  return renderBlocks(lines).replace(/@@BLOCK_(\d+)@@/g, (_, index) => tokenStore[Number(index)] || "");
}

function sanitizeWorkspaceNotesHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;

  const allowedTags = new Set([
    "A", "P", "BR", "STRONG", "EM", "DEL", "CODE", "PRE", "BLOCKQUOTE",
    "UL", "OL", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "HR",
    "IMG", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "DIV", "SPAN"
  ]);
  const allowedAttrs = {
    A: new Set(["href", "title", "target", "rel"]),
    IMG: new Set(["src", "alt", "title"]),
    CODE: new Set(["data-language"]),
    TH: new Set(["colspan", "rowspan"]),
    TD: new Set(["colspan", "rowspan"])
  };

  const sanitizeNode = (node) => {
    Array.from(node.children).forEach((child) => {
      const tag = child.tagName;
      if (!allowedTags.has(tag)) {
        child.replaceWith(...Array.from(child.childNodes));
        return;
      }

      Array.from(child.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const allowed = allowedAttrs[tag];
        if (!allowed || !allowed.has(attribute.name)) {
          child.removeAttribute(attribute.name);
          return;
        }
        if ((name === "href" || name === "src") && !/^(https?:|file:|data:image\/)/i.test(attribute.value)) {
          child.removeAttribute(attribute.name);
        }
      });

      if (tag === "A") {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noreferrer noopener");
      }

      sanitizeNode(child);
    });
  };

  sanitizeNode(template.content);
  return template.innerHTML;
}

function renderWorkspaceNotesPanel(client) {
  const hasClient = Boolean(client);
  const selectedPage = client ? getSelectedWorkspaceNotePage(client) : null;
  const notesValue = selectedPage?.content || "";

  if (elements.workspaceNotes) {
    elements.workspaceNotes.value = notesValue;
  }
  if (elements.workspaceNotesPageTitle) {
    elements.workspaceNotesPageTitle.value = selectedPage?.title || "";
  }
  if (elements.workspaceNotesPageSelect) {
    elements.workspaceNotesPageSelect.innerHTML = "";
    if (client) {
      ensureWorkspaceNotePages(client).forEach((page) => {
        const option = document.createElement("option");
        option.value = page.id;
        option.textContent = page.title || "Untitled page";
        elements.workspaceNotesPageSelect.appendChild(option);
      });
      elements.workspaceNotesPageSelect.value = selectedPage?.id || "";
    }
  }

  if (elements.workspaceNotesEditButton) {
    elements.workspaceNotesEditButton.classList.toggle("primary-button", uiState.workspaceNotesMode === "edit");
  }
  if (elements.workspaceNotesPreviewButton) {
    elements.workspaceNotesPreviewButton.classList.toggle("primary-button", uiState.workspaceNotesMode === "preview");
  }

  const showPreview = hasClient && uiState.workspaceNotesMode === "preview";
  elements.workspaceNotesEditorShell?.classList.toggle("hidden", showPreview);
  elements.workspaceNotesPreview?.classList.toggle("hidden", !showPreview);
  if (elements.workspaceAddNotesPageButton) {
    elements.workspaceAddNotesPageButton.disabled = !hasClient;
  }
  if (elements.workspaceDeleteNotesPageButton) {
    elements.workspaceDeleteNotesPageButton.disabled = !hasClient;
  }
  if (elements.workspaceNotesPageSelect) {
    elements.workspaceNotesPageSelect.disabled = !hasClient;
  }
  if (elements.workspaceNotesPageTitle) {
    elements.workspaceNotesPageTitle.disabled = !hasClient;
  }

  if (elements.workspaceNotesPreview) {
    elements.workspaceNotesPreview.innerHTML = sanitizeWorkspaceNotesHtml(renderWorkspaceMarkdownToHtml(notesValue));
  }
}

function inferWorkspaceResourceTypeFromTarget(target) {
  const value = String(target || "").trim().toLowerCase();
  if (!value) {
    return "";
  }
  if (/docs\.google\.com\/spreadsheets/.test(value)) {
    return "google-sheet";
  }
  if (/\.(xlsx|xls|csv)(?:[\?#].*)?$/.test(value)) {
    return "excel";
  }
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|avif)(?:[\?#].*)?$/.test(value)) {
    return "image";
  }
  if (/\.(mp4|webm|mp3|wav|m4a|ogg|mov)(?:[\?#].*)?$/.test(value)) {
    return "media";
  }
  if (/^https?:\/\//.test(value)) {
    return "site";
  }
  return "file";
}

function getWorkspaceResourceDisplayType(resource) {
  const inferredType = inferWorkspaceResourceTypeFromTarget(resource?.target || "");
  if (inferredType === "image" || inferredType === "media") {
    return inferredType;
  }

  const explicitType = String(resource?.type || "").trim();
  if (explicitType) {
    return explicitType;
  }

  return inferredType;
}

function isWorkspaceUrlTarget(target) {
  return /^https?:\/\//i.test(String(target || "").trim());
}

function toWorkspaceTargetUrl(target) {
  const raw = String(target || "").trim();
  if (!raw) {
    return "";
  }
  if (isWorkspaceUrlTarget(raw) || /^file:\/\//i.test(raw)) {
    return raw;
  }
  return `file:///${raw.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

function isWorkspaceImageResource(resource) {
  return getWorkspaceResourceDisplayType(resource) === "image";
}

function isWorkspaceMediaResource(resource) {
  return getWorkspaceResourceDisplayType(resource) === "media";
}

function renderWorkspaceTodoEventOptions(client) {
  const select = elements.workspaceTodoEventLink;
  if (!select) {
    return;
  }

  select.innerHTML = `<option value="">Link deadline to calendar event</option>`;
  if (!client) {
    select.disabled = true;
    return;
  }

  sortWorkspaceEvents(client.events || []).forEach((event) => {
    const option = document.createElement("option");
    option.value = event.id;
    option.textContent = `${event.title} (${event.date || "No date"})`;
    select.appendChild(option);
  });
  select.disabled = false;
}

function renderWorkspaceTodoResourceOptions(client) {
  const select = elements.workspaceTodoResourceLink;
  if (!select) {
    return;
  }

  select.innerHTML = `<option value="">Attach resource to task</option>`;
  if (!client) {
    select.disabled = true;
    return;
  }

  (client.resources || []).forEach((resource) => {
    const option = document.createElement("option");
    option.value = resource.id;
    option.textContent = resource.label || resource.target || "Untitled resource";
    select.appendChild(option);
  });
  select.disabled = false;
}

function renderWorkspaceClients() {
  if (!elements.workspaceClientList) {
    return;
  }

  elements.workspaceClientList.innerHTML = "";
  if (!state.workspaceClients.length) {
    const empty = document.createElement("div");
    empty.className = "workspace-empty";
    empty.textContent = "Create a client workspace to track tasks, notes, and deadlines.";
    elements.workspaceClientList.appendChild(empty);
    return;
  }

  state.workspaceClients.forEach((client) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `workspace-client-item${client.id === state.selectedWorkspaceClientId ? " active" : ""}`;
    button.innerHTML = `
      <strong>${escapeHtml(client.clientName || "Untitled client")}</strong>
      <span>${escapeHtml(client.projectName || client.stage || "No project details yet")}</span>
    `;
    button.addEventListener("click", () => {
      state.selectedWorkspaceClientId = client.id;
      saveWorkspaceClients();
      hideWorkspaceContextMenu();
      renderWorkspace();
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      state.selectedWorkspaceClientId = client.id;
      saveWorkspaceClients();
      renderWorkspace();
      showWorkspaceContextMenu(client.id, event.clientX, event.clientY);
    });
    elements.workspaceClientList.appendChild(button);
  });
}

function renderWorkspaceTodoList(client) {
  const list = elements.workspaceTodoList;
  if (!list) {
    return;
  }

  list.innerHTML = "";
  if (!client) {
    list.innerHTML = `<div class="workspace-empty">Select a client to manage tasks.</div>`;
    return;
  }
  if (!client.todos.length) {
    list.innerHTML = `<div class="workspace-empty">No tasks yet for this client.</div>`;
    return;
  }

  client.todos.forEach((todo) => {
    const linkedEvent = (client.events || []).find((event) => event.id === todo.eventId);
    const linkedResource = (client.resources || []).find((resource) => resource.id === todo.resourceId);
    const deadlineLabel = linkedEvent?.date || todo.deadline || "No deadline";
    const eventLabel = linkedEvent?.title ? ` · ${linkedEvent.title}` : "";
    const resourceLabel = linkedResource?.label ? ` · Resource: ${linkedResource.label}` : "";
    const item = document.createElement("div");
    item.className = `workspace-task-item${todo.done ? " done" : ""}`;
    item.innerHTML = `
      <div class="workspace-item-copy">
        <strong>${escapeHtml(todo.text || "")}</strong>
        <span>${todo.done ? "Completed" : "Open task"} · ${escapeHtml(deadlineLabel)}${escapeHtml(eventLabel)}${escapeHtml(resourceLabel)}</span>
        <span>${escapeHtml(formatWorkspaceTimestamp(todo.createdAt))}</span>
      </div>
      <div class="workspace-item-actions">
        <button type="button" data-workspace-edit-todo="${todo.id}">Edit</button>
        <button type="button" data-workspace-toggle-todo="${todo.id}">${todo.done ? "Undo" : "Done"}</button>
        <button type="button" data-workspace-delete-todo="${todo.id}">Delete</button>
      </div>
    `;
    item.querySelector("[data-workspace-edit-todo]")?.addEventListener("click", () => {
      startEditingWorkspaceTodo(todo.id);
    });
    item.querySelector("[data-workspace-toggle-todo]")?.addEventListener("click", () => {
      todo.done = !todo.done;
      client.updatedAt = Date.now();
      saveWorkspaceClients();
      renderWorkspace();
    });
    item.querySelector("[data-workspace-delete-todo]")?.addEventListener("click", () => {
      client.todos = client.todos.filter((entry) => entry.id !== todo.id);
      if (uiState.editingWorkspaceTodoId === todo.id) {
        resetWorkspaceTodoForm();
      }
      client.updatedAt = Date.now();
      saveWorkspaceClients();
      renderWorkspace();
    });
    list.appendChild(item);
  });
}

function renderWorkspaceEventList(client) {
  const list = elements.workspaceEventList;
  if (!list) {
    return;
  }

  list.innerHTML = "";
  if (!client) {
    list.innerHTML = `<div class="workspace-empty">Select a client to manage the calendar.</div>`;
    return;
  }
  if (!client.events.length) {
    list.innerHTML = `<div class="workspace-empty">No deadlines or events yet.</div>`;
    return;
  }

  sortWorkspaceEvents(client.events).forEach((event) => {
    const item = document.createElement("div");
    item.className = "workspace-event-item";
    item.innerHTML = `
      <div class="workspace-item-copy">
        <strong>${escapeHtml(event.title || "")}</strong>
        <span>${escapeHtml(event.date || "No date")}</span>
      </div>
      <div class="workspace-item-actions">
        <button type="button" data-workspace-edit-event="${event.id}">Edit</button>
        <button type="button" data-workspace-delete-event="${event.id}">Delete</button>
      </div>
    `;
    item.querySelector("[data-workspace-edit-event]")?.addEventListener("click", () => {
      startEditingWorkspaceEvent(event.id);
    });
    item.querySelector("[data-workspace-delete-event]")?.addEventListener("click", () => {
      client.events = client.events.filter((entry) => entry.id !== event.id);
      client.todos = (client.todos || []).map((todo) => (
        todo.eventId === event.id
          ? { ...todo, eventId: "", deadline: "" }
          : todo
      ));
      if (uiState.editingWorkspaceEventId === event.id) {
        resetWorkspaceEventForm();
      }
      client.updatedAt = Date.now();
      saveWorkspaceClients();
      renderWorkspace();
    });
    list.appendChild(item);
  });
}

function renderWorkspaceResourceList(client) {
  const list = elements.workspaceResourceList;
  if (!list) {
    return;
  }

  list.innerHTML = "";
  if (!client) {
    list.innerHTML = `<div class="workspace-empty">Select a client to connect sheets, sites, files, and media.</div>`;
    return;
  }
  if (!client.resources?.length) {
    list.innerHTML = `<div class="workspace-empty">No connected resources yet.</div>`;
    return;
  }

  client.resources.forEach((resource) => {
    const targetUrl = toWorkspaceTargetUrl(resource.target);
    const item = document.createElement("div");
    item.className = "workspace-resource-item";
    const isPreviewableImage = isWorkspaceImageResource(resource);
    const isPreviewableVideo = isWorkspaceMediaResource(resource) && /\.(mp4|webm)$/i.test(String(resource.target || ""));
    const hasInlinePreview = isPreviewableImage || isPreviewableVideo;
    const previewMarkup = isPreviewableImage
      ? `<div class="workspace-resource-preview workspace-resource-preview-button" data-workspace-preview-resource="${resource.id}" role="button" tabindex="0" aria-label="Open ${escapeHtml(resource.label || "image")}">
          <img src="${escapeHtml(targetUrl)}" alt="${escapeHtml(resource.label || "Image attachment")}" />
        </div>`
      : isPreviewableVideo
        ? `<div class="workspace-resource-preview workspace-resource-preview-button" data-workspace-preview-resource="${resource.id}" role="button" tabindex="0" aria-label="Open ${escapeHtml(resource.label || "video")}">
            <video src="${escapeHtml(targetUrl)}" controls preload="metadata"></video>
          </div>`
        : "";
    item.innerHTML = `
      <div class="workspace-item-copy">
        <strong>${escapeHtml(resource.label || "Untitled resource")}</strong>
        <span>${escapeHtml(getWorkspaceResourceDisplayType(resource))} · ${escapeHtml(resource.target || "")}</span>
        ${resource.notes ? `<span>${escapeHtml(resource.notes)}</span>` : ""}
        ${previewMarkup}
      </div>
      <div class="workspace-item-actions">
        ${hasInlinePreview ? "" : `<button type="button" data-workspace-open-resource="${resource.id}">Open</button>`}
        <button type="button" data-workspace-edit-resource="${resource.id}">Edit</button>
        <button type="button" data-workspace-delete-resource="${resource.id}">Delete</button>
      </div>
    `;
    item.querySelector("[data-workspace-preview-resource]")?.addEventListener("click", () => {
      if (isPreviewableImage) {
        openWorkspaceImageModal(resource);
        return;
      }
      if (isWorkspaceUrlTarget(resource.target)) {
        openUrlInAppBrowser(resource.target);
        return;
      }
      void openExistingPath(resource.target, "Resource path was not found.");
    });
    item.querySelector("[data-workspace-preview-resource]")?.addEventListener("contextmenu", (event) => {
      if (!isPreviewableImage) {
        return;
      }
      event.preventDefault();
      showWorkspaceMediaContextMenu(resource, event.clientX, event.clientY);
    });
    item.querySelector("[data-workspace-preview-resource]")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      if (isPreviewableImage) {
        openWorkspaceImageModal(resource);
        return;
      }
      if (isWorkspaceUrlTarget(resource.target)) {
        openUrlInAppBrowser(resource.target);
        return;
      }
      void openExistingPath(resource.target, "Resource path was not found.");
    });
    item.querySelector("[data-workspace-open-resource]")?.addEventListener("click", () => {
      if (isWorkspaceUrlTarget(resource.target)) {
        openUrlInAppBrowser(resource.target);
        return;
      }
      void openExistingPath(resource.target, "Resource path was not found.");
    });
    item.querySelector("[data-workspace-edit-resource]")?.addEventListener("click", () => {
      startEditingWorkspaceResource(resource.id);
    });
    item.querySelector("[data-workspace-delete-resource]")?.addEventListener("click", () => {
      client.resources = (client.resources || []).filter((entry) => entry.id !== resource.id);
      client.todos = (client.todos || []).map((todo) => (
        todo.resourceId === resource.id
          ? { ...todo, resourceId: "" }
          : todo
      ));
      if (uiState.editingWorkspaceResourceId === resource.id) {
        resetWorkspaceResourceForm();
      }
      client.updatedAt = Date.now();
      saveWorkspaceClients();
      renderWorkspace();
    });
    list.appendChild(item);
  });
}

function renderWorkspaceFormActions() {
  if (elements.workspaceTodoFormState) {
    elements.workspaceTodoFormState.textContent = uiState.editingWorkspaceTodoId ? "Editing task" : "New task";
  }
  if (elements.workspaceAddTodoButton) {
    elements.workspaceAddTodoButton.textContent = uiState.editingWorkspaceTodoId ? "Save" : "Add";
  }
  if (elements.workspaceCancelTodoButton) {
    elements.workspaceCancelTodoButton.disabled = !getSelectedWorkspaceClient() || !uiState.editingWorkspaceTodoId;
  }

  if (elements.workspaceEventFormState) {
    elements.workspaceEventFormState.textContent = uiState.editingWorkspaceEventId ? "Editing event" : "New event";
  }
  if (elements.workspaceAddEventButton) {
    elements.workspaceAddEventButton.textContent = uiState.editingWorkspaceEventId ? "Save" : "Add";
  }
  if (elements.workspaceCancelEventButton) {
    elements.workspaceCancelEventButton.disabled = !getSelectedWorkspaceClient() || !uiState.editingWorkspaceEventId;
  }

  if (elements.workspaceResourceFormState) {
    elements.workspaceResourceFormState.textContent = uiState.editingWorkspaceResourceId ? "Editing resource" : "New resource";
  }
  if (elements.workspaceAddResourceButton) {
    elements.workspaceAddResourceButton.textContent = uiState.editingWorkspaceResourceId ? "Save" : "Attach";
  }
  if (elements.workspaceCancelResourceButton) {
    elements.workspaceCancelResourceButton.disabled = !getSelectedWorkspaceClient() || !uiState.editingWorkspaceResourceId;
  }
}

function renderWorkspace() {
  const client = getSelectedWorkspaceClient();
  hideWorkspaceContextMenu();
  renderWorkspaceClients();
  const hasClient = Boolean(client);
  [
    elements.workspaceClientName,
    elements.workspaceContactName,
    elements.workspaceProjectName,
    elements.workspaceProjectUrl,
    elements.workspaceProjectStage,
    elements.workspaceContactEmail,
    elements.workspaceContactPhone,
    elements.workspaceProjectRepo,
    elements.workspaceHosting,
    elements.workspaceAdminUrl,
    elements.workspacePriority,
    elements.workspaceTodoInput,
    elements.workspaceAddTodoButton,
    elements.workspaceTodoDeadline,
    elements.workspaceTodoEventLink,
    elements.workspaceTodoResourceLink,
    elements.workspaceEventTitle,
    elements.workspaceEventDate,
    elements.workspaceAddEventButton,
    elements.workspaceNotes,
    elements.workspaceNotesPageSelect,
    elements.workspaceNotesPageTitle,
    elements.workspaceAddNotesPageButton,
    elements.workspaceDeleteNotesPageButton,
    elements.workspaceNotesEditButton,
    elements.workspaceNotesPreviewButton,
    elements.workspaceResourceType,
    elements.workspaceResourceLabel,
    elements.workspaceResourceTarget,
    elements.workspaceResourceNotes,
    elements.workspacePickResourceButton,
    elements.workspaceAddResourceButton,
    elements.workspaceEditClientButton,
    elements.workspaceDuplicateClientButton,
    elements.workspaceDeleteClientButton,
    elements.workspaceClearNotesButton
  ].forEach((element) => {
    if (element) {
      element.disabled = !hasClient;
    }
  });

  if (!client) {
    elements.workspaceClientTitle.textContent = "Select a client";
    elements.workspaceClientSubtitle.textContent = "Track notes, to-dos, and deadlines for each WordPress client.";
    elements.workspaceClientName.value = "";
    elements.workspaceContactName.value = "";
    elements.workspaceProjectName.value = "";
    elements.workspaceProjectUrl.value = "";
    elements.workspaceProjectStage.value = "";
    elements.workspaceContactEmail.value = "";
    elements.workspaceContactPhone.value = "";
    elements.workspaceProjectRepo.value = "";
    elements.workspaceHosting.value = "";
    elements.workspaceAdminUrl.value = "";
    elements.workspacePriority.value = "";
    elements.workspaceTodoInput.value = "";
    elements.workspaceTodoDeadline.value = "";
    elements.workspaceTodoEventLink.value = "";
    elements.workspaceEventTitle.value = "";
    elements.workspaceEventDate.value = "";
    elements.workspaceTodoResourceLink.value = "";
    elements.workspaceResourceLabel.value = "";
    elements.workspaceResourceTarget.value = "";
    elements.workspaceResourceNotes.value = "";
    elements.workspaceResourceType.value = "google-sheet";
    resetWorkspaceTodoForm();
    resetWorkspaceEventForm();
    resetWorkspaceResourceForm();
    renderWorkspaceTodoEventOptions(null);
    renderWorkspaceTodoResourceOptions(null);
    renderWorkspaceTodoList(null);
    renderWorkspaceEventList(null);
    renderWorkspaceResourceList(null);
    renderWorkspaceNotesPanel(null);
    renderWorkspaceFormActions();
    return;
  }

  elements.workspaceClientTitle.textContent = client.clientName || "Untitled client";
  elements.workspaceClientSubtitle.textContent = client.projectName || client.stage || "Workspace ready for planning.";
  elements.workspaceClientName.value = client.clientName || "";
  elements.workspaceContactName.value = client.contactName || "";
  elements.workspaceProjectName.value = client.projectName || "";
  elements.workspaceProjectUrl.value = client.projectUrl || "";
  elements.workspaceProjectStage.value = client.stage || "";
  elements.workspaceContactEmail.value = client.contactEmail || "";
  elements.workspaceContactPhone.value = client.contactPhone || "";
  elements.workspaceProjectRepo.value = client.projectRepo || "";
  elements.workspaceHosting.value = client.hosting || "";
  elements.workspaceAdminUrl.value = client.adminUrl || "";
  elements.workspacePriority.value = client.priority || "";
  elements.workspaceResourceType.value = elements.workspaceResourceType.value || "google-sheet";
  renderWorkspaceTodoEventOptions(client);
  renderWorkspaceTodoResourceOptions(client);
  if (uiState.editingWorkspaceTodoId) {
    const editingTodo = (client.todos || []).find((todo) => todo.id === uiState.editingWorkspaceTodoId);
    if (!editingTodo) {
      resetWorkspaceTodoForm();
    }
  }
  if (uiState.editingWorkspaceEventId) {
    const editingEvent = (client.events || []).find((event) => event.id === uiState.editingWorkspaceEventId);
    if (!editingEvent) {
      resetWorkspaceEventForm();
    }
  }
  if (uiState.editingWorkspaceResourceId) {
    const editingResource = (client.resources || []).find((resource) => resource.id === uiState.editingWorkspaceResourceId);
    if (!editingResource) {
      resetWorkspaceResourceForm();
    }
  }
  renderWorkspaceTodoList(client);
  renderWorkspaceEventList(client);
  renderWorkspaceResourceList(client);
  renderWorkspaceNotesPanel(client);
  renderWorkspaceFormActions();
}

function updateSelectedWorkspaceClient(mutator) {
  const client = getSelectedWorkspaceClient();
  if (!client) {
    return;
  }

  mutator(client);
  client.updatedAt = Date.now();
  saveWorkspaceClients();
  renderWorkspace();
}

function loadWorkspaceState() {
  const clients = readBrowserToolPrefs(WORKSPACE_CLIENTS_KEY, []);
  state.workspaceClients = Array.isArray(clients) ? clients.map((client) => ({
    id: String(client?.id || `client-${Date.now()}`),
    clientName: String(client?.clientName || "").trim(),
    contactName: String(client?.contactName || "").trim(),
    projectName: String(client?.projectName || "").trim(),
    projectUrl: String(client?.projectUrl || "").trim(),
    stage: String(client?.stage || "").trim(),
    contactEmail: String(client?.contactEmail || "").trim(),
    contactPhone: String(client?.contactPhone || "").trim(),
    projectRepo: String(client?.projectRepo || "").trim(),
    hosting: String(client?.hosting || "").trim(),
    adminUrl: String(client?.adminUrl || "").trim(),
    priority: String(client?.priority || "").trim(),
    notes: String(client?.notes || ""),
    notePages: Array.isArray(client?.notePages) ? client.notePages.map((page) => ({
      id: String(page?.id || `note-${Date.now()}`),
      title: String(page?.title || "").trim() || "Notes",
      content: String(page?.content || "")
    })) : [],
    selectedNotePageId: String(client?.selectedNotePageId || ""),
    todos: Array.isArray(client?.todos) ? client.todos.map((todo) => ({
      id: String(todo?.id || `todo-${Date.now()}`),
      text: String(todo?.text || "").trim(),
      done: todo?.done === true,
      createdAt: Number(todo?.createdAt || Date.now()),
      deadline: String(todo?.deadline || "").trim(),
      eventId: String(todo?.eventId || "").trim(),
      resourceId: String(todo?.resourceId || "").trim()
    })).filter((todo) => todo.text) : [],
    events: Array.isArray(client?.events) ? client.events.map((event) => ({
      id: String(event?.id || `event-${Date.now()}`),
      title: String(event?.title || "").trim(),
      date: String(event?.date || "").trim()
    })).filter((event) => event.title) : [],
    resources: Array.isArray(client?.resources) ? client.resources.map((resource) => ({
      id: String(resource?.id || `resource-${Date.now()}`),
      type: String(resource?.type || "").trim(),
      label: String(resource?.label || "").trim(),
      target: String(resource?.target || "").trim(),
      notes: String(resource?.notes || "").trim(),
      createdAt: Number(resource?.createdAt || Date.now())
    })).filter((resource) => resource.target) : [],
    updatedAt: Number(client?.updatedAt || Date.now())
  })) : [];

  state.workspaceClients.forEach((client) => {
    ensureWorkspaceNotePages(client);
  });

  try {
    state.selectedWorkspaceClientId = window.localStorage.getItem(WORKSPACE_SELECTED_CLIENT_KEY) || "";
  } catch (_) {
    state.selectedWorkspaceClientId = "";
  }

  if (state.selectedWorkspaceClientId && !getSelectedWorkspaceClient()) {
    state.selectedWorkspaceClientId = "";
  }
  if (!state.selectedWorkspaceClientId && state.workspaceClients[0]) {
    state.selectedWorkspaceClientId = state.workspaceClients[0].id;
  }
  renderWorkspace();
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

function saveWorkspacePanelOrder() {
  writeBrowserToolPrefs(WORKSPACE_PANEL_ORDER_KEY, getWorkspacePanels().map((panel) => panel.dataset.workspacePanel));
}

function saveWorkspacePanelCollapseState() {
  const collapsed = Object.fromEntries(
    getWorkspacePanels().map((panel) => [panel.dataset.workspacePanel, panel.classList.contains("collapsed")])
  );
  writeBrowserToolPrefs(WORKSPACE_PANEL_COLLAPSE_KEY, collapsed);
}

function applyWorkspacePanelPrefs() {
  const grid = elements.workspaceGrid;
  if (!grid) {
    return;
  }

  const order = readBrowserToolPrefs(WORKSPACE_PANEL_ORDER_KEY, DEFAULT_WORKSPACE_PANEL_ORDER);
  const collapsed = readBrowserToolPrefs(WORKSPACE_PANEL_COLLAPSE_KEY, DEFAULT_WORKSPACE_PANEL_COLLAPSE);
  const panelMap = new Map(getWorkspacePanels().map((panel) => [panel.dataset.workspacePanel, panel]));

  order.forEach((id) => {
    const panel = panelMap.get(id);
    if (panel) {
      grid.appendChild(panel);
    }
  });

  getWorkspacePanels().forEach((panel) => {
    panel.classList.toggle("collapsed", Boolean(collapsed[panel.dataset.workspacePanel]));
  });
}

function toggleWorkspacePanel(panel) {
  panel.classList.toggle("collapsed");
  saveWorkspacePanelCollapseState();
}

function findWorkspacePanelDropTarget(pointerY, currentPanel) {
  const panels = getWorkspacePanels().filter((panel) => panel !== currentPanel);

  for (const panel of panels) {
    const rect = panel.getBoundingClientRect();
    if (pointerY < rect.top + rect.height / 2) {
      return { panel, position: "before" };
    }
  }

  return { panel: panels.at(-1) || null, position: "after" };
}

function initWorkspacePanels() {
  getWorkspacePanels().forEach((panel) => {
    const dragHandle = panel.querySelector(".workspace-panel-drag");
    panel.querySelector("[data-workspace-panel-toggle]")?.addEventListener("click", () => {
      toggleWorkspacePanel(panel);
    });

    dragHandle?.addEventListener("dragstart", (event) => {
      draggedWorkspacePanel = panel;
      panel.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", panel.dataset.workspacePanel || "");
      }
    });

    dragHandle?.addEventListener("dragend", () => {
      draggedWorkspacePanel?.classList.remove("dragging");
      draggedWorkspacePanel = null;
      saveWorkspacePanelOrder();
    });

    panel.addEventListener("dragover", (event) => {
      if (!draggedWorkspacePanel || draggedWorkspacePanel === panel) {
        return;
      }

      event.preventDefault();
      const target = findWorkspacePanelDropTarget(event.clientY, draggedWorkspacePanel);
      if (!target.panel) {
        return;
      }

      if (target.position === "before") {
        target.panel.before(draggedWorkspacePanel);
      } else {
        target.panel.after(draggedWorkspacePanel);
      }
    });

    panel.addEventListener("drop", (event) => {
      if (!draggedWorkspacePanel) {
        return;
      }

      event.preventDefault();
      saveWorkspacePanelOrder();
    });
  });

  applyWorkspacePanelPrefs();
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
    const favicon = String(tab.favicon || "").trim();
    const faviconMarkup = favicon
      ? `<img class="tab-favicon" src="${escapeHtml(favicon)}" alt="" />`
      : `<span class="tab-favicon tab-favicon-fallback" aria-hidden="true">${escapeHtml((tab.title || tab.url || "?").trim().charAt(0).toUpperCase() || "?")}</span>`;
    button.title = `${tab.title || tab.url}\n${getTabSessionInfoCopy(tab)}`;
    button.innerHTML = `
      <span class="tab-copy">
        ${faviconMarkup}
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
elements.closeWorkspaceImageModalButton?.addEventListener("click", closeWorkspaceImageModal);
elements.workspaceImageModal?.addEventListener("click", (event) => {
  if (event.target === elements.workspaceImageModal) {
    closeWorkspaceImageModal();
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
    || target.closest("#workspace-context-menu")
    || target.closest("#workspace-media-context-menu")
  )) {
    if (!target.closest(".extension-menu-shell")) {
      hideExtensionsMenuPopup();
    }
    return;
  }

  hideBookmarkFolderMenu();
  hideWorkspaceContextMenu();
  hideWorkspaceMediaContextMenu();
  hideExtensionsMenuPopup();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isBookmarkFolderMenuOpen()) {
    hideBookmarkFolderMenu();
  }
  if (event.key === "Escape") {
    closeWorkspaceImageModal();
  }
  if (event.key === "Escape") {
    hideWorkspaceContextMenu();
  }
  if (event.key === "Escape") {
    hideWorkspaceMediaContextMenu();
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
  loadWorkspaceState();
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
