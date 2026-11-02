// Thin WebSocket client for the room relay (server/rooms.js).
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.id = null;
    this.host = null;
    this.room = null;
    this.players = new Map(); // id -> {id,name,color,head}
    this.inMatch = false;
    this.max = 8;
    this.settings = { map: 'arena', dur: 180, weapons: [] };
  }

  static defaultUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  on(type, fn) { this.handlers[type] = fn; return this; }
  emit(type, ...a) { this.handlers[type]?.(...a); }
  get connected() { return !!this.ws && this.ws.readyState === 1; }
  get isHost() { return this.id !== null && this.id === this.host; }

  connect(url) {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(new Error('Bad server address')); return; }
      let opened = false;
      const timer = setTimeout(() => { if (!opened) { ws.close(); reject(new Error('Connection timed out')); } }, 6000);
      ws.onopen = () => { opened = true; clearTimeout(timer); this.ws = ws; resolve(); };
      ws.onerror = () => { if (!opened) { clearTimeout(timer); reject(new Error('Could not reach the server')); } };
      ws.onclose = () => { clearTimeout(timer); if (this.ws === ws) { this.ws = null; this.emit('close'); } };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        this._handle(m);
      };
    });
  }

  _handle(m) {
    switch (m.t) {
      case 'welcome':
        this.id = m.id; this.host = m.host; this.room = m.code; this.inMatch = m.inMatch; this.max = m.max; this.settings = m.settings;
        this.players = new Map(m.players.map((p) => [p.id, p]));
        this.emit('welcome', m);
        break;
      case 'peer':
        if (m.host) this.host = m.host;
        if (m.ev === 'join') this.players.set(m.player.id, m.player);
        else this.players.delete(m.id);
        this.emit('peer', m);
        break;
      case 'host': this.host = m.id; this.emit('host', m.id); break;
      case 'relay': this.emit('relay', m.from, m.d); break;
      case 'start': this.inMatch = true; this.emit('start', m); break;
      case 'end': this.inMatch = false; this.emit('end', m); break;
      case 'lobby': this.emit('lobby', m); break;
      case 'error': this.emit('error', m.msg, m); break;
    }
  }

  send(obj) { if (this.connected) this.ws.send(JSON.stringify(obj)); }
  join(room, name, color, head, opts = {}) { this.send({ t: 'join', room, name, color, head, ...opts }); }
  relay(d) { this.send({ t: 'relay', d }); }
  start(map, dur) { this.send({ t: 'start', map, dur }); }
  end() { this.send({ t: 'end' }); }
  lobby(map, dur) { this.send({ t: 'lobby', map, dur }); }
  close() { try { this.ws?.close(); } catch { /* ignore */ } this.ws = null; this.players.clear(); this.id = null; this.host = null; }
}
