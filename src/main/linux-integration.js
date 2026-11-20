'use strict';
// AppImage que se instala sozinho: ao abrir com dois cliques, o GCP-Remoto copia a si mesmo
// para ~/.local/share/gcp-remoto, cria o atalho no menu (categoria Internet) e o ícone.
// Abrir uma versão mais nova substitui a instalada. Sem terminal e sem senha.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { app } = require('electron');

const HOME = os.homedir();
const DATA = process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share');
const TARGET_DIR = path.join(DATA, 'gcp-remoto');
const TARGET = path.join(TARGET_DIR, 'GCP-Remoto.AppImage');
const DESKTOP = path.join(DATA, 'applications', 'gcp-remoto.desktop');
const ICON = path.join(DATA, 'icons', 'hicolor', '512x512', 'apps', 'gcp-remoto.png');
const VERSION_FILE = path.join(TARGET_DIR, 'versao.txt');

function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

function installedVersion() { try { return fs.readFileSync(VERSION_FILE, 'utf8').trim(); } catch (_) { return null; } }

// Retorna: null (nada a fazer), 'installed' ou 'updated'.
function integrateAppImage() {
  const src = process.env.APPIMAGE;
  if (process.platform !== 'linux' || !src || !fs.existsSync(src)) return null;
  if (fs.existsSync('/opt/GCP Remoto/gcp-remoto')) return null; // já instalado pelo pacote do sistema
  const current = app.getVersion();
  const prev = installedVersion();
  const running = path.resolve(src) === path.resolve(TARGET);
  let result = null;
  try {
    if (!running && (!prev || cmpVer(current, prev) >= 0 || !fs.existsSync(TARGET))) {
      fs.mkdirSync(TARGET_DIR, { recursive: true });
      const tmp = TARGET + '.novo';
      fs.copyFileSync(src, tmp);
      fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, TARGET);
      fs.writeFileSync(VERSION_FILE, current);
      result = prev ? (cmpVer(current, prev) > 0 ? 'updated' : null) : 'installed';
    }
    // atalho no menu e ícone (sempre garante que existam e apontem para a cópia instalada)
    fs.mkdirSync(path.dirname(DESKTOP), { recursive: true });
    fs.mkdirSync(path.dirname(ICON), { recursive: true });
    const iconSrc = path.join(__dirname, '..', '..', 'build', 'icon.png');
    if (fs.existsSync(iconSrc)) fs.copyFileSync(iconSrc, ICON);
    const exec = fs.existsSync(TARGET) ? TARGET : src;
    fs.writeFileSync(DESKTOP, [
      '[Desktop Entry]', 'Type=Application', 'Name=GCP Remoto', 'GenericName=Acesso remoto',
      'Comment=Acesso remoto gratuito e livre', `Exec="${exec}" %U`, 'Icon=gcp-remoto', 'Terminal=false',
      'Categories=Network;RemoteAccess;', 'Keywords=remote;desktop;acesso;remoto;suporte;', 'StartupWMClass=GCP Remoto', ''
    ].join('\n'));
    fs.chmodSync(DESKTOP, 0o755);
    execFile('update-desktop-database', [path.dirname(DESKTOP)], () => {});
    execFile('xdg-icon-resource', ['forceupdate'], () => {});
  } catch (_) { return null; }
  return result;
}

function installedPath() { return fs.existsSync(TARGET) ? TARGET : (process.env.APPIMAGE || process.execPath); }

module.exports = { integrateAppImage, installedPath };
