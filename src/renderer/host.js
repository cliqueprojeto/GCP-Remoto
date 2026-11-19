// Lado ACESSADO: mantém este computador disponível pelo seu ID, autentica e compartilha a tela.
(function () {
  'use strict';
  const { PEER_PREFIX, PROTO_VERSION } = GProto;
  const QUALITY_BITRATE = { low: 1_200_000, medium: 3_500_000, high: 8_000_000, max: 20_000_000 };

  const Host = {
    peer: null, status: 'connecting', info: null, settings: null,
    session: null, retry: 0, listeners: {},

    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    emit(ev, ...a) { (this.listeners[ev] || []).forEach(fn => { try { fn(...a); } catch (e) { console.error(e); } }); },
    setStatus(s, detail) { this.status = s; this.emit('status', s, detail); },

    async start() {
      this.info = await gcp.invoke('app:info');
      this.settings = await gcp.invoke('settings:get');
      this.connectPeer();
      window.addEventListener('online', () => { if (!this.peer || this.peer.disconnected) this.reconnect(0); });
    },

    connectPeer() {
      if (this.peer) { try { this.peer.destroy(); } catch (_) {} }
      this.setStatus('connecting');
      const peer = new Peer(PEER_PREFIX + this.info.deviceId, GProto.peerOptions(this.settings));
      this.peer = peer;
      peer.on('open', () => { this.retry = 0; this.setStatus('online'); });
      peer.on('connection', (conn) => this.onConnection(conn));
      peer.on('disconnected', () => { if (this.peer === peer && !peer.destroyed) { this.setStatus('connecting'); setTimeout(() => { try { peer.reconnect(); } catch (_) { this.reconnect(); } }, 1500); } });
      peer.on('error', (err) => {
        if (this.peer !== peer) return;
        const t = err.type;
        if (t === 'peer-unavailable') return; // não se aplica ao lado acessado
        if (t === 'unavailable-id') { this.setStatus('connecting', 'ID em uso, tentando novamente…'); return this.reconnect(5000); }
        if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(t)) { this.setStatus('offline', 'Sem conexão com o servidor'); return this.reconnect(); }
        console.warn('[host] peer error', t, err);
      });
    },

    reconnect(delay) {
      clearTimeout(this._rt);
      const d = delay != null ? delay : Math.min(30000, 2000 * Math.pow(1.6, this.retry++));
      this._rt = setTimeout(() => this.connectPeer(), d);
    },

    async reloadSettings() {
      const prev = JSON.stringify(this.settings.server) + JSON.stringify(this.settings.turn) + JSON.stringify(this.settings.iceServers);
      this.settings = await gcp.invoke('settings:get');
      this.info = await gcp.invoke('app:info');
      const now = JSON.stringify(this.settings.server) + JSON.stringify(this.settings.turn) + JSON.stringify(this.settings.iceServers);
      if (prev !== now && !this.session) this.connectPeer();
    },

    // ---------- Conexões recebidas ----------
    onConnection(conn) {
      if (conn.label === 'files') {
        conn.on('open', () => {
          const s = this.session;
          if (!s || !conn.metadata || conn.metadata.token !== s.token || conn.peer !== s.conn.peer) { conn.close(); return; }
          s.filesConn = conn;
          conn.on('data', (m) => s.transfers.handle(m));
        });
        return;
      }
      let authed = false, attempts = 0, challenge = null;
      const sendHello = async () => {
        challenge = await gcp.invoke('auth:challenge');
        conn.send({ t: 'hello', v: PROTO_VERSION, nonce: challenge.nonce, salt: challenge.salt, name: this.settings.displayName, os: this.info.platform, osLabel: this.info.osLabel });
      };
      conn.on('open', async () => {
        if (this.session) { conn.send({ t: 'busy', name: this.settings.displayName }); setTimeout(() => conn.close(), 400); return; }
        await sendHello();
        setTimeout(() => { if (!authed && conn.open) conn.close(); }, 120000);
      });
      conn.on('data', async (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (authed) return this.onSessionMessage(msg);
        if (msg.t !== 'auth' || this.session) return;
        const who = { name: String(msg.name || 'Desconhecido').slice(0, 60), os: msg.os, osLabel: msg.osLabel };
        if (msg.request) {
          const perms = await this.askPermission(who, false);
          if (!conn.open) return;
          if (!perms) { conn.send({ t: 'denied' }); setTimeout(() => conn.close(), 400); return; }
          authed = true; return this.accept(conn, who, perms, 'request');
        }
        const res = await gcp.invoke('auth:check', challenge && challenge.nonce, String(msg.proof || ''));
        if (res.ok) {
          let perms = this.defaultPerms();
          if (this.settings.security.askEvenWithPassword) {
            perms = await this.askPermission(who, true);
            if (!perms) { conn.send({ t: 'denied' }); setTimeout(() => conn.close(), 400); return; }
          }
          authed = true; return this.accept(conn, who, perms, res.kind);
        }
        attempts++;
        conn.send({ t: 'auth-fail', reason: res.locked ? `Muitas tentativas. Aguarde ${res.locked}s.` : 'Senha incorreta.', locked: res.locked || 0 });
        if (attempts >= 3 || res.locked) setTimeout(() => conn.close(), 400); else await sendHello();
      });
      conn.on('close', () => { if (this.session && this.session.conn === conn) this.end('O outro lado encerrou a sessão.'); });
      conn.on('error', () => {});
    },

    defaultPerms() {
      const s = this.settings.security;
      return { control: s.allowControl, files: s.allowFileTransfer, clipboard: s.allowClipboard, drawing: s.allowDrawing };
    },

    // Janela de notificação premium, sempre por cima, mesmo com o app na bandeja
    askPermission(who, hasPassword) { return gcp.invoke('notice:request', { who, hasPassword, perms: this.defaultPerms(), timeout: 45 }); },

    // ---------- Início da sessão ----------
    async accept(conn, who, perms, kind) {
      const token = GDraw.uid() + GDraw.uid();
      const s = this.session = {
        conn, who, perms, kind, token, since: Date.now(), call: null, stream: null, filesConn: null,
        screens: [], screen: null, lastClip: null, paused: false,
        quality: { ...this.settings.session }
      };
      s.transfers = new GProto.Transfers({
        getConn: () => s.filesConn,
        canReceive: () => s.perms.files,
        acceptDest: true,
        onProgress: (p) => this.emit('xfer', p),
        onDone: (offer, paths) => {
          if (offer.purpose === 'clip' && offer.pasteAfter && s.perms.control) {
            setTimeout(() => gcp.send('input:event', { t: 'combo', codes: [this.info.platform === 'darwin' ? 'MetaLeft' : 'ControlLeft', 'KeyV'] }), 150);
          } else if (offer.purpose !== 'clip') {
            gcp.invoke('notify', 'Arquivos recebidos', `${paths.length} item(ns) de ${who.name}`);
          }
        },
        onError: (e) => this.emit('toast', e.message, 'error')
      });
      try {
        s.screens = await gcp.invoke('screens:list');
      } catch (_) { s.screens = []; }
      s.screen = s.screens[0] || null;
      try {
        s.stream = await this.capture(s.screen);
      } catch (e) {
        conn.send({ t: 'error', message: 'Não foi possível capturar a tela remota: ' + e.message });
        this.session = null; setTimeout(() => conn.close(), 400);
        this.emit('toast', 'Falha ao capturar a tela: ' + e.message, 'error');
        return;
      }
      if (perms.control) {
        gcp.invoke('input:prepare').catch(err => {
          conn.send({ t: 'notice', message: 'Controle indisponível neste computador: ' + err.message });
          this.emit('toast', 'Controle remoto indisponível: ' + err.message, 'error');
        });
      }
      conn.send({
        t: 'accepted', token, perms, kind,
        screens: s.screens.map(x => ({ id: x.id, name: x.name, width: x.width, height: x.height })),
        screen: s.screen && s.screen.id, os: this.info.platform, osLabel: this.info.osLabel, name: this.settings.displayName,
        effects: await gcp.invoke('effects:get'), wayland: this.info.wayland
      });
      s.call = this.peer.call(conn.peer, s.stream, { metadata: { token } });
      s.call.on('close', () => { if (this.session === s) this.end('Transmissão encerrada.'); });
      s.call.on('error', () => {});
      this.watchCall(s);
      gcp.invoke('overlay:session', { name: who.name, since: s.since });
      if (s.screen) gcp.invoke('overlay:display', s.screen.displayId);
      gcp.invoke('tray:status', `sessão ativa com ${who.name}`);
      s.clipTimer = setInterval(() => this.pollClipboard(), 900);
      gcp.invoke('notice:info', { tone: 'ok', icon: 'remote', title: 'Sessão remota iniciada', body: `${who.name} está acessando este computador.`, meta: [who.osLabel || GProto.osName(who.os), kind === 'permanent' ? 'senha fixa' : kind === 'request' ? 'aceito por você' : 'senha da sessão'] });
      this.emit('session', s);
    },

    async capture(screen) {
      const q = this.session ? this.session.quality : this.settings.session;
      const audio = this.info.platform === 'win32';
      await gcp.invoke('capture:select', screen && screen.id, audio);
      const fps = Number(q.fps) || 30;
      let maxW = 7680, maxH = 4320;
      if (q.resolution && q.resolution !== 'auto') [maxW, maxH] = q.resolution.split('x').map(Number);
      let stream;
      try {
        // Captura direta (funciona com a janela oculta na bandeja, sem clique do usuário)
        const mandatory = { chromeMediaSource: 'desktop', maxWidth: maxW, maxHeight: maxH, maxFrameRate: fps, minFrameRate: Math.min(5, fps) };
        if (screen && screen.id) mandatory.chromeMediaSourceId = screen.id;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audio ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
          video: { mandatory }
        });
      } catch (err) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: screen && screen.id, maxWidth: maxW, maxHeight: maxH, maxFrameRate: fps } } });
        } catch (_) {
          const video = { frameRate: { ideal: fps, max: fps }, width: { max: maxW }, height: { max: maxH } };
          stream = await navigator.mediaDevices.getDisplayMedia({ video, audio });
        }
      }
      const vt = stream.getVideoTracks()[0];
      if (vt) vt.contentHint = q.quality === 'low' ? 'motion' : 'detail';
      return stream;
    },

    watchCall(s) {
      const apply = () => this.applyBitrate(s);
      const pc = s.call.peerConnection;
      if (!pc) return setTimeout(() => this.watchCall(s), 200);
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'connected') apply();
        if (pc.connectionState === 'failed' && this.session === s) this.end('Falha na conexão de vídeo.');
      });
      setTimeout(apply, 1500);
    },

    async applyBitrate(s) {
      const pc = s.call && s.call.peerConnection; if (!pc) return;
      for (const sender of pc.getSenders()) {
        if (!sender.track || sender.track.kind !== 'video') continue;
        const p = sender.getParameters();
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = QUALITY_BITRATE[s.quality.quality] || QUALITY_BITRATE.high;
        p.encodings[0].maxFramerate = Number(s.quality.fps) || 30;
        p.degradationPreference = s.quality.quality === 'low' ? 'maintain-framerate' : 'maintain-resolution';
        try { await sender.setParameters(p); } catch (_) {}
      }
    },

    async replaceStream(s, screen) {
      const old = s.stream;
      const stream = await this.capture(screen || s.screen);
      const pc = s.call.peerConnection;
      for (const track of stream.getTracks()) {
        const sender = pc.getSenders().find(x => x.track && x.track.kind === track.kind) || pc.getSenders().find(x => !x.track);
        if (sender) await sender.replaceTrack(track);
      }
      s.stream = stream;
      if (screen) { s.screen = screen; gcp.invoke('overlay:display', screen.displayId); }
      old && old.getTracks().forEach(t => t.stop());
      this.applyBitrate(s);
    },

    // ---------- Mensagens da sessão ----------
    onSessionMessage(m) {
      const s = this.session; if (!s) return;
      switch (m.t) {
        case 'mm': case 'md': case 'mu': case 'wh': case 'kd': case 'ku': case 'type': case 'combo': case 'release':
          if (!s.perms.control || s.paused) return;
          if (m.x != null) m.d = s.screen && s.screen.displayId;
          gcp.send('input:event', m);
          if (m.t === 'kd' && (m.code === 'KeyC' || m.code === 'KeyX') && m.ctrl) setTimeout(() => this.checkClipboardFiles(), 450);
          break;
        case 'draw':
          if (s.perms.drawing) gcp.send('overlay:op', { ...m.op, by: 'remote' });
          break;
        case 'chat':
          this.emit('chat', { from: s.who.name, text: String(m.text || '').slice(0, 4000), me: false });
          break;
        case 'clip':
          if (s.perms.clipboard && typeof m.text === 'string') { s.lastClip = m.text; gcp.invoke('clipboard:write', m.text); }
          break;
        case 'quality':
          s.quality = { ...s.quality, ...m.q };
          if (m.q.resolution !== undefined || m.q.fps !== undefined) this.replaceStream(s).catch(() => {});
          else this.applyBitrate(s);
          break;
        case 'screen': {
          const scr = s.screens.find(x => x.id === m.id);
          if (scr) this.replaceStream(s, scr).then(() => s.conn.send({ t: 'screen-changed', id: scr.id })).catch(e => s.conn.send({ t: 'notice', message: e.message }));
          break;
        }
        case 'effects':
          if (s.perms.drawing) gcp.invoke('effects:set', m.patch).then(fx => s.conn.send({ t: 'effects', effects: fx }));
          break;
        case 'fs-list':
          if (!s.perms.files) return s.conn.send({ t: 'fs-list', req: m.req, error: 'Transferência de arquivos não permitida.' });
          gcp.invoke('files:list', m.path || '').then(r => s.conn.send({ t: 'fs-list', req: m.req, ...r }))
            .catch(e => s.conn.send({ t: 'fs-list', req: m.req, error: e.message }));
          break;
        case 'fs-get':
          if (!s.perms.files) return;
          s.transfers.send((m.paths || []).map(String), { purpose: 'send' }).catch(e => s.conn.send({ t: 'notice', message: e.message }));
          break;
        case 'ping':
          s.conn.send({ t: 'pong', ts: m.ts });
          break;
        case 'bye':
          this.end('Sessão encerrada por quem acessava.');
          break;
      }
    },

    async pollClipboard() {
      const s = this.session; if (!s || !s.perms.clipboard || s.polling) return;
      s.polling = true;
      try {
        const text = await gcp.invoke('clipboard:read');
        if (text && text !== s.lastClip) { s.lastClip = text; if (text.length < 1_000_000) s.conn.send({ t: 'clip', text }); }
      } finally { s.polling = false; }
    },

    async checkClipboardFiles() {
      const s = this.session; if (!s || !s.perms.files || !s.filesConn) return;
      const paths = await gcp.invoke('files:clipboard-read');
      const key = paths.join('|');
      if (!paths.length || key === s.lastClipFiles) return;
      s.lastClipFiles = key;
      s.transfers.send(paths, { purpose: 'clip' }).catch(() => {});
    },

    setPerm(name, val) {
      const s = this.session; if (!s) return;
      s.perms[name] = val;
      if (name === 'control' && !val) gcp.invoke('input:release');
      if (name === 'control' && val) gcp.invoke('input:prepare').catch(() => {});
      s.conn.send({ t: 'perms', perms: s.perms });
    },

    sendChat(text) {
      const s = this.session; if (!s || !text) return;
      s.conn.send({ t: 'chat', text });
      this.emit('chat', { from: 'Você', text, me: true });
    },

    async sendFiles(paths) {
      const s = this.session; if (!s || !s.filesConn) throw new Error('Sessão sem canal de arquivos');
      return s.transfers.send(paths, { purpose: 'send' });
    },

    end(reason) {
      const s = this.session; if (!s) return;
      this.session = null;
      clearInterval(s.clipTimer);
      try { s.conn.send({ t: 'bye', reason: 'Sessão encerrada pelo computador acessado.' }); } catch (_) {}
      setTimeout(() => { try { s.conn.close(); } catch (_) {} try { s.filesConn && s.filesConn.close(); } catch (_) {} }, 300);
      try { s.call && s.call.close(); } catch (_) {}
      s.stream && s.stream.getTracks().forEach(t => t.stop());
      gcp.invoke('input:release');
      gcp.invoke('overlay:session', null);
      gcp.invoke('tray:status', 'pronto para conexões');
      gcp.invoke('pw:session-ended');
      const sec = Math.floor((Date.now() - s.since) / 1000);
      const dur = `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      gcp.invoke('notice:info', { tone: 'warn', title: 'Sessão desconectada', body: reason || 'A sessão remota foi encerrada.', meta: [`com ${s.who.name}`, `duração ${dur}`], ms: 9000 });
      this.emit('session-end', reason);
    }
  };

  window.Host = Host;
})();
