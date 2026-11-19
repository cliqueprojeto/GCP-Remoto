'use strict';
// Digitação precisa no Linux X11 (acentos, ç, símbolos com Shift/AltGr, qualquer Unicode),
// independente do layout do teclado (ABNT2, US, etc.). Conversa direto com o servidor X
// via protocolo X11 + extensão XTEST, em JavaScript puro — nada para instalar.
// Mesma técnica do xdotool: se o caractere não existe no layout, ele é mapeado
// temporariamente numa tecla livre, digitado e a tecla continua reservada para reuso.
const x11 = require('x11');
const { charToKeysym } = require('./keymap');

const XK_Shift_L = 0xffe1;
const XK_ISO_Level3_Shift = 0xfe03;

class X11Keyboard {
  constructor() {
    this.ready = null;
    this.queue = Promise.resolve();
    this.spareIdx = 0;
  }

  init() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const client = x11.createClient({ display: process.env.DISPLAY }, (err, display) => {
        if (err) return reject(err);
        this.X = display.client;
        this.min = display.min_keycode;
        this.max = display.max_keycode;
        this.X.on('error', () => {});
        this.X.require('xtest', (e, xtest) => {
          if (e) return reject(e);
          this.xtest = xtest;
          this.loadMapping().then(resolve, reject);
        });
      });
      client.on('error', reject);
    });
    return this.ready;
  }

  loadMapping() {
    const X = this.X, count = this.max - this.min + 1;
    return new Promise((resolve) => {
      X.seq_num++;
      X.pack_stream.pack('CxSCCxx', [101, 2, this.min, count]);
      X.replies[X.seq_num] = [
        (buf, perCode) => {
          const map = {};
          for (let i = 0; i < count; i++) {
            const syms = [];
            for (let j = 0; j < perCode; j++) syms.push(buf.readUInt32LE(24 + (i * perCode + j) * 4));
            map[this.min + i] = syms;
          }
          return { map, perCode };
        },
        (err, res) => {
          if (!err && res) { this.map = res.map; this.perCode = res.perCode; }
          this.spares = Object.keys(this.map || {}).map(Number).filter(kc => this.map[kc].every(s => s === 0)).reverse().slice(0, 8);
          this.shiftKc = this.find(XK_Shift_L);
          this.level3Kc = this.find(XK_ISO_Level3_Shift);
          resolve();
        }
      ];
      X.pack_stream.flush();
    });
  }

  find(ks) {
    for (const kc of Object.keys(this.map)) {
      const s = this.map[kc];
      if (s[0] === ks) return { kc: +kc, level: 0 };
    }
    for (const kc of Object.keys(this.map)) {
      const s = this.map[kc];
      if (s[1] === ks) return { kc: +kc, level: 1 };
    }
    for (const kc of Object.keys(this.map)) {
      const s = this.map[kc];
      if (s[4] === ks) return { kc: +kc, level: 2 };
      if (s[5] === ks) return { kc: +kc, level: 3 };
    }
    return null;
  }

  remap(kc, ks) {
    const X = this.X, per = this.perCode || 2;
    const syms = new Array(per).fill(0); syms[0] = ks; syms[1] = ks;
    X.seq_num++;
    X.pack_stream.pack('CCSCCxx' + 'L'.repeat(per), [100, 1, 2 + per, kc, per, ...syms]);
    X.pack_stream.flush();
    this.map[kc] = syms;
  }

  fake(type, kc) { this.xtest.FakeInput(type, kc, 0, 0, 0, 0); }

  async typeChar(ch) {
    const ks = charToKeysym(ch);
    let f = this.find(ks);
    if (!f || (f.level >= 2 && !this.level3Kc)) {
      if (!this.spares.length) return;
      const kc = this.spares[this.spareIdx++ % this.spares.length];
      this.remap(kc, ks);
      await sleep(30); // aplicativos precisam receber o MappingNotify antes da tecla
      f = { kc, level: 0 };
    }
    const T = this.xtest;
    const shift = (f.level === 1 || f.level === 3) && this.shiftKc;
    const l3 = f.level >= 2 && this.level3Kc;
    if (shift) this.fake(T.KeyPress, this.shiftKc.kc);
    if (l3) this.fake(T.KeyPress, this.level3Kc.kc);
    this.fake(T.KeyPress, f.kc);
    this.fake(T.KeyRelease, f.kc);
    if (l3) this.fake(T.KeyRelease, this.level3Kc.kc);
    if (shift) this.fake(T.KeyRelease, this.shiftKc.kc);
    await sleep(2);
  }

  // Executa uma ação de teclado/mouse na MESMA fila da digitação (mantém a ordem exata).
  enqueue(fn) {
    this.queue = this.queue.then(fn).catch(() => {});
    return this.queue;
  }

  type(text) {
    this.queue = this.queue.then(async () => {
      await this.init();
      for (const ch of text) await this.typeChar(ch);
    }).catch(() => {});
    return this.queue;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { X11Keyboard };
