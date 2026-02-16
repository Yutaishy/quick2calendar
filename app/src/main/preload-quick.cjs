const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quickApi", {
  createSchedule: (payload) => ipcRenderer.invoke("schedule:create", payload),
  answerClarification: (sessionId, answerPayload) =>
    ipcRenderer.invoke("schedule:answer", { sessionId, answer: answerPayload }),
  cancelSession: (sessionId) => ipcRenderer.invoke("schedule:cancel", sessionId),
  hideWindow: () => ipcRenderer.invoke("quick:hide"),
  setExpanded: (expanded) => ipcRenderer.invoke("quick:set-expanded", expanded),
  resize: (height) => ipcRenderer.invoke("quick:resize", height),
  setImeComposing: (active) => ipcRenderer.invoke("quick:set-ime-composing", active),
  copyText: (text) => ipcRenderer.invoke("quick:copy-text", text),
  openExternal: (url) => ipcRenderer.invoke("quick:open-external", url),
  openSettings: () => ipcRenderer.invoke("app:open-settings"),
  onFocusRequested: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("quick:focus", listener);
    return () => ipcRenderer.removeListener("quick:focus", listener);
  }
});
