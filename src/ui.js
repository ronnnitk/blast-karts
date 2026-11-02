import { MAPS } from './maps.js';
import { ITEMS } from './weapons.js';
import { KILL_SOUNDS } from './audio.js';
import { HEADS } from './kartmodel.js';
import { Net } from './net.js';
import { pick } from './util.js';
import { KartPreview } from './kartpreview.js';

const randomRoomId = () => String(Math.floor(10000 + Math.random() * 90000));

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const COLORS = ['#ff3b9a', '#28e0ff', '#ffd23a', '#5dff2e', '#8a4bff', '#ff7a1a', '#ff4040', '#3a7bff'];

export function loadSettings() {
  const d = {
    name: '', color: COLORS[0], head: 0, mapId: 'arena', bots: 5, dur: 180, diff: 'normal',
    master: 0.8, sfx: 1, music: 0.45, kill: 1, killChoice: 'cid', killMax: 4, cidSet: false,
    musicOn: true, announcer: true, shake: true, quality: 'high', shadows: true,
    server: '', crMax: 8, crDur: 180, crMap: 'arena', crWeapons: null,
  };
  try { Object.assign(d, JSON.parse(localStorage.getItem('brk-settings') || '{}')); } catch { /* ignore */ }
  return d;
}

const outline = (g, b, sc) => { g.beginPath(); if (b.type === 'poly') { b.pts.forEach(([x, z], i) => (i ? g.lineTo(x * sc, z * sc) : g.moveTo(x * sc, z * sc))); g.closePath(); } else if (b.type === 'rect') g.rect(-b.hw * sc, -b.hd * sc, b.hw * 2 * sc, b.hd * 2 * sc); else g.arc(0, 0, b.r * sc, 0, 7); };

export class UI {
  constructor({ game, audio, settings }) {
    this.game = game; this.audio = audio; this.s = settings;
    this.net = null;
    this.current = 'main';
    this.prev = 'main';
    this.mapId = settings.mapId;
    if (!this.s.cidSet) { this.s.cidSet = true; this.s.killChoice = 'cid'; this.s.killMax = 4; this.save(); }
    this._build();
    this._bind();
    this._applyAudio();
    game.onPauseKey = () => this.togglePause();
    game.onMatchEnd = (rows) => this.showResults(rows);
    this.show('main');
    try { this.preview = new KartPreview($('kart-prev')); this.refreshPreview(); this.preview.start(); } catch { /* no webgl for the preview */ }
    this._renderProfile();
  }

  refreshPreview() { this.preview?.setKart(this.s.color, this.s.head); const av = $('avatar'); if (av) av.style.background = this.s.color; }

  /** level / coins are derived from lifetime progress saved in settings */
  _renderProfile() {
    const xp = this.s.xp || 0, lv = 1 + Math.floor(xp / 100);
    $('xptxt').textContent = 'Lv ' + lv;
    $('xpfill').style.width = (xp % 100) + '%';
    $('coins').textContent = this.s.coins || 0;
  }

  save() { try { localStorage.setItem('brk-settings', JSON.stringify(this.s)); } catch { /* ignore */ } }

  toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove('show'), ms);
  }

  show(id) {
    this.prev = this.current === 'settings' || this.current === 'help' ? this.prev : this.current;
    this.current = id;
    document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('hidden', el.id !== 'scr-' + id));
    $('screens').style.display = id ? 'block' : 'none';
  }
  hideAll() {
    this.current = null;
    document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
  }

  /* ------------------------------------------------------------ building static content */
  _build() {
    // news / weapons tabs on the main menu
    const news = document.querySelector('.newslist'), newsHtml = news.innerHTML;
    const weaponsHtml = Object.values(ITEMS).map((i) => `<div class="news"><b>${i.emoji} ${i.name}</b><small>${i.desc}</small></div>`).join('');
    document.querySelectorAll('.tabs .tab').forEach((t, i) => t.addEventListener('click', () => {
      document.querySelectorAll('.tabs .tab').forEach((x) => x.classList.toggle('on', x === t));
      news.innerHTML = i ? weaponsHtml : newsHtml;
    }));
    // colors + heads
    $('in-name').value = this.s.name;
    $('swatches').innerHTML = COLORS.map((c) => `<div class="chip${c === this.s.color ? ' sel' : ''}" data-c="${c}" style="background:${c}"></div>`).join('');
    $('heads').innerHTML = HEADS.map((h, i) => `<div class="chip txt${i === this.s.head ? ' sel' : ''}" data-h="${i}">${h}</div>`).join('');

    // map cards
    const cards = $('map-cards');
    cards.innerHTML = '';
    for (const m of MAPS) {
      const el = document.createElement('div');
      el.className = 'card' + (m.id === this.mapId ? ' sel' : '');
      el.dataset.map = m.id;
      const cv = document.createElement('canvas');
      cv.width = 440; cv.height = 260;
      this._drawMapPreview(cv, m);
      const t = document.createElement('div');
      t.className = 'ct';
      t.innerHTML = `<div class="cn">${m.emoji} ${m.name}</div><div class="cd">${m.desc}</div>`;
      el.append(cv, t);
      cards.appendChild(el);
    }
    if (this.s.crWeapons?.includes('shield')) this.s.crWeapons = null; // weapon list changed
    $('cr-map').innerHTML = MAPS.map((m) => `<option value="${m.id}">${m.emoji} ${m.name}</option>`).join('');
    $('cr-map').value = this.s.crMap; $('cr-max').value = this.s.crMax; $('cr-dur').value = this.s.crDur;
    const on = this.s.crWeapons || Object.keys(ITEMS);
    $('cr-weapons').innerHTML = Object.entries(ITEMS).map(([k, i]) =>
      `<label><input type="checkbox" value="${k}"${on.includes(k) ? ' checked' : ''} /><span>${i.emoji}</span>${i.name}</label>`).join('');

    // help items
    $('help-items').innerHTML = Object.values(ITEMS).map((i) => `<div class="item"><span class="em">${i.emoji}</span><div><b>${i.name}</b>${i.desc}</div></div>`).join('');

    // settings values
    $('in-bots').value = this.s.bots; $('bots-val').textContent = this.s.bots;
    $('in-dur').value = this.s.dur; $('in-diff').value = this.s.diff;
    $('vol-master').value = this.s.master; $('vol-sfx').value = this.s.sfx; $('vol-music').value = this.s.music;
    $('vol-kill').value = this.s.kill; $('kill-max').value = this.s.killMax; $('kill-max-val').textContent = this.s.killMax;
    $('opt-music').checked = this.s.musicOn; $('opt-announcer').checked = this.s.announcer; $('opt-shake').checked = this.s.shake;
    $('opt-quality').value = this.s.quality; $('opt-shadows').checked = this.s.shadows;
    $('in-server').value = this.s.server || Net.defaultUrl();
    this._refreshKillSelect();
  }

  _drawMapPreview(cv, m) {
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const th = m.theme;
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, hex(th.skyTop)); grad.addColorStop(1, hex(th.skyBottom));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const b = m.bounds;
    const ex = b.type === 'circle' ? b.r : b.hw, ez = b.type === 'circle' ? b.r : b.hd;
    const sc = Math.min((W - 30) / (ex * 2), (H - 30) / (ez * 2));
    g.save(); g.translate(W / 2, H / 2);
    g.fillStyle = hex(th.groundA);
    outline(g, b, sc); g.fill();
    g.lineWidth = 4; g.strokeStyle = hex(th.accent);
    outline(g, b, sc); g.stroke();
    g.fillStyle = '#5dff2e';
    m.slime.forEach((s) => { g.globalAlpha = 0.7; g.beginPath(); g.arc(s.x * sc, s.z * sc, s.r * sc, 0, 7); g.fill(); g.globalAlpha = 1; });
    m.boxes.forEach((bx, i) => { g.fillStyle = hex(th.wall[i % 3]); g.fillRect((bx.x - bx.w / 2) * sc, (bx.z - bx.d / 2) * sc, Math.max(2, bx.w * sc), Math.max(2, bx.d * sc)); });
    m.pillars.forEach((p, i) => { g.fillStyle = hex(th.wall[i % 3]); g.beginPath(); g.arc(p.x * sc, p.z * sc, Math.max(2, p.r * sc), 0, 7); g.fill(); });
    g.fillStyle = '#fff';
    m.items.forEach(([x, z]) => { g.beginPath(); g.arc(x * sc, z * sc, 4, 0, 7); g.fill(); });
    g.restore();
  }

  _refreshKillSelect() {
    const sel = $('kill-select');
    const hasCustom = !!this.audio.customBuffer;
    sel.innerHTML = KILL_SOUNDS.map((k) => `<option value="${k.id}">${k.name}</option>`).join('') +
      `<option value="custom"${hasCustom ? '' : ' disabled'}>⭐ My uploaded sound${hasCustom ? ' — ' + esc(this.audio.customName) : ' (upload one below)'}</option>`;
    if (this.s.killChoice === 'custom' && !hasCustom) this.s.killChoice = 'boom';
    sel.value = this.s.killChoice;
    this.audio.killChoice = this.s.killChoice;
   
    const info = $('kill-info');
    info.classList.remove('err');
    info.textContent = hasCustom ? `Loaded: ${this.audio.customName} (${this.audio.customBuffer.duration.toFixed(1)}s) — saved in this browser` : 'No custom sound uploaded yet. MP3, WAV or OGG up to ~20 MB.';
  }

  _applyAudio() {
    const a = this.audio, s = this.s;
    a.vol.master = s.master; a.vol.sfx = s.sfx; a.vol.music = s.music; a.vol.kill = s.kill;
    a.killMaxSec = s.killMax; a.musicEnabled = s.musicOn; a.announcer = s.announcer; a.killChoice = s.killChoice;
    a.applyVolumes();
  }

  /* ------------------------------------------------------------ events */
  _bind() {
    const click = (id, fn) => $(id).addEventListener('click', () => { this.audio.init(); this.audio.click(); fn(); });
    document.addEventListener('click', (e) => {
      const back = e.target.closest('[data-back]');
      if (back) { this.audio.init(); this.audio.click(); this.show('main'); }
    });

    $('in-name').addEventListener('input', (e) => { this.s.name = e.target.value.slice(0, 14); this.save(); });
    $('swatches').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      this.s.color = c.dataset.c; this.save(); this.refreshPreview();
      document.querySelectorAll('#swatches .chip').forEach((x) => x.classList.toggle('sel', x === c));
    });
    $('heads').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      this.s.head = +c.dataset.h; this.save(); this.refreshPreview();
      document.querySelectorAll('#heads .chip').forEach((x) => x.classList.toggle('sel', x === c));
    });

    click('btn-solo', () => this.show('solo'));
    click('btn-settings', () => this.show('settings'));
    click('btn-help', () => this.show('help'));
    click('btn-settings-back', () => this.show(this.prev || 'main'));

    $('map-cards').addEventListener('click', (e) => {
      const c = e.target.closest('.card'); if (!c) return;
      this.audio.init(); this.audio.click();
      this.mapId = c.dataset.map; this.s.mapId = this.mapId; this.save();
      document.querySelectorAll('.card').forEach((x) => x.classList.toggle('sel', x === c));
      this.game.startMatch({ mode: 'attract', mapId: this.mapId }); // live background preview of the chosen arena
    });
    $('in-bots').addEventListener('input', (e) => { this.s.bots = +e.target.value; $('bots-val').textContent = e.target.value; this.save(); });
    $('in-dur').addEventListener('change', (e) => { this.s.dur = +e.target.value; this.save(); });
    $('in-diff').addEventListener('change', (e) => { this.s.diff = e.target.value; this.save(); });
    click('btn-start-solo', () => this.startSolo());

    // settings
    const rng = (id, key, fn) => $(id).addEventListener('input', (e) => { this.s[key] = +e.target.value; fn?.(); this._applyAudio(); this.save(); });
    rng('vol-master', 'master'); rng('vol-sfx', 'sfx'); rng('vol-music', 'music'); rng('vol-kill', 'kill');
    rng('kill-max', 'killMax', () => { $('kill-max-val').textContent = this.s.killMax; });
    const chk = (id, key, fn) => $(id).addEventListener('change', (e) => { this.s[key] = e.target.checked; this._applyAudio(); fn?.(); this.save(); });
    chk('opt-music', 'musicOn'); chk('opt-announcer', 'announcer'); chk('opt-shake', 'shake');
    chk('opt-shadows', 'shadows', () => this.game.applyQuality());
    $('opt-quality').addEventListener('change', (e) => { this.s.quality = e.target.value; this.save(); this.game.applyQuality(); this.toast('Quality applies fully on the next match'); });
    $('kill-select').addEventListener('change', (e) => { this.s.killChoice = e.target.value; this.audio.killChoice = e.target.value; this.save(); this.audio.init(); this.audio.playKill(); });
    click('btn-upload', () => $('kill-file').click());
    click('btn-kill-test', () => this.audio.playKill());
    click('btn-kill-clear', async () => { await this.audio.clearCustom(); this.s.killChoice = this.audio.killChoice; this.save(); this._refreshKillSelect(); this.toast('Custom kill sound removed'); });
    $('kill-file').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      const info = $('kill-info');
      if (f.size > 20 * 1024 * 1024) { info.classList.add('err'); info.textContent = 'That file is over 20 MB — pick a shorter clip.'; return; }
      try {
        info.classList.remove('err'); info.textContent = 'Decoding…';
        await this.audio.setCustomFile(f);
        this.s.killChoice = 'custom'; this.save();
        this._refreshKillSelect();
        this.audio.playKill('custom');
        this.toast('Kill sound set: ' + f.name);
      } catch (err) {
        info.classList.add('err');
        info.textContent = "Couldn't decode that file. Try an MP3, WAV or OGG.";
      }
    });
    this.audio.onCustomLoaded = () => this._refreshKillSelect();

    // pause + results
    click('btn-resume', () => this.resume());
    click('btn-pause-settings', () => this.show('settings'));
    click('btn-quit', () => this.quitToMenu());
    click('btn-res-menu', () => this.quitToMenu());
    click('btn-res-again', () => this.playAgain());

    // rooms
    click('btn-create', () => { $('create-code').textContent = randomRoomId(); $('create-status').textContent = ''; this.show('create'); });
    click('btn-joinroom', () => { $('join-status').textContent = ''; this.show('join'); setTimeout(() => $('in-joinid').focus(), 50); });
    click('btn-newcode', () => { $('create-code').textContent = randomRoomId(); });
    $('in-joinid').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5); });
    $('in-joinid').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
    click('btn-join', () => this.joinRoom());
    click('btn-create-go', () => this.createRoom());
    click('btn-leave', () => { this.leaveOnline(); this.show('main'); });
    click('btn-start-online', () => this.net?.start());
    click('btn-copycode', () => { navigator.clipboard?.writeText($('lobby-code').textContent).catch(() => {}); this.toast('Room ID copied'); });
    $('w-all').addEventListener('click', () => document.querySelectorAll('#cr-weapons input').forEach((c) => (c.checked = true)));
    $('w-none').addEventListener('click', () => document.querySelectorAll('#cr-weapons input').forEach((c) => (c.checked = false)));
    $('in-server').addEventListener('change', (e) => { this.s.server = e.target.value.trim() === Net.defaultUrl() ? '' : e.target.value.trim(); this.save(); });
  }

  /* ------------------------------------------------------------ flows */
  playerInfo(id = 'me') {
    return { id, name: (this.s.name || 'Player').trim() || 'Player', color: this.s.color, head: this.s.head };
  }

  startSolo() {
    this.cfg = { mode: 'solo', mapId: this.mapId, duration: this.s.dur, bots: this.s.bots, difficulty: this.s.diff, player: this.playerInfo() };
    this.launch(this.cfg);
  }

  launch(cfg) {
    this.audio.init();
    this._applyAudio();
    this.hideAll();
    this.game.net = cfg.mode === 'online' ? this.net : null;
    this.game.startMatch(cfg);
    this.audio.startMusic();
  }

  togglePause() {
    const g = this.game;
    if (!['countdown', 'playing'].includes(g.state)) return;
    if (this.current === 'pause') this.resume();
    else if (this.current === null) {
      if (g.mode !== 'online') g.paused = true;
      g.input.enabled = false; g.input.reset();
      this.audio.silenceLoops();
      this.show('pause');
    }
  }
  resume() {
    this.game.paused = false;
    this.game.input.enabled = true;
    this.hideAll();
  }

  quitToMenu() {
    this.game.paused = false;
    this.audio.stopMusic();
    this.audio.silenceLoops();
    if (this.net) { this.leaveOnline(); }
    this.game.net = null;
    this.game.hud.show(false);
    this.game.startMatch({ mode: 'attract', mapId: pick(MAPS).id });
    this.show('main');
  }

  showResults(rows) {
    this.audio.stopMusic();
    this.game.hud.show(false);
    const me = rows.findIndex((r) => r.isLocal);
    const top = rows[0];
    const tie = rows[1] && rows[1].kills === top.kills && rows[1].deaths === top.deaths;
    $('res-title').textContent = me === 0 && !tie ? 'VICTORY!' : 'MATCH OVER';
    $('res-winner').textContent = tie ? "IT'S A TIE. AURA FARMING." : `${top.name} wins!`;
    $('res-table').innerHTML = `<tr><th>#</th><th>Driver</th><th class="num">Kills</th><th class="num">Deaths</th></tr>` +
      rows.map((r, i) => `<tr class="${r.isLocal ? 'me' : ''}"><td>${['🥇', '🥈', '🥉'][i] || i + 1}</td><td><i style="background:${r.color}"></i>${esc(r.name)}</td><td class="num">${r.kills}</td><td class="num">${r.deaths}</td></tr>`).join('');
    $('btn-res-again').textContent = this.game.mode === 'online' ? 'BACK TO LOBBY' : 'PLAY AGAIN';
    const mine = rows[me]; // progression: xp and coins from kills, bonus for winning
    if (mine) {
      this.s.xp = (this.s.xp || 0) + 15 + mine.kills * 8 + (me === 0 && !tie ? 25 : 0);
      this.s.coins = (this.s.coins || 0) + mine.kills * 5 + (me === 0 && !tie ? 50 : 10);
      this.save(); this._renderProfile();
    }
    this.show('results');
  }

  playAgain() {
    if (this.game.mode === 'online') {
      if (this.net?.connected) { this.game.hud.show(false); this.game.startMatch({ mode: 'attract', mapId: pick(MAPS).id }); this.show('online'); this._renderLobby(); }
      else this.quitToMenu();
      return;
    }
    this.launch(this.cfg);
  }

  /* ------------------------------------------------------------ rooms */
  _serverUrl() { return $('in-server').value.trim() || Net.defaultUrl(); }

  createRoom() {
    const weapons = [...document.querySelectorAll('#cr-weapons input:checked')].map((c) => c.value);
    const st = $('create-status');
    st.classList.remove('err');
    if (!weapons.length) { st.classList.add('err'); st.textContent = 'Allow at least one weapon.'; return; }
    const settings = { map: $('cr-map').value, dur: +$('cr-dur').value, weapons };
    const max = +$('cr-max').value;
    Object.assign(this.s, { crMap: settings.map, crDur: settings.dur, crMax: max, crWeapons: weapons }); this.save();
    this._connect({ room: $('create-code').textContent, create: true, max, settings }, st, $('btn-create-go'));
  }

  joinRoom() {
    const st = $('join-status');
    st.classList.remove('err');
    const id = $('in-joinid').value.trim();
    if (id.length !== 5) { st.classList.add('err'); st.textContent = 'Room IDs are 5 digits.'; return; }
    this._connect({ room: id, create: false }, st, $('btn-join'));
  }

  async _connect(opts, status, button, attempt = 0) {
    status.classList.remove('err');
    status.textContent = 'Connecting…';
    button.disabled = true;
    this.leaveOnline();
    const net = (this.net = new Net());
    const fail = (msg) => { status.classList.add('err'); status.textContent = msg; button.disabled = false; };
    net.on('welcome', () => { button.disabled = false; status.textContent = ''; this.show('online'); this._renderLobby(); })
      .on('error', (msg, m) => {
        if (m?.retry && opts.create && attempt < 4) { // ID collision: roll a new one and try again
          $('create-code').textContent = randomRoomId();
          this._connect({ ...opts, room: $('create-code').textContent }, status, button, attempt + 1);
        } else { this.net = null; net.close(); fail(msg); }
      })
      .on('peer', (m) => {
        if (m.ev === 'leave' && this.game.mode === 'online') { this.game.removeKart(m.id); this.toast('A player left'); }
        this._renderLobby();
      })
      .on('host', () => this._renderLobby())
      .on('relay', (from, d) => this.game.handleNet(from, d))
      .on('start', (m) => {
        if (!m.players.some((p) => p.id === net.id)) { this.toast('Match already running — you will join the next one'); return; }
        this.cfg = { mode: 'online', mapId: m.map, duration: m.dur, allowed: m.weapons, player: this.playerInfo(net.id), players: m.players };
        this.launch(this.cfg);
      })
      .on('close', () => {
        if (this.net !== net) return;
        this.net = null;
        this.toast('Disconnected from server');
        if (this.game.mode === 'online' && this.game.state !== 'attract') this.quitToMenu(); else this.show('main');
      });
    try {
      await net.connect(this._serverUrl());
      net.join(opts.room, this.playerInfo().name, this.s.color, this.s.head, { create: !!opts.create, max: opts.max, settings: opts.settings });
    } catch (e) {
      this.net = null;
      fail(e.message + ' — is the server running? (npm run dev / npm start)');
    }
  }

  _renderLobby() {
    const net = this.net;
    if (!net || this.current !== 'online') return;
    $('lobby-code').textContent = net.room;
    const host = net.isHost;
    $('lobby-players').innerHTML = [...net.players.values()].map((p) =>
      `<div class="pl"><i style="background:${p.color}"></i>${esc(p.name)}${p.id === net.id ? ' (you)' : ''}${p.id === net.host ? '<b>HOST</b>' : ''}</div>`).join('');
    const st = net.settings, map = MAPS.find((m) => m.id === st.map) || MAPS[0];
    const w = st.weapons.length && st.weapons.length < Object.keys(ITEMS).length ? st.weapons.map((k) => ITEMS[k]?.emoji || '').join(' ') : 'all weapons';
    $('lobby-settings').innerHTML = `${map.emoji} <b>${map.name}</b> · ${net.players.size}/${net.max} players · ${Math.round(st.dur / 6) / 10} min · ${w}`;
    $('btn-start-online').disabled = !host;
    $('btn-start-online').textContent = host ? 'START MATCH' : 'WAITING FOR HOST…';
    $('lobby-status').textContent = net.inMatch ? 'A match is in progress — you will join the next one.' :
      net.players.size < 2 ? 'Share the room ID with friends. They press JOIN ROOM and type it in.' : `${net.players.size} players ready.`;
  }

  leaveOnline() {
    if (this.net) { const n = this.net; this.net = null; n.close(); }
  }
}
