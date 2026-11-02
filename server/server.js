// Production server: serves ./dist and hosts the online room relay on /ws.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoomServer, attachUpgrade } from './rooms.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const port = process.env.PORT || 8787;
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(root, url));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found (run "npm run build" first)'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
attachUpgrade(server, createRoomServer());
server.listen(port, () => console.log(`Brainrot Karts on http://localhost:${port}  (online relay: ws://localhost:${port}/ws)`));
