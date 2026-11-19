'use strict';
// Janelas de notificação próprias, estilizadas e sempre por cima de tudo:
//  - Pedido de acesso (Aceitar / Recusar, com permissões e contagem regressiva)
//  - Avisos de sessão (conectado, desconectado, arquivos recebidos…)
const path = require('path');
const { BrowserWindow, screen, ipcMain } = require('electron');

class NoticeManager {
  constructor({ preload, page, icon }) {
    this.preload = preload;
    this.page = page;
    this.icon = icon;
    this.data = new Map();      // webContents.id -> payload
    this.resolvers = new Map(); // webContents.id -> resolve
    this.infos = [];            // janelas de aviso empilhadas
    ipcMain.handle('notice:data', (e) => this.data.get(e.sender.id) || null);
    ipcMain.handle('notice:respond', (e, value) => {
      const r = this.resolvers.get(e.sender.id);
      if (r) { this.resolvers.delete(e.sender.id); r(value); }
      const w = BrowserWindow.fromWebContents(e.sender);
      if (w && !w.isDestroyed()) w.close();
      return true;
    });
    ipcMain.handle('notice:resize', (e, h) => {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (!w || w.isDestroyed()) return;
      const b = w.getBounds();
      w.setBounds({ ...b, height: Math.ceil(h) });
      this.layoutInfos();
    });
  }

  _create(payload, { width, height, x, y, focus }) {
    const w = new BrowserWindow({
      width, height, x, y, frame: false, transparent: true, resizable: false, movable: true,
      alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false, fullscreenable: false,
      minimizable: false, maximizable: false, focusable: true, backgroundColor: '#00000000', icon: this.icon,
      title: payload.title || 'GCP Remoto',
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: false }
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.data.set(w.webContents.id, payload);
    const id = w.webContents.id;
    w.on('closed', () => {
      this.data.delete(id);
      const r = this.resolvers.get(id);
      if (r) { this.resolvers.delete(id); r(null); }
      this.infos = this.infos.filter(x => x !== w);
      this.layoutInfos();
    });
    w.loadFile(this.page);
    w.once('ready-to-show', () => {
      if (focus) { w.show(); w.focus(); w.flashFrame(true); }
      else w.showInactive();
    });
    return w;
  }

  request(payload) {
    const wa = screen.getPrimaryDisplay().workArea;
    const width = 480, height = 560;
    return new Promise((resolve) => {
      const w = this._create({ kind: 'request', ...payload }, {
        width, height, focus: true,
        x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + Math.max(20, (wa.height - height) / 2.6))
      });
      this.resolvers.set(w.webContents.id, resolve);
    });
  }

  info(payload) {
    const wa = screen.getPrimaryDisplay().workArea;
    const width = 400, height = 150;
    const w = this._create({ kind: 'info', ...payload }, { width, height, x: wa.x + wa.width - width - 16, y: wa.y + wa.height - height - 16, focus: false });
    this.infos.push(w);
    this.layoutInfos();
    return w;
  }

  layoutInfos() {
    const wa = screen.getPrimaryDisplay().workArea;
    let y = wa.y + wa.height - 16;
    for (const w of [...this.infos].reverse()) {
      if (w.isDestroyed()) continue;
      const b = w.getBounds();
      y -= b.height;
      w.setBounds({ x: wa.x + wa.width - b.width - 16, y, width: b.width, height: b.height });
      y -= 10;
    }
  }
}

module.exports = { NoticeManager };
