// Janela principal.
(function () {
  'use strict';
  const { icon, hydrateIcons, toast, esc, modal } = GUI;
  const { formatId, osName, fmtBytes } = GProto;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const FAV_COLORS = ['#4fc3f7', '#7c6cff', '#3ddc97', '#ffb547', '#ff5d5d', '#ff4fd8', '#26c6da', '#9ccc65', '#8d9cba'];
  const FAV_ICONS = ['monitor', 'laptop', 'server', 'home', 'building', 'user'];
  let favorites = [], recents = [], pwVisible = false, password = '', setTab = 'general', sessionTimer = null;

  hydrateIcons();

  // ---------- Navegação ----------
  function go(page) {
    $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
    if (page === 'settings') GSettings.renderSettings(setTab, $('#set-body'), ctx);
    if (page === 'presenter') renderPresenter();
    if (page === 'favorites') renderFavorites();
    if (page === 'recents') renderRecents();
  }
  $$('#nav button').forEach(b => b.onclick = () => go(b.dataset.page));
  $$('[data-goto]').forEach(b => b.onclick = () => go(b.dataset.goto));
  $$('#set-tabs button').forEach(b => b.onclick = () => {
    setTab = b.dataset.tab;
    $$('#set-tabs button').forEach(x => x.classList.toggle('active', x === b));
    GSettings.renderSettings(setTab, $('#set-body'), ctx);
  });

  const ctx = { refresh: () => refreshIdentity() };

  // ---------- Identidade e senha ----------
  async function refreshIdentity() {
    const info = await gcp.invoke('app:info');
    const st = await gcp.invoke('settings:get');
    $('#my-id').textContent = formatId(info.deviceId);
    $('#host-os').innerHTML = `${icon('monitor')} ${esc(st.displayName)} · ${esc(osName(info.platform))}`;
    $('#version').textContent = 'Versão ' + info.version;
    $('#unattended-state').innerHTML = st.security.hasPermanent
      ? `<span class="chip ok">${icon('shield')} Acesso não supervisionado ativo</span>`
      : `<span class="chip">${icon('shield')} Sem senha fixa</span>`;
    if (info.wayland && !info.input.error) $('#pw-hint').textContent = 'Wayland: na primeira sessão o sistema pedirá permissão de compartilhamento e controle.';
    password = await gcp.invoke('pw:get');
    showPw();
  }
  function showPw() { $('#my-pw').textContent = pwVisible ? password : '•'.repeat(password.length || 8); $('#pw-toggle').innerHTML = icon(pwVisible ? 'eyeOff' : 'eye'); }
  $('#pw-toggle').onclick = () => { pwVisible = !pwVisible; showPw(); };
  $('#pw-copy').onclick = () => { gcp.invoke('clipboard:write', password); toast('Senha copiada.', 'ok'); };
  $('#pw-new').onclick = async () => { password = await gcp.invoke('pw:regen'); pwVisible = true; showPw(); toast('Nova senha gerada.', 'ok'); };
  $('#copy-id').onclick = async () => { const i = await gcp.invoke('app:info'); gcp.invoke('clipboard:write', i.deviceId); toast('ID copiado.', 'ok'); };
  gcp.on('pw:changed', (p) => { password = p; showPw(); });
  gcp.on('settings:changed', () => { refreshIdentity(); Host.reloadSettings(); });

  $('#tile-unattended').onclick = () => { setTab = 'security'; $$('#set-tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === 'security')); go('settings'); };
  $('#tile-shortcuts').onclick = () => { setTab = 'shortcuts'; $$('#set-tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === 'shortcuts')); go('settings'); };
  $('#tile-presenter').onclick = () => go('presenter');
  $('#tile-files').onclick = () => gcp.invoke('file:open-downloads');
  $('#btn-open-downloads').onclick = () => gcp.invoke('file:open-downloads');
  $('#btn-support').onclick = () => GSupport.open();
  gcp.on('support:open', () => GSupport.open());
  const showUpdate = (u) => { if (!u || !u.newer) return; $('#update-text').textContent = `Nova versão ${u.latest} do GCP-Remoto disponível.`; $('#update-banner').classList.remove('hidden'); };
  gcp.on('update:available', showUpdate);
  gcp.invoke('update:info').then(u => showUpdate(u.pending));
  $('#update-close').onclick = () => $('#update-banner').classList.add('hidden');
  $('#update-go').onclick = () => { $('#update-text').textContent = 'Preparando a atualização…'; GSettings.installUpdate($('#update-text')); };

  // ---------- Conectar ----------
  const idInput = $('#remote-id');
  idInput.addEventListener('input', () => {
    const digits = idInput.value.replace(/\D/g, '').slice(0, 12);
    const f = formatId(digits);
    if (idInput.value !== f && !/[a-zA-Zà-ú]/.test(idInput.value)) idInput.value = f;
  });
  $('#connect-form').onsubmit = (e) => {
    e.preventDefault();
    const raw = idInput.value.trim();
    let id = raw.replace(/\D/g, '');
    if (!id) {
      const fav = favorites.find(f => f.name.toLowerCase() === raw.toLowerCase());
      if (fav) id = fav.id;
    }
    if (id.length < 6) { toast('Digite um ID válido.', 'error'); idInput.focus(); return; }
    connect(id);
  };

  async function connect(id, extra = {}) {
    try {
      const fav = favorites.find(f => f.id === id);
      await gcp.invoke('session:open', { id, name: fav ? fav.name : undefined, ...extra });
    } catch (e) { toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error'); }
  }

  // ---------- Favoritos e recentes ----------
  async function loadData() {
    favorites = await gcp.invoke('favorites:list');
    recents = await gcp.invoke('recents:list');
    renderQuick(); renderHome(); renderFavorites(); renderRecents();
    $('#id-suggestions').innerHTML = favorites.map(f => `<option value="${formatId(f.id)}">${esc(f.name)}</option>`).join('');
  }

  function favCard(f) {
    return `<div class="fav" style="--c:${esc(f.color)}" data-id="${esc(f.id)}" tabindex="0" role="button" aria-label="Conectar a ${esc(f.name)}">
      <div class="fav-top">${icon(f.icon || 'monitor')}</div>
      <div class="fav-body"><b>${esc(f.name)}</b><small>${formatId(f.id)}</small>
        <div class="fav-meta">${f.hasPassword ? `<span class="chip ok">${icon('lock')}Senha salva</span>` : `<span class="chip">Sem senha</span>`}${f.pinned ? `<span class="chip">${icon('pin')}Rápida</span>` : ''}</div>
      </div>
      <div class="fav-actions">
        <button class="icon-btn sm" data-act="edit" title="Editar">${icon('edit')}</button>
        <button class="icon-btn sm" data-act="del" title="Remover">${icon('trash')}</button>
      </div></div>`;
  }

  function bindFavs(container) {
    $$('.fav', container).forEach(el => {
      const id = el.dataset.id;
      el.onclick = (e) => {
        const act = e.target.closest('[data-act]');
        if (act && act.dataset.act === 'edit') { e.stopPropagation(); return editFavorite(favorites.find(f => f.id === id)); }
        if (act && act.dataset.act === 'del') { e.stopPropagation(); return removeFavorite(id); }
        connect(id);
      };
      el.onkeydown = (e) => { if (e.key === 'Enter') connect(id); };
    });
  }

  function renderQuick() {
    const pinned = favorites.filter(f => f.pinned);
    $('#quick').innerHTML = `<span class="quick-label">Conexões rápidas</span>` +
      pinned.map(f => `<button class="qbtn" style="--c:${esc(f.color)}" data-id="${esc(f.id)}" title="${esc(f.name)} · ${formatId(f.id)}${f.hasPassword ? ' · conecta direto' : ''}"><span class="qi">${icon(f.icon || 'monitor')}</span>${esc(f.name)}</button>`).join('') +
      `<button class="qadd" id="quick-add" title="Adicionar conexão rápida">${icon('plus')}</button>`;
    $$('.qbtn', $('#quick')).forEach(b => b.onclick = () => connect(b.dataset.id));
    $('#quick-add').onclick = () => editFavorite({ pinned: true });
  }

  function renderHome() {
    const favs = [...favorites].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)).slice(0, 4);
    $('#home-favs').innerHTML = favs.length ? favs.map(favCard).join('') : `<div class="empty">Nenhum favorito ainda. Salve computadores com um nome para conectar com um clique.<br><br><button class="btn sm primary" id="empty-add">${icon('plus')}Adicionar favorito</button></div>`;
    bindFavs($('#home-favs'));
    const e = $('#empty-add'); if (e) e.onclick = () => editFavorite({});
    $('#home-recents').innerHTML = recents.slice(0, 5).map(recentRow).join('') || `<div class="empty">As conexões que você fizer aparecerão aqui.</div>`;
    bindRecents($('#home-recents'));
  }

  function renderFavorites() {
    const q = ($('#fav-search').value || '').toLowerCase().replace(/\s/g, '');
    const list = favorites.filter(f => !q || f.name.toLowerCase().replace(/\s/g, '').includes(q) || f.id.includes(q));
    $('#fav-list').innerHTML = list.map(favCard).join('') || `<div class="empty">${q ? 'Nada encontrado.' : 'Nenhum favorito ainda.'}</div>`;
    bindFavs($('#fav-list'));
  }
  $('#fav-search').oninput = renderFavorites;
  $('#fav-add').onclick = () => editFavorite({});

  function when(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return 'agora';
    if (d < 3600) return `há ${Math.floor(d / 60)} min`;
    if (d < 86400) return `há ${Math.floor(d / 3600)} h`;
    return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }
  function recentRow(r) {
    const fav = favorites.find(f => f.id === r.id);
    return `<div class="recent" data-id="${esc(r.id)}"><div class="r-ic">${icon(fav ? fav.icon || 'monitor' : 'monitor')}</div>
      <div class="r-main"><b>${esc(fav ? fav.name : r.name || formatId(r.id))}</b><small>${formatId(r.id)} · ${esc(osName(r.os))} · ${when(r.when)}</small></div>
      ${fav ? '' : `<button class="btn sm ghost" data-act="save">${icon('star')}Salvar</button>`}
      <button class="btn sm" data-act="go">${icon('arrowRight')}Conectar</button></div>`;
  }
  function bindRecents(c) {
    $$('.recent', c).forEach(el => {
      const id = el.dataset.id;
      el.querySelector('[data-act=go]').onclick = () => connect(id);
      const s = el.querySelector('[data-act=save]');
      if (s) s.onclick = () => { const r = recents.find(x => x.id === id); editFavorite({ id, name: r && r.name }); };
    });
  }
  function renderRecents() { $('#recent-list').innerHTML = recents.map(recentRow).join('') || `<div class="empty">Nenhuma sessão recente.</div>`; bindRecents($('#recent-list')); }
  $('#recents-clear').onclick = async () => { await gcp.invoke('recents:clear'); loadData(); };
  gcp.on('recents:changed', loadData);

  async function editFavorite(f = {}) {
    const isNew = !f.id || !favorites.some(x => x.id === f.id);
    let color = f.color || FAV_COLORS[favorites.length % FAV_COLORS.length];
    let ic = f.icon || 'monitor';
    const res = await modal({
      title: isNew ? 'Novo favorito' : 'Editar favorito',
      body: `
        <div class="field"><label>Nome personalizado</label><input class="input" id="f-name" value="${esc(f.name || '')}" placeholder="Ex.: Escritório — Recepção"></div>
        <div class="field"><label>ID do computador</label><input class="input" id="f-id" value="${esc(formatId(f.id || ''))}" ${isNew ? '' : 'disabled'} placeholder="000 000 000"></div>
        <div class="field"><label>Senha (opcional — conecta sem perguntar)</label><input class="input" type="password" id="f-pw" placeholder="${f.hasPassword ? '•••••••• (mantida — digite para trocar)' : 'Senha fixa do computador'}"></div>
        <div class="field"><label>Ícone</label><div class="icon-pick" id="f-icons">${FAV_ICONS.map(n => `<button type="button" data-i="${n}" class="${n === ic ? 'sel' : ''}">${icon(n)}</button>`).join('')}</div></div>
        <div class="field"><label>Cor</label><div class="colors" id="f-colors">${FAV_COLORS.map(c => `<button type="button" style="background:${c}" data-c="${c}" class="${c === color ? 'sel' : ''}"></button>`).join('')}</div></div>
        <label class="mini-toggle" style="color:var(--text)"><span class="switch"><input type="checkbox" id="f-pin" ${f.pinned ? 'checked' : ''}><span></span></span>Mostrar em Conexões rápidas</label>
        ${f.hasPassword ? `<label class="mini-toggle" style="color:var(--text)"><span class="switch"><input type="checkbox" id="f-clearpw"><span></span></span>Apagar senha salva</label>` : ''}`,
      onOpen: (b) => {
        $$('#f-colors button', b).forEach(btn => btn.onclick = () => { color = btn.dataset.c; $$('#f-colors button', b).forEach(x => x.classList.toggle('sel', x === btn)); });
        $$('#f-icons button', b).forEach(btn => btn.onclick = () => { ic = btn.dataset.i; $$('#f-icons button', b).forEach(x => x.classList.toggle('sel', x === btn)); });
      },
      actions: [{ label: 'Cancelar', value: null }, { label: 'Salvar', kind: 'primary', keepOpen: true, get: (b) => {
        const id = $('#f-id', b).value.replace(/\D/g, '');
        if (id.length < 6) { toast('Informe um ID válido.', 'error'); return false; }
        const pw = $('#f-pw', b).value;
        const clear = $('#f-clearpw', b) && $('#f-clearpw', b).checked;
        return { id, name: $('#f-name', b).value.trim() || formatId(id), color, icon: ic, pinned: $('#f-pin', b).checked, password: clear ? '' : (pw ? pw : undefined) };
      } }]
    });
    if (!res) return;
    await gcp.invoke('favorites:save', res);
    toast('Favorito salvo.', 'ok');
    loadData();
  }

  async function removeFavorite(id) {
    const f = favorites.find(x => x.id === id);
    const ok = await modal({ title: 'Remover favorito?', body: `<p>“${esc(f.name)}” sairá da sua lista.</p>`, actions: [{ label: 'Cancelar', value: false }, { label: 'Remover', kind: 'danger', value: true }] });
    if (ok) { await gcp.invoke('favorites:remove', id); loadData(); }
  }

  // ---------- Apresentação ----------
  async function renderPresenter() {
    await GSettings.renderEffects($('#fx-panel'));
    const fx = await gcp.invoke('effects:get');
    $('#presenter-toggle').innerHTML = `${icon('widget')}${fx.widget.on ? 'Fechar widget' : 'Abrir widget'}`;
  }
  $('#presenter-toggle').onclick = async () => {
    const fx = await gcp.invoke('effects:get');
    await gcp.invoke('effects:set', { widget: { on: !fx.widget.on } });
  };
  gcp.on('effects:changed', () => { if ($('#page-presenter').classList.contains('active')) renderPresenter(); });

  // ---------- Status da rede ----------
  Host.on('status', (s, detail) => {
    const el = $('#net-status');
    const map = { online: ['ok', 'Pronto para conexões'], connecting: ['warn', 'Conectando…'], offline: ['err', 'Sem conexão'] };
    const [cls, label] = map[s] || map.connecting;
    el.className = 'chip ' + cls;
    el.innerHTML = `<span class="dot ${s !== 'online' ? 'pulse' : ''}"></span><span>${esc(detail || label)}</span>`;
  });
  Host.on('toast', (m, k) => toast(m, k));

  // ---------- Sessão recebida ----------
  Host.on('session', (s) => {
    $('#incoming-bar').classList.remove('hidden');
    $('#inc-title').textContent = `${s.who.name} está acessando este computador`;
    $('#inc-control').checked = s.perms.control;
    $('#inc-files').checked = s.perms.files;
    const tick = () => {
      const sec = Math.floor((Date.now() - s.since) / 1000);
      $('#inc-sub').textContent = `${osName(s.who.os)} · ${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} · ${s.kind === 'permanent' ? 'senha fixa' : s.kind === 'request' ? 'aceito manualmente' : 'senha da sessão'}`;
    };
    tick(); clearInterval(sessionTimer); sessionTimer = setInterval(tick, 1000);
    $('#host-chat-log').innerHTML = '';
  });
  Host.on('session-end', (reason) => {
    $('#incoming-bar').classList.add('hidden');
    $('#host-chat').classList.add('hidden');
    clearInterval(sessionTimer);
  });
  // ---- Conversa por voz (lado acessado) ----
  const renderHostMic = (st) => {
    const b = $('#inc-mic');
    b.classList.toggle('on', !!st.micOn);
    b.querySelector('.ic-wrap').innerHTML = icon(st.micOn ? 'mic' : 'micOff');
    $('#inc-mic-txt').textContent = st.micOn ? 'Microfone ligado' : (st.active ? 'Responder por voz' : 'Microfone');
    if (!st.micOn) b.style.setProperty('--lvl', 0);
  };
  renderHostMic({});
  Host.on('voice', renderHostMic);
  Host.on('voice-level', (l) => $('#inc-mic').style.setProperty('--lvl', l.toFixed(2)));
  Host.on('voice-remote', (l) => $('#inc-mic').classList.toggle('talking', l > 0.18));
  Host.on('session-end', () => renderHostMic({}));
  $('#inc-mic').onclick = async () => { const v = Host.voice(); if (!v) return; try { await v.toggleMic(); } catch (e) { toast('Não foi possível usar o microfone: ' + (e.message || e.name), 'error', 6000); } };
  GVoice.watchDevices(async (devs, added, removedCount) => {
    for (const d of added) toast(`Dispositivo de áudio conectado: ${d.label}`, 'ok', 4000);
    if (removedCount) toast('Dispositivo de áudio removido — usando o padrão do sistema.', 'info', 4000);
    await Host.reloadSettings();
    if (Host.session && Host.session.voiceObj) Host.session.voiceObj.refreshDevice().catch(() => {});
    if ($('#page-settings').classList.contains('active') && setTab === 'audio') GSettings.renderSettings('audio', $('#set-body'), ctx);
  });

  $('#inc-control').onchange = (e) => Host.setPerm('control', e.target.checked);
  $('#inc-files').onchange = (e) => Host.setPerm('files', e.target.checked);
  $('#inc-end').onclick = () => Host.end('Você encerrou a sessão.');
  $('#inc-chat').onclick = () => { $('#host-chat').classList.toggle('hidden'); $('#host-chat-input').focus(); };
  $('#host-chat-close').onclick = () => $('#host-chat').classList.add('hidden');
  $('#inc-widget').onclick = async () => { const fx = await gcp.invoke('effects:get'); gcp.invoke('effects:set', { widget: { on: !fx.widget.on } }); };
  $('#inc-send').onclick = async () => {
    const paths = await gcp.invoke('files:pick', false);
    if (paths.length) Host.sendFiles(paths).catch(e => toast(e.message, 'error'));
  };
  $('#host-chat-form').onsubmit = (e) => { e.preventDefault(); const i = $('#host-chat-input'); Host.sendChat(i.value.trim()); i.value = ''; };
  Host.on('chat', (m) => {
    const log = $('#host-chat-log');
    log.insertAdjacentHTML('beforeend', `<div class="msg ${m.me ? 'me' : ''}">${esc(m.text)}<small>${esc(m.from)} · ${new Date().toLocaleTimeString('pt-BR', { timeStyle: 'short' })}</small></div>`);
    log.scrollTop = log.scrollHeight;
    if (!m.me) { $('#host-chat').classList.remove('hidden'); gcp.invoke('notify', `Mensagem de ${m.from}`, m.text); }
  });

  // Arrastar arquivos para a janela durante a sessão envia ao outro lado
  document.addEventListener('dragover', (e) => { if (Host.session) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!Host.session) return;
    e.preventDefault();
    const paths = [...e.dataTransfer.files].map(f => gcp.pathForFile(f)).filter(Boolean);
    if (paths.length) Host.sendFiles(paths).catch(err => toast(err.message, 'error'));
  });

  // ---------- Progresso de transferências ----------
  const xferEls = new Map();
  Host.on('xfer', (p) => {
    let el = xferEls.get(p.tid);
    if (!el) {
      el = document.createElement('div'); el.className = 'xfer';
      $('#xfers').appendChild(el); xferEls.set(p.tid, el);
    }
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 100;
    el.innerHTML = `<div class="xfer-top">${icon(p.dir === 'in' ? 'download' : 'upload')}<b>${esc(p.label)}</b><small>${p.state === 'done' ? 'Concluído' : p.state === 'error' ? 'Falhou' : pct + '%'}</small></div>
      <div class="progress"><i style="width:${pct}%"></i></div><small>${fmtBytes(p.done)} de ${fmtBytes(p.total)}</small>`;
    if (p.state !== 'run') setTimeout(() => { el.remove(); xferEls.delete(p.tid); }, p.state === 'done' ? 3500 : 7000);
  });

  // ---------- macOS: permissões ----------
  async function checkMacPermissions() {
    if (gcp.platform !== 'darwin') return;
    const p = await gcp.invoke('mac:permissions', false);
    const missing = [];
    if (p.screen !== 'granted') missing.push(['Gravação de Tela', 'Privacy_ScreenCapture', 'para transmitir esta tela']);
    if (!p.accessibility) missing.push(['Acessibilidade', 'Privacy_Accessibility', 'para aceitar o controle de mouse e teclado']);
    if (!missing.length) return;
    const ok = await modal({ title: 'Permissões do macOS', body: `<p>Para ser acessado, o macOS exige que você libere o GCP Remoto em <b>Ajustes do Sistema › Privacidade e Segurança</b>:</p><ul>${missing.map(m => `<li><b>${m[0]}</b> — ${m[2]}</li>`).join('')}</ul><p>Depois de liberar, feche e abra o GCP Remoto.</p>`, actions: [{ label: 'Depois', value: false }, { label: 'Abrir Ajustes', kind: 'primary', value: true }] });
    if (ok) { if (!p.accessibility) await gcp.invoke('mac:permissions', true); gcp.invoke('mac:open-settings', missing[0][1]); }
  }
  setTimeout(checkMacPermissions, 1500);

  // ---------- Início ----------
  refreshIdentity();
  loadData();
  Host.start();
})();
