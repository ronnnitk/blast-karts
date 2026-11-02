// Tiny room relay for Brainrot Karts online play.
// Clients are authoritative over their own kart; the server only manages rooms, the host and message relay.
import { WebSocketServer } from 'ws';

const MAX_PLAYERS = 8;
const rooms = new Map();
let nextId = 1;

const clean = (s, n) => String(s ?? '').replace(/[^\w \-.!?]/g, '').trim().slice(0, n);
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const publicPlayer = (p) => ({ id: p.id, name: p.name, color: p.color, head: p.head });

function broadcast(room, msg, except) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) if (p !== except && p.readyState === 1) p.send(data);
}

function leave(ws) {
  const room = ws.room;
  if (!room) return;
  room.players.delete(ws.id);
  ws.room = null;
  if (!room.players.size) { rooms.delete(room.code); return; }
  if (room.host === ws.id) {
    room.host = room.players.keys().next().value;
    broadcast(room, { t: 'host', id: room.host });
  }
  broadcast(room, { t: 'peer', ev: 'leave', id: ws.id, host: room.host });
}

export function createRoomServer() {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  wss.on('connection', (ws) => {
    ws.id = 'p' + nextId++;
    ws.room = null;
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      switch (m.t) {
        case 'join': {
          if (ws.room) return;
          const code = clean(m.room, 12).toUpperCase();
          if (!code) { send(ws, { t: 'error', msg: 'Enter a room ID' }); return; }
          let room = rooms.get(code);
          if (m.create) {
            if (room) { send(ws, { t: 'error', msg: 'That room ID is already in use', retry: true }); return; }
            const st = m.settings || {};
            room = {
              code, players: new Map(), host: null, inMatch: false,
              max: Math.max(2, Math.min(MAX_PLAYERS, m.max | 0 || MAX_PLAYERS)),
              settings: {
                map: clean(st.map, 20) || 'arena',
                dur: Math.max(60, Math.min(900, st.dur | 0 || 180)),
                weapons: Array.isArray(st.weapons) ? st.weapons.slice(0, 16).map((w) => clean(w, 14)).filter(Boolean) : [],
              },
            };
            rooms.set(code, room);
          } else if (!room) { send(ws, { t: 'error', msg: 'Room not found — check the ID' }); return; }
          if (room.players.size >= room.max) { send(ws, { t: 'error', msg: `Room is full (${room.max} players)` }); return; }
          ws.name = clean(m.name, 16) || 'Player' + ws.id.slice(1);
          ws.color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#ff3b9a';
          ws.head = Math.max(0, Math.min(3, m.head | 0));
          ws.room = room;
          room.players.set(ws.id, ws);
          if (!room.host) room.host = ws.id;
          send(ws, {
            t: 'welcome', id: ws.id, host: room.host, code, inMatch: room.inMatch, max: room.max, settings: room.settings,
            players: [...room.players.values()].map(publicPlayer),
          });
          broadcast(room, { t: 'peer', ev: 'join', player: publicPlayer(ws), host: room.host }, ws);
          break;
        }
        case 'relay': {
          const room = ws.room;
          if (!room || typeof m.d !== 'object') return;
          broadcast(room, { t: 'relay', from: ws.id, d: m.d }, ws);
          break;
        }
        case 'start': {
          const room = ws.room;
          if (!room || room.host !== ws.id || room.inMatch) return;
          room.inMatch = true;
          broadcast(room, {
            t: 'start', map: room.settings.map, dur: room.settings.dur, weapons: room.settings.weapons,
            seed: (Math.random() * 1e9) | 0,
            players: [...room.players.values()].map(publicPlayer),
          });
          break;
        }
        case 'end': {
          const room = ws.room;
          if (!room || room.host !== ws.id) return;
          room.inMatch = false;
          broadcast(room, { t: 'end' });
          break;
        }
        case 'lobby': { // host picks map/duration, mirrored to everyone
          const room = ws.room;
          if (!room || room.host !== ws.id) return;
          broadcast(room, { t: 'lobby', map: clean(m.map, 20), dur: m.dur | 0 }, ws);
          break;
        }
      }
    });
    ws.on('close', () => leave(ws));
    ws.on('error', () => leave(ws));
  });
  return wss;
}

export function attachUpgrade(httpServer, wss, path = '/ws') {
  httpServer.on('upgrade', (req, socket, head) => {
    const url = (req.url || '').split('?')[0];
    if (url !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}
