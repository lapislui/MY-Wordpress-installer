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
  backups: [],
  selectedSiteId: null,
  workspaceClients: [],
  selectedWorkspaceClientId: null,
  isEditingAddress: false,
  localServerType: "xampp",
  localServerLabel: "XAMPP",
  htdocsPath: "",
  apacheRunning: false,
  serverPaths: null,
  xamppServiceStatus: null,
  // Cross-feature integration
  integration: {
    siteToProjectMap: {}, // Maps site ID to workspace project ID
    projectToSitesMap: {}, // Maps project ID to array of site IDs
    editorProjectContext: null, // Current project context in editor
    editorResourceContext: null, // Current resource context in editor
    lastVisitedScreen: "browser", // Track navigation history
    navigationStack: [] // For back/forward between screens
  }
};

const progressState = {
  creating: false,
  deleting: false,
  backingUp: false
};

const uiState = {
  sidebarCollapsed: false,
  rightSidebarCollapsed: false,
  browserFocusMode: false,
  bottomPanelScreen: null,
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
let currentlyOpenCodeFilePath = null;
let codeEditor = null;
let codeEditorLanguage = "plaintext";
let activeSftpConnectionId = null;
let activeSftpConnectionConfig = null;
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

const BROWSER_TOOL_CATEGORIES = {
  security_access: "Security & Access",
  navigation: "Navigation & Shortcuts",
  data_permissions: "Data & Permissions"
};

const DEFAULT_BROWSER_TOOL_CATEGORY_MAPPING = {
  credentials: "security_access",
  sessions: "security_access",
  bookmarks: "navigation",
  downloads: "data_permissions",
  permissions: "data_permissions"
};

function getBrowserToolCategoryMapping() {
  try {
    const saved = localStorage.getItem("wp-desktop.browser-tool-category-mapping");
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return { ...DEFAULT_BROWSER_TOOL_CATEGORY_MAPPING };
}

function saveBrowserToolCategoryMapping(mapping) {
  localStorage.setItem("wp-desktop.browser-tool-category-mapping", JSON.stringify(mapping));
}

function getBrowserToolCollapsedCategories() {
  try {
    const saved = localStorage.getItem("wp-desktop.browser-tool-category-collapse");
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return [];
}

function saveBrowserToolCollapsedCategories(collapsed) {
  localStorage.setItem("wp-desktop.browser-tool-category-collapse", JSON.stringify(collapsed));
}

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

function getLocalServerLabel() {
  return state.localServerLabel || "XAMPP";
}

function getDocumentRootLabel() {
  return state.serverPaths?.documentRootName || (state.localServerType === "laragon" ? "www" : "htdocs");
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

// ─────────────────────────────────────────────────────────────────
// ─── Cross-Feature Integration System ────────────────────────────
// ─────────────────────────────────────────────────────────────────

function initializeIntegrationMaps() {
  const stored = localStorage.getItem("wpdesktop.integration.maps");
  if (stored) {
    try {
      const maps = JSON.parse(stored);
      state.integration.siteToProjectMap = maps.siteToProject || {};
      state.integration.projectToSitesMap = maps.projectToSites || {};
    } catch (_) {}
  }
}

function saveIntegrationMaps() {
  const maps = {
    siteToProject: state.integration.siteToProjectMap,
    projectToSites: state.integration.projectToSitesMap
  };
  localStorage.setItem("wpdesktop.integration.maps", JSON.stringify(maps));
}

function linkSiteToProject(siteId, projectId) {
  state.integration.siteToProjectMap[siteId] = projectId;

  if (!state.integration.projectToSitesMap[projectId]) {
    state.integration.projectToSitesMap[projectId] = [];
  }
  if (!state.integration.projectToSitesMap[projectId].includes(siteId)) {
    state.integration.projectToSitesMap[projectId].push(siteId);
  }

  saveIntegrationMaps();
}

function unlinkSiteFromProject(siteId, projectId) {
  // Remove site from project's site list
  if (state.integration.projectToSitesMap[projectId]) {
    state.integration.projectToSitesMap[projectId] = state.integration.projectToSitesMap[projectId].filter(
      id => id !== siteId
    );

    // Clean up empty project entries
    if (state.integration.projectToSitesMap[projectId].length === 0) {
      delete state.integration.projectToSitesMap[projectId];
    }
  }

  // Remove site->project mapping
  delete state.integration.siteToProjectMap[siteId];

  saveIntegrationMaps();
}

function getSitesForProject(projectId) {
  return state.integration.projectToSitesMap[projectId] || [];
}

function getProjectForSite(siteId) {
  return state.integration.siteToProjectMap[siteId] || null;
}

function navigateToScreenWithContext(screenName, context = {}) {
  // Save current navigation state
  if (state.integration.lastVisitedScreen) {
    state.integration.navigationStack.push({
      screen: state.integration.lastVisitedScreen,
      context: { ...state.integration }
    });
  }
  
  state.integration.lastVisitedScreen = screenName;
  
  // Apply context to integration state
  if (context.projectId) {
    state.integration.editorProjectContext = context.projectId;
    state.selectedWorkspaceClientId = context.projectId;
  }
  if (context.resourceId) {
    state.integration.editorResourceContext = context.resourceId;
  }
  if (context.siteId) {
    state.selectedSiteId = context.siteId;
  }
  
  // Sync project with sites when switching context
  if (context.projectId) {
    syncProjectWithSites(context.projectId);
    renderSftpSiteSelect();
  }
  
  showScreen(screenName);
}

function autoLinkNewSitesToProject() {
  if (!state.selectedWorkspaceClientId || !state.sites.length) {
    return;
  }

  const projectId = state.selectedWorkspaceClientId;
  const linkedSites = getSitesForProject(projectId);

  state.sites.forEach((site) => {
    // Auto-link sites that aren't already linked to any project
    if (!state.integration.siteToProjectMap[site.id]) {
      linkSiteToProject(site.id, projectId);
    }
  });
}

function syncProjectWithSites(projectId) {
  // Ensure all linked sites still exist in state.sites
  const linkedSites = getSitesForProject(projectId);
  const stillExist = linkedSites.filter((siteId) => 
    state.sites.some((site) => site.id === siteId)
  );
  
  if (stillExist.length !== linkedSites.length) {
    state.integration.projectToSitesMap[projectId] = stillExist;
    saveIntegrationMaps();
  }
}

function getRelatedSitesForScreen(screenName) {
  if (screenName === "workspace" && state.selectedWorkspaceClientId) {
    return getSitesForProject(state.selectedWorkspaceClientId);
  }
  return [];
}

function getEditorContext() {
  if (!state.integration.editorProjectContext) {
    return null;
  }
  const project = state.workspaceClients.find(c => c.id === state.integration.editorProjectContext);
  return {
    projectId: state.integration.editorProjectContext,
    projectName: project?.name || "Unknown Project",
    resourceId: state.integration.editorResourceContext
  };
}

function linkEditorFileToWorkspaceResource(filePath, resourceId) {
  // Create a resource mapping that tracks which files are linked to which resources
  const mapping = {
    filePath: filePath,
    projectId: state.integration.editorProjectContext,
    resourceId: resourceId,
    timestamp: Date.now()
  };
  
  const fileResourceMaps = localStorage.getItem("wpdesktop.editor.fileResourceMaps");
  let maps = fileResourceMaps ? JSON.parse(fileResourceMaps) : [];
  
  // Remove old mapping for this file if exists
  maps = maps.filter(m => m.filePath !== filePath);
  maps.push(mapping);
  
  localStorage.setItem("wpdesktop.editor.fileResourceMaps", JSON.stringify(maps));
}

function getResourceForEditorFile(filePath) {
  const fileResourceMaps = localStorage.getItem("wpdesktop.editor.fileResourceMaps");
  if (!fileResourceMaps) return null;
  
  try {
    const maps = JSON.parse(fileResourceMaps);
    return maps.find(m => m.filePath === filePath) || null;
  } catch (_) {
    return null;
  }
}

function goBackToPreviousScreen() {
  if (state.integration.navigationStack.length > 0) {
    const previous = state.integration.navigationStack.pop();
    Object.assign(state.integration, previous.context);
    showScreen(previous.screen);
  }
}

function getScreenContextName(screenName) {
  const contextMap = {
    browser: "Browser",
    sftp: "File Transfer",
    editor: "Code Editor",
    installer: "WordPress Installer",
    workspace: "Workspace",
    settings: "Settings"
  };
  return contextMap[screenName] || screenName;
}

function generateQuickNavigationButtons() {
  const buttons = [];
  const currentScreen = uiState.bottomPanelScreen;
  
  // From Workspace -> SFTP
  if (currentScreen === "workspace" && state.selectedWorkspaceClientId) {
    const sites = getSitesForProject(state.selectedWorkspaceClientId);
    if (sites.length > 0) {
      buttons.push({
        label: `📁 Manage Files (${sites.length} site${sites.length !== 1 ? "s" : ""})`,
        action: () => navigateToScreenWithContext("sftp", { projectId: state.selectedWorkspaceClientId, siteId: sites[0] })
      });
    }
  }
  
  // From any tool -> Editor
  if (currentScreen && currentScreen !== "editor") {
    buttons.push({
      label: "📝 Code Editor",
      action: () => navigateToScreenWithContext("editor", { 
        projectId: state.integration.editorProjectContext || state.selectedWorkspaceClientId 
      })
    });
  }
  
  // From SFTP -> Workspace
  if (currentScreen === "sftp" && state.selectedWorkspaceClientId) {
    const project = state.workspaceClients.find(c => c.id === state.selectedWorkspaceClientId);
    if (project) {
      buttons.push({
        label: `💼 ${project.name}`,
        action: () => navigateToScreenWithContext("workspace", { projectId: state.selectedWorkspaceClientId })
      });
    }
  }
  
  return buttons;
}

function createQuickActionLinks() {
  const buttons = generateQuickNavigationButtons();
  if (buttons.length === 0) return "";
  
  return buttons.map((btn, idx) => 
    `<button class="quick-nav-button" data-quick-action="${idx}" style="margin-right: 8px; padding: 6px 12px; background: var(--accent-dim); border: 1px solid var(--accent); color: var(--accent); border-radius: 4px; cursor: pointer; font-size: 0.85rem;">${btn.label}</button>`
  ).join("");
}

// Register quick action button handlers
function initQuickNavigationHandlers() {
  document.addEventListener("click", (e) => {
    const button = e.target.closest("[data-quick-action]");
    if (button) {
      const idx = parseInt(button.dataset.quickAction);
      const buttons = generateQuickNavigationButtons();
      if (buttons[idx]) {
        buttons[idx].action();
      }
    }
  });
}

const elements = {
  appShell: document.getElementById("app-shell"),
  appSidebar: document.getElementById("app-sidebar"),
  appRightSidebar: document.getElementById("app-right-sidebar"),
  bottomPanel: document.getElementById("bottom-panel"),
  bottomPanelBody: document.getElementById("bottom-panel-body"),
  bottomPanelIcon: document.getElementById("bottom-panel-icon"),
  bottomPanelLabel: document.getElementById("bottom-panel-label"),
  bottomPanelCloseButton: document.getElementById("bottom-panel-close-button"),
  bottomPanelResizeHandle: document.getElementById("bottom-panel-resize-handle"),
  sidebarToggleButton: document.getElementById("sidebar-toggle-button"),
  rightSidebarToggleButton: document.getElementById("right-sidebar-toggle-button"),
  navButtons: document.querySelectorAll(".nav-button"),
  screens: document.querySelectorAll(".screen"),
  betaFeaturesSidebarWrapper: document.getElementById("beta-features-sidebar-wrapper"),
  settingsBetaEnabled: document.getElementById("settings-beta-enabled"),
  betaToolsCheckboxes: document.getElementById("beta-tools-checkboxes"),
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
  passwordSaveModal: document.getElementById("password-save-modal"),
  passwordSaveUsername: document.getElementById("password-save-username"),
  passwordSaveConfirmButton: document.getElementById("password-save-confirm-button"),
  passwordNeverSaveButton: document.getElementById("password-never-save-button"),
  closePasswordSaveButton: document.getElementById("close-password-save-button"),
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
  backupsCount: document.getElementById("backups-count"),
  backupsList: document.getElementById("backups-list"),
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
  sftpSiteSelect: document.getElementById("sftp-site-select"),
  sftpHost: document.getElementById("sftp-host"),
  sftpPort: document.getElementById("sftp-port"),
  sftpUsername: document.getElementById("sftp-username"),
  sftpAuthType: document.getElementById("sftp-auth-type"),
  sftpPassword: document.getElementById("sftp-password"),
  sftpKeyPath: document.getElementById("sftp-key-path"),
  sftpKeySelectButton: document.getElementById("sftp-key-select-button"),
  sftpRemoteDir: document.getElementById("sftp-remote-dir"),
  sftpSaveConfigButton: document.getElementById("sftp-save-config-button"),
  sftpTestConnectionButton: document.getElementById("sftp-test-connection-button"),
  sftpSelectedSiteSummary: document.getElementById("sftp-selected-site-summary"),
  sftpSubpath: document.getElementById("sftp-subpath"),
  sftpUploadButton: document.getElementById("sftp-upload-button"),
  sftpDownloadButton: document.getElementById("sftp-download-button"),
  sftpProgressStatus: document.getElementById("sftp-progress-status"),
  sftpProgressLines: document.getElementById("sftp-progress-lines"),
  sftpConfigStatus: document.getElementById("sftp-config-status"),
  codeEditorPath: document.getElementById("code-editor-path"),
  codeEditorOpenButton: document.getElementById("code-editor-open-button"),
  codeEditorSaveButton: document.getElementById("code-editor-save-button"),
  codeEditorSaveAsButton: document.getElementById("code-editor-save-as-button"),
  codeEditorStatus: document.getElementById("code-editor-status"),
  codeEditorMonaco: document.getElementById("code-editor-monaco"),
  codeEditorTextarea: document.getElementById("code-editor-textarea"),
  codeEditorRemotePath: document.getElementById("code-editor-remote-path"),
  codeEditorBrowseButton: document.getElementById("code-editor-browse-button"),
  codeEditorFileList: document.getElementById("code-editor-file-list"),
  codeEditorFileListContainer: document.getElementById("code-editor-file-list-container"),
  codeEditorRemoteStatus: document.getElementById("code-editor-remote-status"),
  detailDomain: document.getElementById("detail-domain"),
  detailSsl: document.getElementById("detail-ssl"),
  detailWebServer: document.getElementById("detail-web-server"),
  detailPhpVersion: document.getElementById("detail-php-version"),
  detailDbVersion: document.getElementById("detail-db-version"),
  detailWordpressVersion: document.getElementById("detail-wordpress-version"),
  overviewEmptyCard: document.getElementById("overview-empty-card"),
  localServerType: document.getElementById("local-server-type"),
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
  syncGoogleBtn: document.getElementById("sync-google-btn"),
  syncGoogleStatus: document.getElementById("sync-google-status"),
  syncMicrosoftBtn: document.getElementById("sync-microsoft-btn"),
  syncMicrosoftStatus: document.getElementById("sync-microsoft-status"),
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
  storeInstallForm: document.getElementById("store-install-form"),
  storeInstallInput: document.getElementById("store-install-input"),
  storeInstallSubmit: document.getElementById("store-install-submit"),
  storeInstallButton: document.getElementById("store-install-button"),
  updateStoreExtensionsButton: document.getElementById("update-store-extensions-button"),
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
  siteTabPanels: document.querySelectorAll(".site-tab-panel"),
  settingsMysqlMonaco: document.getElementById("settings-mysql-monaco"),
  workspaceNotesMonaco: document.getElementById("workspace-notes-monaco"),
  loadAppExtensionButton: document.getElementById("load-app-extension-button"),
  appExtensionsList: document.getElementById("app-extensions-list"),
  mcpStatusText: document.getElementById("mcp-status-text"),
  mcpToggleButton: document.getElementById("mcp-toggle-button"),
  mcpEndpointText: document.getElementById("mcp-endpoint-text"),
  mcpSessionsCount: document.getElementById("mcp-sessions-count"),
  mcpErrorItem: document.getElementById("mcp-error-item"),
  mcpErrorText: document.getElementById("mcp-error-text"),
  mcpHost: document.getElementById("mcp-host"),
  mcpPort: document.getElementById("mcp-port"),
  mcpSaveConfigButton: document.getElementById("mcp-save-config-button"),
  mcpConfigStatus: document.getElementById("mcp-config-status")
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
  elements.appShell.classList.toggle("right-sidebar-collapsed", uiState.rightSidebarCollapsed);
  elements.appShell.classList.toggle("browser-focus-mode", uiState.browserFocusMode);
  elements.sidebarToggleButton.setAttribute("aria-label", uiState.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
  elements.sidebarToggleButton.querySelector(".sidebar-toggle-glyph").textContent = uiState.sidebarCollapsed ? ">>" : "<<";
  elements.rightSidebarToggleButton?.setAttribute("aria-label", uiState.rightSidebarCollapsed ? "Expand right sidebar" : "Collapse right sidebar");
  const rightGlyph = elements.rightSidebarToggleButton?.querySelector(".right-sidebar-toggle-glyph");
  if (rightGlyph) {
    rightGlyph.textContent = uiState.rightSidebarCollapsed ? "<<" : ">>";
  }
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

function toggleRightSidebar() {
  uiState.rightSidebarCollapsed = !uiState.rightSidebarCollapsed;
  localStorage.setItem("wpdesktop.rightSidebarCollapsed", uiState.rightSidebarCollapsed ? "1" : "0");
  renderSidebarState();
}

function toggleBrowserFocusMode(forceValue) {
  uiState.browserFocusMode = typeof forceValue === "boolean" ? forceValue : !uiState.browserFocusMode;
  if (uiState.browserFocusMode && state.vaultOpen) {
    state.vaultOpen = false;
    renderVaultPanel();
  }
  if (uiState.browserFocusMode) {
    closeBottomPanel();
  }
  renderSidebarState();
}

function getScreenNavigationMeta(screenName) {
  const button = document.querySelector(`[data-screen="${screenName}"]`);
  const label = button?.querySelector(".nav-button-label")?.textContent?.trim() || screenName;
  const short = button?.querySelector(".nav-button-short")?.textContent?.trim() || "▣";
  return { label: label.replace(short, "").trim() || label, short };
}

function getBottomPanelHeightBounds() {
  const viewportHeight = window.innerHeight || 720;
  return {
    min: Math.min(280, Math.max(180, viewportHeight - 220)),
    max: Math.max(320, Math.floor(viewportHeight * 0.82))
  };
}

function applyBottomPanelHeight(nextHeight, persist = true) {
  if (!elements.bottomPanel) return;

  const bounds = getBottomPanelHeightBounds();
  const height = Math.min(bounds.max, Math.max(bounds.min, Number(nextHeight) || 0));
  elements.bottomPanel.style.height = `${height}px`;

  if (persist) {
    localStorage.setItem("wpdesktop.bottomPanelHeight", String(height));
  }

  if (uiState.bottomPanelScreen === "editor" && codeEditor) {
    setTimeout(() => codeEditor.layout(), 40);
  }
}

function restoreBottomPanelHeight() {
  const savedHeight = Number(localStorage.getItem("wpdesktop.bottomPanelHeight"));
  if (savedHeight) {
    applyBottomPanelHeight(savedHeight, false);
  }
}

function initBottomPanelResize() {
  const handle = elements.bottomPanelResizeHandle;
  if (!handle || !elements.bottomPanel) return;

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = elements.bottomPanel.getBoundingClientRect().height;
    handle.setPointerCapture?.(event.pointerId);
    document.body.classList.add("bottom-panel-resizing");

    const onPointerMove = (moveEvent) => {
      const delta = startY - moveEvent.clientY;
      applyBottomPanelHeight(startHeight + delta, false);
    };

    const onPointerUp = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.body.classList.remove("bottom-panel-resizing");
      const finalHeight = elements.bottomPanel.getBoundingClientRect().height;
      applyBottomPanelHeight(finalHeight, true);
      syncBrowserLayoutSoon();
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  });

  window.addEventListener("resize", () => {
    if (!elements.bottomPanel.classList.contains("hidden")) {
      const currentHeight = elements.bottomPanel.getBoundingClientRect().height;
      applyBottomPanelHeight(currentHeight, false);
    }
  });
}

function openBottomPanel(screenName) {
  const screen = document.getElementById(`${screenName}-screen`);
  if (!screen || !elements.bottomPanel || !elements.bottomPanelBody) {
    return;
  }

  const { label, short } = getScreenNavigationMeta(screenName);
  uiState.bottomPanelScreen = screenName;
  
  // Update panel header with context
  let contextLabel = label;
  let contextIcon = short;
  
  if (screenName === "editor" && state.integration.editorProjectContext) {
    const project = state.workspaceClients.find(c => c.id === state.integration.editorProjectContext);
    if (project) {
      contextLabel = `${label} • ${project.name}`;
    }
  }
  
  if (screenName === "sftp" && state.selectedWorkspaceClientId) {
    const project = state.workspaceClients.find(c => c.id === state.selectedWorkspaceClientId);
    if (project) {
      contextLabel = `${label} • ${project.name}`;
    }
  }
  
  elements.bottomPanelIcon.textContent = contextIcon;
  elements.bottomPanelLabel.textContent = contextLabel;
  elements.bottomPanelBody.appendChild(screen);
  restoreBottomPanelHeight();
  elements.bottomPanel.classList.remove("hidden");
  elements.appShell.classList.add("bottom-panel-open");
  screen.classList.add("active", "bottom-panel-screen");

  if (screenName === "editor" && codeEditor) {
    setTimeout(() => codeEditor.layout(), 80);
  }
}

function closeBottomPanel() {
  if (uiState.bottomPanelScreen) {
    const screen = document.getElementById(`${uiState.bottomPanelScreen}-screen`);
    screen?.classList.remove("active", "bottom-panel-screen");
  }

  uiState.bottomPanelScreen = null;
  elements.bottomPanel?.classList.add("hidden");
  elements.appShell?.classList.remove("bottom-panel-open");

  elements.navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.screen === "browser");
  });

  const browserScreen = document.getElementById("browser-screen");
  browserScreen?.classList.add("active");
  syncBrowserLayoutSoon();
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

  if (screenName === "editor" && codeEditor) {
    setTimeout(() => codeEditor.layout(), 50);
  }

  syncBrowserLayoutSoon();
}

function getSelectedSftpSite() {
  if (!elements.sftpSiteSelect) {
    return getSelectedSite();
  }

  const selectedId = elements.sftpSiteSelect.value || state.selectedSiteId;
  return state.sites.find((site) => site.id === selectedId) || getSelectedSite();
}

function renderSftpSiteSelect() {
  if (!elements.sftpSiteSelect) {
    return;
  }

  elements.sftpSiteSelect.innerHTML = "";
  if (!state.sites.length) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No local sites available";
    elements.sftpSiteSelect.appendChild(emptyOption);
    elements.sftpSiteSelect.disabled = true;
    return;
  }

  state.sites.forEach((site) => {
    const option = document.createElement("option");
    option.value = site.id;
    option.textContent = site.name;
    if (site.id === state.selectedSiteId) {
      option.selected = true;
    }
    elements.sftpSiteSelect.appendChild(option);
  });

  if (!elements.sftpSiteSelect.value) {
    elements.sftpSiteSelect.value = state.selectedSiteId || state.sites[0]?.id || "";
  }

  elements.sftpSiteSelect.disabled = false;
}

function renderSftpConfig() {
  if (!elements.sftpHost) {
    return;
  }

  const site = getSelectedSftpSite();

  // Only update UI visibility and button states, don't clear user-entered fields
  const isReady = Boolean(elements.sftpHost.value.trim() && elements.sftpUsername.value.trim());
  [elements.sftpUploadButton, elements.sftpDownloadButton].forEach((button) => {
    if (button) {
      button.disabled = !isReady || !site;
    }
  });

  if (elements.sftpConfigStatus) {
    if (site) {
      elements.sftpConfigStatus.textContent = `SFTP configured for: ${site.name}`;
    } else {
      elements.sftpConfigStatus.textContent = "Enter SFTP details above and test the connection.";
    }
  }

  const showPassword = elements.sftpAuthType.value === "password";
  if (elements.sftpPassword?.closest) {
    const passwordField = elements.sftpPassword.closest(".field");
    if (passwordField) {
      passwordField.style.display = showPassword ? "block" : "none";
    }
  }
  if (elements.sftpKeyPath?.closest) {
    const keyField = elements.sftpKeyPath.closest(".field");
    if (keyField) {
      keyField.style.display = showPassword ? "none" : "block";
    }
  }
}

function appendSftpProgressLine(line, isError = false) {
  if (!elements.sftpProgressLines) {
    return;
  }
  const item = document.createElement("li");
  item.textContent = String(line || "");
  if (isError) {
    item.style.color = "var(--danger-color)";
  }
  elements.sftpProgressLines.appendChild(item);
  while (elements.sftpProgressLines.children.length > 50) {
    elements.sftpProgressLines.removeChild(elements.sftpProgressLines.firstChild);
  }
  if (elements.sftpProgressLines.parentElement) {
    elements.sftpProgressLines.parentElement.scrollTop = elements.sftpProgressLines.parentElement.scrollHeight;
  }
}

function setCodeEditorStatus(message, isError = false) {
  if (!elements.codeEditorStatus) {
    return;
  }
  elements.codeEditorStatus.textContent = message;
  elements.codeEditorStatus.style.color = isError ? "var(--danger-color)" : "var(--text-dim)";
}

function getCodeEditorLanguageForPath(filePath) {
  const extension = String(filePath || "").split(".").pop().toLowerCase();
  switch (extension) {
    case "js": return "javascript";
    case "ts": return "typescript";
    case "jsx": return "javascript";
    case "tsx": return "typescript";
    case "json": return "json";
    case "css": return "css";
    case "scss": return "scss";
    case "html":
    case "htm": return "html";
    case "md":
    case "markdown": return "markdown";
    case "php": return "php";
    case "sql": return "sql";
    case "yaml":
    case "yml": return "yaml";
    case "xml": return "xml";
    case "py": return "python";
    case "sh": return "shell";
    default: return "plaintext";
  }
}

function setCodeEditorFilePath(filePath) {
  currentlyOpenCodeFilePath = filePath || null;
  if (elements.codeEditorPath) {
    elements.codeEditorPath.value = filePath || "";
  }
  if (filePath) {
    setCodeEditorStatus(`Ready to edit ${filePath}`);
    codeEditorLanguage = getCodeEditorLanguageForPath(filePath);
    if (codeEditor && window.monaco) {
      monaco.editor.setModelLanguage(codeEditor.getModel(), codeEditorLanguage);
    }
  } else {
    setCodeEditorStatus("Open a local file to begin editing.");
  }
}

