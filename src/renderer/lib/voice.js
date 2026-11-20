// Conversa por voz durante a sessão (microfone, headset, fone USB/Bluetooth ou interface de áudio),
// nos dois sentidos. WebRTC com cancelamento de eco, redução de ruído e ganho automático, mais
// regulagem de ganho própria e medidor de nível ao vivo.
// Privacidade: cada lado só transmite o próprio microfone depois de ativá-lo; até lá envia silêncio.
(function (root) {
  'use strict';

  let sharedCtx = null;
  function ctx() {
    if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
    return sharedCtx;
  }

  function silentTrack() { return ctx().createMediaStreamDestination().stream.getAudioTracks()[0]; }

  async function rawMic(deviceId) {
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    if (deviceId) audio.deviceId = { exact: deviceId };
    try { return await navigator.mediaDevices.getUserMedia({ audio, video: false }); }
    catch (e) {
      if (deviceId) { delete audio.deviceId; return navigator.mediaDevices.getUserMedia({ audio, video: false }); }
      throw e;
    }
  }

  // Medidor de nível (0..1) a partir de um nó de áudio
  function meter(node, onLevel) {
    const an = ctx().createAnalyser();
    an.fftSize = 512; an.smoothingTimeConstant = 0.3;
    node.connect(an);
    const buf = new Float32Array(an.fftSize);
    // temporizador (e não requestAnimationFrame): funciona com a janela escondida na bandeja
    let peak = 0;
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-8) + 60) / 55)); // -60 dB..-5 dB
      peak = Math.max(level, peak * 0.82);   // queda suave, como um VU
      onLevel(peak);
    }, 50);
    return () => { clearInterval(timer); try { node.disconnect(an); } catch (_) {} };
  }

  // Microfone processado: dispositivo → ganho → medidor → faixa enviada
  async function processedMic(deviceId, gainPct, onLevel) {
    const raw = await rawMic(deviceId);
    const c = ctx();
    const src = c.createMediaStreamSource(raw);
    const gain = c.createGain(); gain.gain.value = (gainPct == null ? 100 : gainPct) / 100;
    const dst = c.createMediaStreamDestination();
    src.connect(gain); gain.connect(dst);
    const stopMeter = onLevel ? meter(gain, onLevel) : () => {};
    const label = (raw.getAudioTracks()[0] || {}).label || '';
    return {
      track: dst.stream.getAudioTracks()[0], stream: dst.stream, label,
      setGain: (pct) => { gain.gain.value = pct / 100; },
      stop: () => { stopMeter(); raw.getTracks().forEach(t => t.stop()); try { src.disconnect(); gain.disconnect(); } catch (_) {} }
    };
  }

  class Voice {
    // opts: { peer, remotePeerId(), token(), audio() => {micId, speakerId, micGain, volume}, onState(state), onLevel(me), onRemoteLevel(level) }
    constructor(opts) {
      this.o = opts;
      this.call = null;
      this.mic = null;
      this.micOn = false;
      this.remoteActive = false;
      this.stopRemoteMeter = null;
      this.el = document.createElement('audio');
      this.el.autoplay = true;
      this.el.style.display = 'none';
      document.body.appendChild(this.el);
    }

    cfg() { return (this.o.audio && this.o.audio()) || {}; }
    state() { return { active: !!this.call, micOn: this.micOn, remoteActive: this.remoteActive, micLabel: this.mic ? this.mic.label : '' }; }
    emit() { try { this.o.onState && this.o.onState(this.state()); } catch (_) {} }

    _outStream() { return this.micOn && this.mic ? this.mic.stream : new MediaStream([silentTrack()]); }

    applyOutput() {
      const a = this.cfg();
      this.el.volume = Math.max(0, Math.min(1, (a.volume == null ? 100 : a.volume) / 100));
      if (this.el.setSinkId) this.el.setSinkId(a.speakerId || '').catch(() => {});
    }

    _wire(call) {
      this.call = call;
      call.on('stream', (remote) => {
        this.el.srcObject = remote;
        this.applyOutput();
        this.el.play().catch(() => {});
        if (this.stopRemoteMeter) this.stopRemoteMeter();
        try { this.stopRemoteMeter = meter(ctx().createMediaStreamSource(remote), (l) => this.o.onRemoteLevel && this.o.onRemoteLevel(l)); } catch (_) {}
        this.remoteActive = true;
        this.emit();
      });
      call.on('close', () => { if (this.call === call) this._closed(); });
      call.on('error', () => {});
      this.emit();
    }

    _closed() {
      this.call = null; this.remoteActive = false;
      if (this.stopRemoteMeter) { this.stopRemoteMeter(); this.stopRemoteMeter = null; }
      this._stopMic();
      this.el.srcObject = null;
      this.emit();
    }

    async start() {
      if (this.call) return;
      const call = this.o.peer.call(this.o.remotePeerId(), this._outStream(), { metadata: { token: this.o.token(), kind: 'voice' } });
      this._wire(call);
    }

    async answer(call) {
      if (this.call) { try { this.call.close(); } catch (_) {} }
      call.answer(this._outStream());
      this._wire(call);
    }

    async setMic(on) {
      if (on) {
        const a = this.cfg();
        this._stopMic();
        this.mic = await processedMic(a.micId || '', a.micGain, (l) => this.o.onLevel && this.o.onLevel(l));
        this.micOn = true;
        if (!this.call) await this.start(); else await this._replace(this.mic.track);
      } else {
        if (this.call) await this._replace(silentTrack());
        this._stopMic();
        if (this.o.onLevel) this.o.onLevel(0);
      }
      this.emit();
    }

    toggleMic() { return this.setMic(!this.micOn); }
    setGain(pct) { if (this.mic) this.mic.setGain(pct); }

    // Troca de dispositivo (ex.: headset USB conectado) sem derrubar a conversa
    async refreshDevice() { if (this.micOn) await this.setMic(true); this.applyOutput(); }

    async _replace(track) {
      const pc = this.call && this.call.peerConnection; if (!pc) return;
      const sender = pc.getSenders().find(s => (s.track ? s.track.kind === 'audio' : true));
      if (sender) await sender.replaceTrack(track);
    }

    _stopMic() { if (this.mic) this.mic.stop(); this.mic = null; this.micOn = false; }

    end() { try { this.call && this.call.close(); } catch (_) {} this._closed(); }
  }

  async function listDevices() {
    let devs = await navigator.mediaDevices.enumerateDevices();
    if (devs.some(d => d.kind === 'audioinput' && !d.label)) {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); devs = await navigator.mediaDevices.enumerateDevices(); } catch (_) {}
    }
    const nice = (d, fb) => (d.label || fb).replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
    return {
      inputs: devs.filter(d => d.kind === 'audioinput').map(d => ({ id: d.deviceId === 'default' ? '' : d.deviceId, label: d.deviceId === 'default' ? `Padrão do sistema — ${nice(d, 'microfone')}` : nice(d, 'Microfone') })),
      outputs: devs.filter(d => d.kind === 'audiooutput').map(d => ({ id: d.deviceId === 'default' ? '' : d.deviceId, label: d.deviceId === 'default' ? `Padrão do sistema — ${nice(d, 'alto-falante')}` : nice(d, 'Alto-falante') }))
    };
  }

  // Avisa quando um fone/headset/interface é conectado ou removido (USB, Bluetooth, P2)
  function watchDevices(onChange) {
    let prev = null;
    const run = async () => {
      const d = await listDevices().catch(() => null); if (!d) return;
      const ids = new Set([...d.inputs, ...d.outputs].map(x => x.id + x.label));
      if (prev) {
        const added = [...d.inputs, ...d.outputs].filter(x => !prev.has(x.id + x.label));
        const removed = [...prev].filter(k => !ids.has(k));
        onChange(d, added, removed.length);
      }
      prev = ids;
    };
    run();
    navigator.mediaDevices.addEventListener('devicechange', run);
    return () => navigator.mediaDevices.removeEventListener('devicechange', run);
  }

  // Teste de alto-falante: um som curto no dispositivo escolhido
  async function testSpeaker(speakerId, volume) {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const dst = c.createMediaStreamDestination();
    [523, 659, 784].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f;
      const t = c.currentTime + i * 0.18;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g).connect(dst); o.start(t); o.stop(t + 0.45);
    });
    const el = new Audio(); el.srcObject = dst.stream; el.volume = (volume == null ? 100 : volume) / 100;
    if (speakerId && el.setSinkId) await el.setSinkId(speakerId).catch(() => {});
    await el.play().catch(() => {});
    setTimeout(() => { el.srcObject = null; c.close(); }, 1200);
  }

  root.GVoice = { Voice, listDevices, watchDevices, processedMic, testSpeaker, meter };
})(window);
