import { defineServer, defineRoom, matchMaker } from 'colyseus';
import { CoopRoom } from './CoopRoom.js';

// Origins allowed to call the HTTP matchmaking routes. The game runs in the
// Stateloop play frame (play.stateloop.ai); add local dev origins via env.
const ALLOWED = new Set(
  (process.env.ALLOWED_ORIGINS || 'https://play.stateloop.ai,https://creator.stateloop.ai,https://games.stateloop.ai')
    .split(',').map((s) => s.trim()).filter(Boolean),
);
for (const o of (process.env.EXTRA_ORIGINS || '').split(',')) if (o.trim()) ALLOWED.add(o.trim());

matchMaker.controller.getCorsHeaders = function (headers) {
  const origin = headers.get('origin') || '';
  const ok = ALLOWED.has(origin);
  // The SDK calls matchmaking with credentials: "include", so browsers need
  // the exact origin echoed and Allow-Credentials: true (the default header).
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Vary': 'Origin',
  };
};

const server = defineServer({
  rooms: {
    coop: defineRoom(CoopRoom),
  },
});

export default server;
