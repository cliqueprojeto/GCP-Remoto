'use strict';
// Persistência simples em JSON (configurações, favoritos, recentes).
// Senhas salvas são cifradas com safeStorage (chaveiro do sistema) quando disponível.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const DEFAULT_SHORTCUTS = {
  // Sessão
  fullscreen: 'Ctrl+Alt+F',
  toolbar: 'Ctrl+Alt+T',
  drawMode: 'Ctrl+Alt+D',
  viewOnly: 'Ctrl+Alt+V',
  screenshot: 'Ctrl+Alt+P',
  chat: 'Ctrl+Alt+M',
  fileBrowser: 'Ctrl+Alt+E',
  nextMonitor: 'Ctrl+Alt+N',
  fitMode: 'Ctrl+Alt+1',
  originalMode: 'Ctrl+Alt+2',
  stretchMode: 'Ctrl+Alt+3',
  sendCtrlAltDel: 'Ctrl+Alt+End',
  disconnect: 'Ctrl+Alt+Q',
  // Ferramentas de desenho
  toolPointer: 'Alt+1',
  toolPen: 'Alt+2',
  toolMarker: 'Alt+3',
  toolArrow: 'Alt+4',
  toolLine: 'Alt+5',
  toolRect: 'Alt+6',
  toolEllipse: 'Alt+7',
  toolText: 'Alt+8',
  clearDrawings: 'Ctrl+0',
  undoDrawing: 'Ctrl+Alt+Z',
  redoDrawing: 'Ctrl+Alt+Y',
  // Efeitos do mouse
  spotlight: 'Ctrl+Alt+S',
  cursorHighlight: 'Ctrl+Alt+H',
  clickEffect: 'Ctrl+Alt+C',
  presenterWidget: 'Ctrl+Alt+W'
};

const DEFAULTS = {
  deviceId: null,
  displayName: '',
  server: { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' },
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ],
  turn: { urls: '', username: '', credential: '' },
  security: {
    permanentSalt: null,
    permanentHash: null,          // sha256(salt + senhaPermanente)
    askEvenWithPassword: false,   // pedir confirmação mesmo com senha correta
    allowControl: true,
    allowFileTransfer: true,
    allowClipboard: true,
    allowDrawing: true,
    sessionPasswordLength: 8,
    regenerateAfterSession: true
  },
  session: {
    viewMode: 'fit',              // fit | original | stretch
    resolution: 'auto',           // auto | 1920x1080 | ...
    fps: 30,
    quality: 'high',              // low | medium | high | max
    syncClipboard: true,
    showRemoteCursor: true,
    profile: 'speed',             // speed | balanced | quality
    codec: 'auto',                // auto | h264 | vp8 | vp9 | av1
    pointer: 'dot'                // dot | arrow | none
  },
  shortcuts: { ...DEFAULT_SHORTCUTS },
  effects: {
    cursor: { on: true, color: '#ffd400', size: 34, opacity: 45 },
    clicks: { on: true, left: '#4fc3f7', right: '#ff9800', size: 39 },
    spotlight: { on: false, radius: 170, dim: 62 },
    widget: { on: false, expanded: false, x: null, y: null },
    showDuringSession: false,     // mostra efeitos automaticamente quando há sessão remota
    sessionBanner: true          // aviso discreto "sessão remota ativa" na tela acessada
  },
  general: {
    startWithSystem: false,
    startMinimized: false,
    closeToTray: true,
    compatX11: false,
    updateCheck: 'startup',       // startup | daily | weekly | biweekly | monthly | never
    lastUpdateCheck: null,
    theme: 'system',
    downloadDir: ''
  },
  favorites: [],                  // {id, name, password(enc), notes, color, lastUsed}
  recents: []                     // {id, name, when, os}
};

