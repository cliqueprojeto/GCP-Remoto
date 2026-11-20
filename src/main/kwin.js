'use strict';
// KDE Plasma no Wayland: o protocolo não deixa um aplicativo se colocar "sempre por cima" sozinho.
// Pedimos ao próprio KWin (gerenciador de janelas do KDE), pelo recurso oficial de scripts via D-Bus,
// para manter acima de tudo as janelas da camada de desenho, do widget e dos avisos.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CAPTIONS = ['GCP Remoto — camada', 'GCP Remoto — ferramentas', 'GCP Remoto — aviso'];
const PLUGIN = 'gcp-remoto-acima';

const SCRIPT = `
// GCP Remoto: mantém a camada de desenho, o widget e os avisos sempre acima das outras janelas
var nomes = ${JSON.stringify(CAPTIONS)};
function ajustar(w) {
  if (!w) return;
  var c = String(w.caption || '');
  for (var i = 0; i < nomes.length; i++) {
    if (c.indexOf(nomes[i]) === 0) {
      w.keepAbove = true;
      try { w.skipTaskbar = true; w.skipPager = true; w.skipSwitcher = true; } catch (e) {}
      if (nomes[i] === 'GCP Remoto — camada') { try { w.onAllDesktops = true; } catch (e) {} }
      return;
    }
  }
}
function observar(w) {
  ajustar(w);
  try { w.captionChanged.connect(function () { ajustar(w); }); } catch (e) {}
}
var lista = workspace.windowList ? workspace.windowList() : workspace.clientList();
for (var j = 0; j < lista.length; j++) observar(lista[j]);
if (workspace.windowAdded) workspace.windowAdded.connect(observar); else workspace.clientAdded.connect(observar);
`;

function isKdeWayland() {
  return process.platform === 'linux'
    && (!!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland')
    && /KDE/i.test(process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '');
}

async function installKeepAbove(log = () => {}) {
  if (!isKdeWayland()) return false;
  try {
    const dbus = require('dbus-next');
    const bus = dbus.sessionBus();
    const file = path.join(app.getPath('userData'), 'kwin-gcp-remoto.js');
    fs.writeFileSync(file, SCRIPT);
    const obj = await bus.getProxyObject('org.kde.KWin', '/Scripting');
    const scripting = obj.getInterface('org.kde.kwin.Scripting');
    try { if (await scripting.isScriptLoaded(PLUGIN)) await scripting.unloadScript(PLUGIN); } catch (_) {}
    await scripting.loadScript(file, PLUGIN);
    await scripting.start();
    log('[kwin] janelas de apresentação mantidas acima pelo KWin');
    setTimeout(() => { try { bus.disconnect(); } catch (_) {} }, 2000);
    return true;
  } catch (e) {
    log('[kwin] não foi possível registrar o script', e && e.message);
    return false;
  }
}

module.exports = { installKeepAbove, isKdeWayland, CAPTIONS };
