const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settingsApi", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  getSecretStatus: () => ipcRenderer.invoke("settings:get-secrets-status"),
  getOAuthStatus: () => ipcRenderer.invoke("settings:get-oauth-status"),
  setGeminiApiKey: (key) => ipcRenderer.invoke("settings:set-gemini-key", key),
  connectGoogle: () => ipcRenderer.invoke("settings:connect-google"),
  disconnectGoogle: () => ipcRenderer.invoke("settings:disconnect-google"),
  getLogPath: () => ipcRenderer.invoke("debug:get-log-path"),
  getRecentLogs: (limit) => ipcRenderer.invoke("debug:get-recent-logs", limit),
  openLogFile: () => ipcRenderer.invoke("debug:open-log-file")
});
