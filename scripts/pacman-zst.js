// Converte o pacote Arch gerado (.pacman, compressão xz) para o padrão .pkg.tar.zst
// usado pelo Arch Linux / BigLinux / Manjaro. O conteúdo (tar) não muda.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dist = path.join(__dirname, '..', 'dist');
for (const f of fs.readdirSync(dist).filter(n => n.endsWith('.pacman'))) {
  const src = path.join(dist, f);
  const out = path.join(dist, f.replace(/\.pacman$/, '.pkg.tar.zst'));
  const tar = execFileSync('xz', ['-dc', src], { maxBuffer: 2 * 1024 ** 3 });
  fs.writeFileSync(out, execFileSync('zstd', ['-19', '-T0', '-c'], { input: tar, maxBuffer: 2 * 1024 ** 3 }));
  fs.unlinkSync(src);
  console.log('  • pacote Arch/BigLinux:', path.basename(out));
}
