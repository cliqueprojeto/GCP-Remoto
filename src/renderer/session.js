// Janela de SESSÃO: quem controla o computador remoto.
(function () {
  'use strict';
  const { icon, hydrateIcons, toast, esc, matchCombo, prettyCombo } = GUI;
  const { PEER_PREFIX, PROTO_VERSION, formatId, fmtBytes, osName } = GProto;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  hydrateIcons();

  const video = $('#video'), ink = $('#ink'), stage = $('#stage'), surface = $('#surface');
  const ictx = ink.getContext('2d');

  const S = {
    params: null, settings: null, info: null, peer: null, conn: null, filesConn: null, call: null,
    hello: null, accepted: null, token: null, connected: false, ended: false,
    mode: 'control', viewOnly: false, viewMode: 'fit', fullscreen: false, barHidden: false,
    tool: 'pen', color: '#ff4b3e', size: 4,
    screens: [], screen: null, effects: null, remotePerms: {},
    pressed: new Set(), lastClip: null, typedPassword: null,
    contentRect: { x: 0, y: 0, w: 1, h: 1 }, rtt: null
  };

  // ---------- Utilidades ----------
  function send(msg) { if (S.conn && S.conn.open) S.conn.send(msg); }
  function setStatus(kind) { $('#st-dot').className = 'status-dot ' + (kind || ''); }

  function cover(state, title, text, opts = {}) {
    const c = $('#cover');
    if (state === 'hide') { c.classList.add('hidden'); return; }
    c.classList.remove('hidden');
    $('#cv-title').textContent = title;
    $('#cv-text').textContent = text || '';
    $('#cv-spin').classList.toggle('hidden', state !== 'busy');
    $('#pw-form').classList.toggle('hidden', state !== 'password');
    $('#cv-actions').classList.toggle('hidden', state !== 'ended');
    $('#cv-retry').classList.toggle('hidden', !!opts.noRetry);
    if (state === 'password') setTimeout(() => $('#pw-input').focus(), 50);
  }

  // ---------- Inicialização ----------
  async function init() {
    S.params = await gcp.invoke('session:params');
    S.settings = await gcp.invoke('settings:get');
    S.info = await gcp.invoke('app:info');
    if (!S.params) { cover('ended', 'Sessão inválida', 'Abra uma conexão pela janela principal.', { noRetry: true }); return; }
    S.viewMode = S.settings.session.viewMode || 'fit';
    $('#who-name').textContent = S.params.name;
    $('#who-sub').textContent = formatId(S.params.id);
    document.title = `${S.params.name} — GCP Remoto`;
    buildMenus();
    buildDrawbar();
    connect();
  }

  function connect() {
    S.ended = false; S.connected = false; S.accepted = null; S.hello = null;
    cover('busy', 'Conectando…', `Localizando ${formatId(S.params.id)}.`);
    setStatus('');
    if (S.peer) { try { S.peer.destroy(); } catch (_) {} }
    const peer = S.peer = new Peer(GProto.peerOptions(S.settings));
    const timeout = setTimeout(() => { if (!S.hello && !S.ended) fail('Sem resposta', 'O computador remoto não respondeu. Verifique se o GCP Remoto está aberto nele e conectado à internet.'); }, 30000);
    peer.on('open', () => {
      $('#cv-text').textContent = 'Estabelecendo conexão segura…';
      const conn = S.conn = peer.connect(PEER_PREFIX + S.params.id, { reliable: true, serialization: 'binary', metadata: { v: PROTO_VERSION } });
      conn.on('data', onMessage);
      conn.on('close', () => { clearTimeout(timeout); if (!S.ended) fail('Conexão encerrada', S.connected ? 'A sessão foi encerrada.' : 'O computador remoto fechou a conexão.'); });
      conn.on('error', () => {});
    });
    peer.on('call', (call) => {
      if (!S.token || !call.metadata || call.metadata.token !== S.token) { call.close(); return; }
      S.call = call;
      call.answer(undefined, { sdpTransform: (sdp) => GProto.tuneSdp(sdp, { start: 3000, min: 800, max: 20000 }) });
      call.on('stream', (stream) => {
        lowLatency(call);
        video.srcObject = stream;
        video.muted = false;
        video.play().catch(() => { video.muted = true; video.play(); });
      });
      call.on('close', () => { if (!S.ended) fail('Transmissão encerrada', 'O vídeo da tela remota foi interrompido.'); });
      watchStats();
    });
    peer.on('error', (err) => {
      clearTimeout(timeout);
      if (S.ended) return;
      const msg = {
        'peer-unavailable': ['Computador não encontrado', 'O ID está incorreto ou o computador está desligado/offline.'],
        'network': ['Sem conexão', 'Não foi possível alcançar o servidor. Verifique sua internet.'],
        'server-error': ['Servidor indisponível', 'O servidor de conexão não respondeu. Tente novamente.'],
        'socket-error': ['Sem conexão', 'Falha de rede ao contatar o servidor.'],
        'browser-incompatible': ['Incompatível', 'Este sistema não suporta WebRTC.']
      }[err.type] || ['Erro de conexão', err.message || String(err.type)];
      fail(msg[0], msg[1]);
    });
  }

  function endNotice(body) {
    if (!S.connected || S.noticeShown) return;
    S.noticeShown = true;
    const sec = Math.floor((Date.now() - (S.since || Date.now())) / 1000);
    const dur = `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    gcp.invoke('notice:info', { tone: 'warn', title: 'Sessão desconectada', body, meta: [`${S.hello ? S.hello.name : S.params.name} · ${formatId(S.params.id)}`, `duração ${dur}`], ms: 9000 });
  }

  // Exibe cada quadro assim que chega: sem buffer de espera (jitter buffer = 0)
  function lowLatency(call) {
    const pc = call && call.peerConnection; if (!pc) return;
    const apply = () => pc.getReceivers().forEach(r => {
      try { if ('jitterBufferTarget' in r) r.jitterBufferTarget = 0; } catch (_) {}
      try { if ('playoutDelayHint' in r) r.playoutDelayHint = 0; } catch (_) {}
    });
    apply(); setTimeout(apply, 1000); setTimeout(apply, 4000);
  }

  function fail(title, text) {
    if (S.ended) return;
    S.ended = true;
    endNotice(text);
    setStatus('err');
    releaseKeys();
    cover('ended', title, text);
    try { S.call && S.call.close(); } catch (_) {}
  }

  $('#cv-retry').onclick = () => connect();
  $('#cv-close').onclick = () => gcp.invoke('win:close');

  // ---------- Autenticação ----------
  async function authenticate(password) {
    const h = S.hello;
    if (password) {
      S.typedPassword = password;
      send({ t: 'auth', proof: await GProto.makeProof(h.nonce, h.salt, password), name: S.settings.displayName, os: S.info.platform, osLabel: S.info.osLabel });
      cover('busy', 'Verificando senha…', '');
    } else {
      send({ t: 'auth', request: true, name: S.settings.displayName, os: S.info.platform, osLabel: S.info.osLabel });
      cover('busy', 'Aguardando aceite…', `${h.name} precisa aceitar a conexão no computador remoto.`);
    }
  }

  $('#pw-save').onchange = (e) => { $('#pw-name').classList.toggle('hidden', !e.target.checked); if (e.target.checked) { $('#pw-name').value = $('#pw-name').value || (S.hello && S.hello.name) || ''; $('#pw-name').focus(); } };
  $('#pw-form').onsubmit = (e) => { e.preventDefault(); const pw = $('#pw-input').value; if (!pw) { $('#pw-input').focus(); return; } authenticate(pw); };
  $('#pw-request').onclick = () => authenticate(null);

  // ---------- Mensagens ----------
  async function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'hello': {
        const first = !S.hello;
        S.hello = m;
        $('#who-name').textContent = S.params.name !== S.params.id ? S.params.name : m.name;
        $('#who-sub').textContent = `${formatId(S.params.id)} · ${osName(m.os)}`;
        if (first && S.params.password) return authenticate(S.params.password);
        if (first && S.params.request) return authenticate(null);
        if (first) cover('password', `Conectar a ${m.name}`, 'Digite a senha exibida no computador remoto, ou peça para a pessoa aceitar.');
        break;
      }
      case 'auth-fail':
        cover('password', 'Senha incorreta', m.reason || 'Tente novamente.');
        $('#pw-input').select();
        break;
      case 'denied': fail('Acesso recusado', 'A pessoa do outro lado recusou a conexão.'); break;
      case 'busy': fail('Computador ocupado', `${m.name || 'O computador'} já está em outra sessão.`); break;
      case 'error': fail('Erro no computador remoto', m.message); break;
      case 'accepted': return onAccepted(m);
      case 'notice': toast(m.message, 'info', 6000); break;
      case 'perms':
        S.remotePerms = m.perms;
        toast(m.perms.control ? 'Controle liberado pelo computador remoto.' : 'O computador remoto bloqueou o controle.', m.perms.control ? 'ok' : 'error');
        updateModeUI();
        break;
      case 'clip':
        if (S.settings.session.syncClipboard && typeof m.text === 'string') { S.lastClip = m.text; gcp.invoke('clipboard:write', m.text); }
        break;
      case 'chat': addChat(S.hello ? S.hello.name : 'Remoto', m.text, false); break;
      case 'pong': S.rtt = Math.round(performance.now() - m.ts); break;
      case 'screen-changed': S.screen = m.id; buildScreensMenu(); break;
      case 'effects': S.effects = m.effects; buildFxMenu(); break;
      case 'fs-list': onRemoteList(m); break;
      case 'clip-files': onRemoteClipFiles(m); break;
      case 'bye': fail('Sessão encerrada', m.reason || 'O computador remoto encerrou a sessão.'); break;
    }
  }

  async function onAccepted(m) {
    S.accepted = m; S.token = m.token; S.connected = true; S.since = Date.now(); S.noticeShown = false;
    S.screens = m.screens || []; S.screen = m.screen; S.effects = m.effects; S.remotePerms = m.perms;
    cover('busy', 'Conectado!', 'Recebendo a tela remota…');
    setStatus('ok');
    gcp.invoke('session:connected', { id: S.params.id, name: S.hello.name, os: m.os });
    if ($('#pw-save').checked && S.typedPassword) {
      await gcp.invoke('session:save-favorite', { id: S.params.id, name: $('#pw-name').value.trim() || S.hello.name, password: S.typedPassword });
      toast('Salvo nos favoritos — da próxima vez é só um clique.', 'ok');
    }
    S.filesConn = S.peer.connect(PEER_PREFIX + S.params.id, { label: 'files', reliable: true, serialization: 'raw', metadata: { token: S.token } });
    // canal rápido para o mouse: sem ordem garantida (movimentos antigos não seguram os novos)
    S.inputConn = S.peer.connect(PEER_PREFIX + S.params.id, { label: 'input', reliable: false, serialization: 'json', metadata: { token: S.token } });
    S.moveSeq = 0;
    S.filesConn.on('data', (msg) => transfers.handle(msg));
    buildScreensMenu(); buildFxMenu(); buildQualityMenu();
    updateModeUI();
    if (m.wayland) toast('O computador remoto usa Wayland: lá pode aparecer um pedido de permissão do sistema.', 'info', 7000);
    video.addEventListener('loadedmetadata', () => { cover('hide'); layout(); }, { once: true });
    setTimeout(() => { if (!$('#cover').classList.contains('hidden') && video.srcObject) { cover('hide'); layout(); } }, 4000);
    clipboardLoop();
  }

  // ---------- Layout / exibição ----------
  function layout() {
    const vw = video.videoWidth || 1920, vh = video.videoHeight || 1080;
    const cw = stage.clientWidth, ch = stage.clientHeight;
    let w, h, x = 0, y = 0;
    stage.classList.toggle('scroll', S.viewMode === 'original');
    if (S.viewMode === 'stretch') { w = cw; h = ch; }
    else if (S.viewMode === 'original') {
      const dpr = window.devicePixelRatio || 1;
      w = vw / dpr; h = vh / dpr;
      x = Math.max(0, (cw - w) / 2); y = Math.max(0, (ch - h) / 2);
    } else {
      const k = Math.min(cw / vw, ch / vh);
      w = vw * k; h = vh * k; x = (cw - w) / 2; y = (ch - h) / 2;
    }
    Object.assign(surface.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    S.contentRect = { x, y, w, h };
    const dpr = window.devicePixelRatio || 1;
    ink.width = Math.round(w * dpr); ink.height = Math.round(h * dpr);
    redrawInk();
  }
  new ResizeObserver(layout).observe(stage);
  video.addEventListener('resize', layout);

  function setViewMode(m) { S.viewMode = m; layout(); buildViewMenu(); toast({ fit: 'Ajustar à janela', original: 'Tamanho original', stretch: 'Esticar' }[m], 'info', 1500); }

  async function toggleFullscreen(v) {
    S.fullscreen = await gcp.invoke('win:fullscreen', v);
    document.body.classList.toggle('fs', S.fullscreen);
    $('#b-full').innerHTML = icon(S.fullscreen ? 'exitFullscreen' : 'fullscreen');
    if (S.fullscreen) autoHideBar(); else { document.body.classList.remove('bar-hidden'); S.barHidden = false; }
    setTimeout(layout, 120);
  }

  let barTimer;
  function autoHideBar() {
    clearTimeout(barTimer);
    if (!S.fullscreen) return;
    barTimer = setTimeout(() => { if (!$$('.menu:not(.hidden)').length && !$('#bar').matches(':hover')) { document.body.classList.add('bar-hidden'); S.barHidden = true; } }, 2500);
  }
  document.addEventListener('mousemove', (e) => {
    if (S.fullscreen && e.clientY < 12) { document.body.classList.remove('bar-hidden'); S.barHidden = false; autoHideBar(); }
  });
  $('#peek').onclick = () => { document.body.classList.remove('bar-hidden'); S.barHidden = false; autoHideBar(); };
  function toggleBar() { S.barHidden = !S.barHidden; document.body.classList.toggle('bar-hidden', S.barHidden); setTimeout(layout, 60); }

  // ---------- Coordenadas ----------
  function norm(e) {
    const r = ink.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  }
  const canControl = () => S.connected && S.mode === 'control' && !S.viewOnly && S.remotePerms.control !== false;

  // ---------- Mouse ----------
  // Movimentos do mouse: no máximo a cada 8 ms (≈120 por segundo), sempre a posição mais recente
  let pendingMove = null, moveTimer = 0, lastMoveAt = 0;
  const BTN = ['left', 'middle', 'right'];
  function flushMove() {
    moveTimer = 0;
    if (!pendingMove) return;
    const m = { t: 'mm', x: +pendingMove.x.toFixed(5), y: +pendingMove.y.toFixed(5) };
    pendingMove = null; lastMoveAt = performance.now();
    if (S.inputConn && S.inputConn.open) S.inputConn.send({ ...m, q: ++S.moveSeq });
    else send(m);
  }
  ink.addEventListener('pointermove', (e) => {
    if (S.mode === 'draw') return drawMove(e);
    if (!canControl()) return;
    pendingMove = norm(e);
    const wait = 8 - (performance.now() - lastMoveAt);
    if (wait <= 0) flushMove(); else if (!moveTimer) moveTimer = setTimeout(flushMove, wait);
  });
  ink.addEventListener('pointerdown', (e) => {
    ink.focus();
    closeMenus();
    if (S.mode === 'draw') return drawDown(e);
    if (!canControl()) return;
    e.preventDefault();
    ink.setPointerCapture(e.pointerId);
    send({ t: 'md', b: BTN[e.button] || 'left', shift: e.shiftKey, ...norm(e) });
  });
  ink.addEventListener('pointerup', (e) => {
    if (S.mode === 'draw') return drawUp(e);
    if (!canControl()) return;
    send({ t: 'mu', b: BTN[e.button] || 'left', ...norm(e) });
  });
  ink.addEventListener('contextmenu', (e) => e.preventDefault());
  ink.addEventListener('auxclick', (e) => e.preventDefault());
  let wheelAcc = { x: 0, y: 0 };
  ink.addEventListener('wheel', (e) => {
    if (!canControl()) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1;
    wheelAcc.x += e.deltaX * k; wheelAcc.y += e.deltaY * k;
    const sx = Math.trunc(wheelAcc.x / 80), sy = Math.trunc(wheelAcc.y / 80);
    if (sx || sy) { wheelAcc.x -= sx * 80; wheelAcc.y -= sy * 80; send({ t: 'wh', dx: sx, dy: sy }); }
  }, { passive: false });
  ink.tabIndex = 0;

  // ---------- Teclado ----------
  function shortcutAction(e) {
    const sc = S.settings && S.settings.shortcuts; if (!sc) return null;
    return Object.keys(sc).find(k => matchCombo(e, sc[k])) || null;
  }

  const ACTIONS = {
    fullscreen: () => toggleFullscreen(),
    toolbar: () => toggleBar(),
    drawMode: () => setMode(S.mode === 'draw' ? 'control' : 'draw'),
    undoDrawing: () => undo(),
    redoDrawing: () => redo(),
    toolPointer: () => setMode('control'),
    toolPen: () => pickTool('pen'),
    toolMarker: () => pickTool('marker'),
    toolArrow: () => pickTool('arrow'),
    toolLine: () => pickTool('line'),
    toolRect: () => pickTool('rect'),
    toolEllipse: () => pickTool('ellipse'),
    toolText: () => pickTool('text'),
    clickEffect: () => toggleFx('clicks'),
    clearDrawings: () => clearDrawings(),
    viewOnly: () => { S.viewOnly = !S.viewOnly; updateModeUI(); toast(S.viewOnly ? 'Somente visualização' : 'Controle ativado', 'info', 1500); },
    screenshot: () => screenshot(),
    nextMonitor: () => { if (S.screens.length > 1) { const i = S.screens.findIndex(s => s.id === S.screen); send({ t: 'screen', id: S.screens[(i + 1) % S.screens.length].id }); } },
    chat: () => openPanel('chat'),
    fileBrowser: () => openPanel('files'),
    fitMode: () => setViewMode('fit'),
    originalMode: () => setViewMode('original'),
    stretchMode: () => setViewMode('stretch'),
    sendCtrlAltDel: () => sendCombo(['ControlLeft', 'AltLeft', 'Delete']),
    presenterWidget: () => toggleFx('widget'),
    cursorHighlight: () => toggleFx('cursor'),
    spotlight: () => toggleFx('spotlight'),
    disconnect: () => disconnect()
  };

  function typingInUi(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && t !== ink;
  }

  window.addEventListener('keydown', async (e) => {
    const act = shortcutAction(e);
    if (act && ACTIONS[act]) { e.preventDefault(); e.stopPropagation(); ACTIONS[act](); return; }
    if (typingInUi(e)) return;
    if (!canControl() || S.mode === 'draw') {
      if (S.mode === 'draw' && (e.ctrlKey && e.code === 'KeyZ')) { e.preventDefault(); undo(); }
      return;
    }
    e.preventDefault();
    if (e.key === 'Dead' || e.key === 'Process' || e.key === 'Unidentified') return; // aguarda o caractere composto (acentos)
    if (e.code === 'AltRight') return; // AltGr: o caractere resultante é enviado como texto
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') return; // Shift vai como estado de cada tecla

    // Ctrl+V com ARQUIVOS copiados neste computador -> envia e cola no remoto
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV' && !e.altKey && !e.shiftKey && S.filesConn && S.remotePerms.files) {
      const paths = await gcp.invoke('files:clipboard-read');
      if (paths.length) {
        const key = paths.join('|');
        const t = toast(`Enviando ${paths.length} item(ns) para colar no remoto…`, 'info');
        try { await transfers.send(paths, { purpose: 'clip', pasteAfter: true }); S.lastPastedFiles = key; }
        catch (err) { toast(err.message, 'error'); }
        return;
      }
      await pushClipboard();
    }

    const altGr = e.getModifierState && e.getModifierState('AltGraph');
    const printable = e.key.length === 1 || (e.key.length === 2 && /[\uD800-\uDBFF]/.test(e.key[0]));
    if (printable && (altGr || (!e.ctrlKey && !e.altKey && !e.metaKey))) {
      send({ t: 'type', text: e.key });
      return;
    }
    if (altGr && (e.code === 'ControlLeft')) return;
    S.pressed.add(e.code);
    send({ t: 'kd', code: e.code, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
  }, true);

  window.addEventListener('keyup', (e) => {
    if (S.pressed.has(e.code)) { S.pressed.delete(e.code); send({ t: 'ku', code: e.code }); e.preventDefault(); }
  }, true);

  function releaseKeys() { if (S.pressed.size || S.connected) send({ t: 'release' }); S.pressed.clear(); }
  window.addEventListener('blur', releaseKeys);

  function sendCombo(codes) { if (canControl()) send({ t: 'combo', codes }); else toast('O controle está desativado.', 'error'); }

  // ---------- Área de transferência (texto) ----------
  async function pushClipboard() {
    if (!S.settings.session.syncClipboard || !S.connected) return;
    const text = await gcp.invoke('clipboard:read');
    if (text && text !== S.lastClip && text.length < 1_000_000) { S.lastClip = text; send({ t: 'clip', text }); }
  }
  function clipboardLoop() {
    window.addEventListener('focus', pushClipboard);
    setInterval(() => { if (document.hasFocus()) pushClipboard(); }, 1200);
  }

  // ---------- Desenho ----------
  const board = new GDraw.Board();     // pré-visualização local (a versão final chega pelo vídeo)
  const myShapes = [], redoStack = [];
  let drawing = null, appendBuf = [], appendRaf = 0;

  function redrawInk() {
    const dpr = window.devicePixelRatio || 1;
    ictx.setTransform(1, 0, 0, 1, 0, 0);
    ictx.clearRect(0, 0, ink.width, ink.height);
    ictx.setTransform(dpr, 0, 0, dpr, 0, 0);
    board.render(ictx, S.contentRect.w, S.contentRect.h);
  }

  function emit(op) { send({ t: 'draw', op }); }

  function drawDown(e) {
    if (!S.connected) return;
    e.preventDefault();
    const p = norm(e);
    if (S.tool === 'text') return startText(p);
    ink.setPointerCapture(e.pointerId);
    const s = { id: GDraw.uid(), by: 'remote', tool: S.tool, color: S.color, size: S.size, pts: [[p.x, p.y]] };
    if (['line', 'arrow', 'rect', 'ellipse'].includes(S.tool)) s.pts.push([p.x, p.y]);
    drawing = s;
    board.apply({ a: 'upsert', s });
    emit({ a: 'upsert', s });
    redrawInk();
  }
  function drawMove(e) {
    if (!drawing) return;
    const p = norm(e);
    if (drawing.tool === 'pen' || drawing.tool === 'marker') {
      drawing.pts.push([p.x, p.y]);
      appendBuf.push([+p.x.toFixed(5), +p.y.toFixed(5)]);
      if (!appendRaf) appendRaf = requestAnimationFrame(() => { appendRaf = 0; if (appendBuf.length) emit({ a: 'append', id: drawing ? drawing.id : null, pts: appendBuf.splice(0) }); });
    } else {
      drawing.pts[1] = [p.x, p.y];
      emit({ a: 'upsert', s: drawing });
    }
    redrawInk();
  }
  function drawUp() {
    if (!drawing) return;
    if (appendBuf.length) emit({ a: 'append', id: drawing.id, pts: appendBuf.splice(0) });
    emit({ a: 'upsert', s: drawing });
    const done = drawing; drawing = null;
    myShapes.push(done); redoStack.length = 0;
    setTimeout(() => { board.apply({ a: 'remove', id: done.id }); redrawInk(); }, 900);
  }

  function startText(p) {
    const ta = $('#text-input');
    ta.classList.remove('hidden');
    ta.style.left = p.x * S.contentRect.w + 'px';
    ta.style.top = p.y * S.contentRect.h + 'px';
    ta.style.color = S.color;
    ta.value = '';
    ta.focus();
    const commit = () => {
      ta.removeEventListener('keydown', onKey); ta.removeEventListener('blur', commit);
      const text = ta.value.trim();
      ta.classList.add('hidden');
      if (!text) return;
      const s = { id: GDraw.uid(), by: 'remote', tool: 'text', color: S.color, size: S.size, pts: [[p.x, p.y]], text };
      emit({ a: 'upsert', s }); myShapes.push(s); redoStack.length = 0;
    };
    const onKey = (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { ta.value = ''; commit(); }
    };
    ta.addEventListener('keydown', onKey);
    ta.addEventListener('blur', commit);
  }

  function undo() { const s = myShapes.pop(); if (s) { redoStack.push(s); emit({ a: 'remove', id: s.id }); } }
  function redo() { const s = redoStack.pop(); if (s) { myShapes.push(s); emit({ a: 'upsert', s }); } }
  function clearDrawings() { myShapes.length = 0; redoStack.length = 0; emit({ a: 'clear' }); board.apply({ a: 'clear' }); redrawInk(); }

  const TOOL_INFO = [['pen', 'pen', 'Caneta', 'toolPen'], ['marker', 'marker', 'Marca-texto', 'toolMarker'], ['arrow', 'arrow', 'Seta', 'toolArrow'], ['line', 'line', 'Linha', 'toolLine'], ['rect', 'rect', 'Retângulo', 'toolRect'], ['ellipse', 'ellipse', 'Elipse', 'toolEllipse'], ['text', 'text', 'Texto', 'toolText']];
  function buildDrawbar() {
    const sc = (S.settings && S.settings.shortcuts) || {};
    $('#d-tools').innerHTML = TOOL_INFO.map(([t, ic, lab, k]) => `<button class="icon-btn sm ${S.tool === t ? 'active' : ''}" data-tool="${t}" title="${lab}${sc[k] ? ' (' + sc[k] + ')' : ''}">${icon(ic)}</button>`).join('');
    $('#d-colors').innerHTML = GDraw.PALETTE.map(c => `<button class="cdot ${S.color === c ? 'sel' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('');
    $$('#d-tools [data-tool]').forEach(b => b.onclick = () => { S.tool = b.dataset.tool; buildDrawbar(); });
    $$('#d-colors [data-color]').forEach(b => b.onclick = () => { S.color = b.dataset.color; buildDrawbar(); });
    const sz = $('#d-size'); sz.value = S.size; sz.style.setProperty('--p', ((S.size - 1) / 23) * 100 + '%');
    sz.oninput = () => { S.size = Number(sz.value); sz.style.setProperty('--p', ((S.size - 1) / 23) * 100 + '%'); };
  }
  $('#d-undo').onclick = undo; $('#d-redo').onclick = redo; $('#d-clear').onclick = clearDrawings;

  function pickTool(t) { S.tool = t; buildDrawbar(); if (S.mode !== 'draw') setMode('draw'); }

  function setMode(m) {
    S.mode = m;
    if (m === 'draw' && S.remotePerms.drawing === false) { toast('O computador remoto não permite desenhos.', 'error'); S.mode = 'control'; }
    releaseKeys();
    updateModeUI();
    setTimeout(layout, 30);
  }
  function updateModeUI() {
    $('#b-control').classList.toggle('active', S.mode === 'control' && !S.viewOnly);
    $('#b-control').innerHTML = icon(S.viewOnly ? 'eye' : 'mouse');
    $('#b-control').title = S.viewOnly ? 'Somente visualização (clique para controlar)' : 'Controlar (mouse e teclado)';
    $('#b-draw').classList.toggle('active', S.mode === 'draw');
    $('#drawbar').classList.toggle('hidden', S.mode !== 'draw');
    stage.classList.toggle('draw', S.mode === 'draw');
    stage.classList.toggle('control', S.mode === 'control' && canControl());
    stage.classList.remove('ptr-dot', 'ptr-arrow', 'ptr-none');
    stage.classList.add('ptr-' + ((S.settings && S.settings.session.pointer) || 'dot'));
    stage.classList.toggle('viewonly', S.mode === 'control' && !canControl());
  }
  $('#b-control').onclick = () => { if (S.mode === 'draw') setMode('control'); else { S.viewOnly = !S.viewOnly; updateModeUI(); } };
  $('#b-draw').onclick = () => setMode(S.mode === 'draw' ? 'control' : 'draw');
  $('#b-full').onclick = () => toggleFullscreen();
  $('#b-close').onclick = () => disconnect();
  $('#b-shot').onclick = () => screenshot();

  function disconnect() {
    endNotice('Você encerrou a sessão.');
    S.ended = true;
    releaseKeys();
    send({ t: 'bye' });
    setTimeout(() => gcp.invoke('win:close'), 150);
  }

  async function screenshot() {
    if (!video.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    const file = await gcp.invoke('screenshot:save', c.toDataURL('image/png'), S.hello ? S.hello.name : S.params.id);
    const t = toast('Captura salva — clique para abrir a pasta.', 'ok', 5000);
    t.style.cursor = 'pointer'; t.onclick = () => gcp.invoke('file:show', file);
  }

  // ---------- Menus ----------
  function closeMenus() { $$('.menu').forEach(m => m.classList.add('hidden')); }
  $$('[data-menu]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const m = $('#' + b.dataset.menu);
    const open = m.classList.contains('hidden');
    closeMenus();
    if (!open) return;
    m.classList.remove('hidden');
    const r = b.getBoundingClientRect();
    m.style.top = r.bottom + 8 + 'px';
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left + r.width / 2 - m.offsetWidth / 2)) + 'px';
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenus(); });

  function mi(label, attrs = '', { ic, sel, right } = {}) {
    return `<button class="mi ${sel ? 'sel' : ''}" ${attrs}>${ic ? icon(ic) : `<span class="chk">${sel ? '✓' : ''}</span>`}<span>${esc(label)}</span>${right ? `<span class="r">${right}</span>` : ''}</button>`;
  }

  function buildMenus() { buildViewMenu(); buildKeysMenu(); buildQualityMenu(); buildScreensMenu(); buildFxMenu(); }

  function buildViewMenu() {
    const sc = S.settings.shortcuts;
    const m = $('#m-view');
    m.innerHTML = `<h4>Exibição</h4>
      ${mi('Ajustar à janela', 'data-v="fit"', { ic: 'fit', sel: S.viewMode === 'fit', right: sc.fitMode })}
      ${mi('Tamanho original (1:1)', 'data-v="original"', { ic: 'original', sel: S.viewMode === 'original', right: sc.originalMode })}
      ${mi('Esticar', 'data-v="stretch"', { ic: 'stretch', sel: S.viewMode === 'stretch', right: sc.stretchMode })}
      <div class="mdiv"></div><h4>Tamanho da janela</h4>
      ${mi('Igual à resolução remota', 'data-sz="remote"', { ic: 'resize' })}
      ${[[1024, 640], [1280, 800], [1366, 768], [1600, 900], [1920, 1080]].map(([w, h]) => mi(`${w} × ${h}`, `data-sz="${w}x${h}"`, { ic: 'monitor' })).join('')}
      ${mi('Maximizar', 'data-sz="max"', { ic: 'resize' })}
      ${mi('Tela cheia', 'data-sz="full"', { ic: 'fullscreen', right: sc.fullscreen })}
      ${mi('Ocultar barra', 'data-sz="bar"', { ic: 'minus', right: sc.toolbar })}`;
    $$('[data-v]', m).forEach(b => b.onclick = () => { setViewMode(b.dataset.v); closeMenus(); });
    $$('[data-sz]', m).forEach(b => b.onclick = async () => {
      closeMenus();
      const v = b.dataset.sz;
      if (v === 'full') return toggleFullscreen(true);
      if (v === 'bar') return toggleBar();
      if (S.fullscreen) await toggleFullscreen(false);
      if (v === 'max') return gcp.invoke('win:size', 'max');
      const extraH = $('#bar').offsetHeight + (S.mode === 'draw' ? $('#drawbar').offsetHeight : 0);
      if (v === 'remote') {
        const dpr = window.devicePixelRatio || 1;
        await gcp.invoke('win:size', (video.videoWidth || 1280) / dpr, (video.videoHeight || 720) / dpr + extraH);
        return setViewMode('original');
      }
      const [w, h] = v.split('x').map(Number);
      gcp.invoke('win:size', w, h);
    });
  }

  function buildKeysMenu() {
    const m = $('#m-keys');
    const win = S.hello && S.hello.os === 'win32';
    const combos = [
      ['Ctrl + Alt + Del', ['ControlLeft', 'AltLeft', 'Delete']],
      ['Ctrl + Shift + Esc', ['ControlLeft', 'ShiftLeft', 'Escape']],
      ['Alt + Tab', ['AltLeft', 'Tab']],
      ['Alt + F4', ['AltLeft', 'F4']],
      [win ? 'Tecla Windows' : 'Tecla Super', ['MetaLeft']],
      [win ? 'Windows + D (área de trabalho)' : 'Super + D', ['MetaLeft', 'KeyD']],
      [win ? 'Windows + E (explorador)' : 'Super + E', ['MetaLeft', 'KeyE']],
      [win ? 'Windows + R (executar)' : 'Alt + F2 (executar)', win ? ['MetaLeft', 'KeyR'] : ['AltLeft', 'F2']],
      ['Windows/Super + L (bloquear)', ['MetaLeft', 'KeyL']],
      ['Print Screen', ['PrintScreen']],
      ['Ctrl + Alt + T (terminal Linux)', ['ControlLeft', 'AltLeft', 'KeyT']]
    ];
    m.innerHTML = `<h4>Enviar ao computador remoto</h4>` + combos.map(([l], i) => mi(l, `data-k="${i}"`, { ic: 'keyboard' })).join('') +
      `<div class="mdiv"></div>${mi('Colar texto como digitação…', 'data-type', { ic: 'clipboard' })}`;
    $$('[data-k]', m).forEach(b => b.onclick = () => { sendCombo(combos[b.dataset.k][1]); closeMenus(); });
    $('[data-type]', m).onclick = async () => { closeMenus(); const t = await gcp.invoke('clipboard:read'); if (t && canControl()) send({ t: 'type', text: t }); };
  }

  function buildQualityMenu() {
    const q = S.settings.session;
    const m = $('#m-quality');
    const res = [['auto', 'Automática (nativa)'], ['2560x1440', '2560 × 1440'], ['1920x1080', '1920 × 1080'], ['1600x900', '1600 × 900'], ['1366x768', '1366 × 768'], ['1280x720', '1280 × 720'], ['1024x576', '1024 × 576']];
    S.q = S.q || { quality: q.quality, resolution: q.resolution, fps: q.fps, profile: q.profile || 'speed' };
    m.innerHTML = `<h4>Perfil</h4>
      ${[['speed', 'Velocidade — quase em tempo real'], ['balanced', 'Equilibrado'], ['quality', 'Qualidade de imagem']].map(([v, l]) => mi(l, `data-p="${v}"`, { sel: (S.q.profile || 'speed') === v })).join('')}
      <div class="mdiv"></div><h4>Qualidade</h4>
      ${[['low', 'Baixa — internet lenta'], ['medium', 'Equilibrada'], ['high', 'Alta'], ['max', 'Máxima — rede local']].map(([v, l]) => mi(l, `data-q="${v}"`, { sel: S.q ? S.q.quality === v : q.quality === v })).join('')}
      <div class="mdiv"></div><h4>Resolução transmitida</h4>
      ${res.map(([v, l]) => mi(l, `data-r="${v}"`, { sel: (S.q ? S.q.resolution : q.resolution) === v })).join('')}
      <div class="mdiv"></div><h4>Fluidez</h4>
      ${[15, 30, 60].map(f => mi(`${f} quadros/s`, `data-f="${f}"`, { sel: Number(S.q ? S.q.fps : q.fps) === f })).join('')}`;
    S.q = S.q || { quality: q.quality, resolution: q.resolution, fps: q.fps };
    $$('[data-p]', m).forEach(b => b.onclick = () => { S.q.profile = b.dataset.p; send({ t: 'quality', q: { profile: S.q.profile } }); buildQualityMenu(); });
    $$('[data-q]', m).forEach(b => b.onclick = () => { S.q.quality = b.dataset.q; send({ t: 'quality', q: { quality: S.q.quality } }); buildQualityMenu(); });
    $$('[data-r]', m).forEach(b => b.onclick = () => { S.q.resolution = b.dataset.r; send({ t: 'quality', q: { resolution: S.q.resolution } }); buildQualityMenu(); });
    $$('[data-f]', m).forEach(b => b.onclick = () => { S.q.fps = Number(b.dataset.f); send({ t: 'quality', q: { fps: S.q.fps } }); buildQualityMenu(); });
  }

  function buildScreensMenu() {
    const m = $('#m-screens');
    if (!S.screens.length) { m.innerHTML = `<h4>Monitores</h4><div class="mi">Aguardando conexão…</div>`; return; }
    m.innerHTML = `<h4>Monitores remotos</h4>` + S.screens.map((s, i) => mi(`${s.name || 'Tela ' + (i + 1)} · ${s.width}×${s.height}`, `data-s="${esc(s.id)}"`, { ic: 'monitor', sel: s.id === S.screen })).join('') +
      `<div class="mdiv"></div>${mi('Próximo monitor', 'data-next', { ic: 'arrowRight', right: S.settings.shortcuts.nextMonitor })}`;
    $$('[data-s]', m).forEach(b => b.onclick = () => { send({ t: 'screen', id: b.dataset.s }); closeMenus(); });
    $('[data-next]', m).onclick = () => { ACTIONS.nextMonitor(); closeMenus(); };
  }

  function buildFxMenu() {
    const m = $('#m-fx');
    const fx = S.effects;
    if (!fx) { m.innerHTML = `<h4>Efeitos</h4><div class="mi">Aguardando conexão…</div>`; return; }
    const sc = S.settings.shortcuts;
    m.innerHTML = `<h4>Visível para todos na tela remota</h4>
      ${mi('Destaque do cursor', 'data-fx="cursor"', { sel: fx.cursor.on, right: sc.cursorHighlight })}
      ${mi('Efeito de clique', 'data-fx="clicks"', { sel: fx.clicks.on, right: sc.clickEffect })}
      ${mi('Holofote', 'data-fx="spotlight"', { sel: fx.spotlight.on, right: sc.spotlight })}
      ${mi('Widget de ferramentas', 'data-fx="widget"', { sel: fx.widget.on, right: sc.presenterWidget })}
      <div class="mdiv"></div><h4>Cor do destaque</h4>
      <div style="display:flex;gap:6px;padding:4px 10px 8px">${GDraw.PALETTE.slice(0, 8).map(c => `<button class="cdot ${fx.cursor.color === c ? 'sel' : ''}" data-cc="${c}" style="background:${c}"></button>`).join('')}</div>`;
    $$('[data-fx]', m).forEach(b => b.onclick = () => toggleFx(b.dataset.fx));
    $$('[data-cc]', m).forEach(b => b.onclick = () => send({ t: 'effects', patch: { cursor: { color: b.dataset.cc, on: true } } }));
  }
  function toggleFx(k) {
    if (!S.effects) return;
    if (S.remotePerms.drawing === false) return toast('O computador remoto não permite efeitos.', 'error');
    send({ t: 'effects', patch: { [k]: { on: !S.effects[k].on } } });
  }

  // ---------- Estatísticas ----------
  let lastBytes = 0, lastTs = 0;
  function watchStats() {
    clearInterval(S.statTimer);
    S.statTimer = setInterval(async () => {
      send({ t: 'ping', ts: performance.now() });
      const pc = S.call && S.call.peerConnection; if (!pc) return;
      const stats = await pc.getStats();
      let fps = 0, w = 0, h = 0, kbps = 0, relay = false, codec = '', hwDec = '';
      stats.forEach(r => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          fps = Math.round(r.framesPerSecond || 0); w = r.frameWidth; h = r.frameHeight;
          const c = r.codecId && stats.get(r.codecId); if (c) codec = c.mimeType.split('/')[1];
          if (r.decoderImplementation) hwDec = /External|D3D|VAAPI|VideoToolbox|Media ?Foundation|V4L2/i.test(r.decoderImplementation) ? ' HW' : '';
          if (lastTs) kbps = Math.round(((r.bytesReceived - lastBytes) * 8) / (r.timestamp - lastTs));
          lastBytes = r.bytesReceived; lastTs = r.timestamp;
        }
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) {
          const lc = stats.get(r.localCandidateId); if (lc && lc.candidateType === 'relay') relay = true;
        }
      });
      $('#stat').textContent = `${S.rtt != null ? S.rtt + ' ms · ' : ''}${w ? `${w}×${h} · ` : ''}${fps} fps · ${kbps > 1000 ? (kbps / 1000).toFixed(1) + ' Mb/s' : kbps + ' kb/s'}${codec ? ' · ' + codec + hwDec : ''}${relay ? ' · relé' : ''}`;
      $('#st-dot').className = 'status-dot ' + (S.rtt == null || S.rtt < 150 ? 'ok' : S.rtt < 400 ? '' : 'err');
    }, 2000);
  }

  // ---------- Painel lateral ----------
  function openPanel(which) {
    const p = $('#panel');
    const already = !p.classList.contains('hidden') && !$('#p-' + which).classList.contains('hidden');
    if (already) return closePanel();
    p.classList.remove('hidden');
    p.classList.toggle('wide', which === 'files');
    $('#p-chat').classList.toggle('hidden', which !== 'chat');
    $('#p-files').classList.toggle('hidden', which !== 'files');
    $('#p-title').textContent = which === 'chat' ? 'Chat' : 'Transferência de arquivos';
    $('#b-chat').classList.toggle('active', which === 'chat');
    $('#b-files').classList.toggle('active', which === 'files');
    if (which === 'chat') { $('#chat-badge').classList.add('hidden'); setTimeout(() => $('#chat-input').focus(), 30); }
    if (which === 'files') { loadLocal(localDir); loadRemote(remoteDir); }
    setTimeout(layout, 30);
  }
  function closePanel() { $('#panel').classList.add('hidden'); $('#b-chat').classList.remove('active'); $('#b-files').classList.remove('active'); setTimeout(layout, 30); ink.focus(); }
  $('#p-close').onclick = closePanel;
  $('#b-chat').onclick = () => openPanel('chat');
  $('#b-files').onclick = () => openPanel('files');

  function addChat(from, text, me) {
    const log = $('#chat-log');
    log.insertAdjacentHTML('beforeend', `<div class="msg ${me ? 'me' : ''}">${esc(text)}<small>${esc(from)} · ${new Date().toLocaleTimeString('pt-BR', { timeStyle: 'short' })}</small></div>`);
    log.scrollTop = log.scrollHeight;
    if (!me && $('#p-chat').classList.contains('hidden')) { $('#chat-badge').classList.remove('hidden'); toast(`${from}: ${text}`, 'info', 5000); }
  }
  $('#chat-form').onsubmit = (e) => { e.preventDefault(); const i = $('#chat-input'); const t = i.value.trim(); if (!t) return; send({ t: 'chat', text: t }); addChat('Você', t, true); i.value = ''; };

  // ---------- Arquivos ----------
  let localDir = '', remoteDir = '', localSel = new Set(), remoteSel = new Set(), remoteReq = 0;

  const transfers = new GProto.Transfers({
    getConn: () => S.filesConn,
    onProgress: (p) => renderXfer(p),
    onDone: (offer, paths) => {
      if (offer.purpose === 'clip') toast('Pronto para colar: use Ctrl+V em qualquer pasta deste computador.', 'ok', 4000);
      else { const t = toast(`Recebido: ${paths.length} item(ns). Clique para abrir.`, 'ok', 6000); t.style.cursor = 'pointer'; t.onclick = () => gcp.invoke('file:show', paths[0]); if (!$('#p-files').classList.contains('hidden')) loadLocal(localDir); }
    },
    onError: (e) => toast(e.message, 'error')
  });

  const xrows = new Map();
  // Arquivos copiados no computador remoto: vêm na hora (até 1 GB) ou após confirmação
  const CLIP_AUTO_LIMIT = 1024 * 1024 * 1024;
  async function onRemoteClipFiles(m) {
    if (!S.remotePerms.files) return;
    const what = m.top.length === 1 ? `“${m.top[0]}”` : `${m.count} arquivo(s)`;
    if (m.total <= CLIP_AUTO_LIMIT) { send({ t: 'clip-get' }); return; }
    gcp.invoke('notice:info', { tone: 'info', icon: 'clipboard', title: 'Arquivos grandes copiados no remoto', body: `${what} · ${fmtBytes(m.total)}. Confirme na janela da sessão para copiar.`, ms: 10000 });
    const ok = await GUI.modal({ title: 'Copiar do computador remoto?', body: `<p>${esc(what)} — ${fmtBytes(m.total)}.</p><p>Depois de copiar, cole com Ctrl+V em qualquer pasta deste computador.</p>`, actions: [{ label: 'Agora não', value: false }, { label: 'Copiar', kind: 'primary', value: true }] });
    if (ok) send({ t: 'clip-get' });
  }

  function renderXfer(p) {
    gcp.invoke('notice:progress', p.tid, GProto.progressNotice(p, S.hello ? S.hello.name : S.params.name, 'client'));
    let row = xrows.get(p.tid);
    if (!row) { row = document.createElement('div'); row.className = 'xrow'; $('#xlist').prepend(row); xrows.set(p.tid, row); }
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 100;
    row.innerHTML = `${icon(p.dir === 'in' ? 'download' : 'upload')}<span>${esc(p.label)}</span><div class="progress"><i style="width:${pct}%"></i></div><small>${p.state === 'done' ? 'Concluído' : p.state === 'error' ? 'Falhou: ' + esc(p.error || '') : `${fmtBytes(p.done)} / ${fmtBytes(p.total)}`}</small>`;
    if (p.state === 'done' && p.dir === 'out' && !$('#p-files').classList.contains('hidden')) loadRemote(remoteDir);
    if ($('#p-files').classList.contains('hidden') && p.state !== 'run') toast(`${p.dir === 'in' ? 'Recebido' : 'Enviado'}: ${p.label}`, p.state === 'done' ? 'ok' : 'error', 2500);
  }

  function fileRows(list, sel) {
    return list.entries.filter(e => !e.hidden).map(e => `<div class="fitem ${e.dir ? 'dir' : ''} ${sel.has(e.path) ? 'sel' : ''}" data-p="${esc(e.path)}" data-dir="${e.dir ? 1 : 0}">${icon(e.dir ? 'folder' : 'file')}<span>${esc(e.name)}</span><small>${e.dir ? '' : fmtBytes(e.size)}</small></div>`).join('') || '<div class="fitem"><span class="muted">Pasta vazia</span></div>';
  }
  function bindList(el, sel, open) {
    $$('.fitem[data-p]', el).forEach(it => {
      it.onclick = (e) => {
        const p = it.dataset.p;
        if (!e.ctrlKey && !e.shiftKey) sel.clear();
        if (sel.has(p)) sel.delete(p); else sel.add(p);
        $$('.fitem', el).forEach(x => x.classList.toggle('sel', sel.has(x.dataset.p)));
      };
      it.ondblclick = () => { if (it.dataset.dir === '1') open(it.dataset.p); };
    });
  }
  let localParent = null, remoteParent = null;
  async function loadLocal(dir) {
    try {
      const r = await gcp.invoke('files:list', dir);
      localDir = r.path; localParent = r.parent; localSel.clear();
      transfers.defaultDest = r.path || null;
      $('#fl-path').value = r.path || 'Este computador';
      $('#fl-list').innerHTML = fileRows(r, localSel);
      bindList($('#fl-list'), localSel, loadLocal);
    } catch (e) { toast(e.message, 'error'); }
  }
  function loadRemote(dir) { send({ t: 'fs-list', path: dir, req: ++remoteReq }); $('#fr-list').innerHTML = '<div class="fitem"><span class="muted">Carregando…</span></div>'; }
  function onRemoteList(m) {
    if (m.req !== remoteReq) return;
    if (m.error) { $('#fr-list').innerHTML = `<div class="fitem"><span class="muted">${esc(m.error)}</span></div>`; return; }
    remoteDir = m.path; remoteParent = m.parent; remoteSel.clear();
    $('#fr-path').value = m.path || 'Computador remoto';
    $('#fr-list').innerHTML = fileRows(m, remoteSel);
    bindList($('#fr-list'), remoteSel, loadRemote);
  }
  $('#fl-up').onclick = () => { if (localParent !== null) loadLocal(localParent); };
  $('#fr-up').onclick = () => { if (remoteParent !== null) loadRemote(remoteParent); };
  $('#fl-path').onkeydown = (e) => { if (e.key === 'Enter') loadLocal(e.target.value); };
  $('#fr-path').onkeydown = (e) => { if (e.key === 'Enter') loadRemote(e.target.value); };
  $('#f-upload').onclick = async () => {
    let paths = [...localSel];
    if (!paths.length) paths = await gcp.invoke('files:pick', false);
    if (!paths.length) return;
    transfers.send(paths, { purpose: 'send', dest: remoteDir || null }).catch(e => toast(e.message, 'error'));
  };
  $('#f-download').onclick = () => {
    const paths = [...remoteSel];
    if (!paths.length) return toast('Selecione arquivos ou pastas no computador remoto.', 'info');
    send({ t: 'fs-get', paths });
  };

  // Arrastar e soltar arquivos na tela remota
  let dragDepth = 0;
  stage.addEventListener('dragenter', (e) => { if (!S.connected) return; e.preventDefault(); dragDepth++; $('#dropzone').classList.remove('hidden'); });
  stage.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').classList.add('hidden'); } });
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('#dropzone').classList.add('hidden');
    const paths = [...e.dataTransfer.files].map(f => gcp.pathForFile(f)).filter(Boolean);
    if (paths.length) transfers.send(paths, { purpose: 'send' }).then(() => toast('Arquivos enviados para a pasta “GCP Remoto” em Downloads do computador remoto.', 'ok', 5000)).catch(err => toast(err.message, 'error'));
  });

  gcp.on('settings:changed', async () => { S.settings = await gcp.invoke('settings:get'); buildMenus(); });
  gcp.on('xfer:cancel', (tid) => transfers.cancel(tid));
  window.addEventListener('beforeunload', () => { releaseKeys(); send({ t: 'bye' }); });

  init();
})();
