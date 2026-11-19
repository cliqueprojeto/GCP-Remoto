'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { MAP, libnutName, evdevCode, charToKeysym } = require('../src/main/keymap');

function loadRenderer(file, extra = {}) {
  const win = { crypto: globalThis.crypto, TextEncoder, performance, ...extra };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'lib', file), 'utf8'), win);
  return win;
}

test('mapa de teclas cobre letras, números, F1-F12 e navegação', () => {
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') assert.ok(libnutName('Key' + c), c);
  for (let i = 0; i <= 9; i++) assert.ok(libnutName('Digit' + i));
  for (let i = 1; i <= 12; i++) assert.ok(evdevCode('F' + i));
  for (const k of ['Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'Home', 'End', 'PageUp', 'ControlLeft', 'AltLeft', 'MetaLeft', 'ShiftLeft', 'IntlBackslash', 'NumpadComma'])
    assert.ok(MAP[k], k);
  const codes = Object.values(MAP).map(v => v[1]);
  assert.ok(codes.every(n => Number.isInteger(n) && n > 0));
});

test('caracteres viram keysyms X11 corretos (acentos, ç, Unicode)', () => {
  assert.strictEqual(charToKeysym('a'), 0x61);
  assert.strictEqual(charToKeysym('ç'), 0xe7);
  assert.strictEqual(charToKeysym('Á'), 0xc1);
  assert.strictEqual(charToKeysym('€'), 0x01000000 + 0x20ac);
  assert.strictEqual(charToKeysym('\n'), 0xff0d);
});

test('prova de senha do cliente confere com a verificação do lado acessado', async () => {
  const w = loadRenderer('proto.js', { GDraw: {} });
  const salt = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(24).toString('hex');
  const pw = 'Senh@ção123';
  const proof = await w.GProto.makeProof(nonce, salt, pw);
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  assert.strictEqual(proof, sha(nonce + sha(salt + pw)));
  assert.notStrictEqual(proof, sha(nonce + sha(salt + 'outra')));
});

test('formatação de ID e tamanhos', () => {
  const w = loadRenderer('proto.js', { GDraw: {} });
  assert.strictEqual(w.GProto.formatId('1518626850'), '1 518 626 850');
  assert.strictEqual(w.GProto.formatId('301152689'), '301 152 689');
  assert.strictEqual(w.GProto.fmtBytes(3 * 1024 * 1024), '3.0 MB');
});

test('quadro de desenho aplica, acrescenta, remove e limpa formas', () => {
  const w = loadRenderer('draw.js');
  const b = new w.GDraw.Board();
  b.apply({ a: 'upsert', s: { id: 'x', by: 'remote', tool: 'pen', pts: [[0, 0]] } });
  b.apply({ a: 'append', id: 'x', pts: [[0.5, 0.5], [1, 1]] });
  assert.strictEqual(b.shapes[0].pts.length, 3);
  b.apply({ a: 'upsert', s: { id: 'y', by: 'local', tool: 'rect', pts: [[0, 0], [1, 1]] } });
  b.apply({ a: 'clear', by: 'remote' });
  assert.strictEqual(JSON.stringify(b.shapes.map(s => s.id)), '["y"]');
  b.apply({ a: 'remove', id: 'y' });
  assert.strictEqual(b.shapes.length, 0);
});
