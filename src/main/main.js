'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, desktopCapturer,
  session, clipboard, dialog, shell, Notification, globalShortcut
} = require('electron');
const { Store, DEFAULT_SHORTCUTS } = require('./store');
const { InputController, isWayland } = require('./input');
const { OverlayManager } = require('./overlay');
const files = require('./files');
const { NoticeManager } = require('./notices');
const { integrateAppImage, installedPath } = require('./linux-integration');
const updater = require('./updater');
const kwin = require('./kwin');

// Apoio ao projeto (voluntário)
const SUPPORT = {
  pix: '00020126850014br.gov.bcb.pix0136e474b71b-7491-4eac-992f-632652e5a4eb0223DEV GESTAO CULTURAL PRO5204000053039865802BR5915BRUNO ALBERTINI6006BRASIL62200516ChromeExtensions63042B27',
  stripe: 'https://donate.stripe.com/fZu4gzeBSfhbd7451F6Ri00',
  site: 'https://gestaoculturalpro.com.br/'
};

// ---------- Flags do Chromium ----------
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
// Linux: modo nativo por padrão (Wayland ou X11, conforme a sessão). O "modo de compatibilidade X11"
// é opcional (Configurações › Geral) e só é aplicado se houver servidor X disponível.
function earlyConfig() {
  try {
    const dir = process.env.GCP_REMOTO_PROFILE ? path.resolve(process.env.GCP_REMOTO_PROFILE)
      : process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'GCP Remoto - dados')
      : path.join(app.getPath('appData'), 'GCP Remoto');
    return JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  } catch (_) { return {}; }
}
if (process.platform === 'linux') {
  const cfg = earlyConfig();
  if (cfg.general && cfg.general.compatX11 && process.env.DISPLAY) app.commandLine.appendSwitch('ozone-platform', 'x11');
}
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('force-fieldtrials', 'WebRTC-Video-MinVideoBitrate/Enabled,bitrate:500/');
app.setAppUserModelId('br.com.gestaoculturalpro.gcpremoto');

// Versão portátil do Windows: guarda os dados ao lado do .exe (leva no pendrive).
if (process.env.PORTABLE_EXECUTABLE_DIR) app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'GCP Remoto - dados'));
// Perfis separados (ex.: testes com duas instâncias no mesmo computador).
if (process.env.GCP_REMOTO_PROFILE) app.setPath('userData', path.resolve(process.env.GCP_REMOTO_PROFILE));

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const RENDERER = path.join(__dirname, '..', 'renderer');
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const startHidden = process.argv.includes('--hidden');

let store, input, overlay, notices, tray, mainWin = null;
let lastUpdate = null;
let quitting = false;
let sessionPassword = '';
let pendingSourceId = null;
let pendingAudio = false;
const sessionParams = new Map();      // webContents.id -> {id, password, name}
const challenges = new Map();         // nonce -> expiry
let authFailures = [];
let authLockedUntil = 0;
const receivers = new Map();          // tid -> files.Receiver

// ---------- Senha de sessão ----------
function generatePassword(len) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}
function regenPassword() {
  sessionPassword = generatePassword(Math.max(6, Math.min(16, store.get('security').sessionPasswordLength || 8)));
  if (mainWin) mainWin.webContents.send('pw:changed', sessionPassword);
  return sessionPassword;
}

// ---------- Janelas ----------
function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1180, height: 780, minWidth: 900, minHeight: 600,
    title: 'GCP Remoto', icon: ICON, show: false, backgroundColor: '#f1f1f1',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, contextIsolation: true, sandbox: false }
  });
  mainWin.removeMenu();
  mainWin.loadFile(path.join(RENDERER, 'index.html'));
  mainWin.once('ready-to-show', () => {
    if (!(startHidden || store.get('general').startMinimized)) mainWin.show();
  });
  mainWin.on('close', (e) => {
    if (!quitting && store.get('general').closeToTray && tray) {
      e.preventDefault();
      mainWin.hide();
    }
  });
  mainWin.on('closed', () => { mainWin = null; if (!quitting) app.quit(); });
  mainWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWin.webContents.on('console-message', (_e, level, message) => { if (level >= 3) logLine('[interface]', message); });
  mainWin.webContents.on('did-fail-load', (_e, code, desc) => logLine('[carregamento]', code, desc));
}

function showMain() {
  if (!mainWin) return createMainWindow();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
}

