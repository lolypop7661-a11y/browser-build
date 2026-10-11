const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browseryDesktop', {
  isDesktop: true,
  platform: process.platform,
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
  aiKeyStatus: () => ipcRenderer.invoke('ai-key:status'),
  saveAiApiKey: key => ipcRenderer.invoke('ai-key:save', key),
  clearAiApiKey: () => ipcRenderer.invoke('ai-key:clear'),
  analyzeVisiblePage: webContentsId => ipcRenderer.invoke('ai:analyze-visible-page', { webContentsId }),
  listBrowserCookies: partition => ipcRenderer.invoke('browser-data:list-cookies', partition),
  removeBrowserCookie: cookie => ipcRenderer.invoke('browser-data:remove-cookie', cookie),
  clearBrowserData: request => ipcRenderer.invoke('browser-data:clear', request),
});
