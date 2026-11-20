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
      GProto.hardwareCodecs().catch(() => {});
      gcp.on('files:clip-changed', (paths) => this.onClipFiles(paths));
      gcp.on('xfer:cancel', (tid) => { if (this.session) this.session.transfers.cancel(tid); });
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
      peer.on('call', (call) => {
        const s = this.session;
        if (!s || !call.metadata || call.metadata.kind !== 'voice' || call.metadata.token !== s.token || call.peer !== s.conn.peer) { call.close(); return; }
        this.voice(s).answer(call);
        gcp.invoke('notice:info', { tone: 'info', icon: 'headset', title: `${s.who.name} quer conversar por voz`, body: 'Você já ouve a pessoa. Para responder, clique em Microfone na faixa da sessão do GCP Remoto.', ms: 10000 });
      });
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
      if (conn.label === 'input') {
        // Canal rápido do mouse: sem ordem garantida; movimentos antigos são descartados pelo número de sequência
        conn.on('open', () => {
          const s = this.session;
          if (!s || !conn.metadata || conn.metadata.token !== s.token || conn.peer !== s.conn.peer) { conn.close(); return; }
          s.inputConn = conn; s.lastSeq = 0;
          conn.on('data', (m) => {
            if (!m || m.t !== 'mm' || this.session !== s) return;
            if (m.q <= s.lastSeq) return;
            s.lastSeq = m.q;
            this.onSessionMessage(m);
          });
        });
        return;
      }
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
        onProgress: (p) => { this.emit('xfer', p); if (p.dir === 'in') gcp.invoke('notice:progress', p.tid, GProto.progressNotice(p, who.name, 'host')); },
        onDone: (offer, paths) => {
          if (offer.purpose === 'clip') s.ignoreClip = paths.join('|');
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
      const maxKbps = Math.round((QUALITY_BITRATE[s.quality.quality] || QUALITY_BITRATE.high) / 1000);
      s.call = this.peer.call(conn.peer, s.stream, { metadata: { token }, sdpTransform: (sdp) => GProto.tuneSdp(sdp, { start: Math.min(4000, maxKbps), min: Math.min(800, maxKbps), max: maxKbps }) });
      this.preferCodec(s);
      s.call.on('close', () => { if (this.session === s) this.end('Transmissão encerrada.'); });
      s.call.on('error', () => {});
      this.watchCall(s);
      gcp.invoke('overlay:session', { name: who.name, since: s.since });
      if (s.screen) gcp.invoke('overlay:display', s.screen.displayId);
      gcp.invoke('tray:status', `sessão ativa com ${who.name}`);
      s.clipTimer = setInterval(() => this.pollClipboard(), 900);
      s.clipBaseline = false;
      gcp.invoke('files:clip-watch', true);
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
      // Perfil "velocidade": mantém a fluidez e reduz a nitidez quando a rede aperta (como TeamViewer/AnyDesk)
      if (vt) vt.contentHint = (q.profile || 'speed') === 'quality' ? 'detail' : 'motion';
      return stream;
    },

    // Codificação por hardware quando disponível (H.264), senão VP8 (o mais leve em software).
    preferCodec(s) {
      const pc = s.call && s.call.peerConnection;
      if (!pc || !window.RTCRtpSender || !RTCRtpSender.getCapabilities) return;
      const pick = async () => {
        const caps = RTCRtpSender.getCapabilities('video');
        if (!caps) return;
        const want = (s.quality.codec || 'auto');
        let order = ['H264', 'VP8', 'VP9', 'AV1'];
        if (want === 'auto') {
          const hw = await GProto.hardwareCodecs().catch(() => ({}));
          order = hw.H264 ? ['H264', 'VP8', 'VP9', 'AV1'] : hw.VP9 ? ['VP9', 'VP8', 'H264', 'AV1'] : ['VP8', 'H264', 'VP9', 'AV1'];
        } else order = [want.toUpperCase(), ...order.filter(c => c !== want.toUpperCase())];
        const rank = (c) => { const n = c.mimeType.split('/')[1].toUpperCase(); const i = order.indexOf(n); return i < 0 ? 99 : i; };
        const codecs = caps.codecs.slice().sort((a, b) => rank(a) - rank(b));
        for (const t of pc.getTransceivers()) {
          if (t.sender && t.sender.track && t.sender.track.kind === 'video' && t.setCodecPreferences) { try { t.setCodecPreferences(codecs); } catch (_) {} }
        }
      };
      // precisa acontecer antes da oferta: o PeerJS negocia logo em seguida (evento negotiationneeded)
      try {
        const caps = RTCRtpSender.getCapabilities('video');
        const order = s.quality.codec && s.quality.codec !== 'auto' ? [s.quality.codec.toUpperCase()] : (GProto.cachedHw && GProto.cachedHw.H264 ? ['H264'] : GProto.cachedHw && GProto.cachedHw.VP9 ? ['VP9'] : ['VP8']);
        const rank = (c) => (order.includes(c.mimeType.split('/')[1].toUpperCase()) ? 0 : 1);
        const codecs = caps.codecs.slice().sort((a, b) => rank(a) - rank(b));
        for (const t of pc.getTransceivers()) if (t.sender && t.sender.track && t.sender.track.kind === 'video' && t.setCodecPreferences) t.setCodecPreferences(codecs);
      } catch (_) { pick(); }
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
        const prof = s.quality.profile || 'speed';
        p.degradationPreference = prof === 'quality' ? 'maintain-resolution' : prof === 'balanced' ? 'balanced' : 'maintain-framerate';
        p.encodings[0].priority = 'high';
        p.encodings[0].networkPriority = 'high';
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
          if (m.q.profile) { const vt = s.stream && s.stream.getVideoTracks()[0]; if (vt) vt.contentHint = m.q.profile === 'quality' ? 'detail' : 'motion'; }
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
        case 'clip-get':
          if (s.perms.files && s.clipPaths && s.clipPaths.length) s.transfers.send(s.clipPaths, { purpose: 'clip' }).catch(e => s.conn.send({ t: 'notice', message: e.message }));
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

    // Arquivos copiados neste computador (qualquer forma de copiar) ficam disponíveis para colar do outro lado
    async onClipFiles(paths) {
      const s = this.session; if (!s) return;
      const key = paths.join('|');
      if (!s.clipBaseline) { s.clipBaseline = true; s.lastClipFiles = key; return; } // o que já estava copiado antes da sessão não é enviado
      if (key === s.lastClipFiles) return;
      s.lastClipFiles = key;
      if (!paths.length || key === s.ignoreClip || !s.perms.files) return;
      const scan = await gcp.invoke('files:scan', paths);
      s.clipPaths = paths;
      s.conn.send({ t: 'clip-files', count: scan.items.filter(i => !i.dir).length, total: scan.total, top: scan.top.slice(0, 20) });
    },

    async checkClipboardFiles() {
      const s = this.session; if (!s || !s.perms.files || !s.filesConn) return;
      const paths = await gcp.invoke('files:clipboard-read');
      const key = paths.join('|');
      if (!paths.length || key === s.lastClipFiles) return;
      s.lastClipFiles = key;
      s.transfers.send(paths, { purpose: 'clip' }).catch(() => {});
    },

    voice(s) {
      s = s || this.session; if (!s) return null;
      if (s.voiceObj) return s.voiceObj;
      s.voiceObj = new GVoice.Voice({
        peer: this.peer, remotePeerId: () => s.conn.peer, token: () => s.token,
        audio: () => this.settings.audio || {},
        onState: (st) => this.emit('voice', st),
        onLevel: (l) => this.emit('voice-level', l),
        onRemoteLevel: (l) => this.emit('voice-remote', l)
      });
      return s.voiceObj;
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
      if (s.voiceObj) s.voiceObj.end();
      gcp.invoke('files:clip-watch', false);
      try { s.conn.send({ t: 'bye', reason: 'Sessão encerrada pelo computador acessado.' }); } catch (_) {}
      setTimeout(() => { try { s.conn.close(); } catch (_) {} try { s.filesConn && s.filesConn.close(); } catch (_) {} }, 300);
      try { s.call && s.call.close(); } catch (_) {}
      try { s.inputConn && s.inputConn.close(); } catch (_) {}
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