function openSessionWindow(params) {
  const w = new BrowserWindow({
    width: 1280, height: 800, minWidth: 640, minHeight: 420,
    title: `GCP Remoto — ${params.name || params.id}`, icon: ICON, backgroundColor: '#1b1b1f',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, contextIsolation: true, sandbox: false }
  });
  w.removeMenu();
  sessionParams.set(w.webContents.id, params);
  const wcId = w.webContents.id;
  w.on('closed', () => sessionParams.delete(wcId));
  w.loadFile(path.join(RENDERER, 'session.html'));
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return w;
}

function downloadsDir() {
  const dir = store.get('general').downloadDir || path.join(app.getPath('downloads'), 'GCP Remoto');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------- Atalhos globais de apresentação (no computador onde o widget está aberto) ----------
const PRESENTER_KEYS = ['toolPointer', 'toolPen', 'toolMarker', 'toolArrow', 'toolLine', 'toolRect', 'toolEllipse', 'toolText', 'clearDrawings', 'undoDrawing', 'redoDrawing', 'spotlight', 'cursorHighlight', 'clickEffect'];
const ACCEL_KEYS = { Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right' };
function toAccelerator(combo) {
  if (!combo) return null;
  return combo.split('+').map(p => ACCEL_KEYS[p] || (/^Num\d$/.test(p) ? 'num' + p.slice(3) : p)).join('+');
}
function presenterAction(action) {
  const fx = overlay.effects();
  if (action === 'presenterWidget') return overlay.updateEffects({ widget: { on: !fx.widget.on } });
  if (action === 'spotlight') return overlay.updateEffects({ spotlight: { on: !fx.spotlight.on } });
  if (action === 'cursorHighlight') return overlay.updateEffects({ cursor: { on: !fx.cursor.on } });
  if (action === 'clickEffect') return overlay.updateEffects({ clicks: { on: !fx.clicks.on } });
  const TOOLS = { toolPointer: 'pointer', toolPen: 'pen', toolMarker: 'marker', toolArrow: 'arrow', toolLine: 'line', toolRect: 'rect', toolEllipse: 'ellipse', toolText: 'text' };
  if (TOOLS[action]) {
    if (!fx.widget.expanded) overlay.updateEffects({ widget: { expanded: true } });
    return overlay.setTool({ tool: TOOLS[action] });
  }
  overlay.push('overlay:shortcut', action);
}
function syncGlobalShortcuts() {
  globalShortcut.unregisterAll();
  const sc = store.get('shortcuts');
  const keys = ['presenterWidget', ...(overlay.effects().widget.on ? PRESENTER_KEYS : [])];
  for (const k of keys) {
    const acc = toAccelerator(sc[k]);
    if (!acc) continue;
    try { globalShortcut.register(acc, () => presenterAction(k)); } catch (_) { /* combinação inválida ou em uso */ }
  }
}

// ---------- Atualização instalada com o app aberto ----------
// Quando o pacote é atualizado (pacman, apt, dnf, instalador do Windows) com o app rodando
// na bandeja, o processo antigo continuaria ativo. Detecta a troca dos arquivos e reinicia
// sozinho assim que não houver sessão em andamento.
function watchForUpdate() {
  if (!app.isPackaged) return;
  const asar = path.join(process.resourcesPath, 'app.asar');
  const stamp = () => { try { const st = fs.statSync(asar); return st.mtimeMs + ':' + st.size; } catch (_) { return null; } };
  const initial = stamp();
  if (!initial) return;
  let pending = false;
  setInterval(() => {
    const now = stamp();
    if (!now || now === initial) return;
    const busy = (overlay && overlay.sessionInfo) || sessionParams.size > 0;
    if (!pending) {
      pending = true;
      if (busy && notices) notices.info({ tone: 'info', icon: 'refresh', title: 'Atualização instalada', body: 'O GCP-Remoto vai reiniciar sozinho quando a sessão atual terminar.', ms: 9000 });
    }
    if (busy) return;
    quitting = true;
    app.relaunch({ args: process.argv.slice(1).filter(a => a !== '--hidden').concat(mainWin && mainWin.isVisible() ? [] : ['--hidden']) });
    app.exit(0);
  }, 15000);
}

// ---------- macOS: permissões do sistema ----------
// Gravação de Tela (transmitir a tela), Acessibilidade (receber mouse/teclado) e Microfone (voz).
function macPermissions(prompt) {
  if (process.platform !== 'darwin') return null;
  const { systemPreferences } = require('electron');
  return {
    screen: systemPreferences.getMediaAccessStatus('screen'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(!!prompt),
    microphone: systemPreferences.getMediaAccessStatus('microphone')
  };
}

// ---------- Diagnóstico ----------
function logLine(...parts) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'gcp-remoto.log');
    try { if (fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, file + '.1'); } catch (_) {}
    fs.appendFileSync(file, `${new Date().toISOString()} ${parts.map(p => (p && p.stack) || (typeof p === 'object' ? JSON.stringify(p) : String(p))).join(' ')}\n`);
  } catch (_) {}
}
process.on('uncaughtException', (e) => logLine('[erro]', e));
process.on('unhandledRejection', (e) => logLine('[promessa]', e));
app.on('render-process-gone', (_e, wc, details) => {
  logLine('[janela encerrada]', details);
  if (mainWin && !mainWin.isDestroyed() && wc === mainWin.webContents && details.reason !== 'clean-exit') setTimeout(() => mainWin && mainWin.reload(), 800);
});
app.on('child-process-gone', (_e, details) => logLine('[processo]', details));

