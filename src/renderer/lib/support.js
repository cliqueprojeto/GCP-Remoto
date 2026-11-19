// Janela "Apoie o projeto" (PIX e Stripe). O apoio é voluntário.
(function (root) {
  'use strict';
  const { icon, toast } = GUI;
  let info = null;

  async function open() {
    if (document.querySelector('.support-back')) return;
    if (!info) info = await gcp.invoke('support:info');
    const back = document.createElement('div');
    back.className = 'modal-back support-back';
    back.innerHTML = `
      <div class="support" role="dialog" aria-modal="true" aria-label="Apoie o projeto">
        <button class="icon-btn sp-close" title="Fechar">${icon('x')}</button>
        <h2>Apoie o projeto</h2>
        <p class="sp-sub">Sua contribuição ajuda a manter o GCP-Remoto aberto, gratuito e em evolução.</p>
        <div class="sp-dev">
          <img src="assets/logo.svg" alt="">
          <div><b>Desenvolvido por Bruno Albertini</b><a href="#" id="sp-site">Gestão Cultural Pro ${icon('arrow')}</a></div>
        </div>
        <div class="sp-grid">
          <section class="sp-card">
            <h4>PIX · Brasil</h4>
            <div class="sp-qr"><img src="${info.qr}" alt="QR Code PIX"></div>
            <small>Escaneie com o aplicativo do seu banco.</small>
            <button class="btn primary sp-wide" id="sp-copy-pix">${icon('copy')}Copiar PIX</button>
            <details><summary>Ver código PIX</summary><code>${GUI.esc(info.pix)}</code></details>
          </section>
          <section class="sp-card">
            <h4>Stripe · Internacional</h4>
            <div class="sp-heart">${icon('heart')}</div>
            <h3>Faça parte dessa construção</h3>
            <small>Contribua com qualquer valor pelo checkout seguro do Stripe.</small>
            <button class="btn sp-wide" id="sp-stripe">Contribuir via Stripe ${icon('arrow')}</button>
            <button class="sp-link" id="sp-copy-stripe">${icon('copy')}Copiar link do Stripe</button>
            <small class="sp-note">O apoio é voluntário. Todas as funções do aplicativo estão disponíveis sem contribuição.</small>
          </section>
        </div>
      </div>`;
    const close = () => { back.classList.remove('show'); setTimeout(() => back.remove(), 180); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.querySelector('.sp-close').onclick = close;
    back.querySelector('#sp-site').onclick = (e) => { e.preventDefault(); gcp.invoke('app:open-external', info.site); };
    back.querySelector('#sp-stripe').onclick = () => gcp.invoke('app:open-external', info.stripe);
    back.querySelector('#sp-copy-pix').onclick = () => { gcp.invoke('clipboard:write', info.pix); toast('Código PIX copiado. Cole no app do seu banco (PIX Copia e Cola).', 'ok'); };
    back.querySelector('#sp-copy-stripe').onclick = () => { gcp.invoke('clipboard:write', info.stripe); toast('Link do Stripe copiado.', 'ok'); };
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));
  }

  root.GSupport = { open };
})(window);
