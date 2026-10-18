const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("resumeApp", {
  getMeta: () => ipcRenderer.invoke("app:getMeta"),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  testModel: (settings) => ipcRenderer.invoke("settings:testModel", settings),
  listSkills: () => ipcRenderer.invoke("settings:listSkills"),
  listUsers: () => ipcRenderer.invoke("user:list"),
  createEmptyProfile: () => ipcRenderer.invoke("user:createEmptyProfile"),
  loadUser: (username) => ipcRenderer.invoke("user:load", username),
  saveUser: (username, profile) => ipcRenderer.invoke("user:save", { username, profile }),
  deleteUser: (username) => ipcRenderer.invoke("user:delete", username),
  runWorkflow: (username, profile, jd, settings) =>
    ipcRenderer.invoke("workflow:run", { username, profile, jd, settings }),
  saveArtifact: (username, kind, content, extension = "md") =>
    ipcRenderer.invoke("artifact:save", { username, kind, content, extension }),
  saveResumePdf: (username, resumeMarkdown, profile, jd) =>
    ipcRenderer.invoke("artifact:saveResumePdf", { username, resumeMarkdown, profile, jd }),
});
