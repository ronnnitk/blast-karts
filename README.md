# Brainrot Karts

Fast arena kart combat (Three.js + Vite + vanilla JS) with a Brainrot arsenal. All models, sounds and effects are
original and generated in code — no external assets.

```bash
npm install
npm run dev      # game + online room relay on http://localhost:5173
npm run build    # production build into dist/
npm start        # build, then serve dist/ + online relay on http://localhost:8787
```

## Controls
| | |
|---|---|
| WASD / arrows | drive |
| Shift (or V) | drift - hold while steering; release for a mini-turbo proportional to drift time |
| Tap W rapidly | pivot steering - spin on the spot for tight turns / donuts |
| Space / E / click | use item (hold for Fart Blast) |
| Tab | scoreboard |
| Esc | pause |
| Gamepad | stick steer, RT/A gas, LT brake, B/LB drift, X/RB item |

## Arsenal
💨 Fart Blast · 🦈 Tralalero Missile (homing) · ⛓️ Chain Spike (orbiting) · 🫧 Invincible Bubble (ram to destroy) · 🚀 Rocket Launcher (3 straight rockets) · 🔫 Auto Machine Gun ·
🐊 Bombardiro Crocodilo (airstrike) · 🚽 Skibidi Toilet Mine · ⚡ Sigma Boost · 🍌 Chimpanzini Banana ·
🥶 Brr Brr Freeze · 🌀 Lirili Larila Warp

## Kill sound
Settings → *Kill sound*: pick a built-in sound or upload your own MP3/WAV/OGG. It is stored in the browser
(IndexedDB) and plays whenever you destroy a kart. Max clip length is adjustable.

## Online
Main menu: **PLAY** (solo vs bots), **CREATE ROOM**, **JOIN ROOM**.

- **Create Room** — pick map, max players (2–8), round time and which weapons are allowed. A random 5-digit
  Room ID is shown at the top; share it with friends.
- **Join Room** — type the 5-digit Room ID only. Map, time and weapons come from the host's settings.
- The host presses START MATCH in the lobby. Everyone must use the same server (address under Settings → Online).

The server (`server/rooms.js`) only relays messages; each client is authoritative over its own kart and applies
damage to itself. No bots in online matches.

## Layout
`src/game.js` match loop · `kart.js` handling/drift · `weapons.js` items · `bots.js` AI + A* nav (`world.js`) ·
`maps.js` arenas · `audio.js` synth + kill sounds · `fx.js` particles · `net.js` + `server/` multiplayer.

## Deploying so friends anywhere can join

One Node process serves the game and the room relay (`/ws`), so you need a host that runs Node and allows WebSockets (Render, Railway, Fly.io, a VPS). Static-only hosts (Netlify, Vercel, GitHub Pages) will NOT work for multiplayer.

- Build: `npm install && npm run build`
- Start: `node server/server.js` (reads `PORT`; wss:// is used automatically on https)
- Render: push the folder to GitHub, create a Blueprint from it (`render.yaml` is included), share the URL it gives you.
