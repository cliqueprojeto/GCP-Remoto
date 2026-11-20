# GCP-Remoto

## Novidades 1.0.1

- **Atualizar ficou automático:** instale a versão nova por cima e o GCP-Remoto, mesmo aberto na bandeja, reinicia sozinho quando não houver sessão em andamento.
- **Widget de apresentação em janela própria,** que nunca cobre a tela; Esc ou o botão direito sempre devolvem o mouse.
- **Atalhos simples:** Alt+1 a Alt+8 para as ferramentas de desenho e Ctrl+Alt+S/H/C/W para os efeitos do mouse.

Na versão 1.0.0: acesso remoto entre Windows e Linux nos dois sentidos, desenho ao vivo, arquivos com Ctrl+C / Ctrl+V e pacote para Arch, BigLinux e Manjaro. Veja o [histórico de versões](HISTORICO.md).

**Acesso remoto gratuito, livre e completo, com interface em português.**

O GCP-Remoto reúne num só programa o que se espera de uma ferramenta profissional de suporte e acesso remoto: controle total do mouse e do teclado, senha nova a cada sessão, acesso não supervisionado, favoritos com nome personalizado, transferência de arquivos, chat e ferramentas de apresentação para explicar e ensinar na tela da outra pessoa. Sem cadastro, sem anúncios e sem limite de tempo. Tudo vem dentro do próprio instalador.