function deepMerge(base, extra) {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    if (extra && typeof extra === 'object') {
      for (const k of Object.keys(extra)) {
        out[k] = k in base ? deepMerge(base[k], extra[k]) : extra[k];
      }
    }
    return out;
  }
  return extra === undefined ? base : extra;
}

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'config.json');
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (_) { /* primeira execução */ }
    this.data = deepMerge(DEFAULTS, raw);
    if (!this.data.deviceId) this.data.deviceId = Store.newDeviceId();
    if (!this.data.security.permanentSalt) this.data.security.permanentSalt = crypto.randomBytes(16).toString('hex');
    if (!this.data.displayName) this.data.displayName = require('os').hostname();
    this.migrateShortcuts();
    this.migrateV3();
    this.migrateV4();
    this.save();
  }

  // Versão 2 dos atalhos: ferramentas em Alt+número e efeitos no padrão GCP.
  // Só troca atalhos que ainda estão no padrão antigo; os personalizados são mantidos.
  migrateShortcuts() {
    if (this.data.shortcutsVersion >= 2) return;
    const OLD = { clearDrawings: 'Ctrl+Alt+X', screenshot: 'Ctrl+Alt+S', nextMonitor: 'Ctrl+Alt+M', chat: 'Ctrl+Alt+C', spotlight: 'Ctrl+Alt+L' };
    const sc = this.data.shortcuts;
    for (const k of Object.keys(DEFAULT_SHORTCUTS)) {
      if (!(k in sc) || sc[k] === OLD[k]) sc[k] = DEFAULT_SHORTCUTS[k];
    }
    this.data.shortcutsVersion = 2;
  }

  // Versão 3: destaque do cursor desligado nas sessões (evita ponteiro duplicado) e perfil de velocidade.
  migrateV3() {
    if (this.data.prefsVersion >= 3) return;
    this.data.effects.showDuringSession = false;
    this.data.session.profile = this.data.session.profile || 'speed';
    this.data.session.pointer = this.data.session.pointer || 'dot';
    this.data.session.codec = this.data.session.codec || 'auto';
    this.data.prefsVersion = 3;
  }

  // Versão 4: limpar desenhos passa para Ctrl+0 (se o atalho não tiver sido personalizado).
  migrateV4() {
    if (this.data.prefsVersion >= 4) return;
    if (!this.data.shortcuts.clearDrawings || this.data.shortcuts.clearDrawings === 'Alt+0') this.data.shortcuts.clearDrawings = 'Ctrl+0';
    this.data.prefsVersion = 4;
  }

  static newDeviceId() {
    // 9 dígitos, sem zero à esquerda (estilo "1 518 626 850").
    let id = String(crypto.randomInt(1, 10));
    for (let i = 0; i < 8; i++) id += String(crypto.randomInt(0, 10));
    return id;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get(key) { return key ? this.data[key] : this.data; }

  set(key, value) {
    this.data[key] = deepMerge(this.data[key], value);
    this.save();
    return this.data[key];
  }

  // ---- Senhas ----
  static hashPassword(salt, password) {
    return crypto.createHash('sha256').update(salt + password).digest('hex');
  }

  setPermanentPassword(pw) {
    const s = this.data.security;
    if (!pw) { s.permanentHash = null; }
    else { s.permanentSalt = crypto.randomBytes(16).toString('hex'); s.permanentHash = Store.hashPassword(s.permanentSalt, pw); }
    this.save();
  }

  encrypt(text) {
    if (!text) return '';
    if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(text).toString('base64');
    return 'b64:' + Buffer.from(text, 'utf8').toString('base64');
  }

  decrypt(blob) {
    if (!blob) return '';
    try {
      if (blob.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(blob.slice(4), 'base64'));
      if (blob.startsWith('b64:')) return Buffer.from(blob.slice(4), 'base64').toString('utf8');
    } catch (_) { /* chaveiro indisponível */ }
    return '';
  }

  // ---- Favoritos ----
  listFavorites() {
    return this.data.favorites.map(f => ({ ...f, password: undefined, hasPassword: !!f.password }));
  }

  saveFavorite(fav) {
    const id = String(fav.id || '').replace(/\D/g, '');
    if (!id) throw new Error('ID inválido');
    const list = this.data.favorites;
    const i = list.findIndex(f => f.id === id);
    const prev = i >= 0 ? list[i] : {};
    const item = {
      id,
      name: fav.name || prev.name || id,
      notes: fav.notes ?? prev.notes ?? '',
      color: fav.color || prev.color || '#4fc3f7',
      icon: fav.icon || prev.icon || 'monitor',
      pinned: fav.pinned === undefined ? !!prev.pinned : !!fav.pinned,
      lastUsed: prev.lastUsed || null,
      password: fav.password === undefined ? prev.password || '' : (fav.password ? this.encrypt(fav.password) : '')
    };
    if (i >= 0) list[i] = item; else list.push(item);
    this.save();
    return { ...item, password: undefined, hasPassword: !!item.password };
  }

  removeFavorite(id) {
    this.data.favorites = this.data.favorites.filter(f => f.id !== id);
    this.save();
  }

  favoritePassword(id) {
    const f = this.data.favorites.find(x => x.id === id);
    return f ? this.decrypt(f.password) : '';
  }

  touchRecent(entry) {
    const fav = this.data.favorites.find(f => f.id === entry.id);
    if (fav) fav.lastUsed = Date.now();
    this.data.recents = [{ ...entry, when: Date.now() }, ...this.data.recents.filter(r => r.id !== entry.id)].slice(0, 30);
    this.save();
  }
}

module.exports = { Store, DEFAULT_SHORTCUTS };
