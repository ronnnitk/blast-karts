import { ITEMS } from './weapons.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const outline = (g, b, sc) => { g.beginPath(); if (b.type === 'poly') { b.pts.forEach(([x, z], i) => (i ? g.lineTo(x * sc, z * sc) : g.moveTo(x * sc, z * sc))); g.closePath(); } else if (b.type === 'rect') g.rect(-b.hw * sc, -b.hd * sc, b.hw * 2 * sc, b.hd * 2 * sc); else g.arc(0, 0, b.r * sc, 0, 7); };

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      timer: $('timer'), myk: $('myk'), lb: $('lb'), feed: $('feed'), hpfill: $('hpfill'), hptxt: $('hptxt'),
      itembox: $('itembox'), itemicon: $('itemicon'), itemname: $('itemname'), itemammo: $('itemammo'),
      banner: $('banner'), streak: $('streak'), cmBig: $('cm-big'), cmSub: $('cm-sub'), vignette: $('vignette'),
      hit: $('hitmarker'), sb: $('scoreboard'), mini: $('minimap'), driftbar: $('driftbar'), driftfill: $('driftfill'),
      speed: $('speedlines'), hint: $('hint'), rank: $('rank'), rankof: $('rankof'),
    };
    this.mctx = this.el.mini.getContext('2d');
    this.mapLayer = null;
    this._lbT = 0;
    this._last = {};
  }

  show(v) { this.root.classList.toggle('hidden', !v); if (v) { this.el.hint.style.opacity = 0.7; setTimeout(() => (this.el.hint.style.opacity = 0), 9000); } }

  reset() {
    this.el.feed.innerHTML = ''; this.el.banner.className = ''; this.el.streak.className = ''; this.centerMsg('', '');
    this.el.sb.classList.add('hidden'); this._last = {};
  }

  setTimer(sec, infinite) {
    if (infinite) { this.el.timer.textContent = ''; return; }
    const s = Math.max(0, Math.ceil(sec));
    if (this._last.t === s) return;
    this._last.t = s;
    this.el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.el.timer.classList.toggle('low', s <= 15);
  }

  setHP(hp) {
    const v = Math.max(0, Math.round(hp));
    if (this._last.hp === v) return;
    this._last.hp = v;
    this.el.hpfill.style.width = v + '%';
    this.el.hpfill.style.background = v > 55 ? 'linear-gradient(180deg,#7dff9a,#2ad45a)' : v > 28 ? 'linear-gradient(180deg,#ffe36a,#e8a415)' : 'linear-gradient(180deg,#ff7a7a,#d8201f)';
    this.el.hptxt.textContent = v;
  }

  setKills(n) { if (this._last.k !== n) { this._last.k = n; this.el.myk.textContent = n; } }

  setItem(item, rolling, rollIcon) {
    const e = this.el;
    const key = (item ? item.type + ':' + item.ammo : '-') + (rolling ? 'R' + rollIcon : '');
    if (this._last.item === key) return;
    this._last.item = key;
    if (!item) { e.itembox.className = ''; e.itemicon.textContent = '❓'; e.itemname.textContent = 'Find an item box'; e.itemammo.textContent = ''; return; }
    e.itembox.className = 'has' + (rolling ? ' roll' : '');
    if (rolling) { e.itemicon.textContent = rollIcon; e.itemname.textContent = '...'; e.itemammo.textContent = ''; return; }
    const d = ITEMS[item.type];
    e.itemicon.textContent = d.emoji;
    e.itemname.textContent = d.name;
    e.itemammo.textContent = d.ammo ? '×' + item.ammo : '';
  }

  setDrift(tier, t, on) {
    this.el.driftbar.classList.toggle('on', !!on);
    if (!on) return;
    const colors = ['#fff', '#4ab0ff', '#ffa020', '#c050ff'];
    this.el.driftfill.style.background = colors[tier];
    this.el.driftfill.style.width = Math.min(100, (t / 2.2) * 100) + '%';
  }

  speedLines(on) { this.el.speed.classList.toggle('on', on); }

  flash(kind) {
    const v = this.el.vignette;
    v.className = kind;
    clearTimeout(this._vt);
    this._vt = setTimeout(() => (v.className = ''), 90);
  }
  hitmarker() {
    const h = this.el.hit;
    h.classList.add('on');
    clearTimeout(this._ht);
    this._ht = setTimeout(() => h.classList.remove('on'), 110);
  }

  banner(text, sub = '') {
    const b = this.el.banner;
    b.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }
  streak(text) {
    const s = this.el.streak;
    s.textContent = text;
    s.classList.remove('show'); void s.offsetWidth; s.classList.add('show');
  }
  centerMsg(big, sub = '', pop = false) {
    this.el.cmBig.textContent = big;
    this.el.cmSub.textContent = sub;
    this.el.cmBig.classList.remove('pop');
    if (pop) { void this.el.cmBig.offsetWidth; this.el.cmBig.classList.add('pop'); }
  }

  feed(killer, emoji, victim, mine) {
    const f = document.createElement('div');
    f.className = 'f' + (mine ? ' me' : '');
    f.innerHTML = `${killer ? `<span style="color:${killer.color}">${esc(killer.name)}</span> ` : ''}${emoji} <span style="color:${victim.color}">${esc(victim.name)}</span>`;
    this.el.feed.appendChild(f);
    while (this.el.feed.children.length > 5) this.el.feed.firstChild.remove();
    setTimeout(() => f.remove(), 6500);
  }

  /** compact top-5 leaderboard, throttled */
  leaderboard(rows, dt) {
    this._lbT -= dt;
    if (this._lbT > 0) return;
    this._lbT = 0.3;
    const top = rows.slice(0, 5);
    const me = rows.findIndex((r) => r.isLocal);
    if (me >= 0) { const n = me + 1; this.el.rank.textContent = n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]); this.el.rankof.textContent = '/ ' + rows.length; }
    if (me > 4) top.push(rows[me]);
    const html = top.map((r) => `<div class="r${r.isLocal ? ' me' : ''}"><em>${r.kills}</em><span style="color:${r.isLocal ? '#ffe45a' : '#fff'}">${esc(r.name)}</span><b>${r.kills}</b></div>`).join('');
    if (this._last.lb !== html) { this._last.lb = html; this.el.lb.innerHTML = html; }
  }

  scoreboard(show, rows, title = 'SCOREBOARD') {
    this.el.sb.classList.toggle('hidden', !show);
    if (!show) return;
    this.el.sb.innerHTML = `<h4>${title}</h4><table class="score"><tr><th>#</th><th>Driver</th><th class="num">Kills</th><th class="num">Deaths</th></tr>${
      rows.map((r, i) => `<tr class="${r.isLocal ? 'me' : ''}"><td>${i + 1}</td><td><i style="background:${r.color}"></i>${esc(r.name)}</td><td class="num">${r.kills}</td><td class="num">${r.deaths}</td></tr>`).join('')}</table>`;
  }

  /* ---- minimap ---- */
  setMap(world) {
    const S = this.el.mini.width;
    const b = world.bounds;
    const ex = b.type === 'circle' ? b.r : b.hw, ez = b.type === 'circle' ? b.r : b.hd;
    const sc = (S - 16) / (Math.max(ex, ez) * 2);
    this.mm = { sc, S };
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.translate(S / 2, S / 2);
    g.fillStyle = 'rgba(70,60,140,0.65)';
    outline(g, b, sc); g.fill();
    g.fillStyle = '#e8e0ff';
    for (const bx of world.boxes) g.fillRect((bx.x - bx.hw) * sc, (bx.z - bx.hd) * sc, bx.w * sc, bx.d * sc);
    for (const p of world.pillars) { g.beginPath(); g.arc(p.x * sc, p.z * sc, Math.max(2, p.r * sc), 0, 7); g.fill(); }
    g.fillStyle = 'rgba(100,255,60,0.6)';
    for (const s of world.slime) { g.beginPath(); g.arc(s.x * sc, s.z * sc, s.r * sc, 0, 7); g.fill(); }
    this.mapLayer = c;
  }

  drawMinimap(world, karts, me, camH) {
    if (!this.mapLayer) return;
    const g = this.mctx, { sc, S } = this.mm;
    g.clearRect(0, 0, S, S);
    g.drawImage(this.mapLayer, 0, 0);
    g.save();
    g.translate(S / 2, S / 2);
    for (const ib of world.itemBoxes) {
      if (!ib.active) continue;
      g.fillStyle = '#ffd23a';
      g.fillRect(ib.x * sc - 2, ib.z * sc - 2, 4, 4);
    }
    for (const k of karts) {
      if (k.dead) continue;
      g.fillStyle = k.colorHex;
      g.strokeStyle = k === me ? '#fff' : '#000';
      g.lineWidth = k === me ? 2 : 1;
      g.beginPath(); g.arc(k.x * sc, k.z * sc, k === me ? 5 : 3.5, 0, 7); g.fill(); g.stroke();
      if (k === me) { // heading tick
        g.beginPath(); g.moveTo(k.x * sc, k.z * sc); g.lineTo(k.x * sc + Math.sin(k.h) * 11, k.z * sc + Math.cos(k.h) * 11); g.stroke();
      }
    }
    g.restore();
  }
}
