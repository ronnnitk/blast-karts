import { defineConfig } from 'vite';
import { createRoomServer, attachUpgrade } from './server/rooms.js';

// In dev the room relay is mounted on the Vite server at /ws, so `npm run dev` is all you need for online play.
const roomRelay = () => ({
  name: 'brainrot-room-relay',
  configureServer(server) {
    attachUpgrade(server.httpServer, createRoomServer());
  },
});

export default defineConfig({
  plugins: [roomRelay()],
  build: { chunkSizeWarningLimit: 1200 },
});
