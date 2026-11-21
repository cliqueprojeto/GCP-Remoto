'use strict';
// Atualizações pelo GitHub (Releases do projeto), adaptadas a cada forma de instalação:
//  - Windows instalado: baixa o instalador, confere o SHA-256 e instala em silêncio, reabrindo o programa.
//  - Windows portátil: baixa o novo portátil na mesma pasta e o abre.
//  - Linux AppImage: substitui a cópia instalada e reinicia.
//  - Linux .pkg.tar.zst / .deb / .rpm: baixa o pacote certo e abre o instalador do sistema (Pamac, Discover…).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, net, shell } = require('electron');

const REPO = 'cliqueprojeto/GCP-Remoto';
const UA = { 'User-Agent': 'GCP-Remoto-Atualizador', Accept: 'application/vnd.github+json' };

function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

function installKind() {
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'nsis';
  if (process.platform === 'linux') {
    if (process.env.APPIMAGE) return 'appimage';
    if (fs.existsSync('/usr/bin/pacman')) return 'pacman';
    if (fs.existsSync('/usr/bin/dpkg')) return 'deb';
    if (fs.existsSync('/usr/bin/rpm')) return 'rpm';
    return 'appimage';
  }
  if (process.platform === 'darwin') return 'mac';
  return 'other';
}

function assetName(kind, v) {
  return {
    nsis: `GCP-Remoto-Instalador-${v}-x64.exe`,
    portable: `GCP-Remoto-Portatil-${v}-x64.exe`,
    appimage: `GCP-Remoto-${v}-linux-x86_64.AppImage`,
    pacman: `gcp-remoto-${v}-1-x86_64.pkg.tar.zst`,
    deb: `GCP-Remoto-${v}-linux-amd64.deb`,
    rpm: `GCP-Remoto-${v}-linux-x86_64.rpm`,
    mac: `GCP-Remoto-${v}-macOS-${process.arch === 'arm64' ? 'arm64' : 'x64'}.dmg`
  }[kind];
}

async function latest() {
  let res;
  try { res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: UA }); }
  catch (_) { throw new Error('Sem conexão com o GitHub.'); }
  if (res.status === 404) throw new Error('Nenhuma versão pública encontrada no GitHub (o repositório pode estar privado).');
  if (!res.ok) throw new Error(`O GitHub respondeu ${res.status}.`);
  const j = await res.json();
  const version = String(j.tag_name || '').replace(/^v/, '');
  return { version, notes: j.body || '', url: j.html_url, assets: (j.assets || []).map(a => ({ name: a.name, url: a.browser_download_url, size: a.size })) };
}

async function check() {
  const info = await latest();
  const current = app.getVersion();
  const kind = installKind();
  const asset = info.assets.find(a => a.name === assetName(kind, info.version));
  return { current, latest: info.version, newer: cmpVer(info.version, current) > 0, kind, asset: asset || null, page: info.url, notes: info.notes, assets: info.assets };
}

async function download(url, dest, onProgress) {
  const res = await net.fetch(url, { headers: { 'User-Agent': UA['User-Agent'] } });
  if (!res.ok || !res.body) throw new Error(`Falha ao baixar (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = dest + '.parcial';
  const out = fs.createWriteStream(tmp);
  const hash = crypto.createHash('sha256');
  const reader = res.body.getReader();
  let done = 0, last = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    const buf = Buffer.from(value);
    hash.update(buf);
    if (!out.write(buf)) await new Promise(r => out.once('drain', r));
    done += buf.length;
    const now = Date.now();
    if (onProgress && now - last > 200) { last = now; onProgress(done, total); }
  }
  await new Promise((r, j) => out.end(err => (err ? j(err) : r())));
  fs.renameSync(tmp, dest);
  return hash.digest('hex');
}

async function expectedHash(assets, name) {
  const sums = assets.filter(a => /^SHA256SUMS.*\.txt$/i.test(a.name));
  for (const s of sums) {
    try {
      const res = await net.fetch(s.url, { headers: { 'User-Agent': UA['User-Agent'] } });
      if (!res.ok) continue;
      const line = (await res.text()).split(/\r?\n/).find(l => l.trim().endsWith(name));
      if (line) return line.trim().split(/\s+/)[0].toLowerCase();
    } catch (_) {}
  }
  return null;
}

// Baixa e aplica. Retorna { action, file, message }.
async function install(state, { onProgress, appImageTarget, relaunch }) {
  if (!state.asset) throw new Error('Não há pacote desta versão para o seu tipo de instalação. Abra a página de versões.');
  const kind = state.kind;
  let dir;
  if (kind === 'portable') dir = path.dirname(process.env.PORTABLE_EXECUTABLE_FILE);
  else if (kind === 'pacman' || kind === 'deb' || kind === 'rpm' || kind === 'mac') dir = app.getPath('downloads');
  else dir = path.join(app.getPath('temp'), 'gcp-remoto-atualizacao');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, state.asset.name);
  const sha = await download(state.asset.url, file, onProgress);
  const expected = await expectedHash(state.assets, state.asset.name);
  if (expected && expected !== sha) { try { fs.unlinkSync(file); } catch (_) {} throw new Error('O arquivo baixado não confere com a assinatura SHA-256 da versão. A atualização foi cancelada.'); }

  if (kind === 'nsis') {
    spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => app.exit(0), 600);
    return { action: 'installing', file, message: 'Instalando a nova versão… o GCP-Remoto vai reabrir sozinho.' };
  }
  if (kind === 'portable') {
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.exit(0), 600);
    return { action: 'opened', file, message: `Nova versão portátil salva em ${dir}.` };
  }
  if (kind === 'appimage') {
    const target = appImageTarget || process.env.APPIMAGE;
    fs.chmodSync(file, 0o755);
    fs.copyFileSync(file, target + '.novo');
    fs.chmodSync(target + '.novo', 0o755);
    fs.renameSync(target + '.novo', target);
    try { fs.writeFileSync(path.join(path.dirname(target), 'versao.txt'), state.latest); } catch (_) {}
    relaunch(target);
    return { action: 'restarting', file, message: 'Atualizado. Reiniciando…' };
  }
  if (kind === 'mac') {
    await shell.openPath(file);
    return { action: 'system-installer', file, message: 'A imagem da nova versão foi aberta. Arraste o GCP Remoto para Aplicativos e substitua; depois abra de novo.' };
  }
  // .pkg.tar.zst / .deb / .rpm: o instalador gráfico do sistema pede a senha; depois o app reinicia sozinho.
  await shell.openPath(file);
  return { action: 'system-installer', file, message: 'O instalador do sistema foi aberto. Clique em Instalar (ou Aplicar) e informe sua senha; o GCP-Remoto reinicia sozinho na versão nova.' };
}

function isDue(general) {
  const freq = general.updateCheck || 'startup';
  if (freq === 'never') return false;
  if (freq === 'startup') return true;
  const days = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 }[freq] || 1;
  return !general.lastUpdateCheck || (Date.now() - general.lastUpdateCheck) > days * 86400000;
}

module.exports = { check, install, installKind, isDue, cmpVer };
