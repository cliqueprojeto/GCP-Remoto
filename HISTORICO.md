# Histórico de versões

## 1.2.0

- Ctrl+C / Ctrl+V direto: arquivos copiados no computador remoto, de qualquer forma (Ctrl+C, botão direito › Copiar, no Explorer, no Dolphin ou na área de trabalho), ficam prontos para colar com Ctrl+V neste computador. Até 1 GB a cópia começa na hora; acima disso, o programa pergunta antes.
- Janela de progresso sempre visível, mesmo fora da sessão: nome, porcentagem, velocidade, tempo restante e botão Cancelar.
- Ao terminar: "Colar na Área de Trabalho" (coloca os arquivos direto na Área de Trabalho, em qualquer sistema) e "Abrir pasta".
- Transferência de arquivos mais leve: canal de dados bruto, leitura antecipada e gravação em lotes.
- Linux com GNOME, Cinnamon e MATE: arquivos copiados no formato que a área de trabalho desses ambientes reconhece.
- Limpar todos os desenhos agora é Ctrl+0.

## 1.1.0

- Desempenho quase em tempo real: exibição sem buffer de espera (jitter buffer zero), codificação de vídeo por hardware (H.264) quando disponível, perfil "Velocidade" que preserva a fluidez quando a rede aperta e transmissão que já começa em resolução cheia.
- Mouse mais rápido e preciso: canal próprio sem fila de reenvio, até 120 atualizações por segundo, e ponteiro local em forma de ponto, que marca exatamente onde o clique cai sem duplicar a seta do outro computador.
- Destaque amarelo do cursor desligado por padrão durante as sessões (pode ser ligado em Apresentação).
- Teste de conexão em Configurações › Conexão: servidor, tipo de rede, aceleração de vídeo e botão "Aplicar recomendações".
- Atualizações pelo GitHub em Configurações › Geral: frequência da verificação, "Verificar agora" e instalação adaptada a cada sistema, com conferência SHA-256.
- Barra da sessão mostra a codificação em uso (por exemplo, H264 HW).

## 1.0.2

- Instalador do Windows em um clique: instala sem perguntas e abre o programa.
- AppImage que se instala sozinho no menu de aplicativos (Internet) e atualiza a cópia instalada ao abrir uma versão mais nova.
- Linux: janelas voltam ao modo nativo do sistema; modo de compatibilidade X11 opcional.
- Wayland: efeitos de cursor locais desativados (o sistema não informa a posição global do cursor), evitando a camada de tela cheia.
- Registro de diagnóstico e recuperação automática da janela principal.

## 1.0.1

- Atualizações aplicadas com o programa aberto na bandeja: o GCP-Remoto percebe que foi atualizado e reinicia sozinho quando não há sessão em andamento.
- Widget de apresentação em janela própria, que nunca cobre a tela; a camada de desenho deixa os cliques passarem e Esc ou o botão direito devolvem o mouse.
- Linux: janelas pelo X11/XWayland, mais estáveis no KDE Plasma e no GNOME.
- Atalhos simples por padrão: Alt+1 a Alt+8 para as ferramentas, Ctrl+0 para limpar, Ctrl+Alt+S/H/C/W para os efeitos.
- Novo ícone, janela "Apoie o projeto" com PIX e Stripe, e versão exibida no menu da bandeja.

## 1.0.0

Primeira versão pública.

- Acesso remoto entre Windows e Linux, nos dois sentidos, por ID de nove dígitos.
- Senha nova a cada sessão, senha fixa opcional para acesso não supervisionado e janela de aceite com escolha de permissões.
- Favoritos com nome personalizado, ícone, cor e senha salva; conexões rápidas na janela e na bandeja; sessões recentes.
- Controle completo de mouse e teclado, com acentos e símbolos em qualquer layout; combinações de teclas; vários monitores; somente visualização.
- Exibição ajustada, original ou esticada; tamanhos de janela; tela cheia; resolução, quadros por segundo e qualidade ajustáveis.
- Desenho ao vivo, destaque do cursor, anéis de clique, holofote e widget flutuante de ferramentas.
- Transferência de arquivos e pastas com Ctrl+C / Ctrl+V, gerenciador lado a lado e arrastar e soltar.
- Chat, área de transferência sincronizada, captura de tela e atalhos personalizáveis.
- Avisos estilizados de sessão iniciada e desconectada.
- Janela "Apoie o projeto" com PIX e Stripe.
- Pacotes: instalador, portátil e zip para Windows; .deb, .rpm, .pkg.tar.zst e AppImage para Linux.
