'use strict';
// Apresentação na tela deste computador (capturada junto com a tela, então quem acompanha VÊ tudo):
//  - WIDGET: janela pequena e própria, sempre por cima, arrastável. Nunca cobre a tela.
//  - CAMADA: janela transparente em tela cheia com desenhos, destaque do cursor, anéis de clique
//    e holofote. Só existe quando há algo para mostrar e deixa os cliques passarem; ela só
//    recebe o mouse enquanto uma ferramenta de desenho está escolhida (Esc ou botão direito devolvem).
const { BrowserWindow, screen } = require('electron');

const isWayland = process.platform === 'linux' && (!!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland');

class OverlayManager {
  constructor({ store, preload, page, widgetPage }) {
    this.store = store;
    this.preload = preload;
    this.page = page;
    this.widgetPage = widgetPage;
    this.win = null;            // camada
    this.widget = null;         // janela do widget
    this.displayId = null;
    this.timer = null;
    this.hook = null;
    this.hookActive = false;
    this.sessionInfo = null;
    this.hasShapes = false;
    this.tool = { tool: 'pointer', color: '#ff4b3e', size: 4 };
    this.interactive = false;
    this.lastCursor = null;
    this.layerVisible = false;
  }

  // ---------- Captura global de cliques (iniciada uma única vez; nunca parada) ----------
  _ensureHook() {
    if (this.hookActive || this.hookTried || isWayland) return;
    this.hookTried = true;
    setTimeout(() => {
      try {
        const { uIOhook } = require('uiohook-napi');
        uIOhook.on('mousedown', (e) => this.click(e.button === 2 ? 'right' : e.button === 3 ? 'middle' : 'left'));
        uIOhook.start();
        this.hook = uIOhook;
        this.hookActive = true;
      } catch (_) { this.hookActive = false; }
    }, 200);
  }

  effects() { return this.store.get('effects'); }

  display() {
    const all = screen.getAllDisplays();
    return all.find(d => String(d.id) === String(this.displayId)) || screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay();
  }

  // A camada só existe quando há algo para desenhar nela.
  layerNeeded() {
    const fx = this.effects();
    const anyFx = fx.cursor.on || fx.clicks.on || fx.spotlight.on;
    // No Wayland a posição global do cursor não é acessível: efeitos do cursor ficam desativados localmente
    const fxActive = !isWayland && anyFx && ((this.sessionInfo && fx.showDuringSession) || fx.widget.on || this.forceFx);
    return !!(this.hasShapes || this.tool.tool !== 'pointer' || fxActive || (this.sessionInfo && fx.sessionBanner && !fx.widget.on));
  }

  setDisplay(displayId) {
    this.displayId = displayId;
    if (this.win && !this.win.isDestroyed()) this.win.setBounds(this.display().bounds);
  }

  sync() {
    const fx = this.effects();
    if (fx.widget.on) this.showWidget(); else this.hideWidget();
    if (!fx.widget.on && this.tool.tool !== 'pointer') this.setTool({ tool: 'pointer' }, true);
    if (this.layerNeeded()) this.showLayer(); else this.hideLayer();
    this.push('overlay:state', this.state());
    this.pushWidget('overlay:state', this.state());
  }

  state() {
    return { effects: this.effects(), session: this.sessionInfo, forceFx: !!this.forceFx, tool: this.tool, platform: process.platform };
  }

  // ---------- Camada ----------
  _createLayer() {
    const d = this.display();
    const win = new BrowserWindow({
      ...d.bounds, transparent: true, frame: false, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
      fullscreenable: false, show: false, backgroundColor: '#00000000', title: 'GCP Remoto — camada',
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: false, backgroundThrottling: false }
    });
    this._clickThrough(win);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(this.page);
    win.webContents.on('did-finish-load', () => { if (!win.isDestroyed()) win.webContents.send('overlay:state', this.state()); if (this.layerVisible) this._reveal(); });
    win.on('closed', () => { if (this.win === win) { this.win = null; this.layerVisible = false; this._stopTimer(); } });
    this.win = win;
    return win;
  }

  _clickThrough(win) {
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(true, process.platform === 'win32' ? { forward: true } : undefined);
    win.setFocusable(false);
    this.interactive = false;
  }

  // Mantém a janela acima de todas as outras. No Windows, uma janela "sempre por cima"
  // que foi escondida e mostrada de novo pode perder essa condição e ficar atrás do Explorer.
  _raise(win, level = 'screen-saver', rel = 0) {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    win.setAlwaysOnTop(true, level, rel);
    win.moveTop();
  }

  _startTopGuard() {
    if (this.topGuard) return;
    this.topGuard = setInterval(() => {
      if (this.layerVisible) this._raise(this.win, 'screen-saver', 0);
      if (this.widget && !this.widget.isDestroyed() && this.widget.isVisible()) this._raise(this.widget, 'screen-saver', 1);
      if (!this.layerVisible && !(this.widget && !this.widget.isDestroyed() && this.widget.isVisible())) { clearInterval(this.topGuard); this.topGuard = null; }
    }, 1500);
  }

  _reveal() {
    const win = this.win; if (!win || win.isDestroyed()) return;
    win.setBounds(this.display().bounds);
    if (!win.isVisible()) win.showInactive();
    if (process.platform === 'win32') win.setOpacity(1);
    this._raise(win, 'screen-saver', 0);
    this._startTopGuard();
    // No Linux a passagem de cliques precisa ser reaplicada depois que a janela aparece.
    this._applyInteractive();
    setTimeout(() => this._applyInteractive(), 120);
    if (this.widget && !this.widget.isDestroyed()) this._raise(this.widget, 'screen-saver', 1);
  }


  showLayer() {
    if (!this.win || this.win.isDestroyed()) this._createLayer();
    this.layerVisible = true;
    if (!this.win.webContents.isLoading()) this._reveal();
    this._startTimer();
    if (this.effects().clicks.on) this._ensureHook();
  }

  hideLayer() {
    this.layerVisible = false;
    this._stopTimer();
    if (!this.win || this.win.isDestroyed()) return;
    this._clickThrough(this.win);
    if (process.platform === 'win32') {
      // No Windows, esconder e mostrar de novo faz a janela perder o "sempre por cima" (fica atrás do
      // Explorer). Em vez de esconder, ela fica transparente, vazia e deixando os cliques passarem.
      this.win.setOpacity(0);
    } else {
      this.win.hide();
    }
  }

  _applyInteractive() {
    const win = this.win; if (!win || win.isDestroyed()) return;
    const drawing = this.tool.tool !== 'pointer';
    if (drawing) {
      win.setIgnoreMouseEvents(false);
      win.setFocusable(true);
      if (this.tool.tool === 'text') win.focus();
      this.interactive = true;
    } else {
      this._clickThrough(win);
    }
  }

  setTool(t, silent) {
    this.tool = { ...this.tool, ...t };
    if (this.layerNeeded()) { this.showLayer(); if (this.win && !this.win.isDestroyed()) this.win.moveTop(); }
    this._applyInteractive();
    if (!this.layerNeeded()) this.hideLayer();
    this.push('overlay:tool', this.tool);
    if (!silent) this.pushWidget('overlay:tool', this.tool);
  }

  // A camada pede foco temporário para a caixa de texto
  focusLayer() {
    const win = this.win; if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(false); win.setFocusable(true); win.focus();
  }

  push(ch, data) {
    if (this.win && !this.win.isDestroyed() && !this.win.webContents.isLoading()) this.win.webContents.send(ch, data);
  }

  _startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.win || this.win.isDestroyed() || !this.layerVisible) return;
      const fx = this.effects();
      if (!(fx.cursor.on || fx.spotlight.on)) return;
      const p = screen.getCursorScreenPoint();
      if (this.lastCursor && this.lastCursor.x === p.x && this.lastCursor.y === p.y) return;
      this.lastCursor = p;
      const b = this.win.getBounds();
      this.push('overlay:cursor', { x: p.x - b.x, y: p.y - b.y });
    }, 16);
  }
  _stopTimer() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  click(button) {
    if (!this.win || this.win.isDestroyed() || !this.layerVisible) return;
    const p = screen.getCursorScreenPoint();
    const b = this.win.getBounds();
    this.push('overlay:click', { x: p.x - b.x, y: p.y - b.y, button });
  }

  // Cliques injetados remotamente (quando o gancho global não está disponível, ex.: Wayland)
  remoteClick(button) { if (!this.hookActive) this.click(button); }

  // ---------- Widget ----------
  showWidget() {
    if (this.widget && !this.widget.isDestroyed()) { if (!this.widget.isVisible()) this.widget.showInactive(); this._raise(this.widget, 'screen-saver', 1); this._startTopGuard(); return; }
    const fx = this.effects();
    const wa = this.display().workArea;
    const w = 236, h = 64;
    const x = fx.widget.x != null ? fx.widget.x : Math.round(wa.x + (wa.width - w) / 2);
    const y = fx.widget.y != null ? fx.widget.y : Math.round(wa.y + wa.height - h - 40);
    const win = new BrowserWindow({
      x, y, width: w, height: h, transparent: true, frame: false, resizable: false, skipTaskbar: true,
      hasShadow: false, alwaysOnTop: true, fullscreenable: false, minimizable: false, maximizable: false,
      focusable: true, show: false, backgroundColor: '#00000000', title: 'GCP Remoto — ferramentas',
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: false }
    });
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(this.widgetPage);
    win.once('ready-to-show', () => { if (!win.isDestroyed()) { win.showInactive(); this._raise(win, 'screen-saver', 1); this.keepOnScreen(); this._startTopGuard(); } });
    win.webContents.on('did-finish-load', () => { if (!win.isDestroyed()) win.webContents.send('overlay:state', this.state()); });
    let saveT;
    win.on('moved', () => {
      clearTimeout(saveT);
      saveT = setTimeout(() => {
        if (win.isDestroyed()) return;
        const b = win.getBounds();
        const e = this.effects(); e.widget.x = b.x; e.widget.y = b.y; this.store.save();
      }, 300);
    });
    win.on('closed', () => { if (this.widget === win) this.widget = null; });
    this.widget = win;
  }

  hideWidget() {
    if (this.widget && !this.widget.isDestroyed()) this.widget.hide();
  }

  resizeWidget(w, h) {
    const win = this.widget; if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    const nw = Math.ceil(w), nh = Math.ceil(h);
    if (b.width === nw && b.height === nh) return;
    // cresce a partir do centro inferior, para não "pular" de lugar
    const nx = Math.round(b.x + (b.width - nw) / 2);
    const ny = Math.round(b.y + b.height - nh);
    win.setBounds({ x: nx, y: ny, width: nw, height: nh });
    this.keepOnScreen();
  }

  keepOnScreen() {
    const win = this.widget; if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const x = Math.max(wa.x, Math.min(wa.x + wa.width - b.width, b.x));
    const y = Math.max(wa.y, Math.min(wa.y + wa.height - b.height, b.y));
    if (x !== b.x || y !== b.y) win.setPosition(x, y);
  }

  pushWidget(ch, data) {
    if (this.widget && !this.widget.isDestroyed() && !this.widget.webContents.isLoading()) this.widget.webContents.send(ch, data);
  }

  // ---------- Desenho e sessão ----------
  drawOp(op) {
    if (op && op.a === 'mark') { this.hasShapes = true; return; }   // desenho local já está na camada
    if (op && op.a === 'empty') { this.hasShapes = false; this.sync(); return; } // todos desvaneceram
    if (op && op.a === 'upsert') this.hasShapes = true;
    const wasVisible = this.layerVisible;
    this.showLayer();
    const now = Date.now();
    if (!wasVisible || (op && op.a === 'upsert' && now - (this.lastRaise || 0) > 500)) { this.lastRaise = now; this._raise(this.win, 'screen-saver', 0); }
    this.push('overlay:op', op);
  }

  clearShapes() {
    this.hasShapes = false;
    this.push('overlay:op', { a: 'clear' });
    this.sync();
  }

  setSession(info) {
    this.sessionInfo = info;
    if (!info) { this.forceFx = false; this.hasShapes = false; this.push('overlay:op', { a: 'clear', by: 'remote' }); }
    this.sync();
  }

  updateEffects(patch) {
    const fx = this.effects();
    for (const k of Object.keys(patch || {})) {
      if (fx[k] && typeof fx[k] === 'object' && typeof patch[k] === 'object') fx[k] = { ...fx[k], ...patch[k] };
      else fx[k] = patch[k];
    }
    this.store.save();
    this.sync();
    if (this.onEffectsChanged) this.onEffectsChanged();
    for (const w of BrowserWindow.getAllWindows()) {
      if (w === this.win || w === this.widget) continue;
      w.webContents.send('effects:changed', fx);
    }
    this.push('effects:changed', fx);
    this.pushWidget('effects:changed', fx);
    return fx;
  }

  close() {
    this._stopTimer();
    for (const w of [this.win, this.widget]) if (w && !w.isDestroyed()) w.destroy();
    this.win = null; this.widget = null;
  }
}

module.exports = { OverlayManager };
