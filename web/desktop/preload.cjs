"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mital", Object.freeze({
  solver: (op, payload, options) => ipcRenderer.invoke("mital:solver", { op, payload, duals: options?.duals === true }),
  listBusinesses: () => ipcRenderer.invoke("mital:businesses"),
  loadBusiness: (id) => ipcRenderer.invoke("mital:business", id),
  saveBusiness: (doc) => ipcRenderer.invoke("mital:save-business", doc),
  saveDraft: (id, businessName, draft, settings) => ipcRenderer.invoke("mital:save-draft", id, businessName, draft, settings),
  saveWorking: (id, instance, solution) => ipcRenderer.invoke("mital:save-working", id, instance, solution),
  recoverBusiness: (id) => ipcRenderer.invoke("mital:recover-business", id),
  backupStatus: (id) => ipcRenderer.invoke("mital:backup-status", id),
  deleteBusiness: (id) => ipcRenderer.invoke("mital:delete-business", id),
  listSaved: () => ipcRenderer.invoke("mital:saved"),
  getSaved: (id) => ipcRenderer.invoke("mital:get-saved", id),
  putSaved: (id, body) => ipcRenderer.invoke("mital:put-saved", id, body),
  exportBackup: (id) => ipcRenderer.invoke("mital:export-backup", id),
  exportCsv: (name, csv) => ipcRenderer.invoke("mital:export-csv", name, csv),
  importBackup: () => ipcRenderer.invoke("mital:import-backup"),
  openDataFolder: () => ipcRenderer.invoke("mital:open-data-folder"),
  printRoster: (payload) => ipcRenderer.invoke("mital:print", payload),
  getPrintPayload: () => ipcRenderer.invoke("mital:get-print-payload"),
}));
