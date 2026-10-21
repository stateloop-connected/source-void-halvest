// Headless run: two scripted bots play a whole run in the simulation, with no
// network. Checks that the run ends, cores get delivered, and the same seed
// gives the same result (replayability).
import { World } from '../sim/world.js';
import { botCommand, viewFromWorld } from '../bots/policy.js';
import { SKILLS } from '../../js/skills.js';

function run(seed, maxTicks = 60 * 60 * 6) {
  const w = new World(seed, [
    { sid: 'A', seat: 0, name: 'A', color: '#00ffff' },
    { sid: 'B', seat: 1, name: 'B', color: '#ff8800' },
  ]);
  const counts = {};
  let digest = 0;
  for (let t = 0; t < maxTicks && !w.over; t++) {
    const view = viewFromWorld(w);
    const inputs = { A: botCommand(view, 'A', t), B: botCommand(view, 'B', t) };
    const events = w.step(inputs);
    for (const e of events) {
      const k = `${e.ch}:${e.name}`;
      counts[k] = (counts[k] || 0) + 1;
      if (e.ch === 'private' && e.name === 'offer') {
        // bots pick the first offered skill straight away
        const r = w.pickSkill(e.to, e.data.level, e.data.choices[0]);
        if (!r.ok) throw new Error(`pick failed: ${r.reason}`);
      }
    }
    for (const p of w.players) digest = (digest * 31 + Math.round(p.x * 10) + Math.round(p.y * 10)) >>> 0;
  }
  return { w, counts, digest };
}

const t0 = Date.now();
const a = run(12345);
const ms = Date.now() - t0;
const b = run(12345);
const c = run(999);
const fmt = (r) => ({
  ticks: r.w.tick, over: r.w.over, outcome: r.w.outcome, reason: r.w.reason, wave: r.w.wave,
  kills: r.w.kills, cores: r.w.score,
  players: r.w.players.map((p) => ({ seat: p.seat, level: p.level, hp: Math.round(p.health), downed: p.downed, bled: p.bledOut, ...p.stats, skills: Object.keys(p.skills).length })),
});
console.log(JSON.stringify(fmt(a), null, 1));
console.log('events', a.counts);
console.log('same seed same result:', a.digest === b.digest && a.w.tick === b.w.tick, '| other seed differs:', a.digest !== c.digest);
console.log('sim speed:', Math.round(a.w.tick / (ms / 1000)), 'ticks/s', `(${(a.w.tick / 60 / (ms / 1000)).toFixed(0)}x realtime)`);
console.log('skills known:', SKILLS.length);
if (a.digest !== b.digest) process.exit(1);
