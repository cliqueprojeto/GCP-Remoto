(function () {
  'use strict';
  const { icon, esc } = GUI;
  const root = document.getElementById('root');

  // Som curto gerado na hora (sem arquivos de áudio)
  function chime(kind) {
    try {
      const ac = new AudioContext();
      const notes = kind === 'request' ? [660, 880, 1320] : kind === 'warn' ? [520, 390] : [740, 990];
      notes.forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = f;
        const t = ac.currentTime + i * 0.12;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.4);
      });
    } catch (_) {}
  }

  function fit() {
    const card = root.firstElementChild;
    if (card) gcp.invoke('notice:resize', card.getBoundingClientRect().height + 28);
  }

  function leave(value) {
    const c = root.querySelector('.card');
    if (c) c.classList.add('leave');
    setTimeout(() => gcp.invoke('notice:respond', value), 200);
  }

  const OS = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' };

  function renderRequest(d) {
    const seconds = d.timeout || 45;
    root.innerHTML = `
      <div class="card">
        <div class="glow"></div>
        <div class="rq">
          <div class="rq-top drag"><img src="assets/logo.svg" alt="">GCP Remoto · Pedido de acesso<span class="live"><i></i>aguardando</span></div>
          <div class="who">
            <div class="avatar">${icon(d.who.os === 'win32' ? 'monitor' : 'laptop')}</div>
            <div><h1>${esc(d.who.name)}</h1><p>${esc(d.who.osLabel || OS[d.who.os] || 'Computador remoto')}</p></div>
          </div>
          <div class="question">${d.hasPassword ? '<span class="badge-pw">✓ senha correta</span><br>' : ''}<b>${esc(d.who.name)}</b> quer acessar <b>este computador</b>. Você permite?</div>
          <div class="perms nodrag">
            ${[['control', 'mouse', 'Controlar mouse e teclado'], ['files', 'folder', 'Transferir arquivos'], ['clipboard', 'clipboard', 'Área de transferência'], ['drawing', 'pen', 'Desenhar na tela']].map(([k, ic, lab]) =>
              `<label class="perm"><span class="switch"><input type="checkbox" data-p="${k}" ${d.perms[k] ? 'checked' : ''}><span></span></span>${lab}</label>`).join('')}
          </div>
          <div class="actions nodrag">
            <button class="btn danger" id="deny">${icon('x')}Recusar</button>
            <button class="btn accept" id="accept">${icon('check')}Aceitar acesso</button>
          </div>
          <div class="countdown"><span id="cd">Recusa automática em ${seconds}s</span><div class="bar"><i id="cdbar" style="width:100%"></i></div></div>
          <div class="sec-note">Aceite apenas se você conhece quem está pedindo. Você pode encerrar a sessão a qualquer momento pela janela do GCP Remoto.</div>
        </div>
      </div>`;
    const perms = () => Object.fromEntries([...root.querySelectorAll('[data-p]')].map(i => [i.dataset.p, i.checked]));
    document.getElementById('accept').onclick = () => leave(perms());
    document.getElementById('deny').onclick = () => leave(null);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') leave(null); });
    let left = seconds;
    const timer = setInterval(() => {
      left--;
      document.getElementById('cd').textContent = `Recusa automática em ${left}s`;
      document.getElementById('cdbar').style.width = (left / seconds) * 100 + '%';
      if (left <= 0) { clearInterval(timer); leave(null); }
    }, 1000);
    chime('request');
    setTimeout(() => document.getElementById('accept').focus(), 100);
  }

  function renderInfo(d) {
    const kind = d.tone || 'info';
    const ms = d.ms || 7000;
    root.innerHTML = `
      <div class="card ${kind === 'warn' ? 'warn' : ''}">
        <div class="inf ${kind}">
          <div class="badge">${icon(d.icon || (kind === 'warn' ? 'power' : kind === 'ok' ? 'check' : 'info'))}</div>
          <div style="flex:1;min-width:0">
            <h2>${esc(d.title)}</h2>
            <p>${esc(d.body || '')}</p>
            ${d.meta && d.meta.length ? `<div class="meta">${d.meta.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
          </div>
          <button class="icon-btn sm x nodrag" id="close" title="Fechar">${icon('x')}</button>
          <div class="life" style="animation-duration:${ms}ms"></div>
        </div>
      </div>`;
    document.getElementById('close').onclick = () => leave(null);
    root.querySelector('.card').onmouseenter = () => { clearTimeout(t); root.querySelector('.life').style.animationPlayState = 'paused'; };
    root.querySelector('.card').onmouseleave = () => { root.querySelector('.life').style.animationPlayState = 'running'; t = setTimeout(() => leave(null), 2500); };
    let t = setTimeout(() => leave(null), ms);
    chime(kind === 'warn' ? 'warn' : 'info');
  }

  gcp.invoke('notice:data').then((d) => {
    if (!d) return;
    if (d.kind === 'request') renderRequest(d); else renderInfo(d);
    requestAnimationFrame(() => requestAnimationFrame(fit));
  });
})();
