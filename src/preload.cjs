'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tideway', {
  ready: () => ipcRenderer.invoke('tideway:ready'),
  command: (name, value) => ipcRenderer.invoke('tideway:command', name, value),
  state: callback => ipcRenderer.on('tideway:state', (_event, state) => callback(state)),
  focus: callback => ipcRenderer.on('tideway:focus', (_event, field) => callback(field))
});
