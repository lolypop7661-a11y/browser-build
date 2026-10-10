const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browseryDesktop', {
  isDesktop: true,
  platform: process.platform,
  windowAction: action => ipcRenderer.send('window:action', action),
  onDownload: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('download:update', listener);
    return () => ipcRenderer.removeListener('download:update', listener);
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
  aiKeyStatus: () => ipcRenderer.invoke('ai-key:status'),
  saveAiApiKey: key => ipcRenderer.invoke('ai-key:save', key),
  clearAiApiKey: () => ipcRenderer.invoke('ai-key:clear'),
  analyzeVisiblePage: webContentsId => ipcRenderer.invoke('ai:analyze-visible-page', { webContentsId }),
  listBrowserCookies: partition => ipcRenderer.invoke('browser-data:list-cookies', partition),
  removeBrowserCookie: cookie => ipcRenderer.invoke('browser-data:remove-cookie', cookie),
  clearBrowserData: request => ipcRenderer.invoke('browser-data:clear', request),
});
