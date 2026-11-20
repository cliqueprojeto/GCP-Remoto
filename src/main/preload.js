'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE_PREFIXES = ['app:', 'settings:', 'pw:', 'auth:', 'favorites:', 'recents:', 'session:', 'win:', 'screens:', 'capture:', 'input:', 'overlay:', 'effects:', 'clipboard:', 'files:', 'xfer:', 'file:', 'screenshot:', 'notify', 'tray:', 'notice:', 'support:', 'update:'];
const SEND_CHANNELS = ['input:event', 'overlay:op', 'overlay:tool', 'overlay:focus', 'overlay:action', 'widget:resize'];
const ON_CHANNELS = ['files:clip-changed', 'notice:update', 'xfer:cancel', 'update:available', 'update:progress', 'overlay:tool', 'overlay:shortcut', 'support:open', 'pw:changed', 'settings:changed', 'recents:changed', 'effects:changed', 'overlay:state', 'overlay:cursor', 'overlay:click', 'overlay:op', 'overlay:local-op'];

contextBridge.exposeInMainWorld('gcp', {
  invoke: (ch, ...args) => {
    if (!INVOKE_PREFIXES.some(p => ch.startsWith(p))) return Promise.reject(new Error('canal bloqueado: ' + ch));
    return ipcRenderer.invoke(ch, ...args);
  },
  send: (ch, ...args) => { if (SEND_CHANNELS.includes(ch)) ipcRenderer.send(ch, ...args); },
  on: (ch, cb) => {
    if (!ON_CHANNELS.includes(ch)) return () => {};
    const fn = (_e, ...a) => cb(...a);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
  platform: process.platform
});
