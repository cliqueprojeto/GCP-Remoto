// Motor de desenho compartilhado (sessão e camada sobre a tela).
// Coordenadas normalizadas (0..1) para funcionar em qualquer resolução.
(function (root) {
  'use strict';
  const TOOLS = ['pen', 'marker', 'line', 'arrow', 'rect', 'ellipse', 'text'];
  const PALETTE = ['#ff4b3e', '#ff9800', '#ffd400', '#4caf50', '#4fc3f7', '#2979ff', '#b388ff', '#ff4fd8', '#ffffff', '#111111'];

  function scaleOf(w, h) { return Math.max(0.35, Math.min(w, h) / 1080); }

  function drawArrowHead(ctx, x1, y1, x2, y2, size) {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const len = Math.max(12, size * 4);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - len * Math.cos(ang - Math.PI / 7), y2 - len * Math.sin(ang - Math.PI / 7));
    ctx.lineTo(x2 - len * Math.cos(ang + Math.PI / 7), y2 - len * Math.sin(ang + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }

  function renderShape(ctx, s, w, h) {
    const k = scaleOf(w, h);
    const lw = Math.max(1, (s.size || 4) * k);
    const P = (s.pts || []).map(p => [p[0] * w, p[1] * h]);
    if (!P.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = lw;
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = s.tool === 'marker' ? 0 : 2 * k;
    switch (s.tool) {
      case 'pen':
      case 'marker': {
        if (s.tool === 'marker') { ctx.globalAlpha *= 0.38; ctx.lineWidth = lw * 4; ctx.lineCap = 'square'; }
        ctx.beginPath();
        ctx.moveTo(P[0][0], P[0][1]);
        if (P.length === 1) ctx.lineTo(P[0][0] + 0.1, P[0][1] + 0.1);
        for (let i = 1; i < P.length - 1; i++) {
          const mx = (P[i][0] + P[i + 1][0]) / 2, my = (P[i][1] + P[i + 1][1]) / 2;
          ctx.quadraticCurveTo(P[i][0], P[i][1], mx, my);
        }
        if (P.length > 1) ctx.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
        ctx.stroke();
        break;
      }
      case 'line':
      case 'arrow': {
        const [a, b] = [P[0], P[P.length - 1]];
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        if (s.tool === 'arrow') drawArrowHead(ctx, a[0], a[1], b[0], b[1], lw);
        break;
      }
      case 'rect': {
        const [a, b] = [P[0], P[P.length - 1]];
        const r = Math.min(8 * k, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), r);
        else ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        ctx.stroke();
        break;
      }
      case 'ellipse': {
        const [a, b] = [P[0], P[P.length - 1]];
        ctx.beginPath();
        ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'text': {
        const fs = Math.max(12, (s.size || 4) * 6 * k);
        ctx.font = `600 ${fs}px "Inter","Segoe UI","Noto Sans",system-ui,sans-serif`;
        ctx.textBaseline = 'top';
        ctx.shadowColor = 'rgba(0,0,0,.6)';
        ctx.shadowBlur = 4 * k;
        String(s.text || '').split('\n').forEach((line, i) => ctx.fillText(line, P[0][0], P[0][1] + i * fs * 1.2));
        break;
      }
    }
    ctx.restore();
  }

  class Board {
    constructor() { this.shapes = []; this.redoStack = []; }
    apply(op) {
      switch (op.a) {
        case 'upsert': {
          const i = this.shapes.findIndex(s => s.id === op.s.id);
          op.s._t = performance.now();   // o tempo na tela conta a partir da última alteração
          if (i >= 0) this.shapes[i] = op.s; else this.shapes.push(op.s);
          break;
        }
        case 'append': {
          const s = this.shapes.find(x => x.id === op.id);
          if (s) { s.pts.push(...op.pts); s._t = performance.now(); }
          break;
        }
        case 'remove': this.shapes = this.shapes.filter(s => s.id !== op.id); break;
        case 'clear': this.shapes = op.by ? this.shapes.filter(s => s.by !== op.by) : []; break;
      }
    }
    lastBy(by) { for (let i = this.shapes.length - 1; i >= 0; i--) if (this.shapes[i].by === by) return this.shapes[i]; return null; }
    render(ctx, w, h, fade) {
      if (!fade || !fade.on) { for (const s of this.shapes) renderShape(ctx, s, w, h); return false; }
      // Desvanecimento: cada forma fica 'seconds' na tela e some em 'ms' milissegundos
      const now = performance.now(), keep = (fade.seconds || 5) * 1000, dur = Math.max(50, fade.ms || 800);
      let changed = false;
      this.shapes = this.shapes.filter(s => { const age = now - (s._t || now); if (age > keep + dur) { changed = true; return false; } return true; });
      let animating = false;
      for (const s of this.shapes) {
        const age = now - (s._t || now);
        const a = age <= keep ? 1 : 1 - (age - keep) / dur;
        if (age > keep) animating = true;
        ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, a)); renderShape(ctx, s, w, h); ctx.restore();
      }
      return { animating: animating || this.shapes.length > 0, removed: changed };
    }
  }

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

  root.GDraw = { TOOLS, PALETTE, Board, renderShape, uid, scaleOf };
})(window);
