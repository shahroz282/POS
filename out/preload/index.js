"use strict";
const electron = require("electron");
const api = {
  ping: (input) => electron.ipcRenderer.invoke("ping:ping", input)
};
electron.contextBridge.exposeInMainWorld("api", api);
