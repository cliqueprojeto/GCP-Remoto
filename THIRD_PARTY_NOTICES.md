# Créditos e componentes de terceiros

GCP-Remoto: desenvolvido por Bruno Albertini | Gestão Cultural Pro — https://gestaoculturalpro.com.br/
Distribuído sob a GNU General Public License, versão 3 ou posterior (arquivo LICENSE).

A identidade visual, o ícone e a interface do GCP-Remoto são próprios. Nenhum ícone, imagem ou código do AnyDesk, do TeamViewer ou de outro programa de acesso remoto foi copiado.

## Componentes incluídos

- **Electron / Chromium** — runtime da aplicação e motor WebRTC (vídeo, canais de dados e criptografia DTLS/SRTP), sob MIT e licenças do Chromium incluídas no pacote (`LICENSES.chromium.html`).
- **PeerJS** — cliente de sinalização WebRTC, sob MIT.
- **libnut (@nut-tree-fork/libnut-linux e libnut-win32)** — injeção de mouse e teclado no Windows e no Linux X11, sob Apache-2.0.
- **uiohook-napi / libuiohook** — detecção global de cliques para os efeitos de clique, sob MIT (uiohook-napi) e LGPL-3.0 (libuiohook).
- **x11 (node-x11)** — cliente do protocolo X11 em JavaScript, usado para digitação precisa com acentos no Linux X11, sob MIT.
- **dbus-next** — cliente D-Bus em JavaScript, usado para o portal RemoteDesktop do Wayland (KDE Plasma, GNOME), sob MIT.
- **Servidor de sinalização opcional (pasta `server/`)** — PeerJS Server (`peer`), sob MIT, e Express, sob MIT. O `docker-compose.yml` usa a imagem oficial do coturn, sob BSD de 3 cláusulas.

Cada dependência mantém sua própria licença no respectivo pacote. O `package-lock.json` fixa as versões e a integridade de cada uma.

## Servidor público de conexão

Por padrão, os computadores se encontram pelo servidor público gratuito do PeerJS (0.peerjs.com), mantido pela comunidade PeerJS e sem garantia de disponibilidade. Esse servidor apenas apresenta um computador ao outro; a imagem, o controle e os arquivos trafegam diretamente entre eles. O endereço pode ser trocado por um servidor próprio em **Configurações › Conexão**.
