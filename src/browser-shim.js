
(function () {
  const noop = () => {};
  const asyncNull = () => Promise.resolve(null);
  const asyncEmpty = () => Promise.resolve([]);
  const asyncVoid = () => Promise.resolve();

  const defaultSettings = {
    xamppRootPath: "",
    htdocsPath: "",
    dbUser: "root",
    dbPassword: "",
    wpInstallUsername: "admin",
    wpInstallPassword: "",
    wpInstallEmail: "",
    shareLocalSiteSessions: true,
    shareOnlineSiteSessions: false,
    downloadDirectory: "",
    browserPermissions: {},
    browserBookmarks: [],
    browserShowBookmarksBar: true,
    browserExtensions: [],
    effectiveDbProfile: { host: "127.0.0.1", port: "3306", user: "root", password: "" },
    mysqlConfigContent: "",
    xamppPaths: {
      xamppRootPath: "",
      htdocsPath: "",
      controlPanelPath: "",
      apacheStartPath: "",
      apacheStopPath: "",
      apacheConfigPath: "",
      phpExecutablePath: "",
      phpConfigPath: "",
      mysqlConfigPath: "",
      phpMyAdminPath: ""
    }
  };

  const defaultVaultInfo = {
    encryptionAvailable: false,
    storageBackend: "none"
  };

  const defaultCredentials = {
    entries: [],
    selectedId: null,
    username: "",
    password: ""
  };

  window.desktopAPI = {
    pickFolder: asyncNull,
    pickZip: asyncNull,
    pickExtensionArchive: asyncNull,
    pickWorkspaceResource: asyncNull,
    saveBackup: asyncNull,

    browserCreateTab: asyncNull,
    browserActivateTab: asyncNull,
    browserCloseTab: asyncNull,
    browserNavigate: asyncNull,
    browserGetSuggestions: asyncEmpty,
    browserGoBack: asyncVoid,
    browserGoForward: asyncVoid,
    browserReload: asyncVoid,
    browserAutofillCredentials: asyncNull,
    browserShowAppMenu: asyncNull,
    browserFindInPage: asyncNull,
    browserUpdateLayout: asyncNull,
    browserPickDownloadDirectory: asyncNull,
    browserOpenDownload: asyncNull,
    browserShowDownload: asyncNull,
    browserClearDownloads: asyncVoid,
    browserClearPermission: asyncVoid,
    browserAddBookmark: asyncNull,
    browserAddBookmarkFolder: asyncNull,
    browserRemoveBookmark: asyncVoid,
    browserUpdateBookmark: asyncNull,
    browserMoveBookmark: asyncNull,
    browserCopyBookmark: asyncNull,
    browserCutBookmark: asyncNull,
    browserPasteBookmark: asyncNull,
    browserSetBookmarksBarVisible: asyncVoid,
    browserCreateWindow: asyncNull,
    browserShowBookmarkContextMenu: asyncNull,
    browserShowTabContextMenu: asyncNull,
    browserSetTabNickname: asyncNull,
    browserSaveTabSession: asyncNull,
    browserUnsaveTabSession: asyncNull,
    browserShowBookmarkSaveDialog: asyncNull,

    testDb: () => Promise.resolve({ ok: false, error: "Not available in browser preview." }),
    installWordPress: () => Promise.resolve({ ok: false, logs: ["Not available in browser preview."] }),
    openPath: asyncNull,
    copyWorkspaceMedia: asyncNull,
    openWorkspaceMediaWith: asyncNull,

    listSites: asyncEmpty,
    backupSite: asyncNull,
    applyMultisiteConfig: asyncNull,
    deleteSite: asyncNull,
    showSiteContextMenu: asyncNull,

    getSettings: () => Promise.resolve(defaultSettings),
    setXamppRootPath: asyncNull,
    setHtdocsPath: asyncNull,
    setLocalSessionSharing: asyncNull,
    setOnlineSessionSharing: asyncNull,
    setSessionAutoSaveScope: asyncNull,
    setSessionAutoSaveDelay: asyncNull,
    saveMysqlConfig: asyncNull,
    saveWpInstallDefaults: asyncNull,
    installBrowserExtensionFromFolder: asyncNull,
    installBrowserExtensionFromArchive: asyncNull,
    setBrowserExtensionEnabled: asyncNull,
    setBrowserExtensionPinned: asyncNull,
    removeBrowserExtension: asyncNull,
    openBrowserExtensionPopup: asyncNull,

    getVaultInfo: () => Promise.resolve(defaultVaultInfo),
    getInstallerDbProfile: asyncNull,
    saveInstallerDbProfile: asyncNull,
    clearInstallerDbProfile: asyncNull,
    getSiteCredentials: () => Promise.resolve(defaultCredentials),
    saveSiteCredentials: () => Promise.resolve(defaultCredentials),
    clearSiteCredentials: asyncNull,

    onBrowserState: noop,
    onBrowserNotice: noop,
    onBrowserMenuCommand: noop,
    onBrowserDownloadComplete: noop,
    onBrowserBookmarkEdit: noop,
    onBrowserBookmarkFolderEdit: noop,
    onBrowserBookmarkFolderOpen: noop,
    onBrowserBookmarkFolderAddChild: noop,
    onBrowserBookmarkManage: noop,
    onBrowserBookmarkCreateFolderAndMove: noop,
    onBrowserOpenUrl: noop,
    onBrowserFocus: noop,
    onSitesChanged: noop
  };
})();