function loadCodeEditorContent(content) {
  if (codeEditor) {
    codeEditor.setValue(content || "");
  }
  if (elements.codeEditorTextarea) {
    elements.codeEditorTextarea.value = content || "";
  }
}

function renderRemoteFileList(files, remotePath) {
  if (!elements.codeEditorFileList) {
    return;
  }
  
  elements.codeEditorFileList.innerHTML = "";
  
  // Add parent directory option if not root
  if (remotePath !== "/") {
    const parentPath = remotePath.split("/").slice(0, -1).join("/") || "/";
    const parentItem = document.createElement("li");
    parentItem.style.cursor = "pointer";
    parentItem.style.color = "var(--text-dim)";
    parentItem.textContent = ".. (parent directory)";
    parentItem.addEventListener("click", async () => {
      elements.codeEditorRemotePath.value = parentPath;
      elements.codeEditorBrowseButton.click();
    });
    elements.codeEditorFileList.appendChild(parentItem);
  }
  
  // Add files and directories
  (files || []).forEach(file => {
    const item = document.createElement("li");
    item.style.cursor = "pointer";
    item.style.paddingLeft = "20px";
    
    const prefix = file.type === "directory" ? "📁 " : "📄 ";
    const sizeStr = file.type === "directory" ? "" : ` (${(file.size / 1024).toFixed(1)}KB)`;
    item.textContent = `${prefix}${file.name}${sizeStr}`;
    
    if (file.type === "directory") {
      item.addEventListener("click", async () => {
        const newPath = remotePath === "/" ? `/${file.name}` : `${remotePath}/${file.name}`;
        elements.codeEditorRemotePath.value = newPath;
        elements.codeEditorBrowseButton.click();
      });
    } else {
      item.addEventListener("click", async () => {
        await loadRemoteFile(remotePath, file.name);
      });
    }
    
    elements.codeEditorFileList.appendChild(item);
  });
}

function loadRemoteFile(remotePath, fileName) {
  if (!activeSftpConnectionId) {
    setCodeEditorStatus("No active SFTP connection.", true);
    return;
  }

  const fullPath = remotePath === "/" ? `/${fileName}` : `${remotePath}/${fileName}`;
  
  setCodeEditorStatus(`Loading ${fullPath}...`);

  window.desktopAPI.readSftpFile(activeSftpConnectionId, fullPath)
    .then((content) => {
      setCodeEditorFilePath(fullPath);
      loadCodeEditorContent(content);
      setCodeEditorStatus(`Loaded ${fullPath}`);
    })
    .catch((error) => {
      setCodeEditorStatus(`Failed to load file: ${error.message}`, true);
    });
}

// ─── Sidebar Search Sort Filter (SSF) & Categories ───────────────────
const SIDEBAR_ITEMS = [
  // Core Development
  { screen: "terminal", label: "Terminal", short: "💻", category: "development" },
  { screen: "database", label: "Database", short: "🗄️", category: "development" },
  { screen: "git", label: "Git", short: "🌿", category: "development" },
  { screen: "wpcli", label: "WP-CLI", short: "⌨️", category: "development" },

  // Advanced MCP Tools
  { screen: "mcp", label: "MCP Status", short: "🔌", category: "mcp_tools" },
  { screen: "mcp_filesystem", label: "Filesystem MCP", short: "📁", category: "mcp_tools" },
  { screen: "mcp_github", label: "GitHub MCP", short: "🐙", category: "mcp_tools" },
  { screen: "mcp_postgres", label: "PostgreSQL MCP", short: "🐘", category: "mcp_tools" },
  { screen: "mcp_mysql", label: "MySQL MCP", short: "🐬", category: "mcp_tools" },
  { screen: "mcp_browser", label: "Browser Auto MCP", short: "🤖", category: "mcp_tools" },
  { screen: "mcp_slack", label: "Slack MCP", short: "💬", category: "mcp_tools" },
  { screen: "mcp_notion", label: "Notion MCP", short: "📓", category: "mcp_tools" },
  { screen: "mcp_gdrive", label: "Google Drive MCP", short: "☁️", category: "mcp_tools" },
  { screen: "mcp_cloudflare", label: "Cloudflare MCP", short: "⚡", category: "mcp_tools" },

  // DevOps & System
  { screen: "devops_docker", label: "Docker", short: "🐳", category: "devops" },
  { screen: "devops_compose", label: "Docker Compose", short: "🐙", category: "devops" },
  { screen: "devops_k8s", label: "Kubernetes", short: "☸️", category: "devops" },
  { screen: "devops_cicd", label: "CI/CD Runner", short: "🔄", category: "devops" },
  { screen: "deploy", label: "Deployment Mgr", short: "🚀", category: "devops" },
  { screen: "devops_monitor", label: "Server Monitor", short: "📈", category: "devops" },

  // Productivity
  { screen: "prod_notes", label: "Notes", short: "🗒️", category: "productivity" },
  { screen: "prod_kanban", label: "Kanban Board", short: "📋", category: "productivity" },
  { screen: "prod_time", label: "Time Tracking", short: "⏱️", category: "productivity" },
  { screen: "prod_docs", label: "Doc Viewer", short: "📚", category: "productivity" },
  { screen: "prod_vault", label: "Password Vault", short: "🔐", category: "productivity" },
  { screen: "prod_secrets", label: "Secrets Manager", short: "🔑", category: "productivity" },
  { screen: "backups", label: "Backups", short: "💾", category: "productivity" },

  // Collaboration
  { screen: "collab_chat", label: "Team Chat", short: "💬", category: "collaboration" },
  { screen: "meeting", label: "Video Meetings", short: "📞", category: "collaboration" },
  { screen: "collab_workspace", label: "Shared Workspace", short: "👥", category: "collaboration" },
  { screen: "collab_feed", label: "Activity Feed", short: "🔔", category: "collaboration" },
  { screen: "collab_permissions", label: "Site Permissions", short: "🛡️", category: "collaboration" },
  { screen: "ai", label: "AI Assistant", short: "🤖", category: "collaboration" }
];

const CUSTOM_CATEGORIES = {
  core: "Core Development",
  mcp_tools: "Advanced MCP Tools",
  devops: "DevOps & Systems",
  productivity: "Productivity",
  collaboration: "Collaboration"
};

const DEFAULT_CATEGORY_MAPPING = {
  browser: "core",
  editor: "core",
  terminal: "core",
  database: "core",
  git: "core",
  installer: "core",
  wpcli: "core",

  mcp: "mcp_tools",
  mcp_filesystem: "mcp_tools",
  mcp_github: "mcp_tools",
  mcp_postgres: "mcp_tools",
  mcp_mysql: "mcp_tools",
  mcp_browser: "mcp_tools",
  mcp_slack: "mcp_tools",
  mcp_notion: "mcp_tools",
  mcp_gdrive: "mcp_tools",
  mcp_cloudflare: "mcp_tools",

  devops_docker: "devops",
  devops_compose: "devops",
  devops_k8s: "devops",
  devops_cicd: "devops",
  deploy: "devops",
  devops_monitor: "devops",

  workspace: "productivity",
  prod_notes: "productivity",
  prod_kanban: "productivity",
  prod_time: "productivity",
  prod_docs: "productivity",
  prod_vault: "productivity",
  prod_secrets: "productivity",
  backups: "productivity",

  collab_chat: "collaboration",
  meeting: "collaboration",
  collab_workspace: "collaboration",
  collab_feed: "collaboration",
  collab_permissions: "collaboration",
  ai: "collaboration",
  settings: "collaboration"
};

const CATEGORY_LABELS = {
  development: "Dev Tools",
  mcp_tools: "MCP Tools",
  devops: "DevOps",
  productivity: "Productivity",
  collaboration: "Collaboration"
};

let ssfSearchQuery = "";
let ssfFilterCategory = "all";
let ssfSortBy = "custom"; // custom, name, category

function getBetaEnabled() {
  try {
    const saved = localStorage.getItem("wpdesktop.beta.enabled");
    return saved !== "0"; // default to true
  } catch (_) {
    return true;
  }
}

function setBetaEnabled(val) {
  try {
    localStorage.setItem("wpdesktop.beta.enabled", val ? "1" : "0");
  } catch (_) {}
  applyBetaFeaturesState();
}

// ─────────────────────────────────────────────────────────────────
// ─── Custom Categories & Filters CRUD System ─────────────────────
// ─────────────────────────────────────────────────────────────────

function getCustomCategories() {
  try {
    const saved = localStorage.getItem("wpdesktop.beta.custom-categories");
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return [];
}

function saveCustomCategories(categories) {
  localStorage.setItem("wpdesktop.beta.custom-categories", JSON.stringify(categories));
}

function addCustomCategory(name) {
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return null;
  }

  const categories = getCustomCategories();
  const id = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const category = {
    id,
    name: name.trim(),
    createdAt: Date.now(),
    toolIds: []
  };

  categories.push(category);
  saveCustomCategories(categories);
  return category;
}

function updateCustomCategory(categoryId, name) {
  if (!name || name.trim().length === 0) return false;

  const categories = getCustomCategories();
  const category = categories.find(c => c.id === categoryId);
  if (!category) return false;

  category.name = name.trim();
  saveCustomCategories(categories);
  return true;
}

function deleteCustomCategory(categoryId) {
  const categories = getCustomCategories();
  const filtered = categories.filter(c => c.id !== categoryId);
  saveCustomCategories(filtered);
  return true;
}

function assignToolToCategory(categoryId, toolId) {
  const categories = getCustomCategories();
  const category = categories.find(c => c.id === categoryId);
  if (!category) return false;

  if (!category.toolIds.includes(toolId)) {
    category.toolIds.push(toolId);
    saveCustomCategories(categories);
  }
  return true;
}

function unassignToolFromCategory(categoryId, toolId) {
  const categories = getCustomCategories();
  const category = categories.find(c => c.id === categoryId);
  if (!category) return false;

  category.toolIds = category.toolIds.filter(id => id !== toolId);
  saveCustomCategories(categories);
  return true;
}

function getToolsForCategory(categoryId) {
  const categories = getCustomCategories();
  const category = categories.find(c => c.id === categoryId);
  return category ? category.toolIds : [];
}

function getCategoriesForTool(toolId) {
  const categories = getCustomCategories();
  return categories.filter(c => c.toolIds.includes(toolId));
}

function getAllCategoryNames() {
  const builtin = Object.values(BROWSER_TOOL_CATEGORIES);
  const custom = getCustomCategories().map(c => c.name);
  return [...builtin, ...custom];
}

function renderCustomCategories() {
  const container = document.getElementById("beta-categories-list");
  if (!container) return;

  const categories = getCustomCategories();
  container.innerHTML = "";

  if (categories.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "color: var(--text-dim); font-size: 0.9rem; padding: 8px; text-align: center;";
    empty.textContent = "No custom categories yet. Create one above.";
    container.appendChild(empty);
    return;
  }

  categories.forEach(category => {
    const item = document.createElement("div");
    item.style.cssText = "display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 12px; background: var(--surface-2); border-radius: 4px; border: 1px solid var(--line);";
    
    const toolCount = category.toolIds.length;
    const assignedTools = category.toolIds
      .map(tid => SIDEBAR_ITEMS.find(s => s.screen === tid)?.label)
      .filter(Boolean)
      .join(", ");

    item.innerHTML = `
      <div style="min-width: 0;">
        <input type="text" class="beta-category-edit" data-category-id="${category.id}" value="${escapeHtml(category.name)}" style="width: 100%; padding: 4px 6px; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 3px; color: var(--text); font-size: 0.9rem; margin-bottom: 6px;">
        <div style="font-size: 0.85rem; color: var(--text-dim); line-height: 1.4;">
          ${toolCount > 0 
            ? `<strong>Tools:</strong> ${escapeHtml(assignedTools)}` 
            : '<em>No tools assigned yet</em>'}
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <button type="button" class="beta-category-save" data-category-id="${category.id}" style="padding: 4px 8px; background: var(--accent-dim); color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; cursor: pointer; font-size: 0.85rem; white-space: nowrap;">Save</button>
        <button type="button" class="beta-category-assign" data-category-id="${category.id}" style="padding: 4px 8px; background: var(--surface-3); color: var(--text); border: 1px solid var(--line); border-radius: 3px; cursor: pointer; font-size: 0.85rem; white-space: nowrap;">Assign Tools</button>
        <button type="button" class="beta-category-delete" data-category-id="${category.id}" style="padding: 4px 8px; background: var(--danger-bg); color: var(--danger-color); border: 1px solid var(--danger-border); border-radius: 3px; cursor: pointer; font-size: 0.85rem; white-space: nowrap;">Delete</button>
      </div>
    `;
    container.appendChild(item);
  });
}

function showCategoryToolAssignmentModal(categoryId) {
  const category = getCustomCategories().find(c => c.id === categoryId);
  if (!category) return;

  const allBetaTools = SIDEBAR_ITEMS.filter(item => {
    return !["browser", "sftp", "editor", "installer", "workspace", "settings"].includes(item.screen);
  });

  let html = `
    <div style="background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 16px; max-width: 500px; max-height: 80vh; overflow-y: auto;">
      <div style="margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px 0;">Assign Tools to "${escapeHtml(category.name)}"</h3>
        <p style="margin: 0; color: var(--text-dim); font-size: 0.9rem;">Select which beta tools should belong to this category.</p>
      </div>
      <div style="display: grid; gap: 8px; margin-bottom: 16px;">
  `;

  allBetaTools.forEach(tool => {
    const isAssigned = category.toolIds.includes(tool.screen);
    html += `
      <label style="display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--surface-2); border-radius: 4px; cursor: pointer;">
        <input type="checkbox" class="category-tool-checkbox" data-category-id="${categoryId}" data-tool-id="${tool.screen}" ${isAssigned ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer;">
        <span>${tool.short} ${tool.label}</span>
      </label>
    `;
  });

  html += `
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button type="button" class="category-modal-cancel" style="padding: 6px 12px; background: transparent; border: 1px solid var(--line); border-radius: 4px; cursor: pointer; color: var(--text);">Cancel</button>
        <button type="button" class="category-modal-confirm" style="padding: 6px 12px; background: var(--accent-dim); border: 1px solid var(--accent); border-radius: 4px; cursor: pointer; color: var(--accent);">Confirm</button>
      </div>
    </div>
  `;

  const backdrop = document.createElement("div");
  backdrop.style.cssText = "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;";
  backdrop.id = "category-assignment-modal";
  backdrop.innerHTML = html;
  document.body.appendChild(backdrop);

  // Handle checkboxes
  backdrop.querySelectorAll(".category-tool-checkbox").forEach(checkbox => {
    checkbox.addEventListener("change", (e) => {
      const cId = e.target.dataset.categoryId;
      const tId = e.target.dataset.toolId;
      if (e.target.checked) {
        assignToolToCategory(cId, tId);
      } else {
        unassignToolFromCategory(cId, tId);
      }
    });
  });

  // Handle buttons
  backdrop.querySelector(".category-modal-cancel").addEventListener("click", () => {
    backdrop.remove();
  });

  backdrop.querySelector(".category-modal-confirm").addEventListener("click", () => {
    backdrop.remove();
    renderCustomCategories();
    renderBetaFeaturesSettings();
  });

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
}

function initBetaCategoryManagement() {
  const addButton = document.getElementById("beta-category-add-button");
  const nameInput = document.getElementById("beta-category-name-input");
  const categoriesList = document.getElementById("beta-categories-list");

  if (!addButton || !nameInput || !categoriesList) return;

  addButton.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (name.length === 0) {
      return;
    }
    addCustomCategory(name);
    nameInput.value = "";
    renderCustomCategories();
    renderBetaFeaturesSettings();
  });

  nameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      addButton.click();
    }
  });

  categoriesList.addEventListener("click", (e) => {
    const deleteBtn = e.target.closest(".beta-category-delete");
    const saveBtn = e.target.closest(".beta-category-save");

  const assignBtn = e.target.closest(".beta-category-assign");

  if (deleteBtn) {
      const categoryId = deleteBtn.dataset.categoryId;
      if (confirm(`Delete category? This will not delete assigned tools.`)) {
        deleteCustomCategory(categoryId);
        renderCustomCategories();
        renderBetaFeaturesSettings();
      }
    }

    if (saveBtn) {
      const categoryId = saveBtn.dataset.categoryId;
      const input = categoriesList.querySelector(`[data-category-id="${categoryId}"]`);
      if (input) {
        const newName = input.value.trim();
        if (newName.length > 0) {
          updateCustomCategory(categoryId, newName);

              if (assignBtn) {
                const categoryId = assignBtn.dataset.categoryId;
                showCategoryToolAssignmentModal(categoryId);
              }
          renderCustomCategories();
          renderBetaFeaturesSettings();
        }
      }
    }
  });

  renderCustomCategories();
}

function getBetaDisabledTools() {
  try {
    const saved = localStorage.getItem("wpdesktop.beta.disabled-tools");
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return [];
}

function saveBetaDisabledTools(list) {
  try {
    localStorage.setItem("wpdesktop.beta.disabled-tools", JSON.stringify(list));
  } catch (_) {}
}

function isBetaToolEnabled(screen) {
  const disabled = getBetaDisabledTools();
  return !disabled.includes(screen);
}

function setBetaToolEnabled(screen, enabled) {
  let disabled = getBetaDisabledTools();
  if (enabled) {
    disabled = disabled.filter(s => s !== screen);
  } else {
    if (!disabled.includes(screen)) {
      disabled.push(screen);
    }
  }
  saveBetaDisabledTools(disabled);
  renderSidebar();
}

function applyBetaFeaturesState() {
  const isEnabled = getBetaEnabled();
  if (elements.betaFeaturesSidebarWrapper) {
    elements.betaFeaturesSidebarWrapper.style.display = "flex";
  }
  if (elements.settingsBetaEnabled) {
    elements.settingsBetaEnabled.checked = isEnabled;
  }
  renderSidebar();
}

function renderBetaFeaturesSettings() {
  if (!elements.settingsBetaEnabled || !elements.betaToolsCheckboxes) return;

  elements.settingsBetaEnabled.checked = getBetaEnabled();

  let html = "";
  const categories = {};
  const customCategories = getCustomCategories();
  
  SIDEBAR_ITEMS.forEach(item => {
    const isReleased = ["browser", "sftp", "editor", "installer", "workspace", "settings"].includes(item.screen);
    if (isReleased) return;

    if (!categories[item.category]) {
      categories[item.category] = [];
    }
    categories[item.category].push(item);
  });

  const disabledTools = getBetaDisabledTools();

  // Render built-in categories
  Object.entries(CATEGORY_LABELS).forEach(([catKey, catLabel]) => {
    const items = categories[catKey] || [];
    if (items.length === 0) return;

    html += `
      <div style="grid-column: 1 / -1; margin-top: 8px; font-size: 0.82rem; font-weight: 600; color: var(--text-dim); border-bottom: 1px solid var(--line-soft); padding-bottom: 4px;">
        ${catLabel}
      </div>
    `;

    items.forEach(item => {
      const isChecked = !disabledTools.includes(item.screen);
      html += `
        <label class="checkbox-row" style="margin: 4px 0;">
          <input type="checkbox" class="beta-tool-toggle" data-screen="${item.screen}" ${isChecked ? 'checked' : ''}>
          <span>${item.short} ${item.label}</span>
        </label>
      `;
    });
  });

  // Render custom categories
  if (customCategories.length > 0) {
    html += `
      <div style="grid-column: 1 / -1; margin-top: 8px; font-size: 0.82rem; font-weight: 600; color: var(--accent); border-bottom: 1px solid var(--accent-soft); padding-bottom: 4px;">
        ✨ Custom Categories
      </div>
    `;

    customCategories.forEach(category => {
      html += `
        <div style="grid-column: 1 / -1; padding: 6px; background: var(--accent-soft); border-radius: 3px; font-size: 0.85rem; color: var(--text);">
          <strong>${escapeHtml(category.name)}</strong> <span style="color: var(--text-dim);">(${category.toolIds.length} tools)</span>
        </div>
      `;

      // Show tools assigned to this custom category
      category.toolIds.forEach(toolId => {
        const tool = SIDEBAR_ITEMS.find(item => item.screen === toolId);
        if (tool) {
          const isChecked = !disabledTools.includes(toolId);
          html += `
            <label class="checkbox-row" style="margin: 4px 0; margin-left: 16px;">
              <input type="checkbox" class="beta-tool-toggle" data-screen="${toolId}" ${isChecked ? 'checked' : ''}>
              <span>${tool.short} ${tool.label}</span>
            </label>
          `;
        }
      });
    });
  }

  elements.betaToolsCheckboxes.innerHTML = html;
}

function getSidebarCustomOrder() {
  let order = [];
  try {
    const saved = localStorage.getItem("wpdesktop.sidebar-order");
    if (saved) order = JSON.parse(saved);
  } catch (_) {}
  
  const allScreens = SIDEBAR_ITEMS.map(item => item.screen);
  if (!order || !order.length) {
    return allScreens;
  }
  
  allScreens.forEach(screen => {
    if (!order.includes(screen)) {
      order.push(screen);
    }
  });
  return order;
}

function saveSidebarCustomOrder(order) {
  localStorage.setItem("wpdesktop.sidebar-order", JSON.stringify(order));
}

function getCollapsedCategories() {
  try {
    const saved = localStorage.getItem("wpdesktop.collapsed-categories");
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return [];
}

function saveCollapsedCategories(collapsed) {
  localStorage.setItem("wpdesktop.collapsed-categories", JSON.stringify(collapsed));
}

function getToolCategoryMapping() {
  try {
    const saved = localStorage.getItem("wpdesktop.tool-category-mapping");
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return { ...DEFAULT_CATEGORY_MAPPING };
}

function saveToolCategoryMapping(mapping) {
  localStorage.setItem("wpdesktop.tool-category-mapping", JSON.stringify(mapping));
}

function renderSidebar() {
  const sidebarNav = document.getElementById("sidebar-nav");
  if (!sidebarNav) return;

  const isBetaEnabled = getBetaEnabled();
  if (elements.betaFeaturesSidebarWrapper) {
    elements.betaFeaturesSidebarWrapper.style.display = "flex";
  }

  const activeScreen = uiState.bottomPanelScreen || Array.from(document.querySelectorAll(".screen"))
    .find(s => s.classList.contains("active"))
    ?.id?.replace("-screen", "") || "workspace";

  const customOrder = getSidebarCustomOrder();
  const collapsedCats = getCollapsedCategories();
  const mapping = getToolCategoryMapping();

  // Filter items
  let items = SIDEBAR_ITEMS.filter(item => {
    // Check if beta tool is enabled
    if (!isBetaToolEnabled(item.screen)) {
      return false;
    }

    // Technical category filter
    const matchesCategory = ssfFilterCategory === "all" || item.category === ssfFilterCategory;
    
    // Search query matches label or custom category label
    const mappedCat = mapping[item.screen] || "core";
    const mappedCatLabel = CUSTOM_CATEGORIES[mappedCat] || "";
    const matchesSearch = item.label.toLowerCase().includes(ssfSearchQuery.toLowerCase()) || 
                          mappedCatLabel.toLowerCase().includes(ssfSearchQuery.toLowerCase());
                          
    return matchesSearch && matchesCategory;
  });

  // Sort items
  if (ssfSortBy === "name") {
    items.sort((a, b) => a.label.localeCompare(b.label));
  } else {
    items.sort((a, b) => customOrder.indexOf(a.screen) - customOrder.indexOf(b.screen));
  }

  // Generate HTML
  let html = "";

  // Group by the 5 custom categories
  const categories = { core: [], mcp_tools: [], devops: [], productivity: [], collaboration: [] };
  items.forEach(item => {
    const cat = mapping[item.screen] || "core";
    if (categories[cat]) categories[cat].push(item);
  });

  Object.entries(CUSTOM_CATEGORIES).forEach(([catKey, catLabel]) => {
    const catItems = categories[catKey] || [];
    const isCollapsed = collapsedCats.includes(catKey);

    if (catItems.length === 0) {
      // Hide empty categories if there is a search or category filter active
      if (ssfSearchQuery || ssfFilterCategory !== "all") return;

      // Otherwise, show empty placeholder dropzone
      html += `
        <div class="sidebar-category-wrapper" data-category="${catKey}">
          <div class="sidebar-category-header ${isCollapsed ? 'collapsed' : ''}" data-cat-key="${catKey}">
            <span>${catLabel}</span>
            <span class="sidebar-category-arrow">▼</span>
          </div>
          <div class="sidebar-category-items empty ${isCollapsed ? 'collapsed' : ''}" data-cat-key="${catKey}">
            Drag tools here
          </div>
        </div>
      `;
      return;
    }

    html += `
      <div class="sidebar-category-wrapper" data-category="${catKey}">
        <div class="sidebar-category-header ${isCollapsed ? 'collapsed' : ''}" data-cat-key="${catKey}">
          <span>${catLabel}</span>
          <span class="sidebar-category-arrow">▼</span>
        </div>
        <div class="sidebar-category-items ${isCollapsed ? 'collapsed' : ''}" data-cat-key="${catKey}">
          ${catItems.map(item => renderButtonHtml(item, activeScreen)).join("")}
        </div>
      </div>
    `;
  });

  sidebarNav.innerHTML = html;

  // Re-bind events & update elements reference
  bindSidebarEvents();
  elements.navButtons = document.querySelectorAll(".nav-button");
}

function renderButtonHtml(item, activeScreen) {
  const isActive = item.screen === activeScreen;
  return `
    <button class="nav-button ${isActive ? 'active' : ''}" data-screen="${item.screen}" draggable="true">
      <span class="nav-button-short">${item.short}</span>
      <span class="nav-button-label">${item.short} ${item.label}</span>
    </button>
  `;
}

function bindSidebarEvents() {
  const buttons = document.querySelectorAll("#sidebar-nav .nav-button");
  buttons.forEach(button => {
    button.addEventListener("click", () => {
      showScreen(button.dataset.screen);
    });

    // HTML5 Drag and Drop Events
    button.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", button.dataset.screen);
      button.classList.add("dragging");
    });

    button.addEventListener("dragend", () => {
      button.classList.remove("dragging");
      buttons.forEach(btn => btn.classList.remove("drag-over"));
    });

    button.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dragging = document.querySelector(".nav-button.dragging");
      if (dragging && dragging !== button) {
        button.classList.add("drag-over");
      }
    });

    button.addEventListener("dragleave", () => {
      button.classList.remove("drag-over");
    });

    button.addEventListener("drop", (e) => {
      e.preventDefault();
      button.classList.remove("drag-over");
      e.stopPropagation(); // Stop propagation to avoid container drop
      const draggedScreen = e.dataTransfer.getData("text/plain");
      const targetScreen = button.dataset.screen;

      if (draggedScreen && targetScreen && draggedScreen !== targetScreen) {
        const mapping = getToolCategoryMapping();
        const targetCat = mapping[targetScreen] || "core";

        // Assign dragged tool to target category
        mapping[draggedScreen] = targetCat;
        saveToolCategoryMapping(mapping);

        // Reorder custom order list
        const order = getSidebarCustomOrder();
        const fromIdx = order.indexOf(draggedScreen);
        const toIdx = order.indexOf(targetScreen);

        if (fromIdx !== -1 && toIdx !== -1) {
          order.splice(fromIdx, 1);
          order.splice(toIdx, 0, draggedScreen);
          saveSidebarCustomOrder(order);
        }
        renderSidebar();
      }
    });
  });

  // Collapsible category headers
  const catHeaders = document.querySelectorAll(".sidebar-category-header");
  catHeaders.forEach(header => {
    header.addEventListener("click", () => {
      const catKey = header.dataset.catKey;
      let collapsed = getCollapsedCategories();
      if (collapsed.includes(catKey)) {
        collapsed = collapsed.filter(c => c !== catKey);
      } else {
        collapsed.push(catKey);
      }
      saveCollapsedCategories(collapsed);
      renderSidebar();
    });

    // Support dragging over and dropping directly onto headers
    header.addEventListener("dragover", (e) => {
      e.preventDefault();
      header.classList.add("drag-over");
    });

    header.addEventListener("dragleave", () => {
      header.classList.remove("drag-over");
    });

    header.addEventListener("drop", (e) => {
      e.preventDefault();
      header.classList.remove("drag-over");
      const draggedScreen = e.dataTransfer.getData("text/plain");
      const targetCat = header.dataset.catKey;
      if (draggedScreen && targetCat) {
        const mapping = getToolCategoryMapping();
        mapping[draggedScreen] = targetCat;
        saveToolCategoryMapping(mapping);
        renderSidebar();
      }
    });
  });

  // Support dropping onto category list containers directly (useful for empty categories)
  const catContainers = document.querySelectorAll(".sidebar-category-items");
  catContainers.forEach(container => {
    container.addEventListener("dragover", (e) => {
      e.preventDefault();
      container.classList.add("drag-over");
    });

    container.addEventListener("dragleave", () => {
      container.classList.remove("drag-over");
    });

    container.addEventListener("drop", (e) => {
      e.preventDefault();
      container.classList.remove("drag-over");
      const draggedScreen = e.dataTransfer.getData("text/plain");
      const targetCat = container.dataset.catKey;
      if (draggedScreen && targetCat) {
        const mapping = getToolCategoryMapping();
        mapping[draggedScreen] = targetCat;
        saveToolCategoryMapping(mapping);
        renderSidebar();
      }
    });
  });
}

