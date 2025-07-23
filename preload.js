const { contextBridge, ipcRenderer } = require('electron');

// 安全暴露 send 和 on 方法
contextBridge.exposeInMainWorld('api', {
    send: (channel, data) => ipcRenderer.send(channel, data),
    on: (channel, func) => ipcRenderer.on(channel, (_, ...args) => func(...args))
});