Desenvolvido por **Bruno Albertini | [Gestão Cultural Pro](https://gestaoculturalpro.com.br/)**.

![Página inicial do GCP-Remoto](docs/screenshots/01-inicio.png)

## Telas

Capturas do aplicativo em tema escuro.

| | |
|---|---|
| ![Sessão remota com desenho ao vivo](docs/screenshots/02-sessao.png)<br>**Sessão** — controle total e desenho ao vivo na tela remota | ![Pedido de acesso](docs/screenshots/03-pedido-acesso.png)<br>**Pedido de acesso** — aceitar ou recusar, escolhendo as permissões |
| ![Transferência de arquivos](docs/screenshots/04-arquivos.png)<br>**Arquivos** — os dois computadores lado a lado, Ctrl+C / Ctrl+V | ![Exibição](docs/screenshots/05-exibicao.png)<br>**Exibição** — ajustar, tamanho original, esticar, tamanhos de janela e tela cheia |
| ![Widget de ferramentas](docs/screenshots/06-widget.png)<br>**Apresentação** — widget expandido e efeitos visíveis para todos | ![Favoritos](docs/screenshots/07-favoritos.png)<br>**Favoritos** — nome personalizado, ícone, cor e senha salva |
| ![Efeitos do mouse](docs/screenshots/08-apresentacao.png)<br>**Efeitos do mouse** — clique, destaque do cursor e holofote | ![Atalhos](docs/screenshots/09-atalhos.png)<br>**Atalhos** — todas as ações da sessão com teclas personalizadas |
| ![Apoie o projeto](docs/screenshots/10-apoie.png)<br>**Apoie o projeto** — PIX e Stripe, sempre voluntário | ![Sessão desconectada](docs/screenshots/11-desconectado.png)<br>**Avisos** — sessão iniciada e desconectada, com duração |

## Baixar

Baixe a versão mais recente na página de [versões publicadas](https://github.com/cliqueprojeto/GCP-Remoto/releases/latest):

- **GCP-Remoto-Instalador-x.y.z-x64.exe** — instala no Windows 10 e 11 (64 bits) e cria atalhos na área de trabalho e no menu Iniciar.
- **GCP-Remoto-Portatil-x.y.z-x64.exe** — roda sem instalar, por exemplo a partir de um pendrive. As configurações e os favoritos ficam numa pasta ao lado do executável.
- **GCP-Remoto-x.y.z-win-x64.zip** — a mesma versão portátil em uma pasta compactada: descompacte e abra `GCP Remoto.exe`.
- **GCP-Remoto-x.y.z-linux-amd64.deb** — Ubuntu/Debian de 64 bits: instale pelo gerenciador de aplicativos ou com `sudo apt install ./GCP-Remoto-x.y.z-linux-amd64.deb`.
- **GCP-Remoto-x.y.z-linux-x86_64.rpm** — Fedora e distribuições compatíveis: `sudo dnf install ./GCP-Remoto-x.y.z-linux-x86_64.rpm`.
- **gcp-remoto-x.y.z-1-x86_64.pkg.tar.zst** — Arch Linux, BigLinux e Manjaro: instale com `sudo pacman -U ./nome-do-pacote.pkg.tar.zst` ou pelo Pamac em **Instalar pacotes locais**. Para atualizar, instale o pacote da versão nova da mesma forma; se o programa estiver aberto na bandeja, ele reinicia sozinho na versão nova.
- **GCP-Remoto-x.y.z-linux-x86_64.AppImage** — versão portátil Linux: marque o arquivo como executável (`chmod +x arquivo.AppImage`) e abra. Requer FUSE 2; sem FUSE, extraia com `./arquivo.AppImage --appimage-extract` e execute `squashfs-root/AppRun`.

Como o instalador ainda não tem assinatura digital de código, o Windows pode mostrar "O Windows protegeu o computador". Clique em **Mais informações** e depois em **Executar assim mesmo**.

No Linux, o aplicativo aparece em **Internet**. Nenhum programa extra precisa ser instalado: o controle de mouse e teclado, a captura de tela e a digitação com acentos já vêm no pacote.

**Linux com Wayland (BigLinux com KDE Plasma 6, GNOME):** o GCP-Remoto usa o portal do próprio sistema para compartilhar a tela e controlar mouse e teclado. Na primeira sessão, o sistema mostra uma janela pedindo permissão; escolha a tela e confirme. A permissão é lembrada nas próximas vezes.

## Como usar

1. Instale o GCP-Remoto nos dois computadores.
2. No computador que será acessado, a tela inicial mostra o **ID** (nove dígitos) e a **senha desta sessão**.
3. No outro computador, digite o ID e clique em **Conectar**. Informe a senha, ou clique em **Pedir para aceitar** para que a pessoa libere o acesso pela janela de aceite.
4. Marque **Salvar nos favoritos** e dê um nome ao computador: da próxima vez, é só um clique nas **Conexões rápidas**.

## O que ele faz

### Conectar com segurança
- ID fixo de nove dígitos para cada computador e **senha nova gerada a cada sessão**.
- **Senha fixa opcional** para acesso não supervisionado, quando não há ninguém na frente do computador.
- **Janela de aceite destacada** no computador acessado, sempre por cima das outras janelas: mostra quem está pedindo e o sistema usado, permite escolher as permissões (controle, arquivos, área de transferência e desenho) e recusa sozinha se ninguém responder.
- Avisos estilizados de **sessão iniciada** e **sessão desconectada**, com o nome de quem estava conectado e a duração.
- Faixa de **sessão ativa** na janela principal, com controle e arquivos liberados ou bloqueados a qualquer momento, chat e botão para encerrar.
- A senha nunca trafega pela rede: a verificação usa um desafio SHA-256. Após várias tentativas erradas, novas tentativas ficam bloqueadas por alguns minutos.
- Imagem, controle e arquivos vão **direto de um computador para o outro**, com criptografia WebRTC (DTLS/SRTP).

### Favoritos e conexões rápidas
- Computadores salvos com **nome personalizado**, ícone (computador, notebook, servidor, casa, escritório, pessoa) e cor.
- Senha salva de forma cifrada no chaveiro do sistema, para conectar sem digitar.
- **Barra de Conexões rápidas** no topo da janela e no menu da bandeja do sistema.
- Histórico de sessões recentes, com o sistema operacional e há quanto tempo foi a conexão.

### Controlar o computador remoto
- Mouse completo (botões esquerdo, direito e do meio, rolagem, arrastar) e teclado completo, **com acentos, ç e símbolos em qualquer layout** (ABNT2, US e outros).
- Envio de combinações de teclas: Ctrl+Alt+Del, Ctrl+Shift+Esc, Alt+Tab, Alt+F4, tecla Windows/Super, Print Screen e outras.
- **Vários monitores**, com troca rápida entre eles.
- Modo **somente visualização**.
- Área de transferência de texto sincronizada nos dois sentidos e **chat** integrado.
- Captura de tela da sessão, salva em Imagens › GCP Remoto.

### Exibição
- Ajustar à janela, **tamanho original (1:1)** com rolagem, ou esticar.
- Tamanhos de janela prontos (1024×640 até 1920×1080), igual à resolução remota, maximizar e **tela cheia** com barra que se esconde.
- Resolução transmitida (até 4K), 15, 30 ou 60 quadros por segundo e quatro níveis de qualidade, ajustáveis durante a sessão.
- Latência, resolução, quadros por segundo e taxa de transmissão exibidos em tempo real.

### Desenhar e apresentar na tela remota
- Caneta, marca-texto, seta, linha, retângulo, elipse e **texto**, com 10 cores, espessura, desfazer, refazer e limpar.
- **Destaque do cursor**, **anéis de clique** (cores diferentes para o botão esquerdo e o direito) e **holofote**, que escurece a tela e ilumina a área ao redor do ponteiro.
- **Widget flutuante** recolhido (cronômetro e caneta) ou expandido com todas as ferramentas, que pode ser arrastado para qualquer lugar da tela.
- Tudo é desenhado na tela do computador acessado: quem está do outro lado vê exatamente o mesmo, ao vivo.
- As ferramentas de apresentação também funcionam sem sessão, para aulas e reuniões.

### Transferir arquivos
- **Ctrl+C neste computador e Ctrl+V na tela remota**, e o contrário, para arquivos e pastas inteiras.
- Gerenciador com os dois computadores lado a lado: navegar, enviar e baixar.
- Arrastar e soltar arquivos sobre a tela remota.
- Arquivos recebidos ficam em Downloads › GCP Remoto (a pasta pode ser escolhida nas Configurações).

### Atalhos personalizados
Todas as ações da sessão têm atalho configurável em **Configurações › Atalhos**: tela cheia, modo desenho, desfazer, limpar, somente visualização, capturar tela, próximo monitor, chat, arquivos, modos de exibição, Ctrl+Alt+Del, widget, destaque do cursor, holofote e desconectar.

### Aparência
- Interface escura com destaque ciano, ícones próprios e janelas de aviso estilizadas.
- Ícone na bandeja do sistema que muda quando há uma sessão ativa.
- Iniciar com o sistema, iniciar minimizado e continuar disponível com a janela fechada.

## Privacidade

O GCP-Remoto não exige conta e não guarda suas sessões em servidores. Por padrão, os computadores se encontram pelo servidor público gratuito do PeerJS, que apenas apresenta um computador ao outro pelo ID. A imagem da tela, o controle e os arquivos trafegam diretamente entre os dois computadores, com criptografia. Configurações, favoritos e senhas salvas ficam apenas no seu computador.

Para independência total, hospede o seu próprio servidor de conexão (pasta [`server/`](server/)) e configure o endereço em **Configurações › Conexão**. O `docker-compose.yml` inclui também um servidor TURN (coturn) para redes muito restritas, como internet móvel com CGNAT e redes corporativas.

```bash
cd server && docker compose up -d
```

## Apoie o projeto

O GCP-Remoto é gratuito e continuará gratuito. Se ele for útil para você, considere apoiar o desenvolvimento pelo coração (♥) no topo da janela do aplicativo, onde há um QR Code PIX e o link do Stripe, ou diretamente:

- **Stripe (internacional):** [donate.stripe.com/fZu4gzeBSfhbd7451F6Ri00](https://donate.stripe.com/fZu4gzeBSfhbd7451F6Ri00)
- **PIX (Brasil):** use o QR Code ou o botão **Copiar PIX** dentro do aplicativo.

O apoio é voluntário. Todas as funções do aplicativo estão disponíveis sem contribuição.

## Para desenvolvedores

O GCP-Remoto é feito com Electron, WebRTC (PeerJS para sinalização), libnut para mouse e teclado no Windows e no Linux X11, protocolo X11/XTEST em JavaScript para digitação precisa com acentos, e o portal RemoteDesktop via D-Bus no Wayland.

Requisitos de desenvolvimento: Node.js 22 e npm.

```bash
npm ci               # instala as dependências travadas
npm start            # abre o programa
npm test             # roda os testes automatizados
npm run dist:linux   # gera .deb, .rpm, .pkg.tar.zst e AppImage em dist/
npm run dist:win     # gera o instalador, a versão portátil e o zip (no Windows)
```

O workflow **Compilar e publicar** compila no Ubuntu e no Windows a cada envio ao `main`, executa os testes e publica os instaladores na versão indicada em `package.json`.

Estrutura:

- `src/main/` — processo principal: janelas, senhas, injeção de mouse e teclado, arquivos, notificações e camada de desenho.
- `src/renderer/` — interface: janela principal, sessão, camada sobre a tela, notificações e apoio.
- `server/` — servidor de sinalização opcional e TURN.

Sugestões e problemas podem ser enviados na aba [Issues](https://github.com/cliqueprojeto/GCP-Remoto/issues).

## Licença

**Software livre — GPL-3.0-or-later.**

**Autoria:** Bruno Albertini | Gestão Cultural Pro.

O GCP-Remoto é software livre: você pode redistribuí-lo e modificá-lo sob os termos da **GNU General Public License, versão 3 ou posterior**, publicada pela Free Software Foundation. Ele é distribuído na esperança de ser útil, mas **sem nenhuma garantia**. Veja o arquivo [LICENSE](LICENSE).

Os componentes de terceiros mantêm suas próprias licenças, listadas em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