function initSidebarSsf() {
  const searchInput = document.getElementById("ssf-search-input");
  const configToggle = document.getElementById("ssf-config-toggle");
  const configRow = document.getElementById("ssf-config-row");
  const filterCat = document.getElementById("ssf-filter-category");
  const sortBy = document.getElementById("ssf-sort-by");

  // Load initial options
  const savedFilter = localStorage.getItem("wpdesktop.ssf-filter") || "all";
  const savedSort = localStorage.getItem("wpdesktop.ssf-sort") || "custom";

  ssfFilterCategory = savedFilter;
  ssfSortBy = savedSort;

  if (filterCat) filterCat.value = savedFilter;
  if (sortBy) sortBy.value = savedSort;

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      ssfSearchQuery = e.target.value;
      renderSidebar();
    });
  }

  if (configToggle) {
    configToggle.addEventListener("click", () => {
      configRow?.classList.toggle("hidden");
      configToggle.classList.toggle("active");
    });
  }

  if (filterCat) {
    filterCat.addEventListener("change", (e) => {
      ssfFilterCategory = e.target.value;
      localStorage.setItem("wpdesktop.ssf-filter", ssfFilterCategory);
      renderSidebar();
    });
  }

  if (sortBy) {
    sortBy.addEventListener("change", (e) => {
      ssfSortBy = e.target.value;
      localStorage.setItem("wpdesktop.ssf-sort", ssfSortBy);
      renderSidebar();
    });
  }

  // Render initial sidebar
  renderSidebar();
}

// Initialize Sidebar SSF System
initSidebarSsf();
initializeIntegrationMaps();
initQuickNavigationHandlers();
restoreBottomPanelHeight();
initBottomPanelResize();
elements.sidebarToggleButton.addEventListener("click", toggleSidebar);
elements.rightSidebarToggleButton?.addEventListener("click", toggleRightSidebar);
elements.bottomPanelCloseButton?.addEventListener("click", closeBottomPanel);

