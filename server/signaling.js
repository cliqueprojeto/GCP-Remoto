// Servidor de sinalização opcional do GCP Remoto.
// Só apresenta os computadores um ao outro; o vídeo, o controle e os arquivos
// trafegam direto entre eles (ponto a ponto, criptografado).
//   PORT=9000 HOST=0.0.0.0 KEY=peerjs node signaling.js
const http = require('http');
const express = require('express');
const { ExpressPeerServer } = require('peer');

const port = Number(process.env.PORT) || 9000;
const host = process.env.HOST || '0.0.0.0';
const app = express();
const server = http.createServer(app);
app.get('/health', (_req, res) => res.json({ ok: true, app: 'gcp-remoto-signaling' }));
const peer = ExpressPeerServer(server, {
  path: '/',
  key: process.env.KEY || 'peerjs',
  allow_discovery: false,
  proxied: process.env.PROXIED === '1',
  alive_timeout: 60000,
  concurrent_limit: Number(process.env.LIMIT) || 5000
});
app.use(process.env.PEER_PATH || '/', peer);
peer.on('connection', (c) => console.log(new Date().toISOString(), 'conectado', c.getId()));
peer.on('disconnect', (c) => console.log(new Date().toISOString(), 'desconectado', c.getId()));
server.listen(port, host, () => console.log(`GCP Remoto — sinalização em http://${host}:${port}`));