// ---------- Bandeja ----------
function trayImage(state) {
  const file = path.join(__dirname, '..', 'renderer', 'assets', `tray-${state}.png`);
  const img = nativeImage.createFromPath(fs.existsSync(file) ? file : ICON);
  return img.resize({ width: 22, height: 22 });
}
function updateTray(info) {
  if (!tray) return;
  tray.setImage(trayImage(info ? 'active' : 'idle'));
  tray.setToolTip(info ? `GCP Remoto — sessão ativa com ${info.name}` : 'GCP Remoto — pronto para conexões');
}
function createTray() {
  try {
    tray = new Tray(trayImage('idle'));
    tray.setToolTip('GCP Remoto');
    buildTrayMenu();
    tray.on('click', showMain);
  } catch (e) { tray = null; }
}

function buildTrayMenu() {
  if (!tray) return;
  const pinned = store.get('favorites').filter(f => f.pinned);
  const quick = pinned.length ? [
    { label: 'Conexões rápidas', enabled: false },
    ...pinned.map(f => ({ label: `   ${f.name}  (${f.id})`, click: () => openSessionWindow({ id: f.id, password: store.favoritePassword(f.id), name: f.name }) })),
    { type: 'separator' }
  ] : [];
  {
    const menu = Menu.buildFromTemplate([
      ...quick,
      { label: 'Abrir GCP Remoto', click: showMain },
      { label: 'Copiar meu ID', click: () => clipboard.writeText(store.get('deviceId')) },
      { label: 'Nova senha de sessão', click: regenPassword },
      { label: '♥ Apoie o projeto', click: () => { showMain(); setTimeout(() => mainWin && mainWin.webContents.send('support:open'), 300); } },
      { label: 'Ferramentas de apresentação', click: () => { overlay.updateEffects({ widget: { on: !overlay.effects().widget.on } }); } },
      { type: 'separator' },
      { label: `Versão ${app.getVersion()}`, enabled: false },
      { label: 'Sair do GCP-Remoto', click: () => { quitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(menu);
  }
}

// ---------- Início automático ----------
function applyAutostart(enabled) {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
    return;
  }
  const dir = path.join(os.homedir(), '.config', 'autostart');
  const file = path.join(dir, 'gcp-remoto.desktop');
  if (!enabled) { try { fs.unlinkSync(file); } catch (_) {} return; }
  const exec = process.env.APPIMAGE ? installedPath() : process.execPath;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=GCP Remoto\nExec="${exec}" --hidden\nIcon=gcp-remoto\nX-GNOME-Autostart-enabled=true\n`);
}

// ---------- Autenticação ----------
function newChallenge() {
  const nonce = crypto.randomBytes(24).toString('hex');
  challenges.set(nonce, Date.now() + 120000);
  for (const [n, exp] of challenges) if (exp < Date.now()) challenges.delete(n);
  return { nonce, salt: store.get('security').permanentSalt, hasPermanent: !!store.get('security').permanentHash };
}

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function checkProof(nonce, proof) {
  const now = Date.now();
  if (now < authLockedUntil) return { ok: false, locked: Math.ceil((authLockedUntil - now) / 1000) };
  if (!challenges.has(nonce)) return { ok: false, reason: 'desafio expirado' };
  challenges.delete(nonce);
  const sec = store.get('security');
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const sessionVerifier = Store.hashPassword(sec.permanentSalt, sessionPassword);
  if (sessionPassword && safeEq(proof, sha(nonce + sessionVerifier))) return { ok: true, kind: 'session' };
  if (sec.permanentHash && safeEq(proof, sha(nonce + sec.permanentHash))) return { ok: true, kind: 'permanent' };
  authFailures = authFailures.filter(t => now - t < 60000);
  authFailures.push(now);
  if (authFailures.length >= 8) { authLockedUntil = now + 120000; authFailures = []; }
  return { ok: false, reason: 'senha incorreta' };
}

// ---------- IPC ----------
function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(e, ...a));

  h('app:info', () => ({
    deviceId: store.get('deviceId'),
    displayName: store.get('displayName'),
    platform: process.platform,
    osLabel: `${{ win32: 'Windows', linux: 'Linux', darwin: 'macOS' }[process.platform] || process.platform} ${os.release()}`,
    hostname: os.hostname(),
    version: app.getVersion(),
    input: input.info(),
    wayland: isWayland
  }));
  h('app:show', () => showMain());
  h('mac:permissions', (_e, prompt) => macPermissions(prompt));
  h('mac:ask-microphone', () => process.platform === 'darwin' ? require('electron').systemPreferences.askForMediaAccess('microphone') : true);
  h('mac:open-settings', (_e, pane) => { if (process.platform === 'darwin') shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`); });
  h('app:quit', () => { quitting = true; app.quit(); });
  h('app:open-external', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

  h('settings:get', () => {
    const d = store.get();
    return {
      displayName: d.displayName, server: d.server, iceServers: d.iceServers, turn: d.turn,
      security: { ...d.security, permanentHash: undefined, hasPermanent: !!d.security.permanentHash },
      session: d.session, shortcuts: d.shortcuts, general: d.general, audio: d.audio, defaultShortcuts: DEFAULT_SHORTCUTS
    };
  });
  h('settings:set', (_e, key, value) => {
    const allowed = ['displayName', 'server', 'iceServers', 'turn', 'security', 'session', 'shortcuts', 'general', 'audio'];
    if (!allowed.includes(key)) throw new Error('chave inválida');
    if (key === 'security' && value) { delete value.permanentHash; delete value.permanentSalt; }
    if (key === 'displayName') { store.data.displayName = String(value).slice(0, 60); store.save(); }
    else if (key === 'shortcuts') { store.data.shortcuts = { ...DEFAULT_SHORTCUTS, ...value }; store.save(); syncGlobalShortcuts(); }
    else store.set(key, value);
    if (key === 'general') applyAutostart(!!store.get('general').startWithSystem);
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('settings:changed'));
    return true;
  });
  h('settings:permanent-password', (_e, pw) => { store.setPermanentPassword(pw ? String(pw) : ''); return true; });
  h('settings:new-device-id', () => { store.data.deviceId = Store.newDeviceId(); store.save(); return store.get('deviceId'); });

  h('pw:get', () => sessionPassword);
  h('pw:regen', () => regenPassword());
  h('pw:session-ended', () => { if (store.get('security').regenerateAfterSession) regenPassword(); });

  h('auth:challenge', () => newChallenge());
  h('auth:check', (_e, nonce, proof) => checkProof(nonce, proof));

  h('favorites:list', () => store.listFavorites());
  h('favorites:save', (_e, fav) => { const r = store.saveFavorite(fav); buildTrayMenu(); return r; });
  h('favorites:remove', (_e, id) => { store.removeFavorite(id); buildTrayMenu(); return true; });
  h('recents:list', () => store.get('recents'));
  h('recents:clear', () => { store.data.recents = []; store.save(); return true; });

  h('session:open', (_e, params) => {
    const id = String(params.id || '').replace(/\D/g, '');
    if (id.length < 6) throw new Error('ID inválido');
    if (id === store.get('deviceId')) throw new Error('Este é o ID deste próprio computador.');
    const password = params.request ? '' : (params.password != null ? params.password : store.favoritePassword(id));
    const fav = store.get('favorites').find(f => f.id === id);
    openSessionWindow({ id, password, name: params.name || (fav && fav.name) || id, request: !!params.request });
    return true;
  });
  h('session:params', (e) => sessionParams.get(e.sender.id) || null);
  h('session:connected', (_e, info) => { store.touchRecent(info); if (mainWin) mainWin.webContents.send('recents:changed'); });
  h('session:save-favorite', (_e, fav) => store.saveFavorite(fav));

  h('win:fullscreen', (e, val) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    w.setFullScreen(val === undefined ? !w.isFullScreen() : !!val);
    return w.isFullScreen();
  });
  h('win:size', (e, wd, ht) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w.isFullScreen()) w.setFullScreen(false);
    if (w.isMaximized()) w.unmaximize();
    if (wd === 'max') { w.maximize(); return; }
    w.setContentSize(Math.round(wd), Math.round(ht));
    w.center();
  });
  h('win:title', (e, t) => BrowserWindow.fromWebContents(e.sender).setTitle(String(t)));
  h('win:close', (e) => BrowserWindow.fromWebContents(e.sender).close());
  h('win:focus', (e) => { const w = BrowserWindow.fromWebContents(e.sender); w.show(); w.focus(); });

  h('screens:list', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } });
    const displays = screen.getAllDisplays();
    return sources.map((s, i) => {
      const d = displays.find(x => String(x.id) === String(s.display_id)) || displays[i] || screen.getPrimaryDisplay();
      return { id: s.id, name: s.name || `Tela ${i + 1}`, displayId: String(d.id), width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor), thumb: s.thumbnail.toDataURL() };
    });
  });
  h('capture:select', (_e, sourceId, audio) => { pendingSourceId = sourceId; pendingAudio = !!audio; return true; });

  h('input:prepare', async () => { await input.prepare(); return input.info(); });
  ipcMain.on('input:event', (_e, ev) => input.handle(ev));
  h('input:release', () => input.releaseAll());

  // ---- Camada sobre a tela / efeitos / widget ----
  h('overlay:session', (_e, info) => { overlay.setSession(info); updateTray(info); return true; });
  h('overlay:display', (_e, displayId) => { overlay.setDisplay(displayId); return true; });
  ipcMain.on('overlay:op', (_e, op) => overlay.drawOp(op));
  h('overlay:clear', () => overlay.clearShapes());
  h('overlay:get-state', () => overlay.state());
  h('effects:get', () => overlay.effects());
  h('effects:set', (_e, patch) => {
    return overlay.updateEffects(patch);
  });
  h('effects:force', (_e, on) => { overlay.forceFx = !!on; overlay.sync(); return true; });
  ipcMain.on('overlay:tool', (_e, t) => overlay.setTool(t || {}));
  ipcMain.on('overlay:focus', () => overlay.focusLayer());
  ipcMain.on('overlay:action', (_e, action) => overlay.push('overlay:shortcut', String(action)));
  ipcMain.on('widget:resize', (_e, w, h) => overlay.resizeWidget(w, h));

  h('clipboard:read', () => clipboard.readText());
  h('clipboard:write', (_e, text) => { clipboard.writeText(String(text)); return true; });

  // ---- Transferência de arquivos ----
  h('files:clipboard-read', () => files.readClipboardFiles());
  h('files:clip-watch', (e, on) => {
    if (!on) { files.stopClipWatch(); return true; }
    const wc = e.sender;
    files.startClipWatch((paths) => { if (!wc.isDestroyed()) wc.send('files:clip-changed', paths); });
    return true;
  });
  h('files:clipboard-write', (_e, paths) => files.writeClipboardFiles(paths));
  h('files:scan', (_e, paths) => files.scan(paths));
  h('files:pick', async (e, dirs) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: [dirs ? 'openDirectory' : 'openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
  h('files:read', (_e, abs, offset, len) => files.readChunk(abs, offset, Math.min(len, 1024 * 1024)));
  h('files:list', (_e, dir) => files.listDir(dir));
  h('files:downloads-dir', () => downloadsDir());
  h('xfer:begin', (_e, tid, opts) => {
    let base;
    if (opts.purpose === 'clip') base = files.tempClipDir(tid);
    else if (opts.dest) base = path.resolve(String(opts.dest));
    else base = downloadsDir();
    const r = new files.Receiver(base, opts.top || []);
    receivers.set(tid, r);
    return { base, paths: r.paths };
  });
  h('xfer:open', (_e, tid, rel, dir) => { const r = receivers.get(tid); if (r) r.open(rel, dir); return true; });
  h('xfer:write', (_e, tid, data) => { const r = receivers.get(tid); if (r) r.write(data); return true; });
  h('xfer:end', async (_e, tid, opts = {}) => {
    const r = receivers.get(tid); if (!r) return null;
    r.closeFile(); receivers.delete(tid);
    if (opts.toClipboard) await files.writeClipboardFiles(r.paths);
    return r.paths;
  });
  h('file:show', (_e, p) => shell.showItemInFolder(p));
  h('file:open-downloads', () => shell.openPath(downloadsDir()));
  h('file:open-logs', () => { const d = path.join(app.getPath('userData'), 'logs'); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); });
  h('file:choose-dir', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  h('screenshot:save', async (_e, dataUrl, label) => {
    const dir = path.join(app.getPath('pictures'), 'GCP Remoto');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const file = path.join(dir, `captura-${String(label || 'remoto').replace(/\W+/g, '_')}-${stamp}.png`);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return file;
  });

  h('notify', (_e, title, body) => {
    if (Notification.isSupported()) new Notification({ title, body, icon: ICON }).show();
  });
  h('support:info', async () => {
    const QR = require('qrcode');
    const svg = await QR.toString(SUPPORT.pix, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
    return { ...SUPPORT, qr: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') };
  });
  // ---- Atualizações pelo GitHub ----
  h('update:check', async () => {
    const st = await updater.check();
    store.data.general.lastUpdateCheck = Date.now(); store.save();
    lastUpdate = st; return { ...st, checkedAt: store.data.general.lastUpdateCheck };
  });
  h('update:info', () => ({ current: app.getVersion(), kind: updater.installKind(), lastCheck: store.get('general').lastUpdateCheck || null, freq: store.get('general').updateCheck || 'startup', pending: lastUpdate && lastUpdate.newer ? lastUpdate : null }));
  h('update:install', async (e) => {
    const st = lastUpdate && lastUpdate.newer ? lastUpdate : await updater.check();
    if (!st.newer) return { action: 'none', message: 'Você já está na versão mais recente.' };
    return updater.install(st, {
      appImageTarget: installedPath(),
      onProgress: (done, total) => { if (!e.sender.isDestroyed()) e.sender.send('update:progress', done, total); },
      relaunch: (target) => { quitting = true; app.relaunch({ execPath: target, args: [] }); setTimeout(() => app.exit(0), 300); }
    });
  });
  h('update:page', () => shell.openExternal('https://github.com/cliqueprojeto/GCP-Remoto/releases/latest'));
  h('notice:request', (_e, payload) => notices.request(payload));
  h('notice:info', (_e, payload) => { notices.info(payload); return true; });
  h('notice:progress', (e, id, payload) => { notices.progress(String(id), payload, e.sender); return true; });
  h('notice:cancel', (_e, id) => { notices.cancelProgress(String(id)); return true; });
  h('notice:action', (_e, id, action) => {
    const d = notices.progressData(String(id));
    const paths = (d && d.paths) || [];
    if (!paths.length) return { ok: false };
    if (action === 'folder') { shell.showItemInFolder(paths[0]); return { ok: true }; }
    if (action === 'desktop') {
      const desk = app.getPath('desktop');
      const placed = [];
      for (const src of paths) {
        const name = path.basename(src), ext = path.extname(name), base = name.slice(0, name.length - ext.length);
        let dest = path.join(desk, name);
        for (let n = 1; fs.existsSync(dest); n++) dest = path.join(desk, `${base} (${n})${ext}`);
        fs.cpSync(src, dest, { recursive: true });
        placed.push(dest);
      }
      return { ok: true, placed };
    }
    return { ok: false };
  });
  h('tray:status', (_e, text) => { if (tray) tray.setToolTip(`GCP Remoto — ${text}`); });
}

// ---------- Ciclo de vida ----------
const SMOKE = process.argv.includes('--smoke-test');
async function smokeTest() {
  const r = { versao: app.getVersion(), sistema: process.platform, arquitetura: process.arch, empacotado: app.isPackaged };
  const out = (code) => { const line = 'GCP_SMOKE ' + JSON.stringify(r); console.log(line); if (process.env.GCP_SMOKE_OUT) { try { fs.writeFileSync(process.env.GCP_SMOKE_OUT, line + '\n'); } catch (_) {} } app.exit(code); };
  const fail = (m) => { r.erro = m; out(1); };
  try {
    r.controle = input.info();
    if (!input.backend) return fail('controle de mouse/teclado não carregou: ' + (input.error || ''));
    try { require('uiohook-napi'); r.cliques = 'ok'; } catch (e) { r.cliques = 'indisponível: ' + e.message; if (process.platform !== 'linux') return fail('uiohook: ' + e.message); }
    try { require('qrcode'); r.qrcode = 'ok'; } catch (e) { return fail('qrcode: ' + e.message); }
    await new Promise((res, rej) => { if (!mainWin.webContents.isLoading()) return res(); mainWin.webContents.once('did-finish-load', res); mainWin.webContents.once('did-fail-load', (_e, c, d) => rej(new Error(d))); });
    const ui = await mainWin.webContents.executeJavaScript(`new Promise(r => setTimeout(() => r({ peer: typeof Peer, id: document.querySelector('#my-id').textContent, gproto: typeof GProto, gvoice: typeof GVoice, nav: document.querySelectorAll('#nav button').length }), 1500))`);
    r.interface = ui;
    if (ui.peer !== 'function' || ui.gproto !== 'object' || ui.gvoice !== 'object' || ui.nav < 5 || !/\d/.test(ui.id)) return fail('interface incompleta');
    const s = await mainWin.webContents.executeJavaScript(`fetch('session.html').then(r => r.ok)`).catch(() => false);
    r.paginas = s ? 'ok' : 'faltando';
    r.ok = true;
    out(0);
  } catch (e) { fail(e.message); }
}

app.whenReady().then(() => {
  store = new Store();
  input = new InputController(store);
  overlay = new OverlayManager({ store, preload: path.join(__dirname, 'preload.js'), page: path.join(RENDERER, 'overlay.html'), widgetPage: path.join(RENDERER, 'widget.html') });
  input.onClick = (b) => overlay.remoteClick(b);
  overlay.onEffectsChanged = () => syncGlobalShortcuts();
  notices = new NoticeManager({ preload: path.join(__dirname, 'preload.js'), page: path.join(RENDERER, 'notice.html'), icon: ICON });
  regenPassword();
  registerIpc();

  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      const src = sources.find(s => s.id === pendingSourceId) || sources[0];
      const res = { video: src };
      if (pendingAudio && process.platform === 'win32') res.audio = 'loopback';
      callback(res);
    } catch (e) {
      callback({});
    }
  });
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'display-capture', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(perm)));

  if (SMOKE) { createMainWindow(); smokeTest(); setTimeout(() => { console.log('GCP_SMOKE {"erro":"tempo esgotado"}'); app.exit(1); }, 60000); return; }
  logLine('[inicio]', `versão ${app.getVersion()}`, process.platform, process.env.XDG_SESSION_TYPE || '', process.env.APPIMAGE ? 'AppImage' : (app.isPackaged ? 'instalado' : 'desenvolvimento'));
  createTray();
  createMainWindow();
  syncGlobalShortcuts();
  watchForUpdate();
  kwin.installKeepAbove(logLine);   // KDE Wayland: camada, widget e avisos sempre acima (sem clicar no ícone)
  setTimeout(async () => {
    if (!app.isPackaged || !updater.isDue(store.get('general'))) return;
    try {
      lastUpdate = await updater.check();
      store.data.general.lastUpdateCheck = Date.now(); store.save();
      if (lastUpdate.newer && mainWin) mainWin.webContents.send('update:available', lastUpdate);
      if (lastUpdate.newer && notices) notices.info({ tone: 'ok', icon: 'download', title: `Nova versão ${lastUpdate.latest} disponível`, body: 'Abra o GCP-Remoto e clique em Atualizar agora.', ms: 10000 });
    } catch (e) { logLine('[atualização]', e.message); }
  }, 15000);
  const integ = integrateAppImage();
  if (integ) setTimeout(() => notices.info({ tone: 'ok', icon: 'check', title: integ === 'installed' ? 'GCP-Remoto instalado' : 'GCP-Remoto atualizado', body: integ === 'installed' ? 'Ele já está no menu de aplicativos, em Internet. Pode apagar o arquivo baixado.' : `Versão ${app.getVersion()} instalada no menu de aplicativos.`, ms: 9000 }), 2500);
  applyAutostart(!!store.get('general').startWithSystem);
});

app.on('second-instance', showMain);
app.on('activate', () => { if (!SMOKE) showMain(); });   // macOS: clicar no ícone do Dock reabre a janela
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => { quitting = true; if (input) input.close(); if (overlay) overlay.close(); });
app.on('window-all-closed', () => { if (quitting || !tray) app.quit(); });