// Released Featured sidebar click delegation
document.getElementById("released-sidebar-nav")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-button");
  if (btn) showScreen(btn.dataset.screen);
});
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

  elements.sftpSiteSelect?.addEventListener("change", () => {
    if (!elements.sftpSiteSelect.value) {
      return;
    }
    state.selectedSiteId = elements.sftpSiteSelect.value;
    renderSitesList();
    renderSiteDetails();
    renderSftpConfig();
  });

  elements.sftpAuthType?.addEventListener("change", () => {
    renderSftpConfig();
  });

  elements.sftpKeySelectButton?.addEventListener("click", async () => {
    try {
      const keyPath = await window.desktopAPI.pickFile();
      if (keyPath) {
        elements.sftpKeyPath.value = keyPath;
      }
    } catch (error) {
      console.error(error);
    }
  });

  elements.sftpSaveConfigButton?.addEventListener("click", async () => {
    const site = getSelectedSftpSite();
    if (!site) {
      if (elements.sftpConfigStatus) {
        elements.sftpConfigStatus.textContent = "Select a local site to save SFTP settings for transfers.";
      }
      return;
    }

    const config = {
      host: elements.sftpHost.value.trim(),
      port: elements.sftpPort.value.trim() || "22",
      username: elements.sftpUsername.value.trim(),
      authType: elements.sftpAuthType.value,
      password: elements.sftpPassword.value,
      keyPath: elements.sftpKeyPath.value.trim(),
      remoteDir: elements.sftpRemoteDir.value.trim() || "/"
    };

    try {
      await window.desktopAPI.saveSftpConfig(site.id, config);
      if (elements.sftpConfigStatus) {
        elements.sftpConfigStatus.textContent = "SFTP configuration saved for " + site.name + ".";
      }
      await refreshSites();
      renderSftpSiteSelect();
      renderSftpConfig();
    } catch (error) {
      if (elements.sftpConfigStatus) {
        elements.sftpConfigStatus.textContent = `Save failed: ${error.message}`;
      }
    }
  });

  elements.sftpTestConnectionButton?.addEventListener("click", async () => {
    const config = {
      host: elements.sftpHost.value.trim(),
      port: elements.sftpPort.value.trim() || "22",
      username: elements.sftpUsername.value.trim(),
      authType: elements.sftpAuthType.value,
      password: elements.sftpPassword.value,
      keyPath: elements.sftpKeyPath.value.trim(),
      remoteDir: elements.sftpRemoteDir.value.trim() || "/"
    };

    if (!config.host) {
      if (elements.sftpConfigStatus) {
        elements.sftpConfigStatus.textContent = "Enter SFTP host to test connection.";
      }
      return;
    }

    if (!config.username) {
      if (elements.sftpConfigStatus) {
        elements.sftpConfigStatus.textContent = "Enter SFTP username to test connection.";
      }
      return;
    }

    if (elements.sftpConfigStatus) {
      elements.sftpConfigStatus.textContent = "Testing connection...";
    }

    try {
      const result = await window.desktopAPI.testSftpConnection(config);
      if (result.connectionId) {
        activeSftpConnectionId = result.connectionId;
        activeSftpConnectionConfig = config;
        if (elements.sftpConfigStatus) {
          elements.sftpConfigStatus.textContent = "✓ SFTP connection successful! Go to the Editor tab to browse and edit remote files.";
        }
        if (elements.codeEditorRemoteStatus) {
          elements.codeEditorRemoteStatus.textContent = `✓ Connected to ${config.username}@${config.host}:${config.remoteDir}`;
        }
      }
    } catch (error) {
      if (elements.sftpConfigStatus) {
        elements.sftpConfigStatus.textContent = `✗ Connection failed: ${error.message}`;
      }
    }
  });

  const handleSftpTransfer = async (direction) => {
    const site = getSelectedSftpSite();
    if (!site) {
      if (elements.sftpConfigStatus) {
        elements.sftpConfigStatus.textContent = "Select a local site to transfer files.";
      }
      return;
    }

    const config = {
      host: elements.sftpHost.value.trim(),
      port: elements.sftpPort.value.trim() || "22",
      username: elements.sftpUsername.value.trim(),
      authType: elements.sftpAuthType.value,
      password: elements.sftpPassword.value,
      keyPath: elements.sftpKeyPath.value.trim(),
      remoteDir: elements.sftpRemoteDir.value.trim() || "/"
    };

    if (!config.host || !config.username) {
      if (elements.sftpConfigStatus) {
        elements.sftpConfigStatus.textContent = "Complete SFTP settings and test connection before transferring.";
      }
      return;
    }

    if (elements.sftpProgressStatus) {
      elements.sftpProgressStatus.textContent = `${direction === "upload" ? "Uploading" : "Downloading"}...`;
    }
    if (elements.sftpProgressLines) {
      elements.sftpProgressLines.innerHTML = "";
    }

    try {
      await window.desktopAPI.startSftpTransfer({
        siteId: site.id,
        direction,
        subpath: elements.sftpSubpath?.value.trim() || ""
      });
    } catch (error) {
      if (elements.sftpProgressStatus) {
        elements.sftpProgressStatus.textContent = `Transfer failed: ${error.message}`;
      }
    }
  };

  elements.sftpUploadButton?.addEventListener("click", () => handleSftpTransfer("upload"));
  elements.sftpDownloadButton?.addEventListener("click", () => handleSftpTransfer("download"));

  elements.codeEditorOpenButton?.addEventListener("click", async () => {
    try {
      const filePath = await window.desktopAPI.pickFile();
      if (!filePath) {
        return;
      }
      const content = await window.desktopAPI.readExtensionFile(filePath);
      setCodeEditorFilePath(filePath);
      loadCodeEditorContent(content);
    } catch (error) {
      setCodeEditorStatus(`Open failed: ${error.message}`, true);
    }
  });

  const writeEditorFile = async (filePath) => {
    const content = codeEditor ? codeEditor.getValue() : elements.codeEditorTextarea?.value || "";
    await window.desktopAPI.writeFile({ filePath, content });
    setCodeEditorStatus(`Saved ${filePath}`);
  };

  elements.codeEditorSaveButton?.addEventListener("click", async () => {
    try {
      if (!currentlyOpenCodeFilePath) {
        const savePath = await window.desktopAPI.saveFile(elements.codeEditorPath?.value || undefined);
        if (!savePath) {
          return;
        }
        setCodeEditorFilePath(savePath);
      }
      await writeEditorFile(currentlyOpenCodeFilePath);
    } catch (error) {
      setCodeEditorStatus(`Save failed: ${error.message}`, true);
    }
  });

  elements.codeEditorSaveAsButton?.addEventListener("click", async () => {
    try {
      const savePath = await window.desktopAPI.saveFile(elements.codeEditorPath?.value || undefined);
      if (!savePath) {
        return;
      }
      setCodeEditorFilePath(savePath);
      await writeEditorFile(savePath);
    } catch (error) {
      setCodeEditorStatus(`Save failed: ${error.message}`, true);
    }
  });

  elements.codeEditorBrowseButton?.addEventListener("click", async () => {
    if (!activeSftpConnectionId) {
      if (elements.codeEditorRemoteStatus) {
        elements.codeEditorRemoteStatus.textContent = "✗ No active SFTP connection. Test a connection in the SFTP tab first.";
      }
      return;
    }

    const remotePath = (elements.codeEditorRemotePath?.value || "/").trim() || "/";
    if (elements.codeEditorRemoteStatus) {
      elements.codeEditorRemoteStatus.textContent = "Loading directory...";
    }

    try {
      const files = await window.desktopAPI.listSftpDirectory(activeSftpConnectionId, remotePath);
      renderRemoteFileList(files, remotePath);
      if (elements.codeEditorFileListContainer) {
        elements.codeEditorFileListContainer.style.display = "block";
      }
      if (elements.codeEditorRemoteStatus) {
        elements.codeEditorRemoteStatus.textContent = `✓ Browsing ${remotePath}`;
      }
    } catch (error) {
      if (elements.codeEditorRemoteStatus) {
        elements.codeEditorRemoteStatus.textContent = `✗ Failed to list directory: ${error.message}`;
      }
    }
  });

  window.desktopAPI.onSftpProgress?.((payload) => {
    if (!payload) {
      return;
    }
    if (payload.statusText && elements.sftpProgressStatus) {
      elements.sftpProgressStatus.textContent = payload.statusText;
    }
    if (payload.logLine) {
      appendSftpProgressLine(payload.logLine, payload.isError);
    }
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
  void refreshStoreInstallButton();
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
  const paths = state.serverPaths || {};
  const localServerLabel = getLocalServerLabel();
  const documentRootLabel = getDocumentRootLabel();

  if (elements.localServerType) {
    elements.localServerType.value = state.localServerType || "xampp";
  }
  elements.settingsXamppRoot.value = paths.localServerRootPath || paths.xamppRootPath || "";
  elements.settingsHtdocsPath.value = paths.htdocsPath || state.htdocsPath || "";
  elements.xamppSettingsNote.textContent = (paths.localServerRootPath || paths.xamppRootPath)
    ? `This ${localServerLabel} root is used to auto-detect Apache, PHP, MySQL, and phpMyAdmin files.`
    : `Set the ${localServerLabel} root to auto-detect Apache, PHP, MySQL, and phpMyAdmin files.`;

  elements.pickXamppRootButton.textContent = `Set ${localServerLabel} root`;
  elements.settingsPickHtdocsButton.textContent = `Set ${documentRootLabel}`;
  elements.openXamppRootButton.disabled = !(paths.localServerRootPath || paths.xamppRootPath);
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
  if (window.wpDesktopMysqlEditor && window.wpDesktopMysqlEditor.getValue() !== (state.mysqlConfigContent || "")) {
    window.wpDesktopMysqlEditor.setValue(state.mysqlConfigContent || "");
  }
  elements.settingsMysqlEditor.readOnly = !paths.mysqlConfigPath;
  if (window.wpDesktopMysqlEditor) {
    window.wpDesktopMysqlEditor.updateOptions({ readOnly: !paths.mysqlConfigPath });
  }
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

const EXTENSION_STORE_LABELS = {
  chrome: "Chrome Web Store",
  edge: "Edge Add-ons",
  firefox: "Firefox Add-ons"
};

function getExtensionSourceLabel(extension) {
  if (extension.sourceType === "store") {
    return EXTENSION_STORE_LABELS[extension.store] || "store";
  }
  return extension.sourceType === "zip" ? "zip import" : "folder import";
}

let storeInstallInFlight = false;
let lastStoreCheckUrl = "";
let currentStoreTarget = null;

async function installExtensionFromStore(input) {
  if (storeInstallInFlight) {
    return;
  }
  storeInstallInFlight = true;
  setStoreInstallBusy(true);
  setStatus("Downloading extension…");
  try {
    const result = await window.desktopAPI.installBrowserExtensionFromStore(input);
    applySettingsPayload(result.settings);
    const extension = result.extension;
    const verb = result.updatedFrom
      ? `Updated ${extension.name} ${result.updatedFrom} → ${extension.version}`
      : `Installed ${extension.name} ${extension.version}`;
    const warning = extension.loadError
      ? ` It failed to load: ${extension.loadError}`
      : ((extension.notes || [])[0] ? ` ${extension.notes[0]}` : "");
    const message = `${verb} from ${result.storeLabel}.${warning}`;
    setStatus(message);
    setBrowserFeedback(message, extension.loadError || result.compatibility?.level === "broken" ? "error" : "success");
    if (elements.storeInstallInput) {
      elements.storeInstallInput.value = "";
    }
  } catch (error) {
    const message = `Extension install failed: ${error.message}`;
    setStatus(message);
    setBrowserFeedback(message, "error");
  } finally {
    storeInstallInFlight = false;
    setStoreInstallBusy(false);
    lastStoreCheckUrl = "";
    void refreshStoreInstallButton();
  }
}

function setStoreInstallBusy(busy) {
  if (elements.storeInstallSubmit) {
    elements.storeInstallSubmit.disabled = busy;
    elements.storeInstallSubmit.textContent = busy ? "Installing…" : "Install";
  }
  if (elements.storeInstallButton) {
    elements.storeInstallButton.disabled = busy;
    if (busy) {
      elements.storeInstallButton.textContent = "Installing…";
    }
  }
}

// Shows "Add to WP Desktop" while the active tab is an extension's store page.
async function refreshStoreInstallButton() {
  const button = elements.storeInstallButton;
  if (!button) {
    return;
  }
  const url = getActiveBrowserTab()?.url || "";
  if (url === lastStoreCheckUrl) {
    return;
  }
  lastStoreCheckUrl = url;
  const target = url ? await window.desktopAPI.parseExtensionStoreUrl(url).catch(() => null) : null;
  if (url !== lastStoreCheckUrl) {
    return;
  }
  currentStoreTarget = target;
  button.classList.toggle("hidden", !target);
  if (target && !storeInstallInFlight) {
    button.textContent = target.installed ? "Reinstall in WP Desktop" : "Add to WP Desktop";
    button.title = target.installed
      ? `${target.installed.name} ${target.installed.version} is installed. Click to download the latest version from ${target.storeLabel}.`
      : `Install this extension from ${target.storeLabel}`;
  }
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
        <span>${escapeHtml(extension.version || "Version unknown")} · ${escapeHtml(getExtensionSourceLabel(extension))} · ${extension.enabled ? "enabled" : "disabled"}</span>
        ${extension.loadError ? `<span class="extension-load-error">Failed to load: ${escapeHtml(extension.loadError)}</span>` : ""}
        ${(extension.notes || []).map((note) => `<span class="extension-note">${escapeHtml(note)}</span>`).join("")}
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

// The app renderer has desktopAPI access, so markdown links and images must
// never carry script URLs. `value` arrives already HTML-escaped.
function isSafeMarkdownUrl(value, { image = false } = {}) {
  const url = String(value || "").replace(/&amp;/g, "&").trim().toLowerCase();
  if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/.test(url)) {
    return true;
  }
  return image && /^data:image\/(png|jpe?g|gif|webp);/.test(url);
}

function applyWorkspaceMarkdownInline(text) {
  return String(text || "")
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (match, alt, src, title) => {
      if (!isSafeMarkdownUrl(src, { image: true })) {
        return escapeHtml(alt);
      }
      const safeSrc = escapeHtml(src);
      const safeAlt = escapeHtml(alt);
      const safeTitle = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${safeSrc}" alt="${safeAlt}"${safeTitle}>`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_, label, href, title) => {
      if (!isSafeMarkdownUrl(href)) {
        return label;
      }
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
    if (window.wpDesktopNotesEditor && window.wpDesktopNotesEditor.getValue() !== notesValue) {
      window.wpDesktopNotesEditor.setValue(notesValue);
    }
  }
  if (window.wpDesktopNotesEditor) {
    window.wpDesktopNotesEditor.updateOptions({ readOnly: !hasClient });
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
      state.integration.editorProjectContext = client.id;
      saveWorkspaceClients();
      hideWorkspaceContextMenu();
      syncProjectWithSites(client.id);
      renderWorkspace();
      renderSftpSiteSelect();
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
  const sections = getBrowserToolSections();
  const order = sections.map((section) => section.dataset.toolSection);
  writeBrowserToolPrefs(BROWSER_TOOL_ORDER_KEY, order);

  // Update category mapping based on DOM parent
  const mapping = getBrowserToolCategoryMapping();
  let changed = false;
  sections.forEach((section) => {
    const parentContainer = section.closest(".browser-category-items");
    if (parentContainer && parentContainer.dataset.catKey) {
      const currentCat = parentContainer.dataset.catKey;
      const toolId = section.dataset.toolSection;
      if (mapping[toolId] !== currentCat) {
        mapping[toolId] = currentCat;
        changed = true;
      }
    }
  });
  if (changed) {
    saveBrowserToolCategoryMapping(mapping);
  }
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
  const categoryMapping = getBrowserToolCategoryMapping();
  const collapsedCats = getBrowserToolCollapsedCategories();

  // Cache static sections from DOM to keep them in memory with their event listeners
  if (!window.wpDesktopBrowserToolSectionsCache) {
    window.wpDesktopBrowserToolSectionsCache = getBrowserToolSections();
  }
  const sectionMap = new Map(window.wpDesktopBrowserToolSectionsCache.map((section) => [section.dataset.toolSection, section]));

  // Detach sections so they aren't destroyed when clearing innerHTML
  window.wpDesktopBrowserToolSectionsCache.forEach(section => {
    section.remove();
  });

  // Clear panel body except for header
  const header = panel.querySelector(".panel-header");
  panel.innerHTML = "";
  if (header) {
    panel.appendChild(header);
  }

  // Group by category
  const categories = { security_access: [], navigation: [], data_permissions: [] };
  order.forEach((id) => {
    const cat = categoryMapping[id] || "data_permissions";
    if (categories[cat]) {
      const section = sectionMap.get(id);
      if (section) categories[cat].push(section);
    }
  });

  // Render each category wrapper and append its items
  Object.entries(BROWSER_TOOL_CATEGORIES).forEach(([catKey, catLabel]) => {
    const catItems = categories[catKey] || [];
    const isCatCollapsed = collapsedCats.includes(catKey);

    const wrapper = document.createElement("div");
    wrapper.className = "browser-category-wrapper";
    wrapper.dataset.category = catKey;

    const headerDiv = document.createElement("div");
    headerDiv.className = `browser-category-header ${isCatCollapsed ? 'collapsed' : ''}`;
    headerDiv.dataset.catKey = catKey;
    headerDiv.innerHTML = `
      <span>${catLabel}</span>
      <span class="browser-category-arrow">▼</span>
    `;

    const itemsDiv = document.createElement("div");
    itemsDiv.className = `browser-category-items ${isCatCollapsed ? 'collapsed' : ''} ${catItems.length === 0 ? 'empty' : ''}`;
    itemsDiv.dataset.catKey = catKey;

    if (catItems.length === 0) {
      itemsDiv.textContent = "Drag tools here";
    } else {
      catItems.forEach((section) => {
        itemsDiv.appendChild(section);
        section.classList.toggle("collapsed", Boolean(collapsed[section.dataset.toolSection]));
      });
    }

    wrapper.appendChild(headerDiv);
    wrapper.appendChild(itemsDiv);
    panel.appendChild(wrapper);
  });

  // Re-bind category click events & drag events
  bindBrowserToolCategoryEvents();
}

function bindBrowserToolCategoryEvents() {
  const headers = document.querySelectorAll(".browser-category-header");
  headers.forEach(header => {
    header.addEventListener("click", () => {
      const catKey = header.dataset.catKey;
      let collapsed = getBrowserToolCollapsedCategories();
      if (collapsed.includes(catKey)) {
        collapsed = collapsed.filter(c => c !== catKey);
      } else {
        collapsed.push(catKey);
      }
      saveBrowserToolCollapsedCategories(collapsed);
      applyBrowserToolSectionPrefs();
    });

    // Drag over category header
    header.addEventListener("dragover", (e) => {
      e.preventDefault();
      header.classList.add("drag-over");
    });

    header.addEventListener("dragleave", () => {
      header.classList.remove("drag-over");
    });

    header.addEventListener("drop", (e) => {
      e.preventDefault();
      header.classList.remove("drag-over");
      const draggedId = e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
      const targetCat = header.dataset.catKey;
      if (draggedId && targetCat) {
        const mapping = getBrowserToolCategoryMapping();
        mapping[draggedId] = targetCat;
        saveBrowserToolCategoryMapping(mapping);
        
        // Move dragged item to the end of the target category
        const order = readBrowserToolPrefs(BROWSER_TOOL_ORDER_KEY, DEFAULT_BROWSER_TOOL_ORDER);
        const idx = order.indexOf(draggedId);
        if (idx !== -1) {
          order.splice(idx, 1);
          order.push(draggedId);
          writeBrowserToolPrefs(BROWSER_TOOL_ORDER_KEY, order);
        }
        
        applyBrowserToolSectionPrefs();
      }
    });
  });

  // Drag over category items container (useful for empty categories)
  const containers = document.querySelectorAll(".browser-category-items");
  containers.forEach(container => {
    container.addEventListener("dragover", (e) => {
      e.preventDefault();
      container.classList.add("drag-over");
    });

    container.addEventListener("dragleave", () => {
      container.classList.remove("drag-over");
    });

    container.addEventListener("drop", (e) => {
      e.preventDefault();
      container.classList.remove("drag-over");
      const draggedId = e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
      const targetCat = container.dataset.catKey;
      if (draggedId && targetCat) {
        const mapping = getBrowserToolCategoryMapping();
        mapping[draggedId] = targetCat;
        saveBrowserToolCategoryMapping(mapping);
        
        // Move dragged item to the end of target category
        const order = readBrowserToolPrefs(BROWSER_TOOL_ORDER_KEY, DEFAULT_BROWSER_TOOL_ORDER);
        const idx = order.indexOf(draggedId);
        if (idx !== -1) {
          order.splice(idx, 1);
          order.push(draggedId);
          writeBrowserToolPrefs(BROWSER_TOOL_ORDER_KEY, order);
        }
        
        applyBrowserToolSectionPrefs();
      }
    });
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
      applyBrowserToolSectionPrefs();
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
      applyBrowserToolSectionPrefs();
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
      chip.innerHTML = `
        <span class="bookmark-folder-glyph" aria-hidden="true">&#128193;</span>
        <span class="bookmark-folder-title">${escapeHtml(node.title || "Folder")}</span>
        <span class="bookmark-folder-caret" aria-hidden="true">&#9662;</span>
      `;
    }

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
      : `Set your ${getLocalServerLabel()} ${getDocumentRootLabel()} folder to load sites from the shared server.`;
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
    renderSftpConfig();
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
  renderSftpConfig();
}

async function refreshSites() {
  const response = await window.desktopAPI.listSites();
  state.sites = response.sites;
  state.htdocsPath = response.htdocsPath || "";
  applyXamppServiceStatusSnapshot(response);
  elements.htdocsPath.value = state.htdocsPath;
  renderSftpSiteSelect();
  if (!state.selectedSiteId && state.sites[0]) {
    state.selectedSiteId = state.sites[0].id;
  }
  if (state.selectedSiteId && !state.sites.some((site) => site.id === state.selectedSiteId)) {
    state.selectedSiteId = state.sites[0]?.id || null;
  }
}

async function refreshBackups() {
  const response = await window.desktopAPI.listBackups();
  state.backups = Array.isArray(response?.backups) ? response.backups : [];
  renderBackupsList();
}

function renderBackupsList() {
  if (!elements.backupsList || !elements.backupsCount) {
    return;
  }

  elements.backupsCount.textContent = `${state.backups.length} backup${state.backups.length === 1 ? "" : "s"}`;
  elements.backupsList.innerHTML = "";

  if (!state.backups.length) {
    const empty = document.createElement("div");
    empty.className = "workspace-empty";
    empty.textContent = "No backups found yet.";
    elements.backupsList.appendChild(empty);
    return;
  }

  state.backups.forEach((backup) => {
    const item = document.createElement("div");
    item.className = "backup-item";
    item.innerHTML = `
      <div class="backup-item-copy">
        <strong>${escapeHtml(backup.siteName || backup.fileName || "Backup")}</strong>
        <span>${escapeHtml(backup.createdAt ? new Date(backup.createdAt).toLocaleString() : "")}</span>
        <span>${escapeHtml(backup.path || "")}</span>
      </div>
      <div class="backup-item-actions">
        <button type="button" class="primary-button">Restore</button>
      </div>
    `;
    item.querySelector("button")?.addEventListener("click", () => void restoreBackup(backup));
    elements.backupsList.appendChild(item);
  });
}

async function restoreBackup(backup) {
  if (!backup?.path) {
    setStatus("Backup path is missing.");
    return;
  }

  const approved = window.confirm(
    `Restore "${backup.siteName || backup.fileName || "backup"}"?\n\nThis will recreate the local site from the backup package.`
  );
  if (!approved) {
    return;
  }

  showSiteTab("tools");
  setStatus(`Restoring ${backup.siteName || backup.fileName || "backup"}...`);
  setCreateProgress(true, "Restoring files, configuration, and database from backup...");

  try {
    const result = await window.desktopAPI.restoreBackup({ backupPath: backup.path });
    state.selectedSiteId = result?.site?.id || state.selectedSiteId;
    await refreshSites();
    await refreshBackups();
    setStatus(result?.message || `Restored ${backup.siteName || backup.fileName || "backup"}.`);
  } catch (error) {
    setStatus(`Restore failed: ${error.message}`);
  } finally {
    setCreateProgress(false);
  }
}

function applySettingsPayload(settings) {
  state.localServerType = settings.localServerType || "xampp";
  state.localServerLabel = settings.localServerLabel || (state.localServerType === "laragon" ? "Laragon" : "XAMPP");
  state.htdocsPath = settings.htdocsPath || "";
  state.browser.downloadDirectory = settings.downloadDirectory || state.browser.downloadDirectory || "";
  state.serverPaths = settings.serverPaths || settings.xamppPaths || null;
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
  if (settings.mcpServerStatus) {
    renderMcpSettings(settings.mcpServerStatus);
  }
  renderBetaFeaturesSettings();
  initBetaCategoryManagement();
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

  const result = await window.desktopAPI.setLocalServerRootPath({
    localServerType: state.localServerType,
    rootPath: selected
  });
  applySettingsPayload(result);

  await refreshSites();
  setStatus(`Updated ${getLocalServerLabel()} root path.`);
}

async function updateLocalServerType() {
  const selectedType = elements.localServerType?.value === "laragon" ? "laragon" : "xampp";
  const result = await window.desktopAPI.setLocalServerType(selectedType);
  applySettingsPayload(result);
  await refreshSites();
  setStatus(`Switched local server stack to ${getLocalServerLabel()}.`);
}

async function pickAndSaveHtdocsPath() {
  const selected = await window.desktopAPI.pickFolder();
  if (!selected) {
    return;
  }

  const result = await window.desktopAPI.setHtdocsPath(selected);
  applySettingsPayload(result);

  await refreshSites();
  setStatus(`Updated ${getLocalServerLabel()} ${getDocumentRootLabel()} path.`);
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
      if (settings.mcpServerStatus) {
        renderMcpSettings(settings.mcpServerStatus);
      }
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

    // Unlink site from project if it was linked
    const projectId = getProjectForSite(site.id);
    if (projectId) {
      unlinkSiteFromProject(site.id, projectId);
    }

    await refreshSites();
    await refreshBackups();
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
    await refreshBackups();
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
elements.browserFullscreenButton.addEventListener("click", () => {
  window.desktopAPI.browserToggleFullscreen();
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
elements.localServerType?.addEventListener("change", () => void updateLocalServerType());
elements.pickXamppRootButton.addEventListener("click", () => void pickAndSaveXamppRoot());
elements.settingsPickHtdocsButton.addEventListener("click", () => void pickAndSaveHtdocsPath());
elements.openXamppRootButton.addEventListener("click", () =>
  void openExistingPath(state.serverPaths?.localServerRootPath || state.serverPaths?.xamppRootPath, `Set the ${getLocalServerLabel()} root first.`)
);
elements.openSettingsHtdocsButton.addEventListener("click", () =>
  void openExistingPath(state.serverPaths?.htdocsPath || state.htdocsPath, `Set the ${getLocalServerLabel()} ${getDocumentRootLabel()} folder first.`)
);
elements.openApacheStartButton.addEventListener("click", () =>
  void openExistingPath(state.serverPaths?.apacheStartPath, "Apache start script was not found.")
);
elements.openApacheStopButton.addEventListener("click", () =>
  void openExistingPath(state.serverPaths?.apacheStopPath, "Apache stop script was not found.")
);
elements.openApacheConfigButton.addEventListener("click", () =>
  void openExistingPath(state.serverPaths?.apacheConfigPath, "Apache config file was not found.")
);
elements.openMysqlConfigButton.addEventListener("click", () =>
  void openExistingPath(state.serverPaths?.mysqlConfigPath, "MySQL config file was not found.")
);
elements.settingsShareLocalSessions.addEventListener("change", () => void updateLocalSessionSharing());
elements.settingsShareOnlineSessions.addEventListener("change", () => void updateOnlineSessionSharing());

async function updateCloudSyncStatusUI() {
  if (!elements.syncGoogleStatus || !elements.syncMicrosoftStatus) return;
  try {
    const status = await window.desktopAPI.syncGetStatus();
    
    if (status.googleConnected) {
      elements.syncGoogleStatus.textContent = `Connected (${status.googleEmail})`;
      elements.syncGoogleStatus.style.color = "var(--success-color)";
      elements.syncGoogleBtn.textContent = "Disconnect Google";
    } else {
      elements.syncGoogleStatus.textContent = "Not connected";
      elements.syncGoogleStatus.style.color = "";
      elements.syncGoogleBtn.textContent = "Link Google Account";
    }

    if (status.microsoftConnected) {
      elements.syncMicrosoftStatus.textContent = `Connected (${status.microsoftEmail})`;
      elements.syncMicrosoftStatus.style.color = "var(--success-color)";
      elements.syncMicrosoftBtn.textContent = "Disconnect Microsoft";
    } else {
      elements.syncMicrosoftStatus.textContent = "Not connected";
      elements.syncMicrosoftStatus.style.color = "";
      elements.syncMicrosoftBtn.textContent = "Link Microsoft Account";
    }
  } catch (err) {
    console.error("Failed to update cloud sync status:", err);
  }
}

elements.syncGoogleBtn?.addEventListener("click", async () => {
  const status = await window.desktopAPI.syncGetStatus();
  if (status.googleConnected) {
    await window.desktopAPI.syncDisconnectGoogle();
    setStatus("Disconnected Google Account.");
  } else {
    const res = await window.desktopAPI.syncAuthGoogle();
    if (res.ok) {
      setStatus(`Successfully linked Google account: ${res.email}`);
    }
  }
  updateCloudSyncStatusUI();
});

elements.syncMicrosoftBtn?.addEventListener("click", async () => {
  const status = await window.desktopAPI.syncGetStatus();
  if (status.microsoftConnected) {
    await window.desktopAPI.syncDisconnectMicrosoft();
    setStatus("Disconnected Microsoft Account.");
  } else {
    const res = await window.desktopAPI.syncAuthMicrosoft();
    if (res.ok) {
      setStatus(`Successfully linked Microsoft account: ${res.email}`);
    }
  }
  updateCloudSyncStatusUI();
});
elements.sessionAutosaveButton?.addEventListener("click", () => void saveActiveTabSession(true));
elements.sessionSaveButton?.addEventListener("click", () => void saveActiveTabSession(false));
elements.sessionUnsaveButton?.addEventListener("click", () => void unsaveActiveTabSession());
elements.settingsAutosaveLocalSessions?.addEventListener("change", () => void updateSessionAutoSaveScope("local"));
elements.settingsAutosaveOnlineSessions?.addEventListener("change", () => void updateSessionAutoSaveScope("online"));
elements.settingsSessionAutosaveDelay?.addEventListener("change", () => void updateSessionAutoSaveDelay());
elements.settingsSessionAutosaveDelay?.addEventListener("blur", () => void updateSessionAutoSaveDelay());
elements.saveMysqlConfigButton.addEventListener("click", () => void saveMysqlConfigFromSettings());

elements.settingsBetaEnabled?.addEventListener("change", (e) => {
  setBetaEnabled(e.target.checked);
});
elements.betaToolsCheckboxes?.addEventListener("change", (e) => {
  if (e.target.classList.contains("beta-tool-toggle")) {
    setBetaToolEnabled(e.target.dataset.screen, e.target.checked);
  }
});
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
elements.storeInstallForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = elements.storeInstallInput?.value.trim();
  if (input) {
    void installExtensionFromStore(input);
  }
});
elements.storeInstallButton?.addEventListener("click", () => {
  const url = getActiveBrowserTab()?.url;
  if (url && currentStoreTarget) {
    void installExtensionFromStore(url);
  }
});
elements.updateStoreExtensionsButton?.addEventListener("click", async () => {
  const button = elements.updateStoreExtensionsButton;
  button.disabled = true;
  button.textContent = "Checking…";
  try {
    const { results, settings } = await window.desktopAPI.updateStoreExtensions();
    applySettingsPayload(settings);
    if (!results.length) {
      setStatus("No store extensions installed.");
    } else {
      const updated = results.filter((item) => item.ok && item.from && item.from !== item.to);
      const failed = results.filter((item) => !item.ok);
      const summary = updated.length
        ? `Updated ${updated.map((item) => `${item.name} ${item.from} → ${item.to}`).join(", ")}.`
        : "All store extensions are up to date.";
      const failures = failed.length ? ` Failed: ${failed.map((item) => `${item.name} (${item.error})`).join(", ")}.` : "";
      setStatus(summary + failures);
    }
  } catch (error) {
    setStatus(`Update check failed: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "Check for updates";
  }
});
elements.openChromeWebStoreButton?.addEventListener("click", () => void openUrlInAppBrowser("https://chromewebstore.google.com/category/extensions"));
elements.openEdgeAddonsButton?.addEventListener("click", () => void openUrlInAppBrowser("https://microsoftedge.microsoft.com/addons/Microsoft-Edge-Extensions-Home"));
elements.openFirefoxAddonsButton?.addEventListener("click", () => void openUrlInAppBrowser("https://addons.mozilla.org/en-US/firefox/extensions/"));
elements.saveThemeAccentsButton?.addEventListener("click", saveThemeAccentSettings);
elements.resetThemeAccentsButton?.addEventListener("click", resetThemeAccentSettings);
elements.saveWpInstallDefaultsButton.addEventListener("click", () => void saveWpInstallDefaultsFromSettings());
elements.openControlPanelButton.addEventListener("click", () =>
  void openExistingPath(state.serverPaths?.controlPanelPath, `${getLocalServerLabel()} control panel was not found.`)
);
elements.openPhpExeButton.addEventListener("click", () =>
  void openExistingPath(state.serverPaths?.phpExecutablePath, "PHP executable was not found.")
);
elements.openPhpConfigButton.addEventListener("click", () =>
  void openExistingPath(state.serverPaths?.phpConfigPath, "PHP config file was not found.")
);
elements.openPhpMyAdminFolderButton.addEventListener("click", () =>
  void openExistingPath(state.serverPaths?.phpMyAdminPath, "phpMyAdmin folder was not found.")
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
    autoLinkNewSitesToProject();
    renderSftpSiteSelect();
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

window.desktopAPI.onBrowserFullscreenChanged((isFullscreen) => {
  toggleBrowserFocusMode(isFullscreen);
});

window.desktopAPI.onBrowserNotice((payload) => {
  if (payload?.message) {
    setBrowserFeedback(payload.message, payload.type || "info");
  }
});

let pendingPasswordSavePayload = null;

function hidePasswordSaveModal() {
  elements.passwordSaveModal.classList.add("hidden");
  pendingPasswordSavePayload = null;
}

elements.passwordSaveConfirmButton.addEventListener("click", () => {
  if (pendingPasswordSavePayload) {
    void window.desktopAPI.saveSiteCredentials({
      key: pendingPasswordSavePayload.key,
      url: pendingPasswordSavePayload.url,
      username: pendingPasswordSavePayload.username,
      password: pendingPasswordSavePayload.password
    }).then(saved => {
      state.currentVaultCredentials = saved;
      renderVaultCredentialOptions(saved);
      syncVaultPanel();
      setStatus(`Saved credentials for ${pendingPasswordSavePayload.key}.`);
    });
  }
  hidePasswordSaveModal();
});

elements.passwordNeverSaveButton.addEventListener("click", () => {
  hidePasswordSaveModal();
});

elements.closePasswordSaveButton.addEventListener("click", hidePasswordSaveModal);

if (window.desktopAPI.onPromptSaveCredentials) {
  window.desktopAPI.onPromptSaveCredentials((payload) => {
    pendingPasswordSavePayload = payload;
    elements.passwordSaveUsername.textContent = payload.username;
    elements.passwordSaveModal.classList.remove("hidden");
  });
}

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
  void refreshBackups();
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
  await refreshBackups();
  renderDownloads();
  renderPermissions();
  syncBrowserLayoutSoon();
  updateCloudSyncStatusUI();
  
  // Initialize Monaco Editor and app extensions
  initMonacoEditor(loadAllCustomExtensions);
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
uiState.rightSidebarCollapsed = false;
renderSidebarState();
startXamppStatusAutoRefresh();
void loadSavedState();

// ─── Monaco Editor and Extensions API Integration ─────────────────
let notesEditor = null;
let mysqlEditor = null;
let monacoLoaded = false;
let currentlyLoadingPath = null;
const extensionListeners = {};
const loadedExtensions = new Map();

function initMonacoEditor(callback) {
  if (typeof window.require !== "undefined" && !monacoLoaded) {
    window.require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs' } });
    window.require(['vs/editor/editor.main'], function () {
      monacoLoaded = true;
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      monaco.editor.setTheme(isDark ? "vs-dark" : "vs");

      if (elements.settingsMysqlMonaco && elements.settingsMysqlEditor) {
        elements.settingsMysqlEditor.classList.add("hidden");
        elements.settingsMysqlMonaco.classList.remove("hidden");
        mysqlEditor = monaco.editor.create(elements.settingsMysqlMonaco, {
          value: elements.settingsMysqlEditor.value || "",
          language: "ini",
          theme: isDark ? "vs-dark" : "vs",
          automaticLayout: true,
          minimap: { enabled: false }
        });
        mysqlEditor.onDidChangeModelContent(() => {
          elements.settingsMysqlEditor.value = mysqlEditor.getValue();
          elements.settingsMysqlEditor.dispatchEvent(new Event("input"));
        });
      }

      if (elements.workspaceNotesMonaco && elements.workspaceNotes) {
        elements.workspaceNotes.classList.add("hidden");
        elements.workspaceNotesMonaco.classList.remove("hidden");
        notesEditor = monaco.editor.create(elements.workspaceNotesMonaco, {
          value: elements.workspaceNotes.value || "",
          language: "markdown",
          theme: isDark ? "vs-dark" : "vs",
          automaticLayout: true,
          minimap: { enabled: false }
        });
        notesEditor.onDidChangeModelContent(() => {
          elements.workspaceNotes.value = notesEditor.getValue();
          elements.workspaceNotes.dispatchEvent(new Event("input"));
        });
      }

      if (elements.codeEditorMonaco && elements.codeEditorTextarea) {
        elements.codeEditorTextarea.classList.add("hidden");
        elements.codeEditorMonaco.classList.remove("hidden");
        codeEditor = monaco.editor.create(elements.codeEditorMonaco, {
          value: elements.codeEditorTextarea.value || "",
          language: codeEditorLanguage,
          theme: isDark ? "vs-dark" : "vs",
          automaticLayout: true,
          minimap: { enabled: false }
        });
        codeEditor.onDidChangeModelContent(() => {
          elements.codeEditorTextarea.value = codeEditor.getValue();
          elements.codeEditorTextarea.dispatchEvent(new Event("input"));
        });
      }

      window.wpDesktopNotesEditor = notesEditor;
      window.wpDesktopMysqlEditor = mysqlEditor;

      if (callback) callback();
      window.wpDesktopExtensionsAPI.emit("editor-init", { notesEditor, mysqlEditor });
    });
  } else {
    if (callback) callback();
  }
}

// Observe theme mutations to dynamically update Monaco
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.attributeName === "data-theme" && monacoLoaded) {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      monaco.editor.setTheme(isDark ? "vs-dark" : "vs");
    }
  });
});
observer.observe(document.documentElement, { attributes: true });

// Custom Extensions API Exponent
window.wpDesktopExtensionsAPI = {
  getNotesEditor: () => window.wpDesktopNotesEditor,
  getMysqlEditor: () => window.wpDesktopMysqlEditor,
  
  register: (id, config) => {
    if (!id) return;
    loadedExtensions.set(id, config);
    console.log(`Registered custom extension: ${config.name || id} (v${config.version || "1.0.0"})`);
    if (currentlyLoadingPath) {
      saveLoadedExtensionMetadata(currentlyLoadingPath, id, config);
    }
    if (typeof config.activate === "function") {
      try {
        config.activate(window.wpDesktopExtensionsAPI);
      } catch (err) {
        console.error(`Error activating extension ${id}:`, err);
      }
    }
  },

  on: (event, callback) => {
    if (!extensionListeners[event]) {
      extensionListeners[event] = [];
    }
    extensionListeners[event].push(callback);
  },

  emit: (event, data) => {
    const list = extensionListeners[event] || [];
    list.forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        console.error(`Error in event listener for ${event}:`, err);
      }
    });
  },

  addStyle: (cssText) => {
    const style = document.createElement("style");
    style.textContent = cssText;
    document.head.appendChild(style);
    return style;
  },

  desktopAPI: window.desktopAPI,
  getState: () => state,
  getUiState: () => uiState,
  getElements: () => elements
};

function getCustomExtensionsList() {
  try {
    return JSON.parse(localStorage.getItem("wpdesktop.app-extensions") || "[]");
  } catch (_) {
    return [];
  }
}

function saveCustomExtensionsList(list) {
  localStorage.setItem("wpdesktop.app-extensions", JSON.stringify(list));
}

async function loadAllCustomExtensions() {
  const list = getCustomExtensionsList();
  for (const ext of list) {
    if (ext.enabled) {
      await loadCustomExtensionFromPath(ext.path);
    }
  }
  renderCustomExtensionsList();
}

async function loadCustomExtensionFromPath(filePath) {
  try {
    currentlyLoadingPath = filePath;
    const code = await window.desktopAPI.readExtensionFile(filePath);
    const extFunc = new Function("api", code);
    extFunc(window.wpDesktopExtensionsAPI);
    currentlyLoadingPath = null;
    return true;
  } catch (err) {
    console.error(`Failed to execute extension at ${filePath}:`, err);
    currentlyLoadingPath = null;
    return false;
  }
}

function saveLoadedExtensionMetadata(filePath, id, config) {
  const list = getCustomExtensionsList();
  let ext = list.find(item => item.path === filePath);
  if (!ext) {
    ext = { path: filePath, enabled: true };
    list.push(ext);
  }
  ext.id = id;
  ext.name = config.name || id;
  ext.description = config.description || "";
  ext.version = config.version || "1.0.0";
  saveCustomExtensionsList(list);
}

function renderCustomExtensionsList() {
  if (!elements.appExtensionsList) return;
  elements.appExtensionsList.innerHTML = "";
  
  const list = getCustomExtensionsList();
  if (list.length === 0) {
    const note = document.createElement("div");
    note.className = "settings-note";
    note.textContent = "No custom app extensions loaded yet.";
    elements.appExtensionsList.appendChild(note);
    return;
  }

  list.forEach(ext => {
    const item = document.createElement("div");
    item.className = "app-extension-item";
    
    const badgeClass = ext.enabled ? "enabled" : "disabled";
    const badgeText = ext.enabled ? "Enabled" : "Disabled";

    item.innerHTML = `
      <div class="app-extension-info">
        <div class="app-extension-name">
          ${escapeHtml(ext.name || ext.path.split(/[\\/]/).pop())}
          <span class="app-extension-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="app-extension-path">${escapeHtml(ext.path)}</div>
        ${ext.description ? `<div style="font-size: 0.84rem; color: var(--text-dim); margin-top: 4px;">${escapeHtml(ext.description)}</div>` : ""}
      </div>
      <div class="button-row compact">
        <button type="button" class="toggle-ext-btn">${ext.enabled ? "Disable" : "Enable"}</button>
        <button type="button" class="danger-button remove-ext-btn">Remove</button>
      </div>
    `;

    item.querySelector(".toggle-ext-btn").addEventListener("click", () => {
      toggleCustomExtension(ext.path);
    });

    item.querySelector(".remove-ext-btn").addEventListener("click", () => {
      removeCustomExtension(ext.path);
    });

    elements.appExtensionsList.appendChild(item);
  });
}

function toggleCustomExtension(filePath) {
  const list = getCustomExtensionsList();
  const ext = list.find(item => item.path === filePath);
  if (ext) {
    ext.enabled = !ext.enabled;
    saveCustomExtensionsList(list);
    
    if (ext.enabled) {
      loadCustomExtensionFromPath(filePath);
    } else {
      if (ext.id) {
        const config = loadedExtensions.get(ext.id);
        if (config && typeof config.deactivate === "function") {
          try {
            config.deactivate();
          } catch (err) {
            console.error("Deactivate error:", err);
          }
        }
        loadedExtensions.delete(ext.id);
      }
    }
    renderCustomExtensionsList();
  }
}

function removeCustomExtension(filePath) {
  const list = getCustomExtensionsList();
  const ext = list.find(item => item.path === filePath);
  if (ext) {
    if (ext.id) {
      const config = loadedExtensions.get(ext.id);
      if (config && typeof config.deactivate === "function") {
        try {
          config.deactivate();
        } catch (err) {
          console.error("Deactivate error:", err);
        }
      }
      loadedExtensions.delete(ext.id);
    }
    
    const filtered = list.filter(item => item.path !== filePath);
    saveCustomExtensionsList(filtered);
    renderCustomExtensionsList();
  }
}

// Hook up load-app-extension button
elements.loadAppExtensionButton?.addEventListener("click", async () => {
  try {
    const selectedPath = await window.desktopAPI.pickFile();
    if (!selectedPath) return;

    const list = getCustomExtensionsList();
    if (list.some(item => item.path === selectedPath)) {
      setStatus("Extension already loaded: " + selectedPath);
      return;
    }

    setStatus("Loading custom extension...");
    const success = await loadCustomExtensionFromPath(selectedPath);
    if (success) {
      const newList = getCustomExtensionsList();
      if (!newList.some(item => item.path === selectedPath)) {
        newList.push({
          path: selectedPath,
          enabled: true,
          name: selectedPath.split(/[\\/]/).pop(),
          description: ""
        });
        saveCustomExtensionsList(newList);
      }
      setStatus("Successfully loaded extension!");
      renderCustomExtensionsList();
    } else {
      setStatus("Failed to load extension. Check console for details.");
    }
  } catch (err) {
    setStatus("Load extension error: " + err.message);
  }
});

function renderMcpSettings(mcpStatus) {
  if (!elements.mcpStatusText) return;

  const running = mcpStatus?.running === true;
  elements.mcpStatusText.textContent = running ? "Running" : "Stopped";
  elements.mcpStatusText.style.color = running ? "var(--success-color, #10b981)" : "var(--text-dim, #78716c)";
  elements.mcpToggleButton.textContent = running ? "Stop server" : "Start server";
  elements.mcpToggleButton.className = running ? "danger-button" : "primary-button";

  elements.mcpEndpointText.textContent = mcpStatus?.endpoint || "-";
  elements.mcpSessionsCount.textContent = `${mcpStatus?.sessions || 0} active connection${(mcpStatus?.sessions || 0) === 1 ? "" : "s"}`;

  if (mcpStatus?.lastError) {
    elements.mcpErrorText.textContent = mcpStatus.lastError;
    elements.mcpErrorItem.classList.remove("hidden");
  } else {
    elements.mcpErrorItem.classList.add("hidden");
  }

  if (document.activeElement !== elements.mcpHost) {
    elements.mcpHost.value = mcpStatus?.host || "127.0.0.1";
  }
  if (document.activeElement !== elements.mcpPort) {
    elements.mcpPort.value = mcpStatus?.port || 3789;
  }
}

async function toggleMcpServer() {
  const isRunning = elements.mcpStatusText.textContent === "Running";
  elements.mcpToggleButton.disabled = true;
  elements.mcpStatusText.textContent = isRunning ? "Stopping..." : "Starting...";

  try {
    let status;
    if (isRunning) {
      status = await window.desktopAPI.stopMcpServer();
    } else {
      const config = {
        host: elements.mcpHost.value.trim() || "127.0.0.1",
        port: Number(elements.mcpPort.value) || 3789
      };
      status = await window.desktopAPI.startMcpServer(config);
    }
    renderMcpSettings(status);
  } catch (error) {
    console.error("Failed to toggle MCP server:", error);
    alert(`Failed to toggle MCP server: ${error.message}`);
  } finally {
    elements.mcpToggleButton.disabled = false;
  }
}

async function saveMcpConfig() {
  elements.mcpSaveConfigButton.disabled = true;
  elements.mcpConfigStatus.textContent = "Saving configuration...";
  elements.mcpConfigStatus.style.color = "var(--text-dim)";

  try {
    const config = {
      host: elements.mcpHost.value.trim() || "127.0.0.1",
      port: Number(elements.mcpPort.value) || 3789
    };
    const isRunning = elements.mcpStatusText.textContent === "Running";
    const status = await window.desktopAPI.startMcpServer(config);
    if (!isRunning) {
      await window.desktopAPI.stopMcpServer();
    }
    
    const settings = await window.desktopAPI.getSettings();
    applySettingsPayload(settings);
    
    elements.mcpConfigStatus.textContent = "Configuration saved successfully!";
    elements.mcpConfigStatus.style.color = "var(--success-color)";
    setTimeout(() => {
      elements.mcpConfigStatus.textContent = "Configure the host and port for your local MCP server.";
      elements.mcpConfigStatus.style.color = "var(--text-dim)";
    }, 3000);
  } catch (error) {
    elements.mcpConfigStatus.textContent = `Save failed: ${error.message}`;
    elements.mcpConfigStatus.style.color = "var(--danger-color)";
  } finally {
    elements.mcpSaveConfigButton.disabled = false;
  }
}

function initMcpUi() {
  elements.mcpToggleButton?.addEventListener("click", toggleMcpServer);
  elements.mcpSaveConfigButton?.addEventListener("click", saveMcpConfig);
}

initMcpUi();

// ─── P2P Meeting Implementation ──────────────────────────────────
let meetLocalStream = null;
let meetScreenStream = null;
let meetPeer = null;
let meetActiveCall = null;
let meetPC = null; // Manual mode peer connection
let meetAudioMuted = false;
let meetVideoMuted = false;
let meetScreenSharing = false;
let meetSelectedCameraId = "";
let meetSelectedMicId = "";
let meetCurrentMode = "cloud"; // "cloud" or "manual"
let meetLocalICEs = [];

// Query meeting elements
const meetUI = {
  setupPanel: document.getElementById("meet-setup-panel"),
  callPanel: document.getElementById("meet-call-panel"),
  setupPreview: document.getElementById("meet-setup-preview"),
  previewFallback: document.getElementById("meet-preview-fallback"),
  cameraSelect: document.getElementById("meet-camera-select"),
  micSelect: document.getElementById("meet-mic-select"),
  
  modeBtnCloud: document.getElementById("meet-mode-btn-cloud"),
  modeBtnManual: document.getElementById("meet-mode-btn-manual"),
  formCloud: document.getElementById("meet-form-cloud"),
  formManual: document.getElementById("meet-form-manual"),
  
  cloudRoomInput: document.getElementById("meet-cloud-room"),
  cloudStartBtn: document.getElementById("meet-cloud-start-btn"),
  
  manualInitBtn: document.getElementById("meet-manual-init-btn"),
  manualJoinBtn: document.getElementById("meet-manual-join-btn"),
  manualStageHost: document.getElementById("meet-manual-stage-host"),
  manualStageJoiner: document.getElementById("meet-manual-stage-joiner"),
  
  manualOfferText: document.getElementById("meet-manual-offer"),
  manualAnswerText: document.getElementById("meet-manual-answer"),
  manualConnectBtn: document.getElementById("meet-manual-connect-btn"),
  
  manualJoinOfferText: document.getElementById("meet-manual-join-offer"),
  manualJoinAnswerText: document.getElementById("meet-manual-join-answer"),
  manualGenerateAnswerBtn: document.getElementById("meet-manual-generate-answer-btn"),
  
  statusIndicator: document.getElementById("meet-status-indicator"),
  roomLabel: document.getElementById("meet-room-label"),
  
  localVideo: document.getElementById("meet-local-video"),
  localVideoFallback: document.getElementById("meet-local-fallback"),
  remoteVideo: document.getElementById("meet-remote-video"),
  remoteVideoFallback: document.getElementById("meet-remote-fallback"),
  
  toggleAudioBtn: document.getElementById("meet-toggle-audio"),
  toggleVideoBtn: document.getElementById("meet-toggle-video"),
  toggleShareBtn: document.getElementById("meet-toggle-share"),
  hangupBtn: document.getElementById("meet-hangup")
};

// Initialize P2P Meeting
function initMeetingFeature() {
  // Navigation trigger: start device check when Meet screen is shown
  document.querySelector('[data-screen="meeting"]')?.addEventListener("click", () => {
    startMeetSetupPreview();
    loadMeetDevices();
  });

  // Switch setup modes
  meetUI.modeBtnCloud?.addEventListener("click", () => selectMeetMode("cloud"));
  meetUI.modeBtnManual?.addEventListener("click", () => selectMeetMode("manual"));

  // Device selectors
  meetUI.cameraSelect?.addEventListener("change", (e) => {
    meetSelectedCameraId = e.target.value;
    startMeetSetupPreview();
  });
  meetUI.micSelect?.addEventListener("change", (e) => {
    meetSelectedMicId = e.target.value;
    startMeetSetupPreview();
  });

  // Connection controls
  meetUI.cloudStartBtn?.addEventListener("click", startCloudMeeting);
  meetUI.manualInitBtn?.addEventListener("click", () => showManualStage("host"));
  meetUI.manualJoinBtn?.addEventListener("click", () => showManualStage("joiner"));
  meetUI.manualConnectBtn?.addEventListener("click", connectManualHost);
  meetUI.manualGenerateAnswerBtn?.addEventListener("click", connectManualJoiner);

  // In-Call controls
  meetUI.toggleAudioBtn?.addEventListener("click", toggleMeetAudio);
  meetUI.toggleVideoBtn?.addEventListener("click", toggleMeetVideo);
  meetUI.toggleShareBtn?.addEventListener("click", toggleMeetScreenShare);
  meetUI.hangupBtn?.addEventListener("click", hangUpMeet);
}

// Select meet connection mode
function selectMeetMode(mode) {
  meetCurrentMode = mode;
  meetUI.modeBtnCloud.classList.toggle("active", mode === "cloud");
  meetUI.modeBtnManual.classList.toggle("active", mode === "manual");
  meetUI.formCloud.classList.toggle("hidden", mode !== "cloud");
  meetUI.formManual.classList.toggle("hidden", mode !== "manual");
}

// Show manual setup steps
function showManualStage(role) {
  meetUI.manualStageHost.classList.toggle("hidden", role !== "host");
  meetUI.manualStageJoiner.classList.toggle("hidden", role !== "joiner");
  
  if (role === "host") {
    initManualHostConnection();
  }
}

// Load available media devices
async function loadMeetDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (!meetUI.cameraSelect || !meetUI.micSelect) return;
    
    meetUI.cameraSelect.innerHTML = "";
    meetUI.micSelect.innerHTML = "";
    
    devices.forEach(device => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `${device.kind} (${device.deviceId.slice(0, 5)})`;
      
      if (device.kind === "videoinput") {
        meetUI.cameraSelect.appendChild(option);
      } else if (device.kind === "audioinput") {
        meetUI.micSelect.appendChild(option);
      }
    });
  } catch (err) {
    console.error("Failed to load media devices", err);
  }
}

// Start Setup camera preview
async function startMeetSetupPreview() {
  try {
    // Stop any existing stream
    if (meetLocalStream) {
      meetLocalStream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
      video: meetSelectedCameraId ? { deviceId: { exact: meetSelectedCameraId } } : true,
      audio: meetSelectedMicId ? { deviceId: { exact: meetSelectedMicId } } : true
    };

    meetLocalStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    if (meetUI.setupPreview) {
      meetUI.setupPreview.srcObject = meetLocalStream;
      meetUI.setupPreview.style.display = "block";
    }
    if (meetUI.previewFallback) {
      meetUI.previewFallback.style.display = "none";
    }
  } catch (err) {
    console.error("Error accessing user devices:", err);
    if (meetUI.setupPreview) {
      meetUI.setupPreview.style.display = "none";
    }
    if (meetUI.previewFallback) {
      meetUI.previewFallback.style.display = "flex";
      meetUI.previewFallback.textContent = "Camera Blocked / Not Found";
    }
  }
}

// Configure WebRTC Call Panel state
function enterCallUI(roomName) {
  meetUI.setupPanel.classList.add("hidden");
  meetUI.callPanel.classList.remove("hidden");
  meetUI.roomLabel.textContent = `Room: ${roomName}`;
  
  if (meetUI.localVideo) {
    meetUI.localVideo.srcObject = meetLocalStream;
    meetUI.localVideo.style.display = "block";
  }
  if (meetUI.localVideoFallback) {
    meetUI.localVideoFallback.style.display = "none";
  }
  
  updateMeetControlsUI();
}

function updateMeetControlsUI() {
  meetUI.toggleAudioBtn.classList.toggle("muted", meetAudioMuted);
  meetUI.toggleAudioBtn.textContent = meetAudioMuted ? "🔇" : "🎤";
  
  meetUI.toggleVideoBtn.classList.toggle("muted", meetVideoMuted);
  meetUI.toggleVideoBtn.textContent = meetVideoMuted ? "📷 (Off)" : "📷";
  
  meetUI.toggleShareBtn.classList.toggle("muted", !meetScreenSharing);
  meetUI.toggleShareBtn.textContent = meetScreenSharing ? "🛑 Share" : "🖥️";
}

// ─── CLOUD MODE (PeerJS) ───
function startCloudMeeting() {
  const rawRoom = meetUI.cloudRoomInput.value.trim();
  if (!rawRoom) {
    alert("Please enter a room code first.");
    return;
  }

  const roomHash = `wpdesktop-room-${rawRoom}`;
  setStatus(`Connecting to meeting room "${rawRoom}"...`);
  meetUI.statusIndicator.textContent = "Connecting...";
  meetUI.statusIndicator.className = "status-badge connecting";

  enterCallUI(rawRoom);
  connectToCloudPeer(roomHash, "peer-a");
}

function connectToCloudPeer(roomHash, roleId) {
  const currentPeerId = `${roomHash}-${roleId}`;
  
  meetPeer = new Peer(currentPeerId, {
    config: {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    }
  });

  meetPeer.on("open", (id) => {
    console.log(`Connected to PeerJS cloud with ID: ${id}`);
    
    if (roleId === "peer-b") {
      // If we are peer-b, we initiate the call to peer-a
      const targetId = `${roomHash}-peer-a`;
      console.log(`Peer-b calling peer-a (${targetId})...`);
      const call = meetPeer.call(targetId, meetLocalStream);
      handleCloudCall(call);
    }
  });

  meetPeer.on("call", (incomingCall) => {
    console.log("Receiving call from peer-b...");
    incomingCall.answer(meetLocalStream);
    handleCloudCall(incomingCall);
  });

  meetPeer.on("error", (err) => {
    console.error("PeerJS error:", err);
    if (err.type === "unavailable-id" && roleId === "peer-a") {
      // If peer-a is taken, try connecting as peer-b
      console.log("Peer-a ID taken. Re-connecting as Peer-b...");
      meetPeer.destroy();
      connectToCloudPeer(roomHash, "peer-b");
    } else {
      meetUI.statusIndicator.textContent = "Error";
      meetUI.statusIndicator.className = "status-badge failed";
      setStatus(`Connection error: ${err.message}`);
    }
  });
}

function handleCloudCall(call) {
  meetActiveCall = call;
  
  meetUI.statusIndicator.textContent = "Connected";
  meetUI.statusIndicator.className = "status-badge connected";
  setStatus("Connected to remote peer!");

  call.on("stream", (remoteStream) => {
    console.log("Received remote stream!");
    if (meetUI.remoteVideo) {
      meetUI.remoteVideo.srcObject = remoteStream;
      meetUI.remoteVideo.style.display = "block";
    }
    if (meetUI.remoteVideoFallback) {
      meetUI.remoteVideoFallback.style.display = "none";
    }
  });

  call.on("close", () => {
    console.log("Call closed by remote peer.");
    hangUpMeet();
  });
}

// ─── MANUAL P2P MODE ───
const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function createManualPeerConnection() {
  meetPC = new RTCPeerConnection(rtcConfig);
  meetLocalICEs = [];

  // Add tracks
  if (meetLocalStream) {
    meetLocalStream.getTracks().forEach(track => {
      meetPC.addTrack(track, meetLocalStream);
    });
  }

  // Handle remote track
  meetPC.ontrack = (event) => {
    console.log("Manual connection received remote track");
    const remoteStream = event.streams[0];
    if (meetUI.remoteVideo) {
      meetUI.remoteVideo.srcObject = remoteStream;
      meetUI.remoteVideo.style.display = "block";
    }
    if (meetUI.remoteVideoFallback) {
      meetUI.remoteVideoFallback.style.display = "none";
    }
  };

  meetPC.oniceconnectionstatechange = () => {
    const state = meetPC.iceConnectionState;
    console.log("ICE Connection State changed:", state);
    if (state === "connected") {
      meetUI.statusIndicator.textContent = "Connected";
      meetUI.statusIndicator.className = "status-badge connected";
      setStatus("Direct manual P2P connection established!");
    } else if (state === "failed" || state === "closed") {
      meetUI.statusIndicator.textContent = "Failed";
      meetUI.statusIndicator.className = "status-badge failed";
      hangUpMeet();
    }
  };
}

async function initManualHostConnection() {
  createManualPeerConnection();
  
  meetPC.onicecandidate = (event) => {
    if (event.candidate) {
      meetLocalICEs.push(event.candidate);
    }
    // Update display with Offer + Candidates once complete
    updateHostOfferDisplay();
  };

  const offer = await meetPC.createOffer();
  await meetPC.setLocalDescription(offer);
  updateHostOfferDisplay();
}

function updateHostOfferDisplay() {
  const signalData = {
    sdp: meetPC.localDescription,
    candidates: meetLocalICEs
  };
  meetUI.manualOfferText.value = btoa(JSON.stringify(signalData));
}

async function connectManualHost() {
  const rawAnswer = meetUI.manualAnswerText.value.trim();
  if (!rawAnswer) {
    alert("Please paste the answer code from the joiner first.");
    return;
  }

  try {
    const signalData = JSON.parse(atob(rawAnswer));
    enterCallUI("Manual P2P (Host)");
    meetUI.statusIndicator.textContent = "Connecting...";
    meetUI.statusIndicator.className = "status-badge connecting";

    await meetPC.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
    
    // Add joiner candidates
    if (Array.isArray(signalData.candidates)) {
      for (const candidate of signalData.candidates) {
        await meetPC.addIceCandidate(new RTCIceCandidate(candidate));
      }
    }
  } catch (err) {
    alert("Failed to parse the response code: " + err.message);
  }
}

async function connectManualJoiner() {
  const rawOffer = meetUI.manualJoinOfferText.value.trim();
  if (!rawOffer) {
    alert("Please paste the host's connection code first.");
    return;
  }

  try {
    const signalData = JSON.parse(atob(rawOffer));
    createManualPeerConnection();

    meetPC.onicecandidate = (event) => {
      if (event.candidate) {
        meetLocalICEs.push(event.candidate);
      }
      updateJoinerAnswerDisplay();
    };

    await meetPC.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
    const answer = await meetPC.createAnswer();
    await meetPC.setLocalDescription(answer);

    // Add host candidates
    if (Array.isArray(signalData.candidates)) {
      for (const candidate of signalData.candidates) {
        await meetPC.addIceCandidate(new RTCIceCandidate(candidate));
      }
    }

    updateJoinerAnswerDisplay();
    enterCallUI("Manual P2P (Joiner)");
    meetUI.statusIndicator.textContent = "Connecting...";
    meetUI.statusIndicator.className = "status-badge connecting";
  } catch (err) {
    alert("Failed to parse connection code: " + err.message);
  }
}

function updateJoinerAnswerDisplay() {
  const signalData = {
    sdp: meetPC.localDescription,
    candidates: meetLocalICEs
  };
  meetUI.manualJoinAnswerText.value = btoa(JSON.stringify(signalData));
}

// ─── IN-CALL TOGGLES & ACTIONS ───

// Toggle mic track
function toggleMeetAudio() {
  if (!meetLocalStream) return;
  meetAudioMuted = !meetAudioMuted;
  meetLocalStream.getAudioTracks().forEach(track => {
    track.enabled = !meetAudioMuted;
  });
  updateMeetControlsUI();
  setStatus(meetAudioMuted ? "Microphone muted" : "Microphone unmuted");
}

// Toggle camera track
function toggleMeetVideo() {
  if (!meetLocalStream) return;
  meetVideoMuted = !meetVideoMuted;
  meetLocalStream.getVideoTracks().forEach(track => {
    track.enabled = !meetVideoMuted;
  });
  
  if (meetUI.localVideo) {
    meetUI.localVideo.style.display = meetVideoMuted ? "none" : "block";
  }
  if (meetUI.localVideoFallback) {
    meetUI.localVideoFallback.style.display = meetVideoMuted ? "flex" : "none";
  }
  
  updateMeetControlsUI();
  setStatus(meetVideoMuted ? "Camera stream stopped" : "Camera stream active");
}

// Toggle Screen Share stream
async function toggleMeetScreenShare() {
  if (!meetLocalStream) return;
  
  if (!meetScreenSharing) {
    try {
      meetScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const screenVideoTrack = meetScreenStream.getVideoTracks()[0];
      
      // Listen to "ended" event (when user stops sharing from browser toolbar)
      screenVideoTrack.addEventListener("ended", () => {
        stopScreenSharingTracks();
      });

      // Replace video track in current peer call / connection
      replaceVideoTrack(screenVideoTrack);
      
      if (meetUI.localVideo) {
        meetUI.localVideo.srcObject = meetScreenStream;
      }
      
      meetScreenSharing = true;
      updateMeetControlsUI();
      setStatus("Screen sharing started");
    } catch (err) {
      console.error("Failed to share screen:", err);
      setStatus("Failed to start screen share");
    }
  } else {
    stopScreenSharingTracks();
  }
}

function stopScreenSharingTracks() {
  if (!meetScreenSharing) return;

  if (meetScreenStream) {
    meetScreenStream.getTracks().forEach(track => track.stop());
    meetScreenStream = null;
  }

  const cameraTrack = meetLocalStream.getVideoTracks()[0];
  replaceVideoTrack(cameraTrack);

  if (meetUI.localVideo) {
    meetUI.localVideo.srcObject = meetLocalStream;
  }

  meetScreenSharing = false;
  updateMeetControlsUI();
  setStatus("Screen sharing stopped");
}

function replaceVideoTrack(newTrack) {
  if (!newTrack) return;
  
  if (meetActiveCall && meetActiveCall.peerConnection) {
    const senders = meetActiveCall.peerConnection.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === "video");
    if (videoSender) {
      videoSender.replaceTrack(newTrack);
    }
  } else if (meetPC) {
    const senders = meetPC.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === "video");
    if (videoSender) {
      videoSender.replaceTrack(newTrack);
    }
  }
}

// End call / cleanup
function hangUpMeet() {
  setStatus("Meeting ended.");
  
  // Stop active call streams
  if (meetActiveCall) {
    meetActiveCall.close();
    meetActiveCall = null;
  }
  if (meetPeer) {
    meetPeer.destroy();
    meetPeer = null;
  }
  
  // Close manual connection
  if (meetPC) {
    meetPC.close();
    meetPC = null;
  }

  // Stop screen stream if active
  if (meetScreenStream) {
    meetScreenStream.getTracks().forEach(track => track.stop());
    meetScreenStream = null;
  }

  // Restore camera preview inside setup
  meetAudioMuted = false;
  meetVideoMuted = false;
  meetScreenSharing = false;

  meetUI.callPanel.classList.add("hidden");
  meetUI.setupPanel.classList.remove("hidden");

  // Restart setup preview
  startMeetSetupPreview();
}

// Auto-run meeting initialization
initMeetingFeature();


// ═══════════════════════════════════════════════════════════════════
// TAILSCALE ADMIN TOOLKIT — Renderer Module
// ═══════════════════════════════════════════════════════════════════

// ─── State ────────────────────────────────────────────────────────
const tsState = {
  detection: null,
  peers: [],
  self: null,
  exitNodes: [],
  activeExitNode: null,
  serveConfig: null,
  funnelInfo: null,
  netcheck: null,
  dns: null,
  metrics: null,
  activeTab: "dashboard",
  consoleHistory: [],
  consoleHistoryIndex: -1,
  fileTransferLog: [],
  selectedFilePath: null,
  initialized: false,
  loading: false
};

// ─── DOM refs ─────────────────────────────────────────────────────
let tsUI = {};

function tsBindUI() {
  tsUI = {
    statusPill:          document.getElementById("ts-status-pill"),
    refreshBtn:          document.getElementById("ts-refresh-button"),
    loginBtn:            document.getElementById("ts-login-button"),
    logoutBtn:           document.getElementById("ts-logout-button"),
    adminConsoleBtn:     document.getElementById("ts-admin-console-button"),
    notInstalledBanner:  document.getElementById("ts-not-installed-banner"),
    errorBanner:         document.getElementById("ts-error-banner"),
    // Dashboard metrics
    metricOnline:        document.getElementById("ts-metric-online"),
    metricTotal:         document.getElementById("ts-metric-total"),
    metricRelay:         document.getElementById("ts-metric-relay"),
    metricExitnode:      document.getElementById("ts-metric-exitnode"),
    metricTailnet:       document.getElementById("ts-metric-tailnet"),
    metricAccount:       document.getElementById("ts-metric-account"),
    dashboardPeerList:   document.getElementById("ts-dashboard-peer-list"),
    // Devices
    deviceRows:          document.getElementById("ts-device-rows"),
    devicesFilter:       document.getElementById("ts-devices-filter"),
    devicesSearch:       document.getElementById("ts-devices-search"),
    devicesSort:         document.getElementById("ts-devices-sort"),
    deviceModal:         document.getElementById("ts-device-modal"),
    deviceModalName:     document.getElementById("ts-modal-device-name"),
    deviceModalBody:     document.getElementById("ts-modal-body"),
    deviceModalActions:  document.getElementById("ts-modal-actions"),
    deviceModalClose:    document.getElementById("ts-modal-close"),
    // Exit nodes
    exitnodeList:        document.getElementById("ts-exitnode-list"),
    activeExitnodeLabel: document.getElementById("ts-active-exitnode-label"),
    disconnectExitnode:  document.getElementById("ts-disconnect-exitnode"),
    // Serve
    serveProtocol:       document.getElementById("ts-serve-protocol"),
    servePort:           document.getElementById("ts-serve-port"),
    serveTarget:         document.getElementById("ts-serve-target"),
    serveAddBtn:         document.getElementById("ts-serve-add-btn"),
    serveRoutes:         document.getElementById("ts-serve-routes"),
    serveStatus:         document.getElementById("ts-serve-status"),
    serveRefreshBtn:     document.getElementById("ts-serve-refresh-btn"),
    // Funnel
    funnelPort:          document.getElementById("ts-funnel-port"),
    funnelEnableBtn:     document.getElementById("ts-funnel-enable-btn"),
    funnelDisableBtn:    document.getElementById("ts-funnel-disable-btn"),
    funnelStatusBtn:     document.getElementById("ts-funnel-status-btn"),
    funnelStatusPill:    document.getElementById("ts-funnel-status-pill"),
    funnelDomainPreview: document.getElementById("ts-funnel-domain-preview"),
    funnelDomainUrl:     document.getElementById("ts-funnel-domain-url"),
    funnelInfo:          document.getElementById("ts-funnel-info"),
    // Files
    fileTargetDevice:    document.getElementById("ts-file-target-device"),
    filePath:            document.getElementById("ts-file-path"),
    filePickBtn:         document.getElementById("ts-file-pick-btn"),
    fileDropZone:        document.getElementById("ts-file-drop-zone"),
    fileSendBtn:         document.getElementById("ts-file-send-btn"),
    fileStatus:          document.getElementById("ts-file-status"),
    fileHistory:         document.getElementById("ts-file-history"),
    fileClearBtn:        document.getElementById("ts-file-clear-btn"),
    // Netcheck
    netcheckRunBtn:      document.getElementById("ts-netcheck-run-btn"),
    netcheckSummary:     document.getElementById("ts-netcheck-summary"),
    ncUdp:               document.getElementById("ts-nc-udp"),
    ncIpv4:              document.getElementById("ts-nc-ipv4"),
    ncIpv6:              document.getElementById("ts-nc-ipv6"),
    ncNat:               document.getElementById("ts-nc-nat"),
    netcheckDerp:        document.getElementById("ts-netcheck-derp"),
    netcheckStatus:      document.getElementById("ts-netcheck-status"),
    // DNS
    dnsRefreshBtn:       document.getElementById("ts-dns-refresh-btn"),
    dnsMagic:            document.getElementById("ts-dns-magic"),
    dnsDomain:           document.getElementById("ts-dns-domain"),
    dnsNameservers:      document.getElementById("ts-dns-nameservers"),
    dnsStatus:           document.getElementById("ts-dns-status"),
    // Certs
    certHostname:        document.getElementById("ts-cert-hostname"),
    certGetBtn:          document.getElementById("ts-cert-get-btn"),
    certResult:          document.getElementById("ts-cert-result"),
    certExpiry:          document.getElementById("ts-cert-expiry"),
    certPath:            document.getElementById("ts-cert-path"),
    certOpenBtn:         document.getElementById("ts-cert-open-btn"),
    certStatus:          document.getElementById("ts-cert-status"),
    // Console
    consoleOutput:       document.getElementById("ts-console-output"),
    consoleInput:        document.getElementById("ts-console-input"),
    consoleRunBtn:       document.getElementById("ts-console-run-btn"),
    consoleClearBtn:     document.getElementById("ts-console-clear-btn"),
    // System
    sysVersion:          document.getElementById("ts-sys-version"),
    sysClipath:          document.getElementById("ts-sys-clipath"),
    sysApiSource:        document.getElementById("ts-sys-apisource"),
    sysService:          document.getElementById("ts-sys-service"),
    sysAccount:          document.getElementById("ts-sys-account"),
    sysTailnet:          document.getElementById("ts-sys-tailnet"),
    sysDevice:           document.getElementById("ts-sys-device"),
    sysIp:               document.getElementById("ts-sys-ip"),
    sysLoginBtn:         document.getElementById("ts-sys-login-btn"),
    sysLogoutBtn:        document.getElementById("ts-sys-logout-btn"),
    sysLoginUrl:         document.getElementById("ts-sys-login-url"),
    sysLoginUrlText:     document.getElementById("ts-sys-login-url-text"),
    sysStatus:           document.getElementById("ts-sys-status"),
    sysInfoRefreshBtn:   document.getElementById("ts-sysinfo-refresh-btn"),
    // Quick action buttons
    quickNetcheck:       document.getElementById("ts-quick-netcheck"),
    quickStatus:         document.getElementById("ts-quick-status"),
    quickExitnode:       document.getElementById("ts-quick-exitnode"),
    quickServe:          document.getElementById("ts-quick-serve"),
    quickFunnel:         document.getElementById("ts-quick-funnel"),
    quickConsole:        document.getElementById("ts-quick-console"),
    quickAdminConsole:   document.getElementById("ts-quick-admin-console"),
    // Install link
    installLink:         document.getElementById("ts-install-link")
  };
}

// ─── Tab switching ─────────────────────────────────────────────────
function tsTabSwitch(tabName) {
  document.querySelectorAll(".ts-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tsTab === tabName);
  });
  document.querySelectorAll(".ts-tab-panel").forEach((panel) => {
    const isActive = panel.id === `ts-panel-${tabName}`;
    panel.classList.toggle("active", isActive);
  });
  tsState.activeTab = tabName;
}

// ─── Status pill helper ────────────────────────────────────────────
function tsSetStatusPill(text, state) {
  if (!tsUI.statusPill) return;
  tsUI.statusPill.textContent = text;
  tsUI.statusPill.className = `ts-status-pill ts-status-${state}`;
}

// ─── Peer state helpers ────────────────────────────────────────────
function tsGetPeerState(peer) {
  return peer.state || "unknown";
}

function tsFormatLastSeen(lastSeen) {
  if (!lastSeen) return "Never";
  const now = Date.now();
  const ts = new Date(lastSeen).getTime();
  const diffMs = now - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function tsStatusBadge(state) {
  const labels = { online: "Online", relay: "Relayed", offline: "Offline", unknown: "Unknown" };
  return `<span class="ts-badge ts-badge-${state}"><span class="ts-badge-dot"></span>${labels[state] || "Unknown"}</span>`;
}

function tsOsIcon(os) {
  const o = (os || "").toLowerCase();
  if (o.includes("windows")) return "🪟";
  if (o.includes("mac") || o.includes("darwin")) return "🍎";
  if (o.includes("linux")) return "🐧";
  if (o.includes("ios") || o.includes("iphone")) return "📱";
  if (o.includes("android")) return "🤖";
  return "💻";
}

function tsCopy(text) {
  navigator.clipboard.writeText(text).catch(() => {});
}

// ─── Dashboard ─────────────────────────────────────────────────────
function tsRenderDashboard() {
  const peers = tsState.peers;
  const online  = peers.filter((p) => tsGetPeerState(p) === "online").length;
  const relay   = peers.filter((p) => tsGetPeerState(p) === "relay").length;
  const total   = peers.length;

  if (tsUI.metricOnline) tsUI.metricOnline.textContent = online;
  if (tsUI.metricTotal)  tsUI.metricTotal.textContent  = total;
  if (tsUI.metricRelay)  tsUI.metricRelay.textContent  = relay;

  const exitPeer = peers.find((p) => p.exitNode);
  if (tsUI.metricExitnode) tsUI.metricExitnode.textContent = exitPeer ? (exitPeer.name || exitPeer.ip) : "None";

  const tailnet = tsState.self?.DNSName?.split(".").slice(1).join(".") || "—";
  if (tsUI.metricTailnet) tsUI.metricTailnet.textContent = tailnet;

  const account = tsState.self?.UserID ? (tsState.detection?.account || "—") : "—";
  if (tsUI.metricAccount) tsUI.metricAccount.textContent = account;

  // Peer mini-list
  if (tsUI.dashboardPeerList) {
    if (!peers.length) {
      tsUI.dashboardPeerList.innerHTML = `<div class="ts-device-empty">No peers found</div>`;
    } else {
      tsUI.dashboardPeerList.innerHTML = peers.slice(0, 20).map((p) => {
        const state = tsGetPeerState(p);
        return `<div class="ts-dashboard-peer-row">
          <span class="ts-badge ts-badge-${state}"><span class="ts-badge-dot"></span></span>
          <span class="ts-dashboard-peer-name">${tsOsIcon(p.os)} ${tsEsc(p.name || p.ip)}</span>
          <span class="ts-dashboard-peer-ip">${tsEsc(p.ip)}</span>
        </div>`;
      }).join("");
    }
  }
}

// ─── Devices tab ───────────────────────────────────────────────────
function tsGetFilteredPeers() {
  const filter = tsUI.devicesFilter?.value || "all";
  const search = (tsUI.devicesSearch?.value || "").toLowerCase();
  const sort   = tsUI.devicesSort?.value || "name";

  let peers = [...tsState.peers];

  // Filter
  if (filter !== "all") peers = peers.filter((p) => tsGetPeerState(p) === filter);

  // Search
  if (search) {
    peers = peers.filter((p) =>
      (p.name || "").toLowerCase().includes(search) ||
      (p.ip   || "").toLowerCase().includes(search) ||
      (p.os   || "").toLowerCase().includes(search) ||
      (p.user || "").toLowerCase().includes(search)
    );
  }

  // Sort
  peers.sort((a, b) => {
    switch (sort) {
      case "status": {
        const order = { online: 0, relay: 1, offline: 2, unknown: 3 };
        return (order[tsGetPeerState(a)] ?? 4) - (order[tsGetPeerState(b)] ?? 4);
      }
      case "ip":   return (a.ip || "").localeCompare(b.ip || "");
      case "os":   return (a.os || "").localeCompare(b.os || "");
      default:     return (a.name || "").localeCompare(b.name || "");
    }
  });

  return peers;
}

function tsEsc(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tsRenderDevices() {
  if (!tsUI.deviceRows) return;
  const peers = tsGetFilteredPeers();

  if (!peers.length) {
    tsUI.deviceRows.innerHTML = `<div class="ts-device-empty">No devices match your filter.</div>`;
    return;
  }

  tsUI.deviceRows.innerHTML = peers.map((peer) => {
    const state = tsGetPeerState(peer);
    const ip    = tsEsc(peer.ip);
    const name  = tsEsc(peer.name || peer.dnsName || peer.ip);
    const os    = tsEsc(peer.os || "Unknown");
    const seen  = tsFormatLastSeen(peer.lastSeen);
    const exitBadge = peer.exitNode ? " 🚀" : "";

    return `<div class="ts-device-row ts-${state}" data-peer-id="${tsEsc(peer.id)}">
      <span class="ts-device-name">${tsOsIcon(peer.os)} ${name}${exitBadge}</span>
      <span class="ts-device-os">${os}</span>
      <span class="ts-device-ip" title="${ip}">${ip}</span>
      <span>${tsStatusBadge(state)}</span>
      <span class="ts-device-seen">${seen}</span>
      <span class="ts-device-actions">
        <button class="ts-device-action-btn" onclick="tsCopy('${ip}')" title="Copy IP">📋 IP</button>
        <button class="ts-device-action-btn" onclick="tsOpenDeviceModal('${tsEsc(peer.id)}')" title="Details">🔍</button>
        <button class="ts-device-action-btn" onclick="tsPingDevice('${tsEsc(peer.ip)}')" title="Ping">📡 Ping</button>
        <button class="ts-device-action-btn" onclick="tsSshDevice('${tsEsc(peer.ip)}')" title="SSH">🔗 SSH</button>
        ${process.platform === "win32" ? `<button class="ts-device-action-btn" onclick="tsRdpDevice('${tsEsc(peer.ip)}')" title="RDP">🖥️</button>` : ""}
      </span>
    </div>`;
  }).join("");
}

// ─── Device modal ──────────────────────────────────────────────────
function tsOpenDeviceModal(peerId) {
  const peer = tsState.peers.find((p) => p.id === peerId);
  if (!peer || !tsUI.deviceModal) return;

  tsUI.deviceModalName.textContent = `${tsOsIcon(peer.os)} ${peer.name || peer.ip}`;

  tsUI.deviceModalBody.innerHTML = `
    <div class="overview-table">
      <div class="overview-row"><span>Name</span><strong>${tsEsc(peer.name)}</strong></div>
      <div class="overview-row"><span>DNS Name</span><strong>${tsEsc(peer.dnsName)}</strong></div>
      <div class="overview-row"><span>OS</span><strong>${tsEsc(peer.os)}</strong></div>
      <div class="overview-row"><span>User</span><strong>${tsEsc(peer.user)}</strong></div>
      <div class="overview-row"><span>Tailscale IP</span><strong><span class="ts-device-ip">${tsEsc(peer.ip)}</span> <button class="ts-copy-btn" onclick="tsCopy('${tsEsc(peer.ip)}')">Copy</button></strong></div>
      <div class="overview-row"><span>Status</span><strong>${tsStatusBadge(tsGetPeerState(peer))}</strong></div>
      <div class="overview-row"><span>Last seen</span><strong>${tsFormatLastSeen(peer.lastSeen)}</strong></div>
      <div class="overview-row"><span>Relay</span><strong>${tsEsc(peer.relay || "Direct")}</strong></div>
      <div class="overview-row"><span>Exit node</span><strong>${peer.exitNodeOption ? "Available" : "No"} ${peer.exitNode ? " (Active)" : ""}</strong></div>
      ${peer.tags?.length ? `<div class="overview-row"><span>Tags</span><strong>${peer.tags.map(tsEsc).join(", ")}</strong></div>` : ""}
    </div>
  `;

  tsUI.deviceModalActions.innerHTML = `
    <button class="primary-button" onclick="tsSshDevice('${tsEsc(peer.ip)}')">🔗 SSH</button>
    <button onclick="tsPingDevice('${tsEsc(peer.ip)}')">📡 Ping</button>
    <button onclick="tsCopy('${tsEsc(peer.ip)}')">📋 Copy IP</button>
    <button onclick="tsCopy('${tsEsc(peer.dnsName || peer.name)}')">📋 Copy Hostname</button>
    ${peer.exitNodeOption ? `<button onclick="tsSetExitNode('${tsEsc(peer.ip)}')">🚀 Use as Exit Node</button>` : ""}
    ${process.platform === "win32" ? `<button onclick="tsRdpDevice('${tsEsc(peer.ip)}')">🖥️ RDP</button>` : ""}
  `;

  tsUI.deviceModal.classList.remove("hidden");
}

// ─── Device actions ────────────────────────────────────────────────
async function tsPingDevice(ip) {
  tsConsoleAppend(`$ tailscale ping ${ip}`, "ts-cmd");
  tsTabSwitch("console");
  try {
    const res = await window.desktopAPI.tailscalePing(ip);
    tsConsoleAppend(res.stdout || res.stderr || "(no output)", res.code === 0 ? "ts-out" : "ts-err");
  } catch (e) {
    tsConsoleAppend(`Error: ${e.message}`, "ts-err");
  }
}

async function tsSshDevice(ip) {
  try {
    await window.desktopAPI.tailscaleSsh({ host: ip });
  } catch (e) {
    tsShowError(`SSH failed: ${e.message}`);
  }
}

async function tsRdpDevice(ip) {
  try {
    await window.desktopAPI.tailscaleRdp(ip);
  } catch (e) {
    tsShowError(`RDP failed: ${e.message}`);
  }
}

async function tsSetExitNode(nodeId) {
  try {
    const res = await window.desktopAPI.tailscaleSetExitNode(nodeId);
    if (res.ok) {
      tsShowSuccess(`Exit node set to ${nodeId}.`);
      await tsLoadExitNodes();
    } else {
      tsShowError(res.stderr || "Failed to set exit node.");
    }
  } catch (e) {
    tsShowError(e.message);
  }
}

// ─── Exit Nodes ────────────────────────────────────────────────────
async function tsLoadExitNodes() {
  if (!tsUI.exitnodeList) return;
  tsUI.exitnodeList.innerHTML = `<div class="ts-loading-row">Loading exit nodes</div>`;
  try {
    const res = await window.desktopAPI.tailscaleExitNodes();
    tsState.exitNodes = res.exitNodes || [];
    const activeId = res.activeNodeId;

    if (tsUI.activeExitnodeLabel) {
      const active = tsState.exitNodes.find((n) => n.active || n.id === activeId);
      tsUI.activeExitnodeLabel.textContent = active ? `Active: ${active.name || active.ip}` : "No exit node active";
    }

    if (!tsState.exitNodes.length) {
      tsUI.exitnodeList.innerHTML = `<div class="ts-device-empty">No exit nodes available in your tailnet.</div>`;
      return;
    }

    tsUI.exitnodeList.innerHTML = tsState.exitNodes.map((node) => {
      const isActive = node.active || node.id === activeId;
      const stateClass = isActive ? "ts-active" : "";
      const location = [node.city, node.country].filter(Boolean).join(", ");
      return `<div class="ts-exitnode-card ${stateClass}">
        <div>
          <div class="ts-exitnode-name">${tsOsIcon("")} ${tsEsc(node.name || node.ip)}</div>
          <div class="ts-exitnode-detail">${tsEsc(node.ip)}${location ? ` · ${tsEsc(location)}` : ""}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          ${node.online ? tsStatusBadge("online") : tsStatusBadge("offline")}
          ${isActive
            ? `<button onclick="tsDisconnectExitNode()" class="danger-button" style="padding:4px 10px;font-size:0.82rem">Disconnect</button>`
            : `<button onclick="tsSetExitNode('${tsEsc(node.ip)}')" class="primary-button" style="padding:4px 10px;font-size:0.82rem">Connect</button>`
          }
        </div>
      </div>`;
    }).join("");
  } catch (e) {
    tsUI.exitnodeList.innerHTML = `<div class="ts-device-empty">Error: ${tsEsc(e.message)}</div>`;
  }
}

async function tsDisconnectExitNode() {
  try {
    const res = await window.desktopAPI.tailscaleSetExitNode("");
    if (res.ok) {
      tsShowSuccess("Disconnected from exit node.");
      await tsLoadExitNodes();
    }
  } catch (e) {
    tsShowError(e.message);
  }
}

// ─── Serve ─────────────────────────────────────────────────────────
async function tsLoadServeStatus() {
  if (!tsUI.serveRoutes) return;
  tsUI.serveRoutes.innerHTML = `<div class="ts-loading-row">Loading serve config</div>`;
  try {
    const res = await window.desktopAPI.tailscaleServeStatus();
    tsState.serveConfig = res;
    tsRenderServeRoutes(res);
  } catch (e) {
    if (tsUI.serveStatus) tsUI.serveStatus.textContent = `Error: ${e.message}`;
  }
}

function tsRenderServeRoutes(res) {
  if (!tsUI.serveRoutes) return;
  const data = res?.data;

  // Try to parse serve config structure
  let routes = [];
  if (data?.TCP) {
    for (const [port, cfg] of Object.entries(data.TCP || {})) {
      routes.push({ path: `tcp:${port}`, target: cfg.To || JSON.stringify(cfg) });
    }
  }
  if (data?.Web) {
    for (const [host, webCfg] of Object.entries(data.Web || {})) {
      for (const [mountPath, handler] of Object.entries(webCfg?.Handlers || {})) {
        routes.push({ path: `${host}${mountPath}`, target: handler.Proxy || handler.Path || JSON.stringify(handler) });
      }
    }
  }

  if (!routes.length) {
    tsUI.serveRoutes.innerHTML = `<div class="ts-serve-empty">No serve routes configured. Add one above.</div>`;
    return;
  }

  tsUI.serveRoutes.innerHTML = routes.map((r) => `
    <div class="ts-serve-route">
      <div class="ts-serve-route-info">
        <span class="ts-serve-route-path">${tsEsc(r.path)}</span>
        <span class="ts-serve-route-target">→ ${tsEsc(r.target)}</span>
      </div>
      <button class="danger-button" style="padding:4px 10px;font-size:0.82rem" 
        onclick="tsRemoveServeRoute('${tsEsc(r.path)}')">Remove</button>
    </div>
  `).join("");
}

async function tsAddServeRoute() {
  const protocol = tsUI.serveProtocol?.value || "https";
  const port     = tsUI.servePort?.value || "443";
  const target   = tsUI.serveTarget?.value?.trim() || "";

  if (!target) {
    if (tsUI.serveStatus) tsUI.serveStatus.textContent = "Please enter a target.";
    return;
  }
  if (tsUI.serveStatus) tsUI.serveStatus.textContent = "Adding route…";
  try {
    const res = await window.desktopAPI.tailscaleServeAdd({ protocol, port, target });
    if (res.ok) {
      if (tsUI.serveStatus) tsUI.serveStatus.textContent = "Route added.";
      if (tsUI.serveTarget) tsUI.serveTarget.value = "";
      await tsLoadServeStatus();
    } else {
      if (tsUI.serveStatus) tsUI.serveStatus.textContent = `Error: ${res.stderr || "Failed"}`;
    }
  } catch (e) {
    if (tsUI.serveStatus) tsUI.serveStatus.textContent = `Error: ${e.message}`;
  }
}

async function tsRemoveServeRoute(path) {
  const match = path.match(/^(https?|tcp):(\d+)/);
  const protocol = match ? match[1] : "https";
  const port     = match ? match[2] : "443";
  try {
    const res = await window.desktopAPI.tailscaleServeRemove({ protocol, port });
    if (res.ok) await tsLoadServeStatus();
    else if (tsUI.serveStatus) tsUI.serveStatus.textContent = `Remove failed: ${res.stderr}`;
  } catch (e) {
    if (tsUI.serveStatus) tsUI.serveStatus.textContent = `Error: ${e.message}`;
  }
}

// ─── Funnel ────────────────────────────────────────────────────────
async function tsLoadFunnelStatus() {
  try {
    const res = await window.desktopAPI.tailscaleFunnelStatus();
    tsState.funnelInfo = res;
    const isEnabled = Boolean(res?.data && Object.keys(res.data).length);
    if (tsUI.funnelStatusPill) {
      tsUI.funnelStatusPill.textContent = isEnabled ? "Enabled" : "Disabled";
      tsUI.funnelStatusPill.className = `ts-status-pill ts-status-${isEnabled ? "online" : "offline"}`;
    }
    if (tsUI.funnelInfo) tsUI.funnelInfo.textContent = res?.raw || "Funnel status loaded.";
  } catch (e) {
    if (tsUI.funnelInfo) tsUI.funnelInfo.textContent = `Error: ${e.message}`;
  }
}

async function tsSetFunnel(enable) {
  const port = tsUI.funnelPort?.value || "443";
  if (tsUI.funnelInfo) tsUI.funnelInfo.textContent = `${enable ? "Enabling" : "Disabling"} funnel…`;
  try {
    const res = await window.desktopAPI.tailscaleFunnelSet({ port, enable });
    if (res.ok) {
      if (tsUI.funnelInfo) tsUI.funnelInfo.textContent = `Funnel ${enable ? "enabled" : "disabled"}.`;
      await tsLoadFunnelStatus();
    } else {
      if (tsUI.funnelInfo) tsUI.funnelInfo.textContent = `Error: ${res.stderr || "Failed"}`;
    }
  } catch (e) {
    if (tsUI.funnelInfo) tsUI.funnelInfo.textContent = `Error: ${e.message}`;
  }
}

// ─── Netcheck ──────────────────────────────────────────────────────
async function tsRunNetcheck() {
  if (!tsUI.netcheckStatus) return;
  tsUI.netcheckStatus.textContent = "Running netcheck…";
  if (tsUI.netcheckDerp) tsUI.netcheckDerp.innerHTML = `<div class="ts-loading-row">Running network check</div>`;
  if (tsUI.netcheckSummary) tsUI.netcheckSummary.classList.add("hidden");

  try {
    const res = await window.desktopAPI.tailscaleNetcheck();
    tsState.netcheck = res;
    const data = res?.data;
    tsUI.netcheckStatus.textContent = "";

    if (data) {
      if (tsUI.netcheckSummary) tsUI.netcheckSummary.classList.remove("hidden");
      if (tsUI.ncUdp)  tsUI.ncUdp.textContent  = data.UDP ? "✅ Yes" : "❌ No";
      if (tsUI.ncIpv4) tsUI.ncIpv4.textContent = data.GlobalV4 || "❌ None";
      if (tsUI.ncIpv6) tsUI.ncIpv6.textContent = data.GlobalV6 || "❌ None";
      if (tsUI.ncNat)  tsUI.ncNat.textContent  = data.MappingVariesByDestIP ? "⚠️ Yes (Symmetric NAT)" : "✅ No";

      // DERP latencies
      const derpMap = data.RegionLatency || {};
      if (tsUI.netcheckDerp) {
        if (!Object.keys(derpMap).length) {
          tsUI.netcheckDerp.innerHTML = `<div class="ts-device-empty">No DERP relay data available.</div>`;
        } else {
          tsUI.netcheckDerp.innerHTML = Object.entries(derpMap).map(([region, latMs]) => {
            const ms = Math.round(latMs * 1000);
            const cls = ms < 50 ? "ts-fast" : ms < 150 ? "ts-medium" : "ts-slow";
            const label = ms >= 0 ? `${ms}ms` : "Unavailable";
            return `<div class="ts-derp-card">
              <div class="ts-derp-region">DERP ${region}</div>
              <div class="ts-derp-latency ${ms >= 0 ? cls : "ts-none"}">${label}</div>
            </div>`;
          }).join("");
        }
      }
    } else if (res?.raw) {
      tsUI.netcheckStatus.textContent = res.raw;
      if (tsUI.netcheckDerp) tsUI.netcheckDerp.innerHTML = "";
    }
  } catch (e) {
    tsUI.netcheckStatus.textContent = `Error: ${e.message}`;
    if (tsUI.netcheckDerp) tsUI.netcheckDerp.innerHTML = "";
  }
}

// ─── DNS ───────────────────────────────────────────────────────────
async function tsLoadDns() {
  if (tsUI.dnsStatus) tsUI.dnsStatus.textContent = "Loading DNS…";
  try {
    const res = await window.desktopAPI.tailscaleDns();
    tsState.dns = res;

    if (tsUI.dnsMagic)  tsUI.dnsMagic.textContent  = res.magicDns  ? "✅ Enabled" : "❌ Disabled";
    if (tsUI.dnsDomain) tsUI.dnsDomain.textContent = (res.domains || []).join(", ") || "—";

    if (tsUI.dnsNameservers) {
      const ns = res.nameservers || [];
      if (!ns.length) {
        tsUI.dnsNameservers.innerHTML = `<div class="ts-file-history-empty">No custom nameservers configured.</div>`;
      } else {
        tsUI.dnsNameservers.innerHTML = ns.map((n) => {
          const addr = typeof n === "string" ? n : (n.Addr || JSON.stringify(n));
          return `<div class="ts-dns-ns-row">
            <span class="ts-dns-ns-addr">${tsEsc(addr)}</span>
            <span class="ts-dns-ns-type">Resolver</span>
          </div>`;
        }).join("");
      }
    }

    if (tsUI.dnsStatus) tsUI.dnsStatus.textContent = `Source: ${res.source || "unknown"}`;
  } catch (e) {
    if (tsUI.dnsStatus) tsUI.dnsStatus.textContent = `Error: ${e.message}`;
  }
}

// ─── Certs ─────────────────────────────────────────────────────────
async function tsGetCert() {
  const hostname = tsUI.certHostname?.value?.trim() || "";
  if (!hostname) {
    if (tsUI.certStatus) tsUI.certStatus.textContent = "Please enter a hostname.";
    return;
  }
  if (tsUI.certStatus) tsUI.certStatus.textContent = "Generating certificate…";
  if (tsUI.certResult) tsUI.certResult.classList.add("hidden");

  try {
    const res = await window.desktopAPI.tailscaleCertGet(hostname);
    if (tsUI.certExpiry) tsUI.certExpiry.textContent = res.expiry || "Unknown";
    if (tsUI.certPath)   tsUI.certPath.textContent   = res.certPath || "—";
    if (tsUI.certResult) tsUI.certResult.classList.remove("hidden");
    if (tsUI.certStatus) tsUI.certStatus.textContent = "Certificate generated successfully.";

    // Store dir for open button
    tsUI.certOpenBtn._certDir = res.directory;
  } catch (e) {
    if (tsUI.certStatus) tsUI.certStatus.textContent = `Error: ${e.message}`;
  }
}

// ─── Console ───────────────────────────────────────────────────────
function tsConsoleAppend(text, cls = "ts-out") {
  if (!tsUI.consoleOutput) return;
  const line = document.createElement("span");
  line.className = `ts-console-line ${cls}`;
  line.textContent = text;
  tsUI.consoleOutput.appendChild(line);
  tsUI.consoleOutput.appendChild(document.createElement("br"));
  tsUI.consoleOutput.scrollTop = tsUI.consoleOutput.scrollHeight;
}

async function tsRunConsoleCommand() {
  const raw = tsUI.consoleInput?.value?.trim() || "";
  if (!raw) return;

  tsState.consoleHistory.unshift(raw);
  tsState.consoleHistoryIndex = -1;
  if (tsUI.consoleInput) tsUI.consoleInput.value = "";

  tsConsoleAppend(`tailscale> ${raw}`, "ts-cmd");

  try {
    const args = raw.split(/\s+/).filter(Boolean);
    const res = await window.desktopAPI.tailscaleRunCommand(args);
    if (res.stdout) tsConsoleAppend(res.stdout.trimEnd(), "ts-out");
    if (res.stderr) tsConsoleAppend(res.stderr.trimEnd(), "ts-err");
    if (!res.stdout && !res.stderr) tsConsoleAppend("(no output)", "ts-info");
  } catch (e) {
    tsConsoleAppend(`Error: ${e.message}`, "ts-err");
  }
}

// ─── System Info ───────────────────────────────────────────────────
async function tsLoadSystemInfo() {
  if (tsUI.sysStatus) tsUI.sysStatus.textContent = "Loading system info…";
  const det = tsState.detection;

  if (tsUI.sysVersion)   tsUI.sysVersion.textContent   = det?.version || "—";
  if (tsUI.sysClipath)   tsUI.sysClipath.textContent   = det?.cliPath || "Not found";
  if (tsUI.sysApiSource) tsUI.sysApiSource.textContent = det?.apiSource || "—";
  if (tsUI.sysService)   tsUI.sysService.textContent   = det?.found ? "Running" : "Not found";
  if (tsUI.sysStatus)    tsUI.sysStatus.textContent    = "";

  try {
    const { data } = await window.desktopAPI.tailscaleStatus();
    const self = data?.Self;
    if (self) {
      if (tsUI.sysDevice)  tsUI.sysDevice.textContent  = self.HostName || "—";
      if (tsUI.sysIp)      tsUI.sysIp.textContent      = (self.TailscaleIPs || [])[0] || "—";
      const tailnet = self.DNSName?.split(".").slice(1).join(".") || "—";
      if (tsUI.sysTailnet) tsUI.sysTailnet.textContent = tailnet;
    }
    const user = data?.User;
    if (user) {
      const firstUser = Object.values(user)[0];
      if (firstUser && tsUI.sysAccount) tsUI.sysAccount.textContent = firstUser.LoginName || firstUser.DisplayName || "—";
    }
  } catch (e) {
    if (tsUI.sysStatus) tsUI.sysStatus.textContent = `Could not load status: ${e.message}`;
  }
}

// ─── Login / Logout ────────────────────────────────────────────────
async function tsLogin() {
  try {
    const res = await window.desktopAPI.tailscaleLogin();
    if (res.url && tsUI.sysLoginUrl && tsUI.sysLoginUrlText) {
      tsUI.sysLoginUrlText.textContent = res.url;
      tsUI.sysLoginUrl.classList.remove("hidden");
    }
    tsShowSuccess("Login started — check your browser.");
  } catch (e) {
    tsShowError(`Login failed: ${e.message}`);
  }
}

async function tsLogout() {
  try {
    const res = await window.desktopAPI.tailscaleLogout();
    if (res.ok) tsShowSuccess("Logged out.");
    else tsShowError(res.stderr || "Logout failed.");
  } catch (e) {
    tsShowError(`Logout failed: ${e.message}`);
  }
}

// ─── Banner helpers ────────────────────────────────────────────────
function tsShowError(msg) {
  if (!tsUI.errorBanner) return;
  tsUI.errorBanner.textContent = msg;
  tsUI.errorBanner.classList.remove("hidden");
  setTimeout(() => tsUI.errorBanner?.classList.add("hidden"), 6000);
}

function tsShowSuccess(msg) {
  // Reuse error banner as success (green tint via temp class override)
  if (!tsUI.errorBanner) return;
  tsUI.errorBanner.textContent = msg;
  tsUI.errorBanner.style.background = "var(--success-bg)";
  tsUI.errorBanner.style.color      = "var(--success-color)";
  tsUI.errorBanner.style.borderColor = "rgba(74,222,128,0.3)";
  tsUI.errorBanner.classList.remove("hidden");
  setTimeout(() => {
    tsUI.errorBanner?.classList.add("hidden");
    if (tsUI.errorBanner) {
      tsUI.errorBanner.style.background  = "";
      tsUI.errorBanner.style.color       = "";
      tsUI.errorBanner.style.borderColor = "";
    }
  }, 4000);
}

// ─── File transfer ─────────────────────────────────────────────────
function tsPopulateFileDevices() {
  if (!tsUI.fileTargetDevice) return;
  tsUI.fileTargetDevice.innerHTML = `<option value="">Select a device...</option>` +
    tsState.peers
      .filter((p) => tsGetPeerState(p) === "online" || tsGetPeerState(p) === "relay")
      .map((p) => `<option value="${tsEsc(p.ip)}">${tsEsc(p.name || p.ip)}</option>`)
      .join("");
}

async function tsPickFile() {
  try {
    const filePath = await window.desktopAPI.tailscaleFilePick();
    if (filePath) {
      tsState.selectedFilePath = filePath;
      const parts = filePath.replace(/\\/g, "/").split("/");
      if (tsUI.filePath) tsUI.filePath.value = filePath;
    }
  } catch (e) {
    if (tsUI.fileStatus) tsUI.fileStatus.textContent = `Error: ${e.message}`;
  }
}

async function tsSendFile() {
  const target   = tsUI.fileTargetDevice?.value || "";
  const filePath = tsState.selectedFilePath || "";

  if (!target)   { if (tsUI.fileStatus) tsUI.fileStatus.textContent = "Select a target device."; return; }
  if (!filePath) { if (tsUI.fileStatus) tsUI.fileStatus.textContent = "Select a file to send."; return; }

  if (tsUI.fileStatus) tsUI.fileStatus.textContent = "Sending file…";
  if (tsUI.fileSendBtn) tsUI.fileSendBtn.disabled = true;

  try {
    const res = await window.desktopAPI.tailscaleFileSend({ target, filePath });
    const status = res.ok ? "✅ Sent" : `❌ Failed: ${res.stderr || "Unknown error"}`;
    if (tsUI.fileStatus) tsUI.fileStatus.textContent = status;

    const parts = filePath.replace(/\\/g, "/").split("/");
    tsState.fileTransferLog.unshift({
      name: parts[parts.length - 1],
      target,
      status: res.ok ? "success" : "failed",
      time: new Date().toLocaleTimeString()
    });
    tsRenderFileHistory();
  } catch (e) {
    if (tsUI.fileStatus) tsUI.fileStatus.textContent = `Error: ${e.message}`;
  } finally {
    if (tsUI.fileSendBtn) tsUI.fileSendBtn.disabled = false;
  }
}

function tsRenderFileHistory() {
  if (!tsUI.fileHistory) return;
  if (!tsState.fileTransferLog.length) {
    tsUI.fileHistory.innerHTML = `<div class="ts-file-history-empty">No transfers yet.</div>`;
    return;
  }
  tsUI.fileHistory.innerHTML = tsState.fileTransferLog.slice(0, 30).map((entry) => `
    <div class="ts-file-history-row">
      <span class="ts-file-history-name">${tsEsc(entry.name)}</span>
      <span class="ts-file-history-meta">${entry.status === "success" ? "✅" : "❌"} → ${tsEsc(entry.target)} · ${entry.time}</span>
    </div>
  `).join("");
}

// ─── Main init ─────────────────────────────────────────────────────
async function initTailscaleScreen() {
  if (tsState.initialized) return;
  tsState.initialized = true;
  tsBindUI();
  tsSetStatusPill("Detecting…", "unknown");

  // Bind tab buttons
  document.querySelectorAll(".ts-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tsTab;
      tsTabSwitch(tab);
      if (tab === "exitnodes") tsLoadExitNodes();
      else if (tab === "serve")  tsLoadServeStatus();
      else if (tab === "funnel") tsLoadFunnelStatus();
      else if (tab === "dns")    tsLoadDns();
      else if (tab === "system") tsLoadSystemInfo();
      else if (tab === "files")  tsPopulateFileDevices();
    });
  });

  // Quick action buttons
  if (tsUI.quickNetcheck) tsUI.quickNetcheck.addEventListener("click", () => { tsTabSwitch("netcheck"); tsRunNetcheck(); });
  if (tsUI.quickStatus)   tsUI.quickStatus.addEventListener("click", () => { tsTabSwitch("console"); tsRunConsoleCommand_direct("status"); });
  if (tsUI.quickExitnode) tsUI.quickExitnode.addEventListener("click", () => { tsTabSwitch("exitnodes"); tsLoadExitNodes(); });
  if (tsUI.quickServe)    tsUI.quickServe.addEventListener("click", () => { tsTabSwitch("serve"); tsLoadServeStatus(); });
  if (tsUI.quickFunnel)   tsUI.quickFunnel.addEventListener("click", () => { tsTabSwitch("funnel"); tsLoadFunnelStatus(); });
  if (tsUI.quickConsole)  tsUI.quickConsole.addEventListener("click", () => tsTabSwitch("console"));
  if (tsUI.quickAdminConsole) {
    tsUI.quickAdminConsole.addEventListener("click", () => {
      const url = "https://login.tailscale.com/admin/machines";
      if (window.desktopAPI?.openExternal) window.desktopAPI.openExternal(url);
      else window.open(url, "_blank");
    });
  }

  // Refresh / login / logout buttons
  if (tsUI.refreshBtn) tsUI.refreshBtn.addEventListener("click", () => tsRefreshAll());
  if (tsUI.loginBtn)   tsUI.loginBtn.addEventListener("click", () => tsLogin());
  if (tsUI.logoutBtn)  tsUI.logoutBtn.addEventListener("click", () => tsLogout());
  if (tsUI.adminConsoleBtn) {
    tsUI.adminConsoleBtn.addEventListener("click", () => {
      const url = "https://login.tailscale.com/admin/machines";
      if (window.desktopAPI?.openExternal) window.desktopAPI.openExternal(url);
      else window.open(url, "_blank");
    });
  }

  // Device search/filter/sort live update
  if (tsUI.devicesSearch) tsUI.devicesSearch.addEventListener("input", tsRenderDevices);
  if (tsUI.devicesFilter) tsUI.devicesFilter.addEventListener("change", tsRenderDevices);
  if (tsUI.devicesSort)   tsUI.devicesSort.addEventListener("change", tsRenderDevices);

  // Device modal close
  if (tsUI.deviceModalClose) {
    tsUI.deviceModalClose.addEventListener("click", () => tsUI.deviceModal?.classList.add("hidden"));
  }
  if (tsUI.deviceModal) {
    tsUI.deviceModal.addEventListener("click", (e) => {
      if (e.target === tsUI.deviceModal) tsUI.deviceModal.classList.add("hidden");
    });
  }

  // Exit nodes disconnect
  if (tsUI.disconnectExitnode) tsUI.disconnectExitnode.addEventListener("click", () => tsDisconnectExitNode());

  // Serve add
  if (tsUI.serveAddBtn)     tsUI.serveAddBtn.addEventListener("click", tsAddServeRoute);
  if (tsUI.serveRefreshBtn) tsUI.serveRefreshBtn.addEventListener("click", tsLoadServeStatus);

  // Funnel buttons
  if (tsUI.funnelEnableBtn)  tsUI.funnelEnableBtn.addEventListener("click",  () => tsSetFunnel(true));
  if (tsUI.funnelDisableBtn) tsUI.funnelDisableBtn.addEventListener("click", () => tsSetFunnel(false));
  if (tsUI.funnelStatusBtn)  tsUI.funnelStatusBtn.addEventListener("click",  () => tsLoadFunnelStatus());

  // Netcheck
  if (tsUI.netcheckRunBtn) tsUI.netcheckRunBtn.addEventListener("click", tsRunNetcheck);

  // DNS
  if (tsUI.dnsRefreshBtn) tsUI.dnsRefreshBtn.addEventListener("click", tsLoadDns);

  // Certs
  if (tsUI.certGetBtn) tsUI.certGetBtn.addEventListener("click", tsGetCert);
  if (tsUI.certOpenBtn) {
    tsUI.certOpenBtn.addEventListener("click", () => {
      const dir = tsUI.certOpenBtn._certDir;
      if (dir && window.desktopAPI?.openPath) window.desktopAPI.openPath(dir);
    });
  }

  // Console
  if (tsUI.consoleRunBtn)  tsUI.consoleRunBtn.addEventListener("click", tsRunConsoleCommand);
  if (tsUI.consoleClearBtn) tsUI.consoleClearBtn.addEventListener("click", () => {
    if (tsUI.consoleOutput) tsUI.consoleOutput.innerHTML = "";
  });
  if (tsUI.consoleInput) {
    tsUI.consoleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        tsRunConsoleCommand();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        tsState.consoleHistoryIndex = Math.min(tsState.consoleHistoryIndex + 1, tsState.consoleHistory.length - 1);
        if (tsState.consoleHistory[tsState.consoleHistoryIndex]) {
          tsUI.consoleInput.value = tsState.consoleHistory[tsState.consoleHistoryIndex];
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        tsState.consoleHistoryIndex = Math.max(tsState.consoleHistoryIndex - 1, -1);
        tsUI.consoleInput.value = tsState.consoleHistory[tsState.consoleHistoryIndex] || "";
      } else if (e.key === "Tab") {
        e.preventDefault();
        const completions = ["status", "ping", "netcheck", "version", "whois", "ip", "up", "down", "serve status", "funnel status", "file ls", "metrics"];
        const val = tsUI.consoleInput.value;
        const match = completions.find((c) => c.startsWith(val) && c !== val);
        if (match) tsUI.consoleInput.value = match;
      }
    });
  }

  // System info
  if (tsUI.sysInfoRefreshBtn) tsUI.sysInfoRefreshBtn.addEventListener("click", tsLoadSystemInfo);
  if (tsUI.sysLoginBtn)  tsUI.sysLoginBtn.addEventListener("click",  tsLogin);
  if (tsUI.sysLogoutBtn) tsUI.sysLogoutBtn.addEventListener("click", tsLogout);

  // File transfer
  if (tsUI.filePickBtn) tsUI.filePickBtn.addEventListener("click", tsPickFile);
  if (tsUI.fileSendBtn) tsUI.fileSendBtn.addEventListener("click", tsSendFile);
  if (tsUI.fileClearBtn) tsUI.fileClearBtn.addEventListener("click", () => {
    tsState.fileTransferLog = [];
    tsRenderFileHistory();
  });

  // File drag-and-drop
  if (tsUI.fileDropZone) {
    tsUI.fileDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      tsUI.fileDropZone.classList.add("ts-drag-over");
    });
    tsUI.fileDropZone.addEventListener("dragleave", () => tsUI.fileDropZone.classList.remove("ts-drag-over"));
    tsUI.fileDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      tsUI.fileDropZone.classList.remove("ts-drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file?.path) {
        tsState.selectedFilePath = file.path;
        if (tsUI.filePath) tsUI.filePath.value = file.path;
      }
    });
  }

  // Install link — open external
  if (tsUI.installLink) {
    tsUI.installLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (window.desktopAPI?.openExternal) window.desktopAPI.openExternal("https://tailscale.com/download");
      else window.open("https://tailscale.com/download", "_blank");
    });
  }

  // Subscribe to background peer updates
  if (window.desktopAPI?.onTailscalePeerUpdate) {
    window.desktopAPI.onTailscalePeerUpdate((payload) => {
      if (!payload?.peers) return;
      tsState.peers = payload.peers.map(normalizePeerFromMonitor);
      if (tsState.activeTab === "dashboard") tsRenderDashboard();
      if (tsState.activeTab === "devices")   tsRenderDevices();
    });
  }
  if (window.desktopAPI?.onTailscaleNotification) {
    window.desktopAPI.onTailscaleNotification((payload) => {
      const icon = payload.type === "online" ? "🟢" : "🔴";
      tsConsoleAppend(`${icon} ${payload.name} is now ${payload.type}`, "ts-info");
    });
  }

  // Detect Tailscale
  await tsRefreshAll();
}

function normalizePeerFromMonitor(raw) {
  // If it's already normalized (has .state), return as-is
  if (raw.state) return raw;
  const state = raw.Online ? (raw.Relay ? "relay" : "online") : (raw.LastSeen ? "offline" : "unknown");
  return {
    id: raw.ID || raw.PublicKey,
    name: raw.HostName || raw.DNSName || "",
    dnsName: raw.DNSName || "",
    os: raw.OS || "",
    ip: (raw.TailscaleIPs || [])[0] || "",
    online: raw.Online || false,
    relay: raw.Relay || "",
    state,
    lastSeen: raw.LastSeen || null,
    exitNode: raw.ExitNode || false,
    exitNodeOption: raw.ExitNodeOption || false,
    tags: raw.Tags || [],
    allowedIPs: raw.AllowedIPs || []
  };
}

async function tsRunConsoleCommand_direct(cmd) {
  if (tsUI.consoleInput) tsUI.consoleInput.value = cmd;
  await tsRunConsoleCommand();
}

async function tsRefreshAll() {
  tsSetStatusPill("Detecting…", "unknown");

  try {
    // Detect CLI
    const detection = await window.desktopAPI.tailscaleDetect();
    tsState.detection = detection;

    if (!detection.found) {
      tsSetStatusPill("Not installed", "offline");
      if (tsUI.notInstalledBanner) tsUI.notInstalledBanner.classList.remove("hidden");
      return;
    }

    if (tsUI.notInstalledBanner) tsUI.notInstalledBanner.classList.add("hidden");

    // Load peers
    const peersData = await window.desktopAPI.tailscalePeers();
    tsState.peers = peersData.peers || [];
    tsState.self  = peersData.self  || null;

    const online = tsState.peers.filter((p) => p.state === "online").length;
    const total  = tsState.peers.length;

    tsSetStatusPill(`${online}/${total} online`, online > 0 ? "online" : "relay");

    // Render current tab
    tsRenderDashboard();
    tsRenderDevices();
    tsPopulateFileDevices();

    // Start monitor (5s polls)
    await window.desktopAPI.tailscaleStartMonitor(5000);

  } catch (e) {
    tsSetStatusPill("Error", "offline");
    tsShowError(`Detection failed: ${e.message}`);
    if (tsUI.notInstalledBanner) tsUI.notInstalledBanner.classList.remove("hidden");
  }
}

// ─── Hook into navigation: init when any cockpit screen is shown ────
(function () {
  const originalNavHandler = window._cockpitNavHandlerHooked;
  if (originalNavHandler) return;
  window._cockpitNavHandlerHooked = true;

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-screen]");
    if (btn) {
      const screen = btn.dataset.screen;
      setTimeout(() => {
        if (screen === "tailscale") initTailscaleScreen();
        else if (screen === "terminal") initTerminalScreen();
        else if (screen === "database") initDatabaseScreen();
        else if (screen === "git") initGitScreen();
        else if (screen === "wpcli") initWpCliScreen();
        else if (screen === "backups") initBackupsScreen();
        else if (screen === "deploy") initDeployScreen();
        else if (screen === "ai") initAiScreen();
        else if (screen === "devops_docker") initDockerScreen();
        else if (screen === "devops_compose") initDockerComposeScreen();
        else if (screen === "devops_k8s") initKubernetesScreen();
        else if (screen === "devops_cicd") initCicdRunnerScreen();
        else if (screen === "devops_monitor") initServerMonitorScreen();
        else if (screen === "prod_notes") initNotesWorkspaceScreen();
        else if (screen === "prod_kanban") initKanbanBoardScreen();
        else if (screen === "prod_time") initTimeTrackerScreen();
        else if (screen === "prod_docs") initDocumentationViewerScreen();
        else if (screen === "prod_vault") initPasswordVaultScreen();
        else if (screen === "prod_secrets") initSecretsManagerScreen();
        else if (screen === "collab_chat") initTeamChatScreen();
        else if (screen === "collab_workspace") initTeamPresenceScreen();
        else if (screen === "collab_feed") initActivityFeedScreen();
        else if (screen === "collab_permissions") initSitePermissionsScreen();
        else if (screen.startsWith("mcp_") && screen !== "mcp") initConnectorScreen(screen);
      }, 50);
    }
  });
})();

// ─── Local Terminal Screen ──────────────────────────────────────────
let terminalInitialized = false;
function initTerminalScreen() {
  if (terminalInitialized) return;
  terminalInitialized = true;

  const outputEl = document.getElementById("terminal-output");
  const formEl = document.getElementById("terminal-form");
  const inputEl = document.getElementById("terminal-input");
  const clearEl = document.getElementById("terminal-clear");

  function appendLine(text, type = "stdout") {
    if (!outputEl) return;
    const div = document.createElement("div");
    div.className = "terminal-line";
    
    if (type === "input") {
      div.style.color = "var(--accent-strong, #8b5cf6)";
      div.style.fontWeight = "bold";
    } else if (type === "stderr" || type === "error") {
      div.style.color = "var(--danger-color, #ef4444)";
    } else if (type === "info") {
      div.style.color = "var(--success-color, #10b981)";
    } else {
      div.style.color = "var(--text, #f3f4f6)";
    }
    
    div.textContent = text;
    outputEl.appendChild(div);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  async function runCmd(cmd) {
    if (!cmd.trim()) return;
    appendLine(`$ ${cmd}`, "input");
    const site = getSelectedSite();
    const cwd = site?.path || null;
    
    try {
      const result = await window.desktopAPI.shellRun({ command: cmd, cwd });
      if (result.stdout) appendLine(result.stdout, "stdout");
      if (result.stderr) appendLine(result.stderr, "stderr");
      if (result.code !== 0) {
        appendLine(`Process exited with code ${result.code}`, "error");
      } else {
        appendLine(`Command finished successfully.`, "info");
      }
    } catch (err) {
      appendLine(`Execution error: ${err.message}`, "error");
    }
  }

  formEl?.addEventListener("submit", (e) => {
    e.preventDefault();
    const cmd = inputEl.value;
    inputEl.value = "";
    runCmd(cmd);
  });

  clearEl?.addEventListener("click", () => {
    if (outputEl) outputEl.innerHTML = "";
  });

  document.querySelectorAll("#terminal-screen .preset-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const cmd = btn.getAttribute("data-cmd");
      if (inputEl) inputEl.value = cmd;
      runCmd(cmd);
    });
  });
}

// ─── Database Manager Screen ────────────────────────────────────────
let databaseInitialized = false;
function initDatabaseScreen() {
  const site = getSelectedSite();
  if (site) {
    const dbNameInput = document.getElementById("db-name");
    const dbUserInput = document.getElementById("db-user");
    const dbPassInput = document.getElementById("db-pass");
    if (dbNameInput && !dbNameInput.value) dbNameInput.value = site.dbName || "";
    if (dbUserInput && !dbUserInput.value) dbUserInput.value = site.dbUser || "root";
    if (dbPassInput && !dbPassInput.value) dbPassInput.value = site.dbPassword || "";
  }

  if (databaseInitialized) return;
  databaseInitialized = true;

  const testBtn = document.getElementById("db-test-btn");
  const runBtn = document.getElementById("db-run-btn");
  const tablesBtn = document.getElementById("db-tables-btn");
  const optionsBtn = document.getElementById("db-options-btn");
  const sqlInput = document.getElementById("db-sql-input");

  testBtn?.addEventListener("click", testDbConnection);
  runBtn?.addEventListener("click", runSqlQuery);

  tablesBtn?.addEventListener("click", () => {
    const dbType = document.getElementById("db-type").value;
    const sql = dbType === "mysql" ? "SHOW TABLES;" : "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';";
    if (sqlInput) sqlInput.value = sql;
    runSqlQuery();
  });

  optionsBtn?.addEventListener("click", () => {
    const dbType = document.getElementById("db-type").value;
    const sql = dbType === "mysql" ? "SELECT * FROM wp_options LIMIT 10;" : "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' LIMIT 10;";
    if (sqlInput) sqlInput.value = sql;
    runSqlQuery();
  });
}

async function testDbConnection() {
  const dbType = document.getElementById("db-type").value;
  const config = {
    host: document.getElementById("db-host").value,
    port: document.getElementById("db-port").value,
    user: document.getElementById("db-user").value,
    password: document.getElementById("db-pass").value,
    database: document.getElementById("db-name").value
  };
  const statusInfo = document.getElementById("db-status-info");
  statusInfo.textContent = "Testing connection...";
  statusInfo.style.color = "var(--text-dim)";
  try {
    const result = await window.desktopAPI.dbQuery({ dbType, config, sql: "SELECT 1 AS connected;" });
    if (result.ok) {
      statusInfo.textContent = `Connected successfully to ${dbType.toUpperCase()}!`;
      statusInfo.style.color = "var(--success-color, #10b981)";
    } else {
      statusInfo.textContent = `Connection failed: ${result.error}`;
      statusInfo.style.color = "var(--danger-color, #ef4444)";
    }
  } catch (err) {
    statusInfo.textContent = `Error: ${err.message}`;
    statusInfo.style.color = "var(--danger-color, #ef4444)";
  }
}

async function runSqlQuery() {
  const dbType = document.getElementById("db-type").value;
  const config = {
    host: document.getElementById("db-host").value,
    port: document.getElementById("db-port").value,
    user: document.getElementById("db-user").value,
    password: document.getElementById("db-pass").value,
    database: document.getElementById("db-name").value
  };
  const sql = document.getElementById("db-sql-input").value;
  const resultsTable = document.getElementById("db-results-table");
  if (!sql.trim()) {
    alert("Please enter a SQL query.");
    return;
  }
  try {
    const result = await window.desktopAPI.dbQuery({ dbType, config, sql });
    if (!result.ok) {
      resultsTable.innerHTML = `<thead><tr><th style="color:var(--danger-color, #ef4444);">Error</th></tr></thead><tbody><tr><td>${escapeHtml(result.error)}</td></tr></tbody>`;
      return;
    }
    const rows = result.rows || [];
    const fields = result.fields || [];
    if (fields.length === 0) {
      resultsTable.innerHTML = `<thead><tr><th>Query Status</th></tr></thead><tbody><tr><td>Query executed successfully. No rows returned.</td></tr></tbody>`;
      return;
    }
    let html = `<thead><tr style="border-bottom:1px solid var(--line); color:var(--muted);">`;
    fields.forEach(f => {
      html += `<th style="padding:6px; font-weight:600;">${escapeHtml(f)}</th>`;
    });
    html += `</tr></thead><tbody style="color:var(--text-dim);">`;
    if (rows.length === 0) {
      html += `<tr><td colspan="${fields.length}" style="padding:6px;">No rows found.</td></tr>`;
    } else {
      rows.forEach(row => {
        html += `<tr style="border-bottom:1px solid var(--line-soft);">`;
        fields.forEach(f => {
          const val = row[f] !== undefined ? row[f] : "";
          html += `<td style="padding:6px; font-family:monospace;">${escapeHtml(String(val))}</td>`;
        });
        html += `</tr>`;
      });
    }
    html += `</tbody>`;
    resultsTable.innerHTML = html;
  } catch (err) {
    resultsTable.innerHTML = `<thead><tr><th style="color:var(--danger-color, #ef4444);">Error</th></tr></thead><tbody><tr><td>${escapeHtml(err.message)}</td></tr></tbody>`;
  }
}

// ─── Git Workspace Screen ───────────────────────────────────────────
let gitInitialized = false;
function initGitScreen() {
  refreshGitStatus();

  if (gitInitialized) return;
  gitInitialized = true;

  document.getElementById("git-refresh-btn")?.addEventListener("click", refreshGitStatus);
  document.getElementById("git-stage-btn")?.addEventListener("click", gitStageAll);
  document.getElementById("git-commit-btn")?.addEventListener("click", gitCommit);
  document.getElementById("git-pull-btn")?.addEventListener("click", gitPull);
  document.getElementById("git-push-btn")?.addEventListener("click", gitPush);
}

async function refreshGitStatus() {
  const branchEl = document.getElementById("git-active-branch");
  const cleanEl = document.getElementById("git-clean-pill");
  const unstagedEl = document.getElementById("git-unstaged-list");
  const stagedEl = document.getElementById("git-staged-list");
  const historyEl = document.getElementById("git-history-list");

  const site = getSelectedSite();
  if (!site) {
    if (branchEl) branchEl.textContent = "No site selected";
    if (cleanEl) cleanEl.textContent = "Offline";
    if (unstagedEl) unstagedEl.innerHTML = "<li>Please select a workspace client site first.</li>";
    if (stagedEl) stagedEl.innerHTML = "<li>No staged files.</li>";
    return;
  }

  const cwd = site.path;

  try {
    const branchRes = await window.desktopAPI.shellRun({ command: "git rev-parse --abbrev-ref HEAD", cwd });
    if (branchEl) branchEl.textContent = branchRes.code === 0 ? branchRes.stdout.trim() : "none/detached";
  } catch (_) {
    if (branchEl) branchEl.textContent = "none";
  }

  try {
    const statusRes = await window.desktopAPI.shellRun({ command: "git status --porcelain", cwd });
    const lines = statusRes.stdout.split("\n").filter(Boolean);
    const unstaged = [];
    const staged = [];

    lines.forEach(line => {
      const x = line[0];
      const y = line[1];
      const file = line.slice(3).trim();
      if (x !== ' ' && x !== '?') {
        staged.push(`${x} - ${file}`);
      }
      if (y !== ' ' || x === '?') {
        unstaged.push(`${y === '?' ? 'A' : y} - ${file}`);
      }
    });

    if (unstagedEl) {
      unstagedEl.innerHTML = unstaged.length
        ? unstaged.map(f => `<li style="font-family:monospace; font-size:0.8rem; color:var(--text-dim); border-bottom:1px solid var(--line-soft); padding:4px 0;">${escapeHtml(f)}</li>`).join("")
        : `<li>No changes detected.</li>`;
    }

    if (stagedEl) {
      stagedEl.innerHTML = staged.length
        ? staged.map(f => `<li style="font-family:monospace; font-size:0.8rem; color:var(--success-color, #10b981); border-bottom:1px solid var(--line-soft); padding:4px 0;">${escapeHtml(f)}</li>`).join("")
        : `<li>No staged files.</li>`;
    }

    if (cleanEl) {
      if (unstaged.length === 0 && staged.length === 0) {
        cleanEl.textContent = "Clean";
        cleanEl.style.background = "var(--success-color, #10b981)";
        cleanEl.style.color = "#fff";
      } else {
        cleanEl.textContent = "Modified";
        cleanEl.style.background = "var(--accent-strong, #8b5cf6)";
        cleanEl.style.color = "#fff";
      }
    }
  } catch (err) {
    if (unstagedEl) unstagedEl.innerHTML = `<li>Error scanning git status: ${escapeHtml(err.message)}</li>`;
  }

  try {
    const historyRes = await window.desktopAPI.shellRun({ command: "git log --oneline -n 10", cwd });
    if (historyEl) {
      const commits = historyRes.stdout.split("\n").filter(Boolean);
      historyEl.innerHTML = commits.length
        ? commits.map(c => `<li style="font-family:monospace; font-size:0.8rem; border-bottom:1px solid var(--line-soft); padding:4px 0;"><span style="color:var(--accent);">${escapeHtml(c.slice(0, 7))}</span> ${escapeHtml(c.slice(8))}</li>`).join("")
        : `<li>No history found.</li>`;
    }
  } catch (_) {
    if (historyEl) historyEl.innerHTML = "<li>Unable to fetch logs.</li>";
  }
}

async function gitStageAll() {
  const site = getSelectedSite();
  if (!site) return;
  await window.desktopAPI.shellRun({ command: "git add -A", cwd: site.path });
  refreshGitStatus();
}

async function gitCommit() {
  const site = getSelectedSite();
  const msgEl = document.getElementById("git-msg-input");
  if (!site || !msgEl?.value.trim()) {
    alert("Please enter a commit message.");
    return;
  }
  const messageFile = `${site.path}/.git/WPDESKTOP_COMMIT_MSG`;
  await window.desktopAPI.writeFile({ filePath: messageFile, content: msgEl.value });
  const result = await window.desktopAPI.shellRun({ command: "git commit -F .git/WPDESKTOP_COMMIT_MSG", cwd: site.path });
  alert(result.code === 0 ? "Committed successfully!" : `Commit failed: ${result.stderr}`);
  if (result.code === 0) window.logTeamActivity?.(`committed to ${site.name}: ${msgEl.value.split(/\r?\n/)[0]}`);
  msgEl.value = "";
  refreshGitStatus();
}

async function gitPull() {
  const site = getSelectedSite();
  if (!site) return;
  const result = await window.desktopAPI.shellRun({ command: "git pull", cwd: site.path });
  alert(result.stdout || result.stderr || "Pull completed.");
  refreshGitStatus();
}

async function gitPush() {
  const site = getSelectedSite();
  if (!site) return;
  const result = await window.desktopAPI.shellRun({ command: "git push", cwd: site.path });
  if (result.code === 0) window.logTeamActivity?.(`pushed ${site.name} to its Git remote`);
  alert(result.stdout || result.stderr || "Push completed.");
  refreshGitStatus();
}

// ─── WP-CLI Environment Screen ──────────────────────────────────────
let wpcliInitialized = false;
function initWpCliScreen() {
  if (wpcliInitialized) return;
  wpcliInitialized = true;

  const outputEl = document.getElementById("wpcli-output");
  const inputEl = document.getElementById("wpcli-input");
  const formEl = document.getElementById("wpcli-form");

  function appendLine(text, isError = false) {
    if (!outputEl) return;
    const div = document.createElement("div");
    div.className = "wpcli-line";
    div.style.fontFamily = "monospace";
    div.style.color = isError ? "var(--danger-color, #ef4444)" : "var(--text, #f3f4f6)";
    div.textContent = text;
    outputEl.appendChild(div);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  async function runWpCommand(cmd) {
    const site = getSelectedSite();
    if (!site) {
      appendLine("Error: No site selected. Please select a site in the Sidebar or Installer first.", true);
      return;
    }
    appendLine(`$ wp ${cmd}`);
    try {
      const result = await window.desktopAPI.shellRun({ command: `wp ${cmd}`, cwd: site.path });
      if (result.stdout) appendLine(result.stdout);
      if (result.stderr) appendLine(result.stderr, true);
    } catch (err) {
      appendLine(`Execution failed: ${err.message}`, true);
    }
  }

  formEl?.addEventListener("submit", (e) => {
    e.preventDefault();
    const cmd = inputEl.value;
    inputEl.value = "";
    runWpCommand(cmd);
  });

  document.querySelectorAll("#wpcli-screen .wpcli-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const cmd = btn.getAttribute("data-cmd");
      if (inputEl) inputEl.value = cmd;
      runWpCommand(cmd);
    });
  });
}

// ─── Site Backups Screen ────────────────────────────────────────────
let backupsInitialized = false;
function initBackupsScreen() {
  refreshBackupsCustom();

  if (backupsInitialized) return;
  backupsInitialized = true;

  document.getElementById("backups-create-btn")?.addEventListener("click", backupSelectedSite_custom);
}

async function backupSelectedSite_custom() {
  const site = getSelectedSite();
  if (!site) {
    alert("Please select a site in the Workspace or Installer first.");
    return;
  }
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
    alert(`Backup saved to ${result.savePath}.`);
    window.logTeamActivity?.(`backed up ${site.name}`);
    await refreshBackupsCustom();
  } catch (error) {
    alert(`Backup failed: ${error.message}`);
  }
}

async function refreshBackupsCustom() {
  const countEl = document.getElementById("backups-count-text");
  const listEl = document.getElementById("backups-list-container");
  if (!listEl) return;
  const response = await window.desktopAPI.listBackups();
  const backups = Array.isArray(response?.backups) ? response.backups : [];
  if (countEl) countEl.textContent = `${backups.length} backup${backups.length === 1 ? "" : "s"}`;
  listEl.innerHTML = "";
  if (!backups.length) {
    listEl.innerHTML = '<div class="settings-item"><span style="color:var(--muted);">No backups found. Click Create Backup to start.</span></div>';
    return;
  }
  backups.forEach((backup) => {
    const item = document.createElement("div");
    item.className = "settings-item";
    item.style.display = "flex";
    item.style.justifyContent = "space-between";
    item.style.alignItems = "center";
    item.style.marginBottom = "8px";
    item.innerHTML = `
      <div class="backup-item-copy">
        <strong>${escapeHtml(backup.siteName || backup.fileName || "Backup")}</strong><br/>
        <span style="font-size:0.75rem; color:var(--muted);">${escapeHtml(backup.createdAt ? new Date(backup.createdAt).toLocaleString() : "")}</span><br/>
        <span style="font-size:0.75rem; color:var(--muted); font-family:monospace;">${escapeHtml(backup.path || "")}</span>
      </div>
      <button type="button" class="primary-button compact">Restore</button>
    `;
    item.querySelector("button").addEventListener("click", async () => {
      if (window.confirm(`Restore "${backup.siteName || backup.fileName || "backup"}"?\n\nThis will recreate the local site from the backup package.`)) {
        try {
          await window.desktopAPI.restoreBackup({ backupPath: backup.path });
          alert("Backup restored successfully.");
          window.logTeamActivity?.(`restored a backup of ${backup.siteName || backup.fileName || "a site"}`);
        } catch (err) {
          alert(`Restore failed: ${err.message}`);
        }
      }
    });
    listEl.appendChild(item);
  });
}

// ─── Deployment Manager Screen ──────────────────────────────────────


// ─── AI Assistant Screen ────────────────────────────────────────────

// ─── Docker Manager Screen ──────────────────────────────────────────
let dockerInitialized = false;
function initDockerScreen() {
  refreshDockerStatus();

  if (dockerInitialized) return;
  dockerInitialized = true;

  document.getElementById("docker-refresh-btn")?.addEventListener("click", refreshDockerStatus);
}

async function refreshDockerStatus() {
  const statusEl = document.getElementById("docker-engine-status");
  const listEl = document.getElementById("docker-containers-list");
  if (!statusEl || !listEl) return;

  statusEl.textContent = "Scanning...";
  statusEl.style.background = "var(--surface-3)";

  try {
    const result = await window.desktopAPI.shellRun({ command: "docker ps --format \"{{.ID}}|{{.Names}}|{{.Status}}|{{.Image}}\"" });
    if (result.code !== 0) {
      statusEl.textContent = "Disconnected";
      statusEl.style.background = "var(--danger-color, #ef4444)";
      statusEl.style.color = "#fff";
      listEl.innerHTML = '<div class="settings-item"><span style="color:var(--muted);">Docker daemon offline or not installed.</span></div>';
      return;
    }

    statusEl.textContent = "Connected";
    statusEl.style.background = "var(--success-color, #10b981)";
    statusEl.style.color = "#fff";

    const lines = result.stdout.split("\n").filter(Boolean);
    if (lines.length === 0) {
      listEl.innerHTML = '<div class="settings-item"><span style="color:var(--muted);">No active containers running.</span></div>';
      return;
    }

    listEl.innerHTML = lines.map(line => {
      const [id, name, status, image] = line.split("|");
      return `
        <div class="settings-item" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div>
            <strong>${escapeHtml(name)}</strong> (${escapeHtml(image)})<br/>
            <span style="font-size:0.75rem; color:var(--muted);">ID: ${escapeHtml(id)} · Status: ${escapeHtml(status)}</span>
          </div>
          <button class="danger-button compact" onclick="stopDockerContainer('${escapeHtml(id)}')">Stop</button>
        </div>
      `;
    }).join("");
  } catch (err) {
    statusEl.textContent = "Disconnected";
    statusEl.style.background = "var(--danger-color, #ef4444)";
    statusEl.style.color = "#fff";
    listEl.innerHTML = `<div class="settings-item"><span style="color:var(--muted);">Error: ${escapeHtml(err.message)}</span></div>`;
  }
}

window.stopDockerContainer = async function(id) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(String(id))) return;
  const confirmStop = confirm(`Are you sure you want to stop container ${id}?`);
  if (!confirmStop) return;
  await window.desktopAPI.shellRun({ command: `docker stop ${id}` });
  refreshDockerStatus();
};

// ─── Docker Compose Screen ──────────────────────────────────────────
let composeInitialized = false;
function initDockerComposeScreen() {
  if (composeInitialized) return;
  composeInitialized = true;

  const logsEl = document.getElementById("compose-logs");
  const upBtn = document.getElementById("compose-up-btn");
  const downBtn = document.getElementById("compose-down-btn");

  function appendLog(line) {
    if (!logsEl) return;
    const div = document.createElement("div");
    div.textContent = line;
    logsEl.appendChild(div);
    logsEl.scrollTop = logsEl.scrollHeight;
  }

  upBtn?.addEventListener("click", async () => {
    const site = getSelectedSite();
    appendLog("[Compose] Running docker compose up -d...");
    try {
      const result = await window.desktopAPI.shellRun({ command: "docker compose up -d", cwd: site?.path });
      appendLog(result.stdout || result.stderr || "Containers started.");
    } catch (_) {
      try {
        const result = await window.desktopAPI.shellRun({ command: "docker-compose up -d", cwd: site?.path });
        appendLog(result.stdout || result.stderr || "Containers started.");
      } catch (err) {
        appendLog(`Error: ${err.message}`);
      }
    }
  });

  downBtn?.addEventListener("click", async () => {
    const site = getSelectedSite();
    appendLog("[Compose] Running docker compose down...");
    try {
      const result = await window.desktopAPI.shellRun({ command: "docker compose down", cwd: site?.path });
      appendLog(result.stdout || result.stderr || "Containers stopped.");
    } catch (_) {
      try {
        const result = await window.desktopAPI.shellRun({ command: "docker-compose down", cwd: site?.path });
        appendLog(result.stdout || result.stderr || "Containers stopped.");
      } catch (err) {
        appendLog(`Error: ${err.message}`);
      }
    }
  });
}

// ─── Kubernetes Screen ──────────────────────────────────────────────
let k8sInitialized = false;
function initKubernetesScreen() {
  refreshPodsList();

  if (k8sInitialized) return;
  k8sInitialized = true;

  document.getElementById("k8s-refresh-btn")?.addEventListener("click", refreshPodsList);
  document.getElementById("k8s-namespace")?.addEventListener("change", refreshPodsList);
}

async function refreshPodsList() {
  const nsEl = document.getElementById("k8s-namespace");
  const listEl = document.getElementById("k8s-pods-list");
  if (!nsEl || !listEl) return;

  const ns = /^[a-z0-9-]{1,63}$/.test(nsEl.value) ? nsEl.value : "default";
  listEl.innerHTML = '<div class="settings-item"><span style="color:var(--muted);">Scanning pods...</span></div>';

  try {
    const result = await window.desktopAPI.shellRun({ command: `kubectl get pods -n ${ns} --no-headers` });
    if (result.code !== 0) {
      listEl.innerHTML = '<div class="settings-item"><span style="color:var(--muted);">No pods detected. Ensure kubectl is configured and connected.</span></div>';
      return;
    }

    const lines = result.stdout.split("\n").filter(Boolean);
    if (lines.length === 0) {
      listEl.innerHTML = `<div class="settings-item"><span style="color:var(--muted);">No pods in namespace ${ns}.</span></div>`;
      return;
    }

    listEl.innerHTML = lines.map(line => {
      const parts = line.split(/\s+/).filter(Boolean);
      const name = parts[0] || "Unknown";
      const ready = parts[1] || "-";
      const status = parts[2] || "Unknown";
      const statusColor = status === "Running" ? "var(--success-color, #10b981)" : (status === "Pending" ? "#eab308" : "var(--danger-color, #ef4444)");
      
      return `
        <div class="settings-item" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div>
            <strong>${escapeHtml(name)}</strong><br/>
            <span style="font-size:0.75rem; color:var(--muted);">Ready: ${escapeHtml(ready)} · Status: <span style="color:${statusColor}; font-weight:bold;">${escapeHtml(status)}</span></span>
          </div>
          <button class="primary-button compact" onclick="kubectlLogs('${escapeHtml(name)}', '${escapeHtml(ns)}')">Logs</button>
        </div>
      `;
    }).join("");
  } catch (err) {
    listEl.innerHTML = `<div class="settings-item"><span style="color:var(--muted);">Error: ${escapeHtml(err.message)}</span></div>`;
  }
}

window.kubectlLogs = async function(pod, ns) {
  if (!/^[a-z0-9.-]+$/.test(String(pod)) || !/^[a-z0-9-]+$/.test(String(ns))) return;
  const result = await window.desktopAPI.shellRun({ command: `kubectl logs ${pod} -n ${ns} --tail=50` });
  alert(result.stdout || result.stderr || "No logs available.");
};

// ─── CI/CD Runner Screen ────────────────────────────────────────────

// ─── Server Monitor Screen ──────────────────────────────────────────


// ─── Notes Workspace Screen ─────────────────────────────────────────
let notesInitialized = false;
function initNotesWorkspaceScreen() {
  const input = document.getElementById("notes-markdown-input");
  if (input) {
    input.value = localStorage.getItem("wpdesktop.notes") || "# Sprint Developer Notes\n\n* Task 1: Check SFTP connection.\n* Task 2: Build MCP status visual charts.";
    renderNotesPreview();
  }

  if (notesInitialized) return;
  notesInitialized = true;

  input?.addEventListener("input", renderNotesPreview);
}

function renderNotesPreview() {
  const input = document.getElementById("notes-markdown-input");
  const preview = document.getElementById("notes-preview-output");
  if (input && preview) {
    const markdown = input.value;
    localStorage.setItem("wpdesktop.notes", markdown);
    preview.innerHTML = renderWorkspaceMarkdownToHtml(markdown);
  }
}

// ─── Kanban Board Screen ────────────────────────────────────────────
let kanbanInitialized = false;
const DEFAULT_KANBAN_CARDS = [
  { id: "k-1", text: "Configure host dev stacks", column: "todo" },
  { id: "k-2", text: "Setup workspace variables", column: "progress" },
  { id: "k-3", text: "Category header layout integration", column: "done" }
];

function initKanbanBoardScreen() {
  renderKanbanCards();

  if (kanbanInitialized) return;
  kanbanInitialized = true;

  const form = document.getElementById("kanban-add-todo-form");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("kanban-todo-input");
    const text = input.value.trim();
    if (!text) return;
    
    const cards = getKanbanCards();
    cards.push({ id: `k-${Date.now()}`, text, column: "todo" });
    saveKanbanCards(cards);
    
    input.value = "";
    renderKanbanCards();
  });

  const cols = ["todo", "progress", "done"];
  cols.forEach(col => {
    const listEl = document.getElementById(`kanban-${col}-list`);
    if (!listEl) return;

    listEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      listEl.style.border = "1px dashed var(--accent)";
    });

    listEl.addEventListener("dragleave", () => {
      listEl.style.border = "1px dashed var(--line)";
    });

    listEl.addEventListener("drop", (e) => {
      e.preventDefault();
      listEl.style.border = "1px dashed var(--line)";
      const cardId = e.dataTransfer.getData("text/plain");
      if (cardId) {
        const cards = getKanbanCards();
        const card = cards.find(c => c.id === cardId);
        if (card) {
          card.column = col;
          saveKanbanCards(cards);
          renderKanbanCards();
        }
      }
    });
  });
}

function getKanbanCards() {
  try {
    const saved = localStorage.getItem("wpdesktop.kanban-cards");
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return [...DEFAULT_KANBAN_CARDS];
}

function saveKanbanCards(cards) {
  localStorage.setItem("wpdesktop.kanban-cards", JSON.stringify(cards));
}

function renderKanbanCards() {
  const cards = getKanbanCards();
  const cols = ["todo", "progress", "done"];
  
  cols.forEach(col => {
    const listEl = document.getElementById(`kanban-${col}-list`);
    if (!listEl) return;
    listEl.innerHTML = "";
    
    const colCards = cards.filter(c => c.column === col);
    colCards.forEach(c => {
      const cardEl = document.createElement("div");
      cardEl.className = "settings-item";
      cardEl.draggable = true;
      cardEl.style.cursor = "grab";
      cardEl.style.background = "var(--surface-2)";
      cardEl.style.marginBottom = "6px";
      cardEl.style.display = "flex";
      cardEl.style.justifyContent = "space-between";
      cardEl.style.alignItems = "center";
      
      cardEl.innerHTML = `
        <strong>${escapeHtml(c.text)}</strong>
        <span class="delete-card-btn" style="cursor:pointer; color:var(--danger-color, #ef4444); font-weight:bold; font-size:1.1rem; padding:0 4px;">&times;</span>
      `;

      cardEl.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", c.id);
        cardEl.style.opacity = "0.5";
      });

      cardEl.addEventListener("dragend", () => {
        cardEl.style.opacity = "1";
      });

      cardEl.querySelector(".delete-card-btn").addEventListener("click", () => {
        const updated = getKanbanCards().filter(item => item.id !== c.id);
        saveKanbanCards(updated);
        renderKanbanCards();
      });

      listEl.appendChild(cardEl);
    });
  });
}

// ─── Time Tracker Screen ────────────────────────────────────────────
let timeInitialized = false;
let trackerInterval = null;
let timerActive = false;
let elapsedSeconds = 0;

function initTimeTrackerScreen() {
  renderTimeLogs();

  if (timeInitialized) return;
  timeInitialized = true;

  const startBtn = document.getElementById("stopwatch-start-btn");
  const pauseBtn = document.getElementById("stopwatch-pause-btn");
  const resetBtn = document.getElementById("stopwatch-reset-btn");
  const display = document.getElementById("stopwatch-display");

  function updateDisplay() {
    const hrs = String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0');
    const mins = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0');
    const secs = String(elapsedSeconds % 60).padStart(2, '0');
    if (display) display.textContent = `${hrs}:${mins}:${secs}`;
  }

  startBtn?.addEventListener("click", () => {
    if (timerActive) return;
    timerActive = true;
    trackerInterval = setInterval(() => {
      elapsedSeconds++;
      updateDisplay();
    }, 1000);
  });

  pauseBtn?.addEventListener("click", () => {
    if (!timerActive) return;
    timerActive = false;
    clearInterval(trackerInterval);

    if (elapsedSeconds > 0) {
      const logs = getTimeLogs();
      const hrs = String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0');
      const mins = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0');
      const secs = String(elapsedSeconds % 60).padStart(2, '0');
      
      logs.push({
        id: Date.now(),
        date: new Date().toLocaleDateString(),
        duration: `${hrs}:${mins}:${secs}`
      });
      saveTimeLogs(logs);
      renderTimeLogs();
    }
  });

  resetBtn?.addEventListener("click", () => {
    timerActive = false;
    clearInterval(trackerInterval);
    elapsedSeconds = 0;
    updateDisplay();
  });
}

function getTimeLogs() {
  try {
    const saved = localStorage.getItem("wpdesktop.time-logs");
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return [];
}

function saveTimeLogs(logs) {
  localStorage.setItem("wpdesktop.time-logs", JSON.stringify(logs));
}

function renderTimeLogs() {
  const logs = getTimeLogs();
  const listEl = document.getElementById("time-logs-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  if (logs.length === 0) {
    listEl.innerHTML = '<div class="settings-item"><span>No logged intervals. Click Start to track.</span></div>';
    return;
  }

  logs.forEach(log => {
    const div = document.createElement("div");
    div.className = "settings-item";
    div.style.display = "flex";
    div.style.justifyContent = "space-between";
    div.style.alignItems = "center";
    div.style.marginBottom = "6px";
    div.innerHTML = `
      <span>Date: ${escapeHtml(log.date)} · Duration: <strong>${escapeHtml(log.duration)}</strong></span>
      <button class="danger-button compact" onclick="deleteTimeLog(${log.id})">Delete</button>
    `;
    listEl.appendChild(div);
  });
}

window.deleteTimeLog = function(id) {
  const logs = getTimeLogs().filter(log => log.id !== id);
  saveTimeLogs(logs);
  renderTimeLogs();
};

// ─── Documentation Viewer Screen ────────────────────────────────────
let docsInitialized = false;
const DOC_DATABASE = {
  wp: `
    <h4>WordPress WP_Query Reference</h4>
    <p>Construct complex database queries for post lists using arguments:</p>
    <pre><code class="language-php">$query = new WP_Query( array(
    'post_type' => 'product',
    'posts_per_page' => 10,
    'meta_key' => 'price',
    'orderby' => 'meta_value_num',
    'order' => 'ASC'
) );</code></pre>`,
  docker: `
    <h4>Docker Command Reference</h4>
    <p>Useful docker lifecycle commands for standard stack maintenance:</p>
    <pre><code class="language-shell">docker ps -a               # List all containers
docker build -t app:latest . # Build project container
docker logs -f container-id # Stream logs output
docker system prune -a      # Clean cache volumes</code></pre>`,
  k8s: `
    <h4>Kubernetes Pod Specs</h4>
    <p>Standard YAML configuration mapping container specification:</p>
    <pre><code class="language-yaml">apiVersion: v1
kind: Pod
metadata:
  name: web-nginx
spec:
  containers:
  - name: nginx
    image: nginx:1.14.2
    ports:
    - containerPort: 80</code></pre>`,
  php: `
    <h4>PHP Standard Library</h4>
    <p>Common array and string processing functions reference:</p>
    <pre><code class="language-php">array_map(function($item) {
    return trim($item);
}, $raw_array);

json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);</code></pre>`
};

function initDocumentationViewerScreen() {
  if (docsInitialized) return;
  docsInitialized = true;

  const select = document.getElementById("doc-selection");
  const search = document.getElementById("doc-search");
  const body = document.getElementById("doc-body");

  function refreshDocs() {
    if (!body || !select) return;
    const current = select.value;
    let content = DOC_DATABASE[current] || "<h4>Documentation item not found.</h4>";
    
    if (search && search.value.trim()) {
      const q = search.value.toLowerCase();
      if (!content.toLowerCase().includes(q)) {
        content = `<h4>No matches found for "${escapeHtml(search.value)}" in this manual.</h4>`;
      }
    }
    body.innerHTML = content;
  }

  select?.addEventListener("change", refreshDocs);
  search?.addEventListener("input", refreshDocs);
}

// ─── Password Vault Screen ──────────────────────────────────────────






// ─── Secrets Manager Screen ─────────────────────────────────────────
let secretsInitialized = false;
function initSecretsManagerScreen() {
  loadSecretsVariables();

  if (secretsInitialized) return;
  secretsInitialized = true;

  document.getElementById("secrets-load-env")?.addEventListener("click", loadSecretsVariables);
  document.getElementById("secrets-save-env")?.addEventListener("click", saveSecretsVariables);
}

async function loadSecretsVariables() {
  const listEl = document.getElementById("secrets-variables-list");
  if (!listEl) return;
  listEl.innerHTML = "<span>Loading .env environment...</span>";

  const site = getSelectedSite();
  const filePath = site ? `${site.path}/.env` : null;

  if (!filePath) {
    listEl.innerHTML = "<span>Select a site to edit its .env file.</span>";
    return;
  }
  let content = "";
  try {
    content = await window.desktopAPI.readExtensionFile(filePath);
  } catch (_) {
    listEl.innerHTML = `<span>No .env file found in ${escapeHtml(site.path)}.</span>`;
    return;
  }

  const lines = content.split("\n").filter(Boolean);
  listEl.innerHTML = "";
  lines.forEach(line => {
    if (line.startsWith("#") || !line.includes("=")) return;
    const [key, ...valueParts] = line.split("=");
    const value = valueParts.join("=");
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.marginBottom = "6px";
    row.innerHTML = `
      <input type="text" value="${escapeHtml(key.trim())}" readonly style="width:140px; height:32px; border:1px solid var(--input-border); border-radius:6px; background:var(--surface-3); color:var(--text-dim); padding:0 8px;">
      <input type="text" class="secret-val-input" data-key="${escapeHtml(key.trim())}" value="${escapeHtml(value.trim())}" style="flex:1; height:32px; border:1px solid var(--input-border); border-radius:6px; background:var(--input-bg); color:var(--text); padding:0 8px;">
    `;
    listEl.appendChild(row);
  });
}

async function saveSecretsVariables() {
  const site = getSelectedSite();
  if (!site) {
    alert("Please select a site folder to save .env file.");
    return;
  }
  const inputs = document.querySelectorAll("#secrets-variables-list .secret-val-input");
  let content = "";
  inputs.forEach(input => {
    const key = input.getAttribute("data-key");
    const val = input.value;
    content += `${key}=${val}\n`;
  });
  
  const filePath = `${site.path}/.env`;
  try {
    await window.desktopAPI.writeFile({ filePath, content });
    alert(".env file saved successfully!");
  } catch (err) {
    alert(`Failed to save: ${err.message}`);
  }
}

// ─── Team Chat Screen ───────────────────────────────────────────────

// ─── MCP Adapter Screen ─────────────────────────────────────────────

window.tsOpenDeviceModal  = tsOpenDeviceModal;
window.tsPingDevice       = tsPingDevice;
window.tsSshDevice        = tsSshDevice;
window.tsRdpDevice        = tsRdpDevice;
window.tsSetExitNode      = tsSetExitNode;
window.tsDisconnectExitNode = tsDisconnectExitNode;
window.tsRemoveServeRoute = tsRemoveServeRoute;
window.tsCopy             = tsCopy;


