// Camada transparente em tela cheia (computador acessado / apresentador):
// desenhos ao vivo, destaque do cursor, anéis de clique, holofote e selo de sessão.
// Deixa os cliques passarem; só recebe o mouse enquanto uma ferramenta de desenho está ativa.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const canvas = $('#fx'), ctx = canvas.getContext('2d');
  const board = new GDraw.Board();
  let tool = { tool: 'pointer', color: '#ff4b3e', size: 4 };
  let state = { effects: null, session: null };
  let cursor = { x: -999, y: -999 };
  let rings = [];
  let dirty = true;
  const mine = [], redo = [];

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    dirty = true;
  }
  addEventListener('resize', resize); resize();

  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

  function fxActive() {
    const fx = state.effects; if (!fx) return false;
    return (state.session && fx.showDuringSession) || fx.widget.on || state.forceFx;
  }

  function frame() {
    if (dirty || rings.length) {
      dirty = false;
      const fx = state.effects, on = fxActive();
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = innerWidth, h = innerHeight;
      if (fx && on && fx.spotlight.on && cursor.x > -500) {
        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${fx.spotlight.dim / 100})`;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-out';
        const g = ctx.createRadialGradient(cursor.x, cursor.y, fx.spotlight.radius * 0.82, cursor.x, cursor.y, fx.spotlight.radius);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cursor.x, cursor.y, fx.spotlight.radius, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      board.render(ctx, w, h);
      if (fx && on && fx.cursor.on && cursor.x > -500) {
        ctx.beginPath(); ctx.fillStyle = hexA(fx.cursor.color, fx.cursor.opacity / 100);
        ctx.arc(cursor.x, cursor.y, fx.cursor.size, 0, Math.PI * 2); ctx.fill();
      }
      const now = performance.now();
      rings = rings.filter(r => now - r.t < 520);
      for (const r of rings) {
        const k = (now - r.t) / 520, size = fx ? fx.clicks.size : 39;
        ctx.beginPath(); ctx.strokeStyle = hexA(r.color, 1 - k); ctx.lineWidth = 4 * (1 - k) + 1;
        ctx.arc(r.x, r.y, size * (0.35 + k * 0.9), 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.fillStyle = hexA(r.color, 0.28 * (1 - k));
        ctx.arc(r.x, r.y, size * 0.35 * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill();
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- Eventos do processo principal ----------
  gcp.on('overlay:state', (s) => { state = s; if (s.tool) setTool(s.tool); dirty = true; renderBanner(); });
  gcp.on('effects:changed', (fx) => { state.effects = fx; dirty = true; renderBanner(); });
  gcp.on('overlay:cursor', (p) => { cursor = p; dirty = true; });
  gcp.on('overlay:click', (c) => {
    const fx = state.effects;
    if (!fx || !fx.clicks.on || !fxActive()) return;
    rings.push({ x: c.x, y: c.y, t: performance.now(), color: c.button === 'right' ? fx.clicks.right : fx.clicks.left });
  });
  gcp.on('overlay:op', (op) => { board.apply(op); dirty = true; });
  gcp.on('overlay:tool', (t) => setTool(t));
  gcp.on('overlay:shortcut', (action) => {
    if (action === 'undoDrawing') { const s = mine.pop(); if (s) { redo.push(s); apply({ a: 'remove', id: s.id }); } }
    if (action === 'redoDrawing') { const s = redo.pop(); if (s) { mine.push(s); apply({ a: 'upsert', s }); } }
    if (action === 'clearDrawings') { mine.length = 0; redo.length = 0; apply({ a: 'clear' }); }
  });

  function setTool(t) {
    tool = { ...tool, ...t };
    document.body.classList.toggle('drawing', tool.tool !== 'pointer');
  }
  const backToPointer = () => gcp.send('overlay:tool', { tool: 'pointer' });

  // ---------- Selo de sessão ----------
  function fmt(ms) { const s = Math.floor(ms / 1000); const hh = Math.floor(s / 3600); return (hh ? String(hh).padStart(2, '0') + ':' : '') + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  function renderBanner() {
    const b = $('#banner');
    const show = state.session && state.effects && state.effects.sessionBanner && !state.effects.widget.on;
    b.classList.toggle('hidden', !show);
    if (show) $('#banner-text').textContent = `Sessão remota ativa · ${state.session.name} · ${fmt(Date.now() - state.session.since)}`;
  }
  setInterval(renderBanner, 1000);

  // ---------- Desenho local (apresentador) ----------
  function apply(op) { board.apply(op); dirty = true; }
  let cur = null;
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); backToPointer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#text-input').style.display === 'none') backToPointer(); });
  canvas.addEventListener('pointerdown', (e) => {
    if (tool.tool === 'pointer' || e.button !== 0) return;
    const p = { x: e.clientX / innerWidth, y: e.clientY / innerHeight };
    if (tool.tool === 'text') return startText(e.clientX, e.clientY, p);
    canvas.setPointerCapture(e.pointerId);
    cur = { id: GDraw.uid(), by: 'local', tool: tool.tool, color: tool.color, size: tool.size, pts: [[p.x, p.y]] };
    if (!['pen', 'marker'].includes(tool.tool)) cur.pts.push([p.x, p.y]);
    apply({ a: 'upsert', s: cur });
  });
  canvas.addEventListener('pointermove', (e) => {
    cursor = { x: e.clientX, y: e.clientY };
    if (!cur) { dirty = true; return; }
    const p = [e.clientX / innerWidth, e.clientY / innerHeight];
    if (cur.tool === 'pen' || cur.tool === 'marker') cur.pts.push(p); else cur.pts[1] = p;
    dirty = true;
  });
  canvas.addEventListener('pointerup', () => { if (cur) { mine.push(cur); redo.length = 0; cur = null; gcp.send('overlay:op', { a: 'mark' }); } });

  function startText(x, y, p) {
    const ta = $('#text-input');
    gcp.send('overlay:focus');
    ta.style.display = 'block'; ta.style.left = x + 'px'; ta.style.top = y + 'px'; ta.style.color = tool.color; ta.value = '';
    ta.focus();
    const commit = () => {
      ta.removeEventListener('keydown', onKey); ta.removeEventListener('blur', commit);
      ta.style.display = 'none';
      const text = ta.value.trim();
      if (text) { const s = { id: GDraw.uid(), by: 'local', tool: 'text', color: tool.color, size: tool.size, pts: [[p.x, p.y]], text }; mine.push(s); apply({ a: 'upsert', s }); }
    };
    const onKey = (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); } if (e.key === 'Escape') { ta.value = ''; commit(); } };
    ta.addEventListener('keydown', onKey); ta.addEventListener('blur', commit);
  }
})();
