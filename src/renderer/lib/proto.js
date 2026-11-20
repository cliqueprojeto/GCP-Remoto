// Protocolo GCP Remoto: autenticação, configuração do WebRTC e transferência de arquivos.
(function (root) {
  'use strict';
  const PEER_PREFIX = 'gcpremoto-';
  const PROTO_VERSION = 1;
  const CHUNK = 128 * 1024;
  // Canal de arquivos em modo bruto (sem empacotamento do PeerJS): controle em JSON (texto)
  // e dados em blocos binários com 16 bytes de cabeçalho (identificador da transferência).
  const enc = new TextEncoder(), dec = new TextDecoder();
  function sendCtl(conn, obj) { conn.send(JSON.stringify(obj)); }
  function sendData(conn, tid, u8) {
    const out = new Uint8Array(16 + u8.byteLength);
    out.set(enc.encode(String(tid).padEnd(16, ' ').slice(0, 16)), 0);
    out.set(u8, 16);
    conn.send(out.buffer);
  }

  async function sha256hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // A senha nunca trafega: envia-se sha256(nonce + sha256(salt + senha)).
  async function makeProof(nonce, salt, password) {
    return sha256hex(nonce + await sha256hex(salt + password));
  }

  function peerOptions(settings) {
    const srv = settings.server || {};
    const ice = [...(settings.iceServers || [])];
    if (settings.turn && settings.turn.urls) {
      ice.push({ urls: settings.turn.urls.split(/[,\s]+/).filter(Boolean), username: settings.turn.username, credential: settings.turn.credential });
    }
    return {
      host: srv.host, port: Number(srv.port) || 443, path: srv.path || '/', secure: !!srv.secure, key: srv.key || 'peerjs',
      debug: 1, pingInterval: 5000,
      config: { iceServers: ice, sdpSemantics: 'unified-plan', iceCandidatePoolSize: 4 }
    };
  }

  function fmtBytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
  }

  function formatId(id) { return String(id || '').replace(/\D/g, '').replace(/(\d)(?=(\d{3})+$)/g, '$1 '); }

  function osName(p) { return { win32: 'Windows', linux: 'Linux', darwin: 'macOS' }[p] || p || '?'; }

  // ---------- Transferência de arquivos (sobre um DataConnection dedicado) ----------
  class Transfers {
    constructor({ getConn, onProgress, onDone, onError, canReceive, acceptDest }) {
      this.acceptDest = !!acceptDest;   // só o lado acessado aceita destino escolhido pelo outro lado
      this.defaultDest = null;          // pasta local preferida (ex.: painel de arquivos aberto)
      this.getConn = getConn;
      this.onProgress = onProgress || (() => {});
      this.onDone = onDone || (() => {});
      this.onError = onError || (() => {});
      this.canReceive = canReceive || (() => true);
      this.incoming = new Map();
      this.cancelled = new Set();
    }

    async waitDrain(conn) {
      const dc = conn.dataChannel;
      while ((dc && dc.bufferedAmount > 8 * 1024 * 1024) || (conn.bufferSize || 0) > 64) {
        await new Promise(r => setTimeout(r, 15));
        if (!conn.open) throw new Error('conexão encerrada');
      }
    }

    async send(paths, opts = {}) {
      const conn = this.getConn();
      if (!conn || !conn.open) throw new Error('Canal de arquivos indisponível');
      const scan = await gcp.invoke('files:scan', paths);
      if (!scan.items.length) throw new Error('Nada para enviar');
      const tid = GDraw.uid();
      const label = scan.top.length === 1 ? scan.top[0] : `${scan.top.length} itens`;
      sendCtl(conn, { t: 'fx-offer', tid, top: scan.top, count: scan.items.length, total: scan.total, purpose: opts.purpose || 'send', dest: opts.dest || null, pasteAfter: !!opts.pasteAfter });
      let done = 0;
      const purpose = opts.purpose || 'send';
      this.onProgress({ tid, dir: 'out', label, done, total: scan.total, state: 'run', purpose });
      let last = 0;
      try {
        for (const it of scan.items) {
          if (this.cancelled.has(tid)) throw new Error('cancelado');
          sendCtl(conn, { t: 'fx-file', tid, rel: it.rel, dir: it.dir });
          if (it.dir) continue;
          const READ = 1024 * 1024;
          let next = it.size > 0 ? gcp.invoke('files:read', it.abs, 0, READ) : null;
          for (let off = 0; off < it.size; off += READ) {
            if (this.cancelled.has(tid)) throw new Error('cancelado');
            const big = await next;
            next = off + READ < it.size ? gcp.invoke('files:read', it.abs, off + READ, READ) : null; // lê o próximo enquanto envia este
            for (let o = 0; o < big.byteLength; o += CHUNK) {
              await this.waitDrain(conn);
              sendData(conn, tid, big.subarray(o, Math.min(o + CHUNK, big.byteLength)));
            }
            const data = big;
            done += data.byteLength;
            const now = performance.now();
            if (now - last > 120) { last = now; this.onProgress({ tid, dir: 'out', label, done, total: scan.total, state: 'run', purpose }); }
          }
        }
        sendCtl(conn, { t: 'fx-end', tid });
        this.onProgress({ tid, dir: 'out', label, done: scan.total, total: scan.total, state: 'done', purpose });
        return tid;
      } catch (e) {
        try { sendCtl(conn, { t: 'fx-abort', tid }); } catch (_) {}
        this.onProgress({ tid, dir: 'out', label, done, total: scan.total, state: 'error', error: e.message, purpose: opts.purpose || 'send' });
        throw e;
      }
    }

    cancel(tid) {
      this.cancelled.add(tid);
      const inc = this.incoming.get(tid);
      if (inc) {
        // quem recebe cancela: avisa quem envia e descarta o que já chegou
        inc.aborted = true;
        try { this.getConn() && sendCtl(this.getConn(), { t: 'fx-cancel', tid }); } catch (_) {}
        inc.chain.then(() => gcp.invoke('xfer:end', tid, { abort: true }));
        this.incoming.delete(tid);
        this.onProgress({ tid, dir: 'in', label: inc.label, done: inc.done, total: inc.offer.total, state: 'error', error: 'Cópia cancelada.', purpose: inc.offer.purpose });
      }
    }

    flushWrite(tid, inc) {
      if (!inc.pend || !inc.pend.length) return;
      const buf = new Uint8Array(inc.pendLen);
      let o = 0; for (const p of inc.pend) { buf.set(p, o); o += p.byteLength; }
      inc.pend = []; inc.pendLen = 0;
      inc.chain = inc.chain.then(() => gcp.invoke('xfer:write', tid, buf));
    }

    handle(msg) {
      if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch (_) { return false; } }
      else if (msg instanceof ArrayBuffer || ArrayBuffer.isView(msg)) {
        const u8 = msg instanceof ArrayBuffer ? new Uint8Array(msg) : new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
        msg = { t: 'fx-data', tid: dec.decode(u8.subarray(0, 16)).trim(), d: u8.subarray(16) };
      }
      if (!msg || typeof msg !== 'object') return false;
      switch (msg.t) {
        case 'fx-offer': {
          if (!this.canReceive(msg)) { const c = this.getConn(); if (c) sendCtl(c, { t: 'fx-reject', tid: msg.tid }); return true; }
          const label = msg.top.length === 1 ? msg.top[0] : `${msg.top.length} itens`;
          const inc = { offer: msg, label, done: 0, chain: Promise.resolve(), last: 0 };
          const dest = msg.purpose === 'clip' ? null : ((this.acceptDest && msg.dest) || this.defaultDest || null);
          inc.chain = gcp.invoke('xfer:begin', msg.tid, { purpose: msg.purpose, dest, top: msg.top })
            .catch(e => { inc.aborted = true; this.onError(e); });
          this.incoming.set(msg.tid, inc);
          this.onProgress({ tid: msg.tid, dir: 'in', label, done: 0, total: msg.total, state: 'run', purpose: msg.purpose });
          return true;
        }
        case 'fx-file': {
          const inc = this.incoming.get(msg.tid); if (!inc || inc.aborted) return true;
          this.flushWrite(msg.tid, inc);
          inc.chain = inc.chain.then(() => gcp.invoke('xfer:open', msg.tid, msg.rel, msg.dir));
          return true;
        }
        case 'fx-data': {
          const inc = this.incoming.get(msg.tid); if (!inc || inc.aborted) return true;
          const d = msg.d instanceof Uint8Array ? msg.d.slice() : new Uint8Array(msg.d);
          inc.done += d.byteLength;
          inc.pend = inc.pend || []; inc.pendLen = (inc.pendLen || 0) + d.byteLength; inc.pend.push(d);
          if (inc.pendLen >= 1024 * 1024) this.flushWrite(msg.tid, inc);
          const now = performance.now();
          if (now - inc.last > 120) { inc.last = now; this.onProgress({ tid: msg.tid, dir: 'in', label: inc.label, done: inc.done, total: inc.offer.total, state: 'run', purpose: inc.offer.purpose }); }
          return true;
        }
        case 'fx-end': {
          const inc = this.incoming.get(msg.tid); if (!inc) return true;
          this.flushWrite(msg.tid, inc);
          inc.chain.then(() => gcp.invoke('xfer:end', msg.tid, { toClipboard: inc.offer.purpose === 'clip' }))
            .then(paths => {
              this.incoming.delete(msg.tid);
              this.onProgress({ tid: msg.tid, dir: 'in', label: inc.label, done: inc.offer.total, total: inc.offer.total, state: 'done', paths, purpose: inc.offer.purpose });
              this.onDone(inc.offer, paths || []);
            })
            .catch(e => this.onError(e));
          return true;
        }
        case 'fx-abort': {
          const inc = this.incoming.get(msg.tid); if (!inc) return true;
          inc.aborted = true;
          inc.chain.then(() => gcp.invoke('xfer:end', msg.tid, {}));
          this.incoming.delete(msg.tid);
          this.onProgress({ tid: msg.tid, dir: 'in', label: inc.label, done: inc.done, total: inc.offer.total, state: 'error', error: 'Cópia cancelada.', purpose: inc.offer.purpose });
          return true;
        }
        case 'fx-cancel':
          this.cancelled.add(msg.tid);
          return true;
        case 'fx-reject':
          this.cancel(msg.tid);
          this.onError(new Error('O outro computador recusou a transferência de arquivos.'));
          return true;
      }
      return false;
    }
  }

  // Descobre quais codecs o computador codifica por hardware (placa de vídeo)
  async function hardwareCodecs() {
    if (GProto.cachedHw) return GProto.cachedHw;
    const out = {};
    if (!navigator.mediaCapabilities) return out;
    const tests = { H264: 'video/H264', VP9: 'video/VP9', AV1: 'video/AV1', VP8: 'video/VP8' };
    for (const [k, ct] of Object.entries(tests)) {
      try {
        const r = await navigator.mediaCapabilities.encodingInfo({ type: 'webrtc', video: { contentType: ct, width: 1920, height: 1080, bitrate: 6000000, framerate: 30 } });
        out[k] = !!(r.supported && r.powerEfficient);
      } catch (_) { out[k] = false; }
    }
    GProto.cachedHw = out;
    return out;
  }

  // Começa a transmissão já com banda alta e define um piso, para a imagem nascer nítida
  // (o padrão do WebRTC começa em ~300 kb/s e demora segundos para subir).
  function tuneSdp(sdp, { start = 2500, min = 800, max = 20000 } = {}) {
    const lines = sdp.split('\r\n');
    const out = [];
    let inVideo = false;
    const pts = new Set();
    for (const l of lines) { if (l.startsWith('m=')) inVideo = l.startsWith('m=video'); if (inVideo) { const m = l.match(/^a=rtpmap:(\d+) (H264|VP8|VP9|AV1)\//i); if (m) pts.add(m[1]); } }
    const params = `x-google-start-bitrate=${start};x-google-min-bitrate=${min};x-google-max-bitrate=${max}`;
    const withFmtp = new Set();
    for (const l of lines) { const m = l.match(/^a=fmtp:(\d+) /); if (m && pts.has(m[1])) withFmtp.add(m[1]); }
    for (const l of lines) {
      const f = l.match(/^a=fmtp:(\d+) (.*)$/);
      if (f && pts.has(f[1]) && !/x-google-start-bitrate/.test(l)) { out.push(l + ';' + params); continue; }
      out.push(l);
      const r = l.match(/^a=rtpmap:(\d+) /);
      if (r && pts.has(r[1]) && !withFmtp.has(r[1])) out.push(`a=fmtp:${r[1]} ${params}`);
    }
    return out.join('\r\n');
  }

  // Monta os textos da janela de progresso para cada situação
  const xferClock = new Map();
  function progressNotice(p, otherName, side) {
    const now = performance.now();
    let c = xferClock.get(p.tid);
    if (!c) { c = { t0: now, d0: p.done, lastT: now, lastD: p.done, speed: 0 }; xferClock.set(p.tid, c); }
    if (now - c.lastT > 400) { const inst = (p.done - c.lastD) / ((now - c.lastT) / 1000); c.speed = c.speed ? c.speed * 0.6 + inst * 0.4 : inst; c.lastT = now; c.lastD = p.done; }
    const eta = c.speed > 1 && p.total ? (p.total - p.done) / c.speed : 0;
    if (p.state !== 'run') xferClock.delete(p.tid);
    const other = otherName || 'computador remoto';
    let title, doneTitle, doneText;
    if (p.purpose === 'clip' && p.dir === 'in') {
      title = side === 'host' ? `Recebendo para colar aqui (de ${other})` : `Copiando de ${other}`;
      doneTitle = side === 'host' ? 'Colado' : 'Pronto para colar';
      doneText = side === 'host' ? 'Os arquivos foram colados neste computador.' : 'Cole com Ctrl+V em qualquer pasta deste computador.';
    } else if (p.purpose === 'clip') {
      title = `Enviando para colar em ${other}`; doneTitle = 'Colado no computador remoto'; doneText = 'Os arquivos já estão na pasta aberta do outro computador.';
    } else if (p.dir === 'in') {
      title = `Recebendo de ${other}`; doneTitle = 'Arquivos recebidos'; doneText = 'Salvos em Downloads › GCP Remoto.';
    } else {
      title = `Enviando para ${other}`; doneTitle = 'Arquivos enviados'; doneText = 'Transferência concluída.';
    }
    const canDesktop = p.state === 'done' && p.dir === 'in' && side === 'client' && Array.isArray(p.paths) && p.paths.length > 0;
    if (canDesktop && p.purpose === 'clip') doneText = 'Cole com Ctrl+V em qualquer pasta, ou envie direto para a Área de Trabalho.';
    return { dir: p.dir, label: p.label, done: p.done, total: p.total, state: p.state, error: p.error, speed: Math.round(c.speed), eta: Math.round(eta), title, doneTitle, doneText, paths: canDesktop ? p.paths : null, canDesktop };
  }

  root.GProto = { PEER_PREFIX, PROTO_VERSION, sha256hex, makeProof, peerOptions, fmtBytes, formatId, osName, Transfers, hardwareCodecs, tuneSdp, progressNotice, cachedHw: null };
})(window);
