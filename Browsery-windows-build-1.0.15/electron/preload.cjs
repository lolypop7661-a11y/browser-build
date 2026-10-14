const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browseryDesktop', {
  isDesktop: true,
  platform: process.platform,
  globalControlStatus: () => ipcRenderer.invoke('global-control:status'),
  getGlobalControlState: () => ipcRenderer.invoke('global-control:state'),
  saveGlobalAdminSecret: secret => ipcRenderer.invoke('global-control:admin-secret:save', secret),
  clearGlobalAdminSecret: () => ipcRenderer.invoke('global-control:admin-secret:clear'),
  globalAdminAction: action => ipcRenderer.invoke('global-control:admin-action', action),
  browseryAccountSignUp: credentials => ipcRenderer.invoke('global-control:account:signup', credentials),
  browseryAccountSignIn: credentials => ipcRenderer.invoke('global-control:account:signin', credentials),
  browseryAccountStatus: () => ipcRenderer.invoke('global-control:account:status'),
  browseryAccountSignOut: () => ipcRenderer.invoke('global-control:account:signout'),
  onGlobalControlState: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('global-control:state-changed', listener);
    return () => ipcRenderer.removeListener('global-control:state-changed', listener);
  },
  windowAction: action => ipcRenderer.send('window:action', action),
  onDownload: callback => {
    if (typeof callback !== 'function') return () => {};
    let disposed = false;
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('download:update', listener);
    // Replay completed transfers after each launch so the Downloads drawer is a
    // real library rather than only a view of this process's active transfers.
    ipcRenderer.invoke('downloads:list').then(items => {
      if (!disposed && Array.isArray(items)) items.forEach(item => callback({ ...item, historical: true }));
    }).catch(() => {});
    return () => { disposed = true; ipcRenderer.removeListener('download:update', listener); };
  },
  onShortcut: callback => {
    const listener = (_event, shortcut) => callback(shortcut);
    ipcRenderer.on('browser:shortcut', listener);
    return () => ipcRenderer.removeListener('browser:shortcut', listener);
  },
  onNewTab: callback => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on('browser:new-tab', listener);
    return () => ipcRenderer.removeListener('browser:new-tab', listener);
  },
  onReopenClosedTab: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, tab) => callback(tab);
    ipcRenderer.on('browser:reopen-closed', listener);
    return () => ipcRenderer.removeListener('browser:reopen-closed', listener);
  },
  rememberClosedTab: tab => ipcRenderer.invoke('browser:closed-tab:remember', tab),
  reopenClosedTab: () => ipcRenderer.invoke('browser:closed-tab:reopen'),
  listClosedTabs: () => ipcRenderer.invoke('browser:closed-tab:list'),
  clearClosedTabs: () => ipcRenderer.invoke('browser:closed-tab:clear'),
  predictivePreload: request => ipcRenderer.invoke('browser:predictive-preload', request),
  updateTabActivity: request => ipcRenderer.invoke('browser:tab-activity', request),
  onPermissionRequest: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('browser:permission-request', listener);
    return () => ipcRenderer.removeListener('browser:permission-request', listener);
  },
  onPermissionResolved: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('browser:permission-resolved', listener);
    return () => ipcRenderer.removeListener('browser:permission-resolved', listener);
  },
  respondToPermission: response => ipcRenderer.invoke('browser:permission-response', response),
  listSitePermissions: () => ipcRenderer.invoke('browser:permissions:list'),
  clearSitePermission: request => ipcRenderer.invoke('browser:permissions:clear', request),
  savedLoginStatus: () => ipcRenderer.invoke('saved-logins:status'),
  listSavedLogins: () => ipcRenderer.invoke('saved-logins:list'),
  saveLogin: login => ipcRenderer.invoke('saved-logins:save', login),
  deleteSavedLogin: id => ipcRenderer.invoke('saved-logins:delete', id),
  copySavedLoginUsername: id => ipcRenderer.invoke('saved-logins:copy', { id, kind: 'username' }),
  copySavedLoginPassword: id => ipcRenderer.invoke('saved-logins:copy', { id, kind: 'password' }),
  fillSavedLogin: request => ipcRenderer.invoke('saved-logins:fill', request),
  openDefaultBrowserSettings: () => ipcRenderer.invoke('browser:open-default-browser-settings'),
  appUpdateStatus: () => ipcRenderer.invoke('app-update:status'),
  checkForAppUpdate: () => ipcRenderer.invoke('app-update:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('app-update:download'),
  installAppUpdate: () => ipcRenderer.invoke('app-update:install'),
  openAppUpdateRelease: () => ipcRenderer.invoke('app-update:open-release'),
  onAppUpdate: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app-update:state', listener);
    return () => ipcRenderer.removeListener('app-update:state', listener);
  },
  onBrowserSettingsApplied: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('browser:settings-applied', listener);
    return () => ipcRenderer.removeListener('browser:settings-applied', listener);
  },
  downloadCommand: payload => ipcRenderer.send('download:command', payload),
  updateSettings: settings => ipcRenderer.send('settings:update', settings),
  openVpnSettings: () => ipcRenderer.invoke('vpn:open-settings'),
  getProtonStatus: () => ipcRenderer.invoke('vpn:proton-status'),
  openProton: () => ipcRenderer.invoke('vpn:proton-open'),
  connectProton: () => ipcRenderer.invoke('vpn:proton-connect'),
  getProtectionStatus: site => ipcRenderer.invoke('protection:status', site),
  allowProtectionForSite: site => ipcRenderer.invoke('protection:allow-site', site),
  removeProtectionForSite: site => ipcRenderer.invoke('protection:remove-site', site),
  listProtectionAllowedSites: () => ipcRenderer.invoke('protection:list-allowed-sites'),
  resetProtectionStats: () => ipcRenderer.invoke('protection:reset-stats'),
  refreshProtectionRules: () => ipcRenderer.invoke('protection:refresh-rules'),
  aiKeyStatus: () => ipcRenderer.invoke('ai-key:status'),
  saveAiApiKey: key => ipcRenderer.invoke('ai-key:save', key),
  clearAiApiKey: () => ipcRenderer.invoke('ai-key:clear'),
  askGroqVoice: payload => ipcRenderer.invoke('ai:voice-assistant', payload),
  analyzeVisiblePage: webContentsId => ipcRenderer.invoke('ai:analyze-visible-page', { webContentsId }),
  listBrowserCookies: partition => ipcRenderer.invoke('browser-data:list-cookies', partition),
  removeBrowserCookie: cookie => ipcRenderer.invoke('browser-data:remove-cookie', cookie),
  clearBrowserData: request => ipcRenderer.invoke('browser-data:clear', request),
});
