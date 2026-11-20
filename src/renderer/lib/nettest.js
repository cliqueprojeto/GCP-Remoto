// Teste de conexão: servidor, tipo de rede (NAT), aceleração de vídeo e recomendações.
(function (root) {
  'use strict';

  function withTimeout(p, ms, fallback) {
    return Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms))]);
  }

  // Tempo para entrar no servidor de localização (sinalização)
  function testServer(settings) {
    return withTimeout(new Promise((resolve) => {
      const t0 = performance.now();
      let peer;
      try { peer = new Peer(GProto.peerOptions(settings)); } catch (e) { return resolve({ ok: false, error: e.message }); }
      peer.on('open', () => { const ms = Math.round(performance.now() - t0); peer.destroy(); resolve({ ok: true, ms }); });
      peer.on('error', (e) => { try { peer.destroy(); } catch (_) {} resolve({ ok: false, error: e.type || e.message }); });
    }), 12000, { ok: false, error: 'tempo esgotado' });
  }

  // Endereço público visto por um servidor STUN
  function stunMapping(url) {
    return withTimeout(new Promise((resolve) => {
      const t0 = performance.now();
      const pc = new RTCPeerConnection({ iceServers: [{ urls: url }] });
      pc.createDataChannel('t');
      const found = { host: false, srflx: null };
      pc.onicecandidate = (e) => {
        if (!e.candidate) { pc.close(); resolve(found); return; }
        const c = e.candidate;
        if (c.type === 'host') found.host = true;
        if (c.type === 'srflx' && !found.srflx) found.srflx = { ip: c.address, port: c.port, ms: Math.round(performance.now() - t0) };
      };
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => resolve(found));
    }), 6000, { host: false, srflx: null });
  }

  function testTurn(turn) {
    if (!turn || !turn.urls) return Promise.resolve(null);
    return withTimeout(new Promise((resolve) => {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: turn.urls.split(/[,\s]+/).filter(Boolean), username: turn.username, credential: turn.credential }], iceTransportPolicy: 'relay' });
      pc.createDataChannel('t');
      let ok = false;
      pc.onicecandidate = (e) => { if (e.candidate && e.candidate.type === 'relay') ok = true; if (!e.candidate) { pc.close(); resolve(ok); } };
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => resolve(false));
    }), 8000, false);
  }

  async function run(settings, onStep) {
    const r = {};
    onStep && onStep('Conectando ao servidor…');
    r.server = await testServer(settings);
    onStep && onStep('Verificando o tipo de rede…');
    const [a, b] = await Promise.all([stunMapping('stun:stun.l.google.com:19302'), stunMapping('stun:stun.cloudflare.com:3478')]);
    r.stunMs = (a.srflx && a.srflx.ms) || (b.srflx && b.srflx.ms) || null;
    r.publicIp = (a.srflx && a.srflx.ip) || (b.srflx && b.srflx.ip) || null;
    if (!a.srflx && !b.srflx) r.nat = 'bloqueada';
    else if (a.srflx && b.srflx && a.srflx.port !== b.srflx.port) r.nat = 'restrita';
    else r.nat = 'aberta';
    r.turn = await testTurn(settings.turn);
    onStep && onStep('Verificando a aceleração de vídeo…');
    r.hw = await GProto.hardwareCodecs().catch(() => ({}));
    r.cores = navigator.hardwareConcurrency || 2;
    r.screen = { w: Math.round(screen.width * devicePixelRatio), h: Math.round(screen.height * devicePixelRatio) };

    // ---- Recomendações ----
    const rec = { profile: 'speed', codec: 'auto', pointer: 'dot', quality: 'high', fps: 30, resolution: 'auto' };
    const hw = r.hw.H264 || r.hw.VP9 || r.hw.AV1;
    if (hw && r.cores >= 4) rec.fps = 60;
    if (!hw && r.cores < 4) { rec.fps = 24; rec.quality = 'medium'; }
    if (r.screen.w > 1920) rec.resolution = '1920x1080';
    if (r.server.ok && r.server.ms > 1200) { rec.quality = 'medium'; rec.fps = Math.min(rec.fps, 30); }
    r.rec = rec;
    return r;
  }

  root.GNetTest = { run };
})(window);
