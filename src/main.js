import './style.css';
import { audio } from './audio.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { UI, loadSettings } from './ui.js';
import { MAPS } from './maps.js';
import { pick } from './util.js';

const settings = loadSettings();
const hud = new Hud();
const game = new Game({ canvas: document.getElementById('c'), audio, hud, settings });
const ui = new UI({ game, audio, settings });

// live attract-mode behind the menus: bots brawl while you pick a map
game.startMatch({ mode: 'attract', mapId: pick(MAPS).id });

let last = performance.now();
function loop(now) {
  const dt = (now - last) / 1000;
  last = now;
  try { game.frame(dt); } catch (e) { console.error(e); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// handy for debugging from the console
window.__brk = { game, ui, audio };
