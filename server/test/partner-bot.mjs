// A scripted partner for testing with one human in a browser.
// Usage: URL=ws://localhost:2567 CODE=ABCD node test/partner-bot.mjs [--seconds 120]
// Without CODE it quick-matches.
import { Client } from '@colyseus/sdk';
import { botCommand } from '../../shared/bots/policy.js';

const URL = process.env.URL || 'ws://localhost:2567';
const CODE = process.env.CODE || '';
const args = process.argv.slice(2);
const SECONDS = Number(args[args.indexOf('--seconds') + 1]) || 120;

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

const client = new Client(URL);
const room = CODE ? await client.joinById(CODE, { name: 'PartnerBot', color: '#ffaa44', bot: true }) : await client.joinOrCreate('coop', { name: 'PartnerBot', color: '#ffaa44', bot: true });
console.log('joined', room.roomId);
room.onMessage('*', (type, msg) => {
  if (type === 'offer') room.send('pick', { level: msg.level, skill: msg.choices[0] });
  if (type === 'evt:episode_end') { console.log('episode_end', msg.outcome, msg.reason); setTimeout(() => room.send('ready', {}), 3000); }
  if (type === 'chat') console.log('chat', msg.text);
});
const input = room.input();
let t = 0;
const timer = setInterval(() => {
  t++;
  Object.assign(input.data, botCommand(viewFromState(room.state), room.sessionId, t));
  input.send();
}, input.stepMs || 16);
setTimeout(async () => { clearInterval(timer); await room.leave(); process.exit(0); }, SECONDS * 1000);
