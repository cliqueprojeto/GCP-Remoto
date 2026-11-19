// Telas de configurações e de efeitos (usadas na janela principal).
(function (root) {
  'use strict';
  const { esc, icon, prettyCombo, comboFromEvent, toast, modal } = GUI;

  const SHORTCUT_GROUPS = [
    ['Sessão', {
      fullscreen: ['Tela cheia', 'Entra e sai da tela cheia na sessão'],
      toolbar: ['Mostrar / ocultar barra', 'Recolhe a barra de ferramentas da sessão'],
      drawMode: ['Modo desenho', 'Liga e desliga o desenho na tela remota'],
      viewOnly: ['Somente visualizar', 'Bloqueia o envio de mouse e teclado'],
      screenshot: ['Capturar tela', 'Salva uma imagem da tela remota'],
      chat: ['Chat', 'Abre o chat da sessão'],
      fileBrowser: ['Arquivos', 'Abre o gerenciador de transferência'],
      nextMonitor: ['Próximo monitor', 'Alterna entre os monitores remotos'],
      fitMode: ['Ajustar à janela', ''],
      originalMode: ['Tamanho original (1:1)', ''],
      stretchMode: ['Esticar', ''],
      sendCtrlAltDel: ['Enviar Ctrl+Alt+Del', 'Envia a combinação ao computador remoto'],
      disconnect: ['Desconectar', 'Encerra a sessão']
    }],
    ['Ferramentas', {
      toolPointer: ['Cursor (interagir com a tela)', ''],
      toolPen: ['Caneta', ''],
      toolMarker: ['Marca-texto', ''],
      toolArrow: ['Seta', ''],
      toolLine: ['Linha', ''],
      toolRect: ['Retângulo', ''],
      toolEllipse: ['Elipse', ''],
      toolText: ['Texto', ''],
      clearDrawings: ['Limpar todos os desenhos', ''],
      undoDrawing: ['Desfazer', ''],
      redoDrawing: ['Refazer', '']
    }],
    ['Efeitos do mouse', {
      spotlight: ['Holofote', ''],
      cursorHighlight: ['Destaque do cursor', ''],
      clickEffect: ['Efeito de clique', ''],
      presenterWidget: ['Widget de ferramentas', 'Mostra ou oculta o widget flutuante']
    }]
  ];
  const SHORTCUT_LABELS = Object.assign({}, ...SHORTCUT_GROUPS.map(g => g[1]));

  function row(title, sub, ctlHtml) {
    return `<div class="srow"><div class="s-text"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div><div class="s-ctl">${ctlHtml}</div></div>`;
  }
  const toggle = (key, on) => `<label class="switch"><input type="checkbox" data-k="${key}" ${on ? 'checked' : ''}><span></span></label>`;
  const range = (key, v, min, max, unit = '', step = 1) => `<input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${v}" style="--p:${((v - min) / (max - min)) * 100}%"><span class="val" data-val="${key}">${v}${unit}</span>`;
  const color = (key, v) => `<label class="swatch" style="background:${v}"><input type="color" data-k="${key}" value="${v}"></label>`;
  const select = (key, v, opts) => `<select class="input" data-k="${key}">${opts.map(([val, lab]) => `<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  const text = (key, v, ph = '', type = 'text') => `<input class="input" type="${type}" data-k="${key}" value="${esc(v ?? '')}" placeholder="${esc(ph)}">`;

  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj); }

  // Liga os controles [data-k] a um callback (caminho, valor)
  function bind(container, onChange) {
    container.querySelectorAll('[data-k]').forEach(el => {
      const key = el.dataset.k;
      const unit = (el.nextElementSibling && el.nextElementSibling.dataset.val) ? el.nextElementSibling.textContent.replace(/[\d.\-]+/, '') : '';
      const evt = el.type === 'range' || el.type === 'color' ? 'input' : 'change';
      el.addEventListener(evt, () => {
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'range' || el.type === 'number') v = Number(v);
        if (el.type === 'range') {
          el.style.setProperty('--p', ((v - el.min) / (el.max - el.min)) * 100 + '%');
          const lab = container.querySelector(`[data-val="${key}"]`); if (lab) lab.textContent = v + unit;
        }
        if (el.type === 'color') el.parentElement.style.background = v;
        onChange(key, v, el);
      });
    });
  }

  // ---------- Efeitos ----------
  async function renderEffects(el) {
    const fx = await gcp.invoke('effects:get');
    el.innerHTML = `
      <div class="sgroup">Mouse</div>
      ${row('Efeito de clique', 'Anel animado a cada clique do mouse.', toggle('clicks.on', fx.clicks.on))}
      ${row('Cores do clique', '', `<span class="muted">Esquerdo</span>${color('clicks.left', fx.clicks.left)}<span class="muted">Direito</span>${color('clicks.right', fx.clicks.right)}`)}
      ${row('Tamanho do clique', '', range('clicks.size', fx.clicks.size, 16, 90, ' px'))}
      ${row('Destaque do cursor', 'Círculo colorido que acompanha o ponteiro.', toggle('cursor.on', fx.cursor.on))}
      ${row('Cor do destaque', '', color('cursor.color', fx.cursor.color))}
      ${row('Tamanho do destaque', '', range('cursor.size', fx.cursor.size, 14, 90, ' px'))}
      ${row('Opacidade do destaque', '', range('cursor.opacity', fx.cursor.opacity, 10, 90, '%'))}
      ${row('Holofote', 'Escurece a tela e mantém iluminada a área ao redor do ponteiro.', toggle('spotlight.on', fx.spotlight.on))}
      ${row('Raio do holofote', '', range('spotlight.radius', fx.spotlight.radius, 60, 400, ' px'))}
      ${row('Escurecimento', '', range('spotlight.dim', fx.spotlight.dim, 20, 90, '%'))}
      <div class="sgroup">Widget e sessão</div>
      ${row('Widget de ferramentas', 'Barra flutuante (recolhida ou expandida) para desenhar na tela. Arraste para qualquer lugar.', toggle('widget.on', fx.widget.on))}
      ${row('Efeitos durante sessões remotas', 'Mostra os efeitos do mouse automaticamente quando alguém acessa este computador.', toggle('showDuringSession', fx.showDuringSession))}
      ${row('Aviso de sessão ativa', 'Exibe um selo discreto “sessão remota ativa” na tela acessada.', toggle('sessionBanner', fx.sessionBanner))}
    `;
    bind(el, (key, v) => {
      const [a, b] = key.split('.');
      gcp.invoke('effects:set', b ? { [a]: { [b]: v } } : { [a]: v });
    });
  }

  // ---------- Configurações ----------
  async function renderSettings(tab, el, ctx) {
    const st = await gcp.invoke('settings:get');
    const info = await gcp.invoke('app:info');
    const save = (key, value) => gcp.invoke('settings:set', key, value);
    let html = '';
    switch (tab) {
      case 'general':
        html = `
          ${row('Nome deste computador', 'Como você aparece para quem conecta.', text('displayName', st.displayName))}
          ${row('Iniciar com o sistema', 'Fica disponível para acesso assim que o computador liga.', toggle('general.startWithSystem', st.general.startWithSystem))}
          ${row('Iniciar minimizado', 'Abre direto na bandeja do sistema.', toggle('general.startMinimized', st.general.startMinimized))}
          ${row('Fechar para a bandeja', 'Continua recebendo conexões com a janela fechada.', toggle('general.closeToTray', st.general.closeToTray))}
          ${row('Pasta de arquivos recebidos', st.general.downloadDir || 'Downloads/GCP Remoto', `<button class="btn sm" id="pick-dir">${icon('folder')}Escolher</button>`)}
          ${row('Ao conectar, exibir', 'Modo padrão da tela remota.', select('session.viewMode', st.session.viewMode, [['fit', 'Ajustar à janela'], ['original', 'Tamanho original'], ['stretch', 'Esticar']]))}
          ${row('Sincronizar área de transferência', 'Copiar e colar texto entre os computadores.', toggle('session.syncClipboard', st.session.syncClipboard))}`;
        break;
      case 'security':
        html = `
          <div class="sgroup">Senhas</div>
          ${row('Senha fixa (acesso não supervisionado)', st.security.hasPermanent ? 'Definida. Permite acessar sem ninguém na frente deste computador.' : 'Não definida.', `<button class="btn sm" id="set-perm">${icon('lock')}${st.security.hasPermanent ? 'Alterar' : 'Definir'}</button>${st.security.hasPermanent ? `<button class="btn sm danger" id="del-perm">Remover</button>` : ''}`)}
          ${row('Tamanho da senha de sessão', 'Senha aleatória exibida na tela inicial.', range('security.sessionPasswordLength', st.security.sessionPasswordLength, 6, 16, ' car.'))}
          ${row('Nova senha após cada sessão', 'Gera outra senha sempre que uma sessão termina.', toggle('security.regenerateAfterSession', st.security.regenerateAfterSession))}
          ${row('Pedir confirmação mesmo com senha', 'Exibe a janela de aceite mesmo quando a senha está correta.', toggle('security.askEvenWithPassword', st.security.askEvenWithPassword))}
          <div class="sgroup">Permissões padrão de quem acessa</div>
          ${row('Controlar mouse e teclado', '', toggle('security.allowControl', st.security.allowControl))}
          ${row('Transferir arquivos', '', toggle('security.allowFileTransfer', st.security.allowFileTransfer))}
          ${row('Área de transferência', '', toggle('security.allowClipboard', st.security.allowClipboard))}
          ${row('Desenhar na tela e usar efeitos', '', toggle('security.allowDrawing', st.security.allowDrawing))}
          <div class="sgroup">Identidade</div>
          ${row('Gerar novo ID', 'Troca o número deste computador. Quem tem o ID antigo salvo perde o acesso.', `<button class="btn sm danger" id="new-id">${icon('refresh')}Gerar novo ID</button>`)}`;
        break;
      case 'video':
        html = `
          ${row('Resolução transmitida', 'Limite da resolução enviada por este computador e padrão ao acessar outros.', select('session.resolution', st.session.resolution, [['auto', 'Automática (nativa)'], ['3840x2160', '3840 × 2160 (4K)'], ['2560x1440', '2560 × 1440'], ['1920x1080', '1920 × 1080 (Full HD)'], ['1600x900', '1600 × 900'], ['1366x768', '1366 × 768'], ['1280x720', '1280 × 720 (HD)'], ['1024x576', '1024 × 576']]))}
          ${row('Quadros por segundo', '', select('session.fps', st.session.fps, [[15, '15 fps (economia)'], [24, '24 fps'], [30, '30 fps (recomendado)'], [60, '60 fps (fluido)']]))}
          ${row('Qualidade', 'Mais qualidade usa mais internet.', select('session.quality', st.session.quality, [['low', 'Baixa — conexões lentas'], ['medium', 'Equilibrada'], ['high', 'Alta'], ['max', 'Máxima — rede local']]))}`;
        break;
      case 'connection':
        html = `
          <div class="sgroup">Servidor de localização (sinalização)</div>
          ${row('Endereço', 'Por padrão usa o servidor público gratuito. Você pode hospedar o seu (pasta server/ do projeto).', text('server.host', st.server.host, '0.peerjs.com'))}
          ${row('Porta', '', `<input class="input" style="width:120px" type="number" data-k="server.port" value="${st.server.port}">`)}
          ${row('Caminho', '', text('server.path', st.server.path, '/'))}
          ${row('Chave', '', text('server.key', st.server.key, 'peerjs'))}
          ${row('Conexão segura (TLS)', '', toggle('server.secure', st.server.secure))}
          ${row('Restaurar padrão', '', `<button class="btn sm" id="srv-default">${icon('refresh')}Servidor público</button>`)}
          <div class="sgroup">Retransmissão TURN (redes restritas)</div>
          ${row('URL(s) TURN', 'Ex.: turn:meuservidor.com:3478 — necessário apenas em redes muito fechadas.', text('turn.urls', st.turn.urls, 'turn:host:3478'))}
          ${row('Usuário', '', text('turn.username', st.turn.username))}
          ${row('Senha', '', text('turn.credential', st.turn.credential, '', 'password'))}`;
        break;
      case 'shortcuts':
        html = `<p class="sc-note">Na janela da sessão, os atalhos valem enquanto ela estiver em foco. As ferramentas e os efeitos também funcionam neste computador enquanto o widget de apresentação estiver aberto. Clique no atalho e pressione a nova combinação; Esc cancela.</p>` +
          SHORTCUT_GROUPS.map(([g, items]) => `<div class="sgroup">${esc(g)}</div>` + Object.keys(items).map(k => row(items[k][0], items[k][1], `<div class="sc-wrap"><button class="sc-key" data-sc="${k}">${prettyCombo(st.shortcuts[k])}</button><button class="sc-clear" data-clear="${k}" title="Limpar atalho">${icon('backspace')}</button></div>`)).join('')).join('') +
          `<div class="sc-reset-row"><button class="btn" id="sc-reset">${icon('refresh')}Restaurar atalhos padrão</button></div>`;
        break;
      case 'about':
        html = `
          <div class="about">
            <img src="assets/logo.svg" alt="">
            <div>
              <h2>GCP Remoto ${esc(info.version)}</h2>
              <p>Acesso remoto gratuito e livre · GPL-3.0-or-later</p>
              <p>Desenvolvido por <b>Bruno Albertini | Gestão Cultural Pro</b></p>
              <p>Sistema: ${esc(info.osLabel)} · Controle: ${esc(info.input.backend || 'indisponível')}${info.wayland ? ' (Wayland via portal do sistema)' : ''}</p>
              <p>Conexão ponto a ponto criptografada (WebRTC · DTLS/SRTP).</p>
            </div>
          </div>
          ${row('Código-fonte', 'github.com/cliqueprojeto/GCP-Remoto', `<button class="btn sm" id="open-gh">${icon('globe')}Abrir</button>`)}
          ${row('Gestão Cultural Pro', 'gestaoculturalpro.com.br', `<button class="btn sm ghost" id="open-support">${icon('heart')}Apoie o projeto</button>`)}`;
        break;
    }
    el.innerHTML = html;

    bind(el, (key, v) => {
      if (key === 'displayName') return save('displayName', v).then(() => ctx && ctx.refresh && ctx.refresh());
      const [a, b] = key.split('.');
      save(a, { [b]: v });
    });

    const $ = (s) => el.querySelector(s);
    if ($('#pick-dir')) $('#pick-dir').onclick = async () => { const d = await gcp.invoke('file:choose-dir'); if (d) { await save('general', { downloadDir: d }); renderSettings(tab, el, ctx); } };
    if ($('#set-perm')) $('#set-perm').onclick = async () => {
      const pw = await modal({
        title: 'Senha fixa de acesso',
        body: `<p>Com esta senha você acessa este computador a qualquer momento, sem ninguém precisar aceitar. Use uma senha forte.</p>
          <div class="field"><label>Nova senha</label><input class="input" type="password" id="p1" minlength="8"></div>
          <div class="field"><label>Repita a senha</label><input class="input" type="password" id="p2"></div>`,
        actions: [{ label: 'Cancelar', value: null }, { label: 'Salvar', kind: 'primary', keepOpen: true, get: (b) => {
          const p1 = b.querySelector('#p1').value, p2 = b.querySelector('#p2').value;
          if (p1.length < 8) { toast('Use pelo menos 8 caracteres.', 'error'); return false; }
          if (p1 !== p2) { toast('As senhas não conferem.', 'error'); return false; }
          return p1;
        } }]
      });
      if (pw) { await gcp.invoke('settings:permanent-password', pw); toast('Senha fixa definida.', 'ok'); renderSettings(tab, el, ctx); ctx && ctx.refresh && ctx.refresh(); }
    };
    if ($('#del-perm')) $('#del-perm').onclick = async () => { await gcp.invoke('settings:permanent-password', ''); toast('Senha fixa removida.', 'ok'); renderSettings(tab, el, ctx); ctx && ctx.refresh && ctx.refresh(); };
    if ($('#new-id')) $('#new-id').onclick = async () => {
      const ok = await modal({ title: 'Gerar novo ID?', body: '<p>Quem tem o ID atual salvo deixará de encontrar este computador.</p>', actions: [{ label: 'Cancelar', value: false }, { label: 'Gerar novo ID', kind: 'danger', value: true }] });
      if (ok) { await gcp.invoke('settings:new-device-id'); location.reload(); }
    };
    if ($('#srv-default')) $('#srv-default').onclick = async () => { await save('server', { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' }); renderSettings(tab, el, ctx); };
    if ($('#open-gh')) $('#open-gh').onclick = () => gcp.invoke('app:open-external', 'https://github.com/cliqueprojeto/GCP-Remoto');
    if ($('#open-support')) $('#open-support').onclick = () => GSupport.open();
    if ($('#sc-reset')) $('#sc-reset').onclick = async () => { await save('shortcuts', st.defaultShortcuts); renderSettings(tab, el, ctx); };

    el.querySelectorAll('[data-clear]').forEach(btn => btn.onclick = async () => {
      st.shortcuts[btn.dataset.clear] = '';
      await save('shortcuts', st.shortcuts);
      renderSettings(tab, el, ctx);
    });
    el.querySelectorAll('[data-sc]').forEach(btn => {
      btn.onclick = () => {
        el.querySelectorAll('.sc-key.listening').forEach(b => b.classList.remove('listening'));
        btn.classList.add('listening');
        btn.textContent = 'Pressione as teclas…';
        const onKey = async (e) => {
          e.preventDefault(); e.stopPropagation();
          const k = btn.dataset.sc;
          if (e.key === 'Escape') { finish(st.shortcuts[k]); return; }
          if (e.key === 'Backspace') { st.shortcuts[k] = ''; await save('shortcuts', st.shortcuts); finish(''); return; }
          const combo = comboFromEvent(e);
          if (!combo) return;
          if (!/^(Ctrl|Alt|Super)\+/.test(combo) && !/^F\d+$/.test(combo)) { toast('Use Ctrl, Alt ou Super na combinação (ou uma tecla F).', 'error'); return; }
          const dup = Object.keys(st.shortcuts).find(x => x !== k && st.shortcuts[x] === combo);
          if (dup) toast(`Atalho movido de “${SHORTCUT_LABELS[dup][0]}”.`, 'info');
          if (dup) st.shortcuts[dup] = '';
          st.shortcuts[k] = combo;
          await save('shortcuts', st.shortcuts);
          renderSettings(tab, el, ctx);
          document.removeEventListener('keydown', onKey, true);
        };
        const finish = (c) => { btn.classList.remove('listening'); btn.innerHTML = prettyCombo(c); document.removeEventListener('keydown', onKey, true); };
        document.addEventListener('keydown', onKey, true);
      };
    });
  }

  root.GSettings = { renderSettings, renderEffects, SHORTCUT_LABELS };
})(window);
