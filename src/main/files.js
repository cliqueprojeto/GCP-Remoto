'use strict';
// Arquivos: área de transferência de ARQUIVOS (Ctrl+C / Ctrl+V entre computadores),
// leitura/gravação de transferências e navegação remota de pastas.
// Tudo usa recursos nativos do sistema (sem instalações extras):
//   Windows -> PowerShell (Get-Clipboard / Set-Clipboard)  |  Linux -> formato text/uri-list
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { clipboard, app } = require('electron');

function ps(script) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
      { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

async function readClipboardFiles() {
  try {
    if (process.platform === 'win32') {
      const out = await ps('[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }');
      return out.split(/\r?\n/).map(s => s.trim()).filter(p => p && fs.existsSync(p));
    }
    const formats = clipboard.availableFormats();
    let raw = '';
    if (formats.includes('text/uri-list')) raw = clipboard.read('text/uri-list');
    if (!raw && formats.includes('x-special/gnome-copied-files')) raw = clipboard.readBuffer('x-special/gnome-copied-files').toString('utf8');
    if (!raw) {
      const t = clipboard.readText();
      if (/^file:\/\//m.test(t)) raw = t;
    }
    return raw.split(/\r?\n/).map(s => s.trim()).filter(s => s.startsWith('file://'))
      .map(u => { try { return decodeURIComponent(new URL(u).pathname); } catch (_) { return null; } })
      .filter(p => p && fs.existsSync(p));
  } catch (_) { return []; }
}

async function writeClipboardFiles(paths) {
  if (!paths.length) return false;
  if (process.platform === 'win32') {
    const list = paths.map(p => `'${p.replace(/'/g, "''")}'`).join(',');
    await ps(`Set-Clipboard -Path ${list}`);
    return true;
  }
  const uris = paths.map(p => 'file://' + p.split('/').map(encodeURIComponent).join('/'));
  // KDE/Dolphin e GNOME Files aceitam text/uri-list para colar arquivos. Em ambientes GNOME,
  // a área de trabalho (e o Nautilus) preferem x-special/gnome-copied-files.
  const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toUpperCase();
  if (/GNOME|UNITY|CINNAMON|MATE|BUDGIE|PANTHEON/.test(desktop)) {
    clipboard.writeBuffer('x-special/gnome-copied-files', Buffer.from('copy\n' + uris.join('\n'), 'utf8'));
  } else {
    clipboard.writeBuffer('text/uri-list', Buffer.from(uris.join('\r\n') + '\r\n', 'utf8'));
  }
  return true;
}

// Expande arquivos e pastas em uma lista plana com caminho relativo.
function scan(paths, limit = 20000) {
  const out = [];
  const top = [];
  const walk = (abs, rel) => {
    if (out.length >= limit) return;
    let st;
    try { st = fs.lstatSync(abs); } catch (_) { return; }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      out.push({ abs, rel, size: 0, dir: true });
      for (const name of fs.readdirSync(abs)) walk(path.join(abs, name), rel + '/' + name);
    } else if (st.isFile()) {
      out.push({ abs, rel, size: st.size, dir: false });
    }
  };
  for (const p of paths) {
    const name = path.basename(p);
    top.push(name);
    walk(p, name);
  }
  return { items: out, top, total: out.reduce((a, b) => a + b.size, 0) };
}

function safeRel(rel) {
  const parts = String(rel).split(/[\\/]+/).filter(x => x && x !== '.' && x !== '..')
    .map(x => x.replace(/[<>:"|?*\x00-\x1f]/g, '_'));
  return parts.join(path.sep);
}

function uniqueTop(dir, name) {
  let target = path.join(dir, name);
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  for (let n = 1; fs.existsSync(target); n++) target = path.join(dir, `${base} (${n})${ext}`);
  return path.basename(target);
}

class Receiver {
  constructor(baseDir, top) {
    this.baseDir = baseDir;
    fs.mkdirSync(baseDir, { recursive: true });
    this.rename = new Map();
    for (const t of top) this.rename.set(t, uniqueTop(baseDir, safeRel(t)));
    this.fd = null;
    this.paths = [...this.rename.values()].map(n => path.join(baseDir, n));
  }
  resolve(rel) {
    const s = safeRel(rel).split(path.sep);
    if (this.rename.has(s[0])) s[0] = this.rename.get(s[0]);
    const full = path.join(this.baseDir, ...s);
    if (!full.startsWith(this.baseDir)) throw new Error('caminho inválido');
    return full;
  }
  open(rel, dir) {
    this.closeFile();
    const full = this.resolve(rel);
    if (dir) { fs.mkdirSync(full, { recursive: true }); return; }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    this.fd = fs.openSync(full, 'w');
  }
  write(data) { if (this.fd != null) fs.writeSync(this.fd, Buffer.from(data)); }
  closeFile() { if (this.fd != null) { fs.closeSync(this.fd); this.fd = null; } }
}

function readChunk(abs, offset, length) {
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, offset);
    return buf.subarray(0, n);
  } finally { fs.closeSync(fd); }
}

function listDir(dir) {
  if (!dir) {
    if (process.platform === 'win32') {
      const drives = [];
      for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { try { fs.accessSync(l + ':\\'); drives.push({ name: l + ':', path: l + ':\\', dir: true }); } catch (_) {} }
      return { path: '', parent: null, entries: [{ name: 'Pasta pessoal', path: os.homedir(), dir: true }, ...drives] };
    }
    dir = os.homedir();
  }
  dir = path.resolve(dir);
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      entries.push({ name, path: full, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs, hidden: name.startsWith('.') });
    } catch (_) { /* sem permissão */ }
  }
  entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
  const parent = path.dirname(dir) !== dir ? path.dirname(dir) : (process.platform === 'win32' ? '' : null);
  return { path: dir, parent, entries, sep: path.sep, home: os.homedir() };
}

