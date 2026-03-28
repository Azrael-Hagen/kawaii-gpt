import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  minimize:      () => ipcRenderer.send('window:minimize'),
  maximize:      () => ipcRenderer.send('window:maximize'),
  close:         () => ipcRenderer.send('window:close'),
  getVersion:    () => ipcRenderer.invoke('app:version'),
  getSecret:     (key: string) => ipcRenderer.invoke('secret:get', key),
  setSecret:     (key: string, value: string) => ipcRenderer.invoke('secret:set', key, value),
  webSearch:     (query: string, maxResults?: number) => ipcRenderer.invoke('web:search', query, maxResults),
  openExternal:  (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  legacyStatus:  () => ipcRenderer.invoke('legacy:status'),
  legacyStart:   (payload?: { command?: string; args?: string; cwd?: string }) => ipcRenderer.invoke('legacy:start', payload),
  legacyStop:    () => ipcRenderer.invoke('legacy:stop'),
})
