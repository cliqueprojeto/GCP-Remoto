'use strict';
// Injeção de mouse/teclado no computador acessado.
//  - Windows e Linux X11: libnut (binário nativo empacotado junto com o app)
//  - Linux Wayland: portal org.freedesktop.portal.RemoteDesktop via D-Bus (nativo do KDE/GNOME)
const { screen } = require('electron');
const { libnutName, evdevCode, charToKeysym } = require('./keymap');

const isWayland = process.platform === 'linux' && (!!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland');

function findDisplay(displayId) {
  const all = screen.getAllDisplays();
  return all.find(d => String(d.id) === String(displayId)) || screen.getPrimaryDisplay();
}

// ---------------- Backend libnut (Windows / X11) ----------------
class LibnutBackend {
  constructor() {
    this.name = process.platform === 'win32' ? 'windows' : 'x11';
    this.nut = require(process.platform === 'win32' ? '@nut-tree-fork/libnut-win32' : '@nut-tree-fork/libnut-linux');
    this.nut.setMouseDelay(0);
    this.nut.setKeyboardDelay(0);
    if (process.platform === 'linux') {
      const { X11Keyboard } = require('./x11kbd');
      this.xkbd = new X11Keyboard();
      this.xkbd.init().catch(() => { this.xkbd = null; });
    }
  }
  async ready() { return true; }
  toPhysical(nx, ny, displayId) {
    const d = findDisplay(displayId);
    const b = d.bounds;
    const dip = { x: b.x + nx * b.width, y: b.y + ny * b.height };
    if (process.platform === 'win32') {
      const p = screen.dipToScreenPoint(dip);
      return { x: Math.round(p.x), y: Math.round(p.y) };
    }
    const sf = d.scaleFactor || 1;
    return { x: Math.round(dip.x * sf), y: Math.round(dip.y * sf) };
  }
  move(nx, ny, displayId) { const p = this.toPhysical(nx, ny, displayId); this.nut.moveMouse(p.x, p.y); }
  button(btn, down) {
    if (this.xkbd) return this.xkbd.enqueue(() => this.nut.mouseToggle(down ? 'down' : 'up', btn));
    this.nut.mouseToggle(down ? 'down' : 'up', btn);
  }
  wheel(dx, dy) {
    // dy > 0 = rolar para baixo (convenção do navegador). libnut: y positivo = para cima.
    if (dy) this.nut.scrollMouse(0, -dy);
    if (dx) this.nut.scrollMouse(dx, 0);
  }
  key(code, down) {
    const k = libnutName(code);
    if (!k) return;
    const run = () => { try { this.nut.keyToggle(k, down ? 'down' : 'up'); } catch (_) { /* tecla não suportada no layout */ } };
    if (this.xkbd) return this.xkbd.enqueue(run);
    run();
  }
  type(text) {
    if (!text) return;
    if (this.xkbd) return this.xkbd.type(text);       // X11: acentos e símbolos em qualquer layout
    this.nut.typeString(text);                          // Windows: Unicode nativo (SendInput)
  }
  close() {}
}

// ---------------- Backend Wayland (portal RemoteDesktop) ----------------
class PortalBackend {
  constructor(store) {
    this.name = 'wayland';
    this.store = store;
    this.session = null;
    this.streams = [];
    this.starting = null;
    this.dbus = require('dbus-next');
  }

  async ready() {
    if (this.session) return true;
    if (!this.starting) this.starting = this._start().catch(e => { this.starting = null; throw e; });
    return this.starting;
  }

  async _request(iface, method, args, optionsIndex) {
    const { Variant } = this.dbus;
    const token = 'gcp' + Math.random().toString(36).slice(2, 10);
    const sender = this.bus.name.slice(1).replace(/\./g, '_');
    const reqPath = `/org/freedesktop/portal/desktop/request/${sender}/${token}`;
    args[optionsIndex].handle_token = new Variant('s', token);
    const rule = `type='signal',interface='org.freedesktop.portal.Request',member='Response',path='${reqPath}'`;
    await this.bus._addMatch(rule);
    return new Promise((resolve, reject) => {
      const onMsg = (msg) => {
        if (msg.path === reqPath && msg.member === 'Response') {
          this.bus.removeListener('message', onMsg);
          const [code, results] = msg.body;
          if (code !== 0) reject(new Error(code === 1 ? 'Permissão negada pelo usuário' : 'Portal recusou a solicitação'));
          else resolve(results);
        }
      };
      this.bus.on('message', onMsg);
      iface[method](...args).catch(err => { this.bus.removeListener('message', onMsg); reject(err); });
    });
  }

  async _start() {
    const { Variant } = this.dbus;
    this.bus = this.dbus.sessionBus();
    const obj = await this.bus.getProxyObject('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop');
    this.rd = obj.getInterface('org.freedesktop.portal.RemoteDesktop');
    this.sc = obj.getInterface('org.freedesktop.portal.ScreenCast');
    const created = await this._request(this.rd, 'CreateSession', [{ session_handle_token: new Variant('s', 'gcps' + Date.now()) }], 0);
    const session = created.session_handle.value;
    const restore = this.store.get('waylandRestoreToken');
    const devOpts = { types: new Variant('u', 3), persist_mode: new Variant('u', 2) };
    if (restore) devOpts.restore_token = new Variant('s', restore);
    await this._request(this.rd, 'SelectDevices', [session, devOpts], 1);
    try {
      await this._request(this.sc, 'SelectSources', [session, { types: new Variant('u', 1), multiple: new Variant('b', true) }], 1);
    } catch (_) { /* sem screencast: só movimento relativo */ }
    const started = await this._request(this.rd, 'Start', [session, '', {}], 2);
    if (started.restore_token) { this.store.data.waylandRestoreToken = started.restore_token.value; this.store.save(); }
    this.streams = (started.streams ? started.streams.value : []).map(([node, props]) => ({
      node,
      pos: props.position ? props.position.value : [0, 0],
      size: props.size ? props.size.value : null
    }));
    this.session = session;
    return true;
  }

  _stream(displayId) {
    const d = findDisplay(displayId);
    return this.streams.find(s => s.pos[0] === d.bounds.x && s.pos[1] === d.bounds.y) || this.streams[0];
  }

  move(nx, ny, displayId) {
    if (!this.session) return;
    const s = this._stream(displayId);
    if (s && s.size) {
      this.rd.NotifyPointerMotionAbsolute(this.session, {}, s.node, nx * s.size[0], ny * s.size[1]).catch(() => {});
    }
  }
  button(btn, down) {
    if (!this.session) return;
    const code = { left: 272, right: 273, middle: 274 }[btn] || 272;
    this.rd.NotifyPointerButton(this.session, {}, code, down ? 1 : 0).catch(() => {});
  }
  wheel(dx, dy) {
    if (!this.session) return;
    if (dy) this.rd.NotifyPointerAxisDiscrete(this.session, {}, 0, dy).catch(() => {});
    if (dx) this.rd.NotifyPointerAxisDiscrete(this.session, {}, 1, dx).catch(() => {});
  }
  key(code, down) {
    if (!this.session) return;
    const k = evdevCode(code);
    if (k) this.rd.NotifyKeyboardKeycode(this.session, {}, k, down ? 1 : 0).catch(() => {});
  }
  async type(text) {
    if (!this.session || !text) return;
    for (const ch of text) {
      const ks = charToKeysym(ch);
      await this.rd.NotifyKeyboardKeysym(this.session, {}, ks, 1).catch(() => {});
      await this.rd.NotifyKeyboardKeysym(this.session, {}, ks, 0).catch(() => {});
    }
  }
  close() {
    if (this.session && this.bus) {
      const m = new this.dbus.Message({ destination: 'org.freedesktop.portal.Desktop', path: this.session, interface: 'org.freedesktop.portal.Session', member: 'Close' });
      this.bus.call(m).catch(() => {});
    }
    this.session = null; this.starting = null;
  }
}

// ---------------- Controlador com rastreio de teclas pressionadas ----------------
class InputController {
  constructor(store) {
    this.store = store;
    this.backend = null;
    this.error = null;
    this.pressedKeys = new Set();
    this.pressedButtons = new Set();
    try {
      this.backend = isWayland ? new PortalBackend(store) : new LibnutBackend();
    } catch (e) {
      this.error = e.message;
    }
  }

  info() { return { backend: this.backend ? this.backend.name : null, wayland: isWayland, error: this.error }; }

  async prepare() {
    if (!this.backend) throw new Error(this.error || 'Controle indisponível');
    return this.backend.ready();
  }

  handle(ev) {
    const b = this.backend;
    if (!b) return;
    try {
      switch (ev.t) {
        case 'mm': b.move(clamp(ev.x), clamp(ev.y), ev.d); break;
        case 'md':
          if (ev.x != null) b.move(clamp(ev.x), clamp(ev.y), ev.d);
          this.autoShift(ev.shift);
          b.button(ev.b, true); this.pressedButtons.add(ev.b);
          if (this.onClick) this.onClick(ev.b);
          break;
        case 'mu':
          if (ev.x != null) b.move(clamp(ev.x), clamp(ev.y), ev.d);
          b.button(ev.b, false); this.pressedButtons.delete(ev.b);
          this.autoShift(false); break;
        case 'wh': b.wheel(Math.max(-20, Math.min(20, ev.dx | 0)), Math.max(-20, Math.min(20, ev.dy | 0))); break;
        case 'kd': this.autoShift(ev.shift); b.key(ev.code, true); this.pressedKeys.add(ev.code); break;
        case 'ku': b.key(ev.code, false); this.pressedKeys.delete(ev.code); if (this.pressedKeys.size <= 1) this.autoShift(false); break;
        case 'type': b.type(String(ev.text || '').slice(0, 5000)); break;
        case 'combo': {
          const codes = (ev.codes || []).slice(0, 6);
          codes.forEach(c => b.key(c, true));
          codes.slice().reverse().forEach(c => b.key(c, false));
          break;
        }
        case 'release': this.releaseAll(); break;
      }
    } catch (e) {
      console.error('[input]', e.message);
    }
  }

  // Shift é enviado como "estado" junto de cada tecla/clique (não como tecla solta),
  // para não interferir na digitação de texto.
  autoShift(on) {
    if (!this.backend) return;
    if (on && !this.shiftDown) { this.backend.key('ShiftLeft', true); this.shiftDown = true; this.pressedKeys.add('ShiftLeft'); }
    else if (!on && this.shiftDown) { this.backend.key('ShiftLeft', false); this.shiftDown = false; this.pressedKeys.delete('ShiftLeft'); }
  }

  releaseAll() {
    this.shiftDown = false;
    if (!this.backend) return;
    for (const k of this.pressedKeys) { try { this.backend.key(k, false); } catch (_) {} }
    for (const btn of this.pressedButtons) { try { this.backend.button(btn, false); } catch (_) {} }
    this.pressedKeys.clear(); this.pressedButtons.clear();
  }

  close() { this.releaseAll(); if (this.backend) this.backend.close(); }
}

function clamp(v) { v = Number(v); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }

module.exports = { InputController, isWayland };
