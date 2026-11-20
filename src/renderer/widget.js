// Widget flutuante de ferramentas (janela própria, arrastável pela alça ⠿).
(function () {
  'use strict';
  const { icon } = GUI;
  const el = document.getElementById('wdg');
  let state = { effects: null, session: null, tool: { tool: 'pointer', color: '#ff4b3e', size: 4 } };
  const startedAt = Date.now();

  const TOOLS = [['pointer', 'pointer', 'Cursor — interagir com a tela (Alt+1)'], ['pen', 'pen', 'Caneta (Alt+2)'], ['marker', 'marker', 'Marca-texto (Alt+3)'], ['arrow', 'arrow', 'Seta (Alt+4)'], ['line', 'line', 'Linha (Alt+5)'], ['rect', 'rect', 'Retângulo (Alt+6)'], ['ellipse', 'ellipse', 'Elipse (Alt+7)'], ['text', 'text', 'Texto (Alt+8)']];

  function fmt(ms) { const s = Math.floor(ms / 1000); const hh = Math.floor(s / 3600); return (hh ? String(hh).padStart(2, '0') + ':' : '') + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }

  function fit() {
    const r = el.getBoundingClientRect();
    gcp.send('widget:resize', r.width + 12, r.height + 12);
  }

  function render() {
    const fx = state.effects; if (!fx) return;
    const t = state.tool || {};
    const live = !!state.session;
    const timer = `<span class="rec-dot ${live ? '' : 'idle'}"></span><span class="timer" id="w-timer">${fmt(Date.now() - (live ? state.session.since : startedAt))}</span>`;
    el.classList.toggle('expanded', !!fx.widget.expanded);
    if (!fx.widget.expanded) {
      el.innerHTML = `<div class="w-row"><span class="grip" title="Arraste para mover">${icon('grip')}</span>${timer}<button class="wb ${t.tool !== 'pointer' ? 'active' : ''}" data-act="expand" title="Abrir ferramentas">${icon('pen')}</button></div>`;
    } else {
      el.innerHTML = `
        <div class="w-row"><span class="grip" title="Arraste para mover">${icon('grip')}</span>${timer}<span class="w-label ${live ? '' : 'idle'}">${live ? 'AO VIVO' : 'APRESENTAÇÃO'}</span>
          <button class="wb" data-act="collapse" title="Recolher">${icon('minus')}</button><button class="wb" data-act="close" title="Fechar widget (Ctrl+Alt+W)">${icon('x')}</button></div>
        <div class="w-row">
          ${TOOLS.map(([k, ic, lab]) => `<button class="wb ${t.tool === k ? 'active' : ''}" data-tool="${k}" title="${lab}">${icon(ic)}</button>`).join('')}
          <span class="wsep"></span>
          ${GDraw.PALETTE.map(c => `<button class="wc ${t.color === c ? 'sel' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}
          <input type="range" id="size" min="1" max="24" value="${t.size}" style="--p:${((t.size - 1) / 23) * 100}%" title="Espessura">
          <span class="wsep"></span>
          <button class="wb" data-action="undoDrawing" title="Desfazer (Ctrl+Alt+Z)">${icon('undo')}</button>
          <button class="wb" data-action="redoDrawing" title="Refazer (Ctrl+Alt+Y)">${icon('redo')}</button>
          <button class="wb" data-action="clearDrawings" title="Limpar desenhos (Ctrl+0)">${icon('trash')}</button>
          <span class="wsep"></span>
          <button class="wb ${fx.cursor.on ? 'active' : ''}" data-fx="cursor" title="Destaque do cursor (Ctrl+Alt+H)">${icon('cursorFx')}</button>
          <button class="wb ${fx.clicks.on ? 'active' : ''}" data-fx="clicks" title="Efeito de clique (Ctrl+Alt+C)">${icon('clickFx')}</button>
          <button class="wb ${fx.spotlight.on ? 'active' : ''}" data-fx="spotlight" title="Holofote (Ctrl+Alt+S)">${icon('spotlight')}</button>
        </div>
        <div class="w-hint">Passe o mouse sobre um item para ver o nome e o atalho · arraste ⠿ para mover · Esc volta ao cursor</div>`;
    }
    bind();
    requestAnimationFrame(fit);
  }

  function bind() {
    el.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => gcp.send('overlay:tool', { tool: b.dataset.tool }));
    el.querySelectorAll('[data-color]').forEach(b => b.onclick = () => gcp.send('overlay:tool', { color: b.dataset.color }));
    const sz = el.querySelector('#size');
    if (sz) sz.oninput = () => { sz.style.setProperty('--p', ((sz.value - 1) / 23) * 100 + '%'); gcp.send('overlay:tool', { size: Number(sz.value) }); };
    el.querySelectorAll('[data-fx]').forEach(b => b.onclick = () => { const k = b.dataset.fx; gcp.invoke('effects:set', { [k]: { on: !state.effects[k].on } }); });
    el.querySelectorAll('[data-action]').forEach(b => b.onclick = () => { gcp.send('overlay:action', b.dataset.action); if (b.dataset.action === 'clearDrawings') gcp.invoke('overlay:clear'); });
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'expand') gcp.invoke('effects:set', { widget: { expanded: true } });
      if (a === 'collapse') { gcp.send('overlay:tool', { tool: 'pointer' }); gcp.invoke('effects:set', { widget: { expanded: false } }); }
      if (a === 'close') { gcp.send('overlay:tool', { tool: 'pointer' }); gcp.invoke('effects:set', { widget: { on: false, expanded: false } }); }
    });
  }

  gcp.on('overlay:state', (s) => { state = { ...state, ...s }; render(); });
  gcp.invoke('overlay:get-state').then((s) => { if (s && !state.effects) { state = { ...state, ...s }; render(); } }).catch(() => {});
  gcp.on('effects:changed', (fx) => { state.effects = fx; render(); });
  gcp.on('overlay:tool', (t) => { state.tool = t; render(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') gcp.send('overlay:tool', { tool: 'pointer' }); });
  setInterval(() => { const t = document.getElementById('w-timer'); if (t) t.textContent = fmt(Date.now() - (state.session ? state.session.since : startedAt)); }, 1000);
})();