// Observa cópias de ARQUIVOS (Ctrl+C, botão direito › Copiar, qualquer gerenciador).
//  Windows: um único PowerShell em laço (leve), sem abrir processos a cada verificação.
//  Linux: compara o conteúdo text/uri-list da área de transferência.
let clipWatch = null;
function startClipWatch(cb) {
  stopClipWatch();
  if (process.platform === 'win32') {
    const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $last=$null; while ($true) { try { $l = [Windows.Forms.Clipboard]::GetFileDropList(); $s = ($l -join '|') } catch { $s = $last }; if ($s -ne $last) { $last = $s; [Console]::Out.WriteLine('GCPFILES:' + $s); [Console]::Out.Flush() }; Start-Sleep -Milliseconds 700 }";
    const { spawn } = require('child_process');
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { windowsHide: true });
    let buf = '';
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line.startsWith('GCPFILES:')) cb(line.slice(9).split('|').map(s => s.trim()).filter(p => p && fs.existsSync(p)));
      }
    });
    ps.on('error', () => {});
    clipWatch = { stop: () => { try { ps.kill(); } catch (_) {} } };
    return;
  }
  let last = null;
  const tick = async () => {
    let sig = '';
    try {
      const f = clipboard.availableFormats();
      const fmt = f.find(x => x === 'text/uri-list') || f.find(x => x === 'x-special/gnome-copied-files');
      sig = fmt ? clipboard.readBuffer(fmt).toString('utf8') : (/^file:\/\//m.test(clipboard.readText()) ? clipboard.readText() : '');
    } catch (_) {}
    if (sig === last) return;
    last = sig;
    cb(sig ? await readClipboardFiles() : []);
  };
  const t = setInterval(tick, 700); tick();
  clipWatch = { stop: () => clearInterval(t) };
}
function stopClipWatch() { if (clipWatch) clipWatch.stop(); clipWatch = null; }

function tempClipDir(tid) { return path.join(app.getPath('temp'), 'gcp-remoto-clip', String(tid)); }

module.exports = { readClipboardFiles, writeClipboardFiles, scan, Receiver, readChunk, listDir, tempClipDir, startClipWatch, stopClipWatch };
