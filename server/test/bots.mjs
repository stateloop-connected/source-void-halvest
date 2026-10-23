// Two network bots play one episode against a running server.
// Usage: URL=ws://localhost:2567 node test/bots.mjs [--seconds 60] [--private]
import { Client } from '@colyseus/sdk';
import { botCommand } from '../../shared/bots/policy.js';

const URL = process.env.URL || 'ws://localhost:2567';
const args = process.argv.slice(2);
const SECONDS = Number(args[args.indexOf('--seconds') + 1]) || 60;
const PRIVATE = args.includes('--private');

function viewFromState(state) {
  // the state is empty until the first patch arrives (slower over the internet)
  if (!state || !state.players || !state.agents || !state.objects) return { players: [], enemies: [], core: null, zone: null };
  const players = [];
  state.players.forEach((p, sid) => players.push({ sid, seat: p.slot, x: p.x, y: p.y, downed: p.downed, bledOut: p.bledOut, carrying: p.carrying }));
  const enemies = [];
  state.agents.forEach((e) => enemies.push({ x: e.x, y: e.y }));
  let core = null, zone = null;
  state.objects.forEach((o) => {
    if (o.type === 'core') { const attach = {}; o.attach.forEach((a, sid) => { attach[sid] = a.handle; }); core = { x: o.x, y: o.y, theta: o.yaw, holders: [...o.heldBy], attach }; }
    if (o.type === 'drop_zone') zone = { x: o.x, y: o.y, r: o.r };
  });
  return { players, enemies, core, zone };
}

async function bot(name, joinFn) {
  const client = new Client(URL);
  const room = await joinFn(client);
  const counts = {};
  const tally = (k) => { counts[k] = (counts[k] || 0) + 1; };
  room.onMessage('*', (type, msg) => {
    tally(type);
    if (type === 'offer') room.send('pick', { level: msg.level, skill: msg.choices[0] });
    if (type === 'fx') for (const [n] of msg) tally(`fx.${n}`);
  });
  const input = room.input();
  let t = 0;
  const timer = setInterval(() => {
    t++;
    const view = viewFromState(room.state);
    Object.assign(input.data, botCommand(view, room.sessionId, t));
    input.send();
  }, input.stepMs || 16);
  return { name, room, counts, stop: () => clearInterval(timer) };
}

const a = await bot('A', (c) => (PRIVATE ? c.create('coop', { name: 'BotA', private: true, bot: true }) : c.joinOrCreate('coop', { name: 'BotA', bot: true })));
console.log('A joined room', a.room.roomId, 'code', a.room.state.code);
const b = await bot('B', (c) => (PRIVATE ? c.joinById(a.room.roomId, { name: 'BotB', bot: true }) : c.joinOrCreate('coop', { name: 'BotB', bot: true })));
console.log('B joined room', b.room.roomId);

const t0 = Date.now();
let ended = false;
b.room.onMessage('evt:episode_end', (m) => { ended = true; console.log('episode_end', JSON.stringify(m)); });
while (Date.now() - t0 < SECONDS * 1000 && !ended) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = a.room.state;
  let core='none'; s.objects.forEach((o,id)=>{ if(o.type==='core') core=`${id}@${o.x.toFixed(0)},${o.y.toFixed(0)} held=${o.heldBy.length}`; if(o.type==='drop_zone') core+=` zone=${o.progress.toFixed(2)}`; });
  const pl=[]; s.players.forEach((p)=>pl.push(`${p.slot}:${p.x.toFixed(0)},${p.y.toFixed(0)}${p.carrying?'*':''}${p.downed?'D':''}`));
  console.log(`players=${pl.join(' ')} core=${core} t=${((Date.now() - t0) / 1000).toFixed(0)}s phase=${s.phase} tick=${s.tick} wave=${s.wave} agents=${s.agents.size} objects=${s.objects.size} score=${s.score} kills=${s.kills}`);
}
console.log('A messages', a.counts);
a.stop(); b.stop();
await a.room.leave();
await b.room.leave();
process.exit(0);
