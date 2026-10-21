// A simple scripted co-op player. Used by the headless simulation test and by
// the network test bots. It works on a plain "view" so it runs on the
// simulation objects and on decoded Colyseus state alike.
//
// view = {
//   players: [{ sid, seat, x, y, downed, bledOut, carrying }],
//   enemies: [{ x, y }],
//   core: { x, y, theta, holders: [sid], attach: { sid: handle } } | null,
//   zone: { x, y, r } | null,
// }

const CORE_HALF = 60;
const ARENA = 4500;

export function botCommand(view, sid, t = 0) {
  const me = view.players.find((p) => p.sid === sid);
  const cmd = { mx: 0, my: 0, aimX: 0, aimY: 0, fire: false, auto: true, interact: false };
  if (!me || me.downed || me.bledOut) return cmd;
  const partner = view.players.find((p) => p.sid !== sid);

  // Aim at the nearest enemy (autoshoot does the firing).
  let nearest = null, nd = Infinity;
  for (const e of view.enemies) {
    const d = (e.x - me.x) ** 2 + (e.y - me.y) ** 2;
    if (d < nd) { nd = d; nearest = e; }
  }
  cmd.aimX = nearest ? nearest.x : me.x + 200;
  cmd.aimY = nearest ? nearest.y : me.y;

  const goTo = (x, y, stopAt = 8) => {
    const dx = x - me.x, dy = y - me.y, d = Math.hypot(dx, dy);
    if (d > stopAt) { cmd.mx = dx / d; cmd.my = dy / d; }
    return d;
  };

  // 1. Revive a downed partner.
  if (partner && partner.downed && !partner.bledOut) {
    const d = goTo(partner.x, partner.y, 40);
    if (d < 90) cmd.interact = true;
    return cmd;
  }

  // 2. Carry the core to the zone, each bot on its own handle.
  if (view.core && view.zone && partner && !partner.downed) {
    const c = view.core;
    const attach = c.attach || {};
    const taken = Object.entries(attach).filter(([sid]) => sid !== me.sid).map(([, h]) => h);
    let handle = me.seat === 0 ? 0 : 1;
    if (taken.includes(handle)) handle = 1 - handle;
    const s = handle === 0 ? -1 : 1;
    const hx = c.x + s * Math.cos(c.theta) * (CORE_HALF + 12);
    const hy = c.y + s * Math.sin(c.theta) * (CORE_HALF + 12);
    if (me.carrying) {
      cmd.interact = true;
      const bothHolding = (c.holders || []).length === 2;
      if (bothHolding) {
        const dx = view.zone.x - c.x, dy = view.zone.y - c.y, d = Math.hypot(dx, dy);
        if (d > 1) { cmd.mx = dx / d; cmd.my = dy / d; }
      }
      return cmd;
    }
    const d = goTo(hx, hy, 4);
    if (d < 30) cmd.interact = true;
    return cmd;
  }

  // 3. Otherwise kite: back away from close enemies, drift towards the partner.
  if (nearest && nd < 260 * 260) {
    const d = Math.sqrt(nd) || 1;
    cmd.mx = (me.x - nearest.x) / d;
    cmd.my = (me.y - nearest.y) / d;
  } else if (partner) {
    goTo(partner.x + (me.seat === 0 ? -80 : 80), partner.y, 60);
  }
  // Stay away from the walls.
  if (me.x < 200) cmd.mx = Math.max(cmd.mx, 0.6);
  if (me.x > ARENA - 200) cmd.mx = Math.min(cmd.mx, -0.6);
  if (me.y < 200) cmd.my = Math.max(cmd.my, 0.6);
  if (me.y > ARENA - 200) cmd.my = Math.min(cmd.my, -0.6);
  void t;
  return cmd;
}

/** Build a policy view from the simulation World. */
export function viewFromWorld(w) {
  return {
    players: w.players.map((p) => ({ sid: p.sid, seat: p.seat, x: p.x, y: p.y, downed: p.downed, bledOut: p.bledOut, carrying: p.carrying })),
    enemies: w.enemies.map((e) => ({ x: e.x, y: e.y })),
    core: w.core ? { x: w.core.x, y: w.core.y, theta: w.core.theta, holders: w.core.holders, attach: w.core.attach } : null,
    zone: w.zone ? { x: w.zone.x, y: w.zone.y, r: w.zone.r } : null,
  };
}
