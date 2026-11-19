'use strict';
// KeyboardEvent.code  ->  [nome libnut (Windows/X11), código evdev (Wayland/portal)]
const MAP = {
  Escape: ['escape', 1], Digit1: ['1', 2], Digit2: ['2', 3], Digit3: ['3', 4], Digit4: ['4', 5],
  Digit5: ['5', 6], Digit6: ['6', 7], Digit7: ['7', 8], Digit8: ['8', 9], Digit9: ['9', 10],
  Digit0: ['0', 11], Minus: ['-', 12], Equal: ['=', 13], Backspace: ['backspace', 14], Tab: ['tab', 15],
  KeyQ: ['q', 16], KeyW: ['w', 17], KeyE: ['e', 18], KeyR: ['r', 19], KeyT: ['t', 20], KeyY: ['y', 21],
  KeyU: ['u', 22], KeyI: ['i', 23], KeyO: ['o', 24], KeyP: ['p', 25], BracketLeft: ['[', 26],
  BracketRight: [']', 27], Enter: ['enter', 28], ControlLeft: ['control', 29], KeyA: ['a', 30],
  KeyS: ['s', 31], KeyD: ['d', 32], KeyF: ['f', 33], KeyG: ['g', 34], KeyH: ['h', 35], KeyJ: ['j', 36],
  KeyK: ['k', 37], KeyL: ['l', 38], Semicolon: [';', 39], Quote: ["'", 40], Backquote: ['`', 41],
  ShiftLeft: ['shift', 42], Backslash: ['\\', 43], KeyZ: ['z', 44], KeyX: ['x', 45], KeyC: ['c', 46],
  KeyV: ['v', 47], KeyB: ['b', 48], KeyN: ['n', 49], KeyM: ['m', 50], Comma: [',', 51], Period: ['.', 52],
  Slash: ['/', 53], ShiftRight: ['right_shift', 54], NumpadMultiply: ['multiply', 55], AltLeft: ['alt', 56],
  Space: ['space', 57], CapsLock: ['caps_lock', 58], F1: ['f1', 59], F2: ['f2', 60], F3: ['f3', 61],
  F4: ['f4', 62], F5: ['f5', 63], F6: ['f6', 64], F7: ['f7', 65], F8: ['f8', 66], F9: ['f9', 67],
  F10: ['f10', 68], NumLock: ['num_lock', 69], ScrollLock: ['scroll_lock', 70], Numpad7: ['numpad_7', 71],
  Numpad8: ['numpad_8', 72], Numpad9: ['numpad_9', 73], NumpadSubtract: ['subtract', 74],
  Numpad4: ['numpad_4', 75], Numpad5: ['numpad_5', 76], Numpad6: ['numpad_6', 77], NumpadAdd: ['add', 78],
  Numpad1: ['numpad_1', 79], Numpad2: ['numpad_2', 80], Numpad3: ['numpad_3', 81], Numpad0: ['numpad_0', 82],
  NumpadDecimal: ['numpad_decimal', 83], IntlBackslash: ['\\', 86], F11: ['f11', 87], F12: ['f12', 88],
  IntlRo: ['/', 89], NumpadEnter: ['enter', 96], ControlRight: ['right_control', 97],
  NumpadDivide: ['divide', 98], PrintScreen: ['printscreen', 99], AltRight: ['right_alt', 100],
  Home: ['home', 102], ArrowUp: ['up', 103], PageUp: ['pageup', 104], ArrowLeft: ['left', 105],
  ArrowRight: ['right', 106], End: ['end', 107], ArrowDown: ['down', 108], PageDown: ['pagedown', 109],
  Insert: ['insert', 110], Delete: ['delete', 111], AudioVolumeMute: ['audio_mute', 113],
  AudioVolumeDown: ['audio_vol_down', 114], AudioVolumeUp: ['audio_vol_up', 115], Pause: ['pause', 119],
  NumpadComma: ['numpad_decimal', 121], MetaLeft: ['meta', 125], OSLeft: ['meta', 125],
  MetaRight: ['right_meta', 126], OSRight: ['right_meta', 126], ContextMenu: ['menu', 127],
  F13: ['f13', 183], F14: ['f14', 184], F15: ['f15', 185], F16: ['f16', 186], F17: ['f17', 187],
  F18: ['f18', 188], F19: ['f19', 189], F20: ['f20', 190], F21: ['f21', 191], F22: ['f22', 192],
  F23: ['f23', 193], F24: ['f24', 194], MediaTrackNext: ['audio_next', 163],
  MediaPlayPause: ['audio_play', 164], MediaTrackPrevious: ['audio_prev', 165], MediaStop: ['audio_stop', 166]
};

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);

function libnutName(code) { return MAP[code] ? MAP[code][0] : null; }
function evdevCode(code) { return MAP[code] ? MAP[code][1] : null; }

// Converte um caractere Unicode para keysym X11 (usado pelo portal no Wayland).
function charToKeysym(ch) {
  const cp = ch.codePointAt(0);
  if (cp === 0x0a || cp === 0x0d) return 0xff0d;
  if (cp === 0x09) return 0xff09;
  if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) return cp;
  return 0x01000000 + cp;
}

module.exports = { MAP, MODIFIER_CODES, libnutName, evdevCode, charToKeysym };
