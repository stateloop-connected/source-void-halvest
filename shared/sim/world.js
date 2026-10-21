// Void Halvest: the authoritative simulation.
//
// A port of the original single-browser game logic (js/entities/*, js/systems/*)
// to a fixed 60 Hz step with seeded randomness, two remote players and a new
// carry-together mechanic (the Void Core). No DOM, no three.js: it runs in Node
// on the server and can be replayed headless from seed + inputs.
//
// Coordinates: game units on a 4500 x 4500 plane, origin top-left, +y down.
// Unlike the original, every position here is an entity CENTRE.

import {
  ARENA_W, ARENA_H, UNITS_PER_TICK, PLAYER_W, ITEM_W, ITEM_LIFETIME, MAX_ITEMS,
  REVIVE_RANGE, REVIVE_TIME, AUTOSHOOT_OVERRIDE, LIGHT_HEIGHT_BASE, LIGHT_LIT_FACTOR,
  CORE_LENGTH, CORE_GRAB_RANGE, CORE_CARRY_SPEED, CORE_MAX_TURN, CORE_FIRST_SPAWN,
  CORE_RESPAWN, CORE_SPAWN_MIN, CORE_SPAWN_MAX, ZONE_RADIUS, ZONE_DIST_MIN, ZONE_DIST_MAX,
  ZONE_DELIVER_TIME, ARENA_MARGIN, CORE_XP_REWARD, CORE_HEAL_RATIO,
  GAME_DURATION, WAVE_DURATION, INITIAL_SPAWN_RATE, MIN_SPAWN_RATE, SPAWN_RATE_DECREASE,
  WAVE_UNLOCK_FAST, WAVE_UNLOCK_SHOOTER, WAVE_UNLOCK_TANK, WAVE_UNLOCK_ICE,
  WAVE_SCALING_BOOST_1, WAVE_SCALING_BOOST_2, ENEMY_SCALING_PER_WAVE, SHOOTER_STOP_RANGE,
  PLAYER_BASE_HEALTH, PLAYER_BASE_SPEED, PLAYER_BASE_DAMAGE, PLAYER_BASE_FIRE_RATE,
  PLAYER_BASE_LIGHT_RADIUS, XP_LEVEL_MULTIPLIER, INITIAL_XP_REQUIRED,
  BULLET_BASE_SPEED, BULLET_BASE_RANGE, BULLET_SIZE, POLAR_VORTEX_RADIUS,
  HEALTH_DROP_BASE_RATE, HEALTH_RESTORE_AMOUNT, ITEM_MAGNET_BASE_RANGE, XP_ITEM_BASE_VALUE,
  SKILL_CHOICES_BASE, SKILL_CHOICES_WITH_EXTRA,
} from './config.js';
import { stepPlayerMove } from './move.js';
import { stream } from './rng.js';
import { SKILLS } from '../../js/skills.js';

const S = UNITS_PER_TICK;
const RUN_LENGTH = GAME_DURATION * 60; // game units (the HUD clock shows /60)
const MAX_ALIVE_ENEMIES = 300;
const ENEMY_BULLET_SPEED = 4;
const ENEMY_BULLET_RANGE = 600;
const BULLET_W = BULLET_SIZE * 2;

const ENEMY_TYPES = {
  basic: { hp: 30, speed: 1.5, damage: 10, xp: 1, w: 32 },
  fast: { hp: 15, speed: 2.7, damage: 5, xp: 2, w: 28 },
  tank: { hp: 100, speed: 0.8, damage: 20, xp: 5, w: 40 },
  shooter: { hp: 20, speed: 1.0, damage: 5, xp: 3, w: 32, shootRate: 240 },
  ice: { hp: 25, speed: 0.9, damage: 5, xp: XP_ITEM_BASE_VALUE, w: 32, shootRate: 180 },
};

// Personal Light is redundant online (every player has a cursor light).
const OFFERABLE = SKILLS.filter((s) => s.id !== 'p2_light');

function overlap(ax, ay, aw, bx, by, bw) {
  const h = (aw + bw) / 2;
  return Math.abs(ax - bx) < h && Math.abs(ay - by) < h;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

class SpatialHash {
  constructor(cell = 150) { this.cell = cell; this.map = new Map(); }
  clear() { this.map.clear(); }
  key(i, j) { return i * 65536 + j; }
  insert(e) {
    const c = this.cell, h = e.w / 2;
    const i0 = Math.floor((e.x - h) / c), i1 = Math.floor((e.x + h) / c);
    const j0 = Math.floor((e.y - h) / c), j1 = Math.floor((e.y + h) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      let list = this.map.get(k);
      if (!list) { list = []; this.map.set(k, list); }
      list.push(e);
    }
  }
  /** Entities whose cells touch the box [x0, x1] x [y0, y1], in insertion order. */
  query(x0, y0, x1, y1) {
    const c = this.cell, out = [], seen = new Set();
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
      for (let j = Math.floor(y0 / c); j <= Math.floor(y1 / c); j++) {
        const list = this.map.get(this.key(i, j));
        if (!list) continue;
        for (const e of list) if (!seen.has(e)) { seen.add(e); out.push(e); }
      }
    }
    out.sort((a, b) => a.n - b.n); // deterministic order regardless of cell walk
    return out;
  }
}

export function newPlayer(sid, seat, name, color) {
  return {
    sid, seat, name, color,
    x: ARENA_W / 2 + (seat === 0 ? -60 : 60), y: ARENA_H / 2, vx: 0, vy: 0,
    angle: 0, aimX: ARENA_W / 2, aimY: ARENA_H / 2 - 200,
    alive: true, downed: false, bledOut: false, canBeRevived: true,
    downedTimer: 0, maxDownedTime: 30 * 60, reviveProgress: 0, reviving: '',
    maxHealth: PLAYER_BASE_HEALTH, health: PLAYER_BASE_HEALTH, speed: PLAYER_BASE_SPEED,
    slowEffects: [], slow: 0, freezeDoTTimer: 0,
    damage: PLAYER_BASE_DAMAGE, fireRate: PLAYER_BASE_FIRE_RATE, fireTimer: 0,
    bulletSpeed: BULLET_BASE_SPEED, bulletSize: BULLET_W, projectileCount: 1,
    piercing: 0, range: BULLET_BASE_RANGE, splashRadius: 0, splashDamageRatio: 0,
    freezeChance: 0, extraChoice: false, healthRegen: 0, regenTimer: 0, armor: 0,
    shieldUnlocked: false, shieldActive: false, shieldTimer: 0, shieldCooldown: 600,
    stasisUnlocked: false, stasisRadius: POLAR_VORTEX_RADIUS, stasisSlow: 0, stasisBulletSlow: false,
    deflectUnlocked: false, deflectCharges: 0, deflectMaxCharges: 0,
    deflectRechargeTimer: 0, deflectRechargeInterval: 60,
    magnetBonus: 0, dropBonus: 0, lightRadiusBonus: 0, hasPersonalLight: false,
    currentSpread: 0, maxSpread: 0.35, minSpread: 0.02, spreadPerShot: 0.08, spreadRecovery: 0.005,
    xp: 0, level: 1, xpToLevel: INITIAL_XP_REQUIRED, skills: {},
    autoshoot: true, autoOverride: 0, carrying: '', interact: false,
    offers: [], killedBy: '', connected: true,
    stats: { kills: 0, shots: 0, hits: 0, damageDealt: 0, damageTaken: 0, revives: 0, deliveries: 0 },
  };
}

export class World {
  /**
   * @param {number} seed
   * @param {{sid:string, seat:number, name:string, color:string}[]} seats
   */
  constructor(seed, seats) {
    this.seed = seed >>> 0;
    this.rng = {
      spawn: stream(this.seed, 'spawn'),
      combat: stream(this.seed, 'combat'),
      loot: stream(this.seed, 'loot'),
      skills: stream(this.seed, 'skills'),
      core: stream(this.seed, 'core'),
    };
    this.players = seats
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((s) => newPlayer(s.sid, s.seat, s.name, s.color));
    this.enemies = [];
    this.bullets = [];
    this.items = [];
    this.core = null;
    this.zone = null;
    this.nextId = 1;
    this.tick = 0;
    this.gameTime = 0;
    this.wave = 1;
    this.spawnTimer = 0;
    this.spawnRate = INITIAL_SPAWN_RATE;
    this.difficultyTimer = 0;
    this.kills = 0;
    this.score = 0; // cores delivered
    this.nextCoreAt = CORE_FIRST_SPAWN;
    this.over = false;
    this.outcome = '';
    this.reason = '';
    this.hash = new SpatialHash(150);
    this.events = [];
  }

  id(prefix) { return `${prefix}${this.nextId++}`; }
  player(sid) { return this.players.find((p) => p.sid === sid); }
  livePlayers() { return this.players.filter((p) => !p.downed && !p.bledOut && p.health > 0); }

  /** One-shot happening. ch 'evt' = recorded label (guide names),
   * 'fx' = cosmetic for clients, 'private' = to one seat only. */
  emit(ch, name, data, to) { this.events.push({ ch, name, data, to }); }

  // --------------------------------------------------------------------------
  /** Advance one fixed step. `inputs` maps sid -> {mx, my, aimX, aimY, fire, auto, interact}. */
  step(inputs) {
    this.events = [];
    if (this.over) return this.events;
    this.tick++;
    this.gameTime += S;

    for (const p of this.players) this.updatePlayer(p, inputs[p.sid] || {});
    this.updateRevive(inputs);
    this.updateCore(inputs);
    this.updateSpawning();

    this.hash.clear();
    for (const e of this.enemies) this.hash.insert(e);
    this.updateEnemies();
    this.updateContacts();
    this.updateBullets();
    this.updateItems();
    this.checkEnd();
    return this.events;
  }

  // ---- Players -------------------------------------------------------------
  updatePlayer(p, cmd) {
    p.interact = !!cmd.interact;
    if (typeof cmd.auto === 'boolean') p.autoshoot = cmd.auto;
    if (Number.isFinite(cmd.aimX) && Number.isFinite(cmd.aimY)) {
      p.aimX = Math.max(-500, Math.min(ARENA_W + 500, cmd.aimX));
      p.aimY = Math.max(-500, Math.min(ARENA_H + 500, cmd.aimY));
    }

    if (p.bledOut) { p.vx = 0; p.vy = 0; return; }
    if (p.downed) {
      p.vx = 0; p.vy = 0;
      if (p.downedTimer > 0) {
        p.downedTimer = Math.max(0, p.downedTimer - S);
        if (p.downedTimer <= 0) {
          p.health = 0;
          p.canBeRevived = false;
          p.bledOut = true;
          p.alive = false;
          this.emit('fx', 'bledout', { seat: p.sid });
        }
      }
      return;
    }

    // Slows (ice) decay in game time.
    for (let i = p.slowEffects.length - 1; i >= 0; i--) {
      p.slowEffects[i].timer -= S;
      if (p.slowEffects[i].timer <= 0) p.slowEffects.splice(i, 1);
    }
    const totalSlow = p.slowEffects.reduce((sum, e) => sum + e.amount, 0);
    p.slow = Math.min(1, totalSlow);

    stepPlayerMove(p, cmd); // no-op while carrying: the core moves the carriers

    // Aim: manual fire aims at the cursor and suspends autoshoot for a while.
    p.autoOverride = Math.max(0, p.autoOverride - S);
    let tx = p.aimX, ty = p.aimY, autoTarget = null;
    if (cmd.fire && !p.carrying) {
      p.autoOverride = AUTOSHOOT_OVERRIDE;
    } else if (p.autoshoot && p.autoOverride <= 0) {
      autoTarget = this.findTarget(p);
      if (autoTarget) { tx = autoTarget.x; ty = autoTarget.y; }
    }
    p.angle = Math.atan2(ty - p.y, tx - p.x);

    if (p.fireTimer > 0) p.fireTimer = Math.max(0, p.fireTimer - S);
    if (p.healthRegen > 0) {
      p.regenTimer += S;
      if (p.regenTimer >= 60) { p.regenTimer = 0; p.health = Math.min(p.maxHealth, p.health + p.healthRegen); }
    }
    const recovery = p.fireTimer <= 0 ? p.spreadRecovery : p.spreadRecovery * 0.5;
    p.currentSpread = Math.max(p.minSpread, p.currentSpread - recovery * S);
    if (p.shieldUnlocked && !p.shieldActive) {
      p.shieldTimer -= S;
      if (p.shieldTimer <= 0) p.shieldActive = true;
    }
    if (p.deflectUnlocked && p.deflectCharges < p.deflectMaxCharges) {
      p.deflectRechargeTimer -= S;
      if (p.deflectRechargeTimer <= 0) { p.deflectCharges++; p.deflectRechargeTimer = p.deflectRechargeInterval; }
    }
    if (totalSlow >= 1) {
      p.freezeDoTTimer += S;
      if (p.freezeDoTTimer >= 12) {
        p.freezeDoTTimer = 0;
        this.damagePlayer(p, p.slowEffects.length, 'ice');
        if (p.downed) return;
      }
    } else {
      p.freezeDoTTimer = 0;
    }

    // Shooting. Carriers have their hands busy: autoshoot only, half rate.
    const wantFire = (cmd.fire && !p.carrying) || !!autoTarget;
    if (wantFire && p.fireTimer <= 0) {
      p.fireTimer = p.carrying ? p.fireRate * 2 : p.fireRate;
      this.firePlayer(p);
    }
  }

  damagePlayer(p, amount, source) {
    if (p.downed || p.bledOut) return false;
    if (p.shieldActive) {
      p.shieldActive = false;
      p.shieldTimer = p.shieldCooldown;
      this.emit('fx', 'shield', { seat: p.sid });
      return false;
    }
    if (p.armor > 0) amount = Math.max(0, amount - p.armor);
    p.health -= amount;
    p.stats.damageTaken += amount;
    if (p.health <= 0) {
      p.health = 0;
      p.downed = true;
      p.downedTimer = p.maxDownedTime;
      p.killedBy = String(source || '');
      p.slowEffects.length = 0;
      p.slow = 0;
      p.freezeDoTTimer = 0;
      this.releaseCore(p, 'drop');
      this.emit('fx', 'downed', { seat: p.sid, by: p.killedBy });
      return true;
    }
    return false;
  }

  litBy(x, y) {
    for (const p of this.players) {
      if (p.bledOut) continue;
      const r = LIGHT_HEIGHT_BASE * (1 + p.lightRadiusBonus) * LIGHT_LIT_FACTOR;
      const dx = x - p.aimX, dy = y - p.aimY;
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }

  findTarget(p) {
    const range = p.range || 600;
    const cand = this.hash.query(p.x - range, p.y - range, p.x + range, p.y + range);
    let best = null, bestD = range * range;
    for (const e of cand) {
      if (e.health <= 0) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = dx * dx + dy * dy;
      if (d >= bestD) continue;
      if (!this.litBy(e.x, e.y)) continue;
      bestD = d;
      best = e;
    }
    return best;
  }

  firePlayer(p) {
    const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
    const make = (angleOffset, side) => {
      const sx = p.x + 25 * cos - side * sin;
      const sy = p.y + 25 * sin + side * cos;
      this.spawnBullet({
        owner: p.sid, isPlayer: true, x: sx, y: sy, angle: p.angle + angleOffset,
        speed: p.bulletSpeed, damage: p.damage, piercing: p.piercing, maxDist: p.range,
        freezeChance: p.freezeChance, splashRadius: p.splashRadius,
        splashDamageRatio: p.splashDamageRatio, color: p.color,
      });
      p.stats.shots++;
    };
    const r = this.rng.combat;
    if (p.projectileCount === 1) {
      make((r() - 0.5) * 2 * p.currentSpread, 10);
    } else {
      for (let i = 0; i < p.projectileCount; i++) {
        const base = (i - (p.projectileCount - 1) / 2) * 0.15;
        make(base + (r() - 0.5) * 2 * p.currentSpread, i % 2 === 0 ? 10 : -10);
      }
    }
    p.currentSpread = Math.min(p.maxSpread, p.currentSpread + p.spreadPerShot);
  }

  spawnBullet(o) {
    const b = {
      id: this.id('b'), owner: o.owner || '', isPlayer: o.isPlayer, x: o.x, y: o.y,
      angle: o.angle, speed: o.speed, vx: Math.cos(o.angle) * o.speed, vy: Math.sin(o.angle) * o.speed,
      damage: o.damage, piercing: o.piercing || 0, dist: 0, maxDist: o.maxDist,
      enemyType: o.enemyType || '', freezeChance: o.freezeChance || 0,
      splashRadius: o.splashRadius || 0, splashDamageRatio: o.splashDamageRatio || 0,
      forceFreeze: !!o.forceFreeze, hit: new Set(),
    };
    this.bullets.push(b);
    this.emit('fx', 'shot', {
      id: b.id, owner: b.owner, player: b.isPlayer, kind: b.enemyType, x: r1(b.x), y: r1(b.y),
      a: r3(b.angle), v: b.speed, d: b.maxDist, c: o.color || '',
    });
    return b;
  }

  // ---- Revive (hold interact next to a downed partner) ----------------------
  updateRevive(inputs) {
    for (const downed of this.players) {
      if (!downed.downed || !downed.canBeRevived) { downed.reviveProgress = 0; continue; }
      let reviver = null;
      for (const p of this.players) {
        if (p === downed || p.downed || p.bledOut || p.health <= 0) continue;
        if (Math.hypot(p.x - downed.x, p.y - downed.y) < REVIVE_RANGE && inputs[p.sid]?.interact) {
          reviver = p;
          break;
        }
      }
      if (reviver) {
        if (reviver.carrying) this.releaseCore(reviver, 'place'); // can't do both
        if (downed.reviving !== reviver.sid) {
          downed.reviving = reviver.sid;
          this.emit('evt', 'interact_start', { seat: reviver.sid, object: downed.sid, action: 'revive' });
        }
        downed.reviveProgress += S;
        if (downed.reviveProgress >= REVIVE_TIME) {
          downed.downed = false;
          downed.health = downed.maxHealth * 0.5;
          downed.reviveProgress = 0;
          downed.downedTimer = 0;
          downed.reviving = '';
          reviver.stats.revives++;
          this.emit('evt', 'interact_end', { seat: reviver.sid, object: downed.sid, action: 'revive', done: true });
          this.emit('fx', 'revived', { seat: downed.sid, by: reviver.sid });
        }
      } else {
        if (downed.reviving) {
          this.emit('evt', 'interact_end', { seat: downed.reviving, object: downed.sid, action: 'revive', done: false });
          downed.reviving = '';
        }
        downed.reviveProgress = Math.max(0, downed.reviveProgress - S);
      }
    }
  }

  // ---- Void Core: spawn, grab, carry together, deliver ----------------------
  updateCore(inputs) {
    if (!this.core) {
      if (this.gameTime >= this.nextCoreAt) this.spawnCore();
      return;
    }
    const core = this.core;
    const ax = Math.cos(core.theta), ay = Math.sin(core.theta);
    const handlePos = (h) => {
      const s = h === 0 ? -1 : 1;
      return { x: core.x + s * ax * (CORE_LENGTH / 2), y: core.y + s * ay * (CORE_LENGTH / 2) };
    };

    // Releases: let go of interact, downed, or gone.
    for (const sid of core.holders.slice()) {
      const p = this.player(sid);
      if (!p || p.downed || p.bledOut || !inputs[sid]?.interact) this.releaseCore(p || { sid }, p?.downed ? 'drop' : 'place');
    }
    // Grabs: free handle within reach while holding interact (revive wins).
    for (const p of this.players) {
      if (p.carrying || p.downed || p.bledOut || !inputs[p.sid]?.interact) continue;
      if (this.players.some((q) => q !== p && q.downed && q.canBeRevived && Math.hypot(q.x - p.x, q.y - p.y) < REVIVE_RANGE)) continue;
      let best = -1, bestD = CORE_GRAB_RANGE + PLAYER_W / 2;
      for (const h of [0, 1]) {
        if (Object.values(core.attach).includes(h)) continue;
        const hp = handlePos(h);
        const d = Math.hypot(hp.x - p.x, hp.y - p.y);
        if (d < bestD) { bestD = d; best = h; }
      }
      if (best >= 0) {
        core.holders.push(p.sid);
        core.attach[p.sid] = best;
        p.carrying = core.id;
        this.emit('evt', 'grab', { seat: p.sid, object: core.id, handle: best });
      }
    }

    // Motion: only with both handles held. Each carrier's input is a wanted
    // velocity at its handle; the bar translates with the mean and turns with
    // the difference across the bar. The carriers are then placed at the handles.
    core.vx = 0; core.vy = 0; core.omega = 0; core.tension = 0;
    if (core.holders.length === 2) {
      const u = [null, null];
      let speed = Infinity;
      for (const sid of core.holders) {
        const p = this.player(sid);
        const c = inputs[sid] || {};
        let mx = Number(c.mx) || 0, my = Number(c.my) || 0;
        const len = Math.hypot(mx, my);
        if (len > 1) { mx /= len; my /= len; }
        u[core.attach[sid]] = { x: mx, y: my };
        speed = Math.min(speed, p.speed * (1 - p.slow));
      }
      const k = speed * CORE_CARRY_SPEED * S;
      const ua = { x: u[0].x * k, y: u[0].y * k }, ub = { x: u[1].x * k, y: u[1].y * k };
      const nx = -ay, ny = ax;
      const rel = { x: ub.x - ua.x, y: ub.y - ua.y };
      let omega = (rel.x * nx + rel.y * ny) / CORE_LENGTH;
      const maxTurn = CORE_MAX_TURN * S;
      omega = Math.max(-maxTurn, Math.min(maxTurn, omega));
      core.omega = omega;
      core.tension = rel.x * ax + rel.y * ay; // > 0: carriers pull the bar apart
      core.vx = (ua.x + ub.x) / 2;
      core.vy = (ua.y + ub.y) / 2;
      core.theta = wrapAngle(core.theta + omega);
      const m = CORE_LENGTH / 2 + PLAYER_W;
      core.x = Math.max(m, Math.min(ARENA_W - m, core.x + core.vx));
      core.y = Math.max(m, Math.min(ARENA_H - m, core.y + core.vy));
    }
    const ax2 = Math.cos(core.theta), ay2 = Math.sin(core.theta);
    for (const sid of core.holders) {
      const p = this.player(sid);
      const s = core.attach[sid] === 0 ? -1 : 1;
      const off = CORE_LENGTH / 2 + PLAYER_W / 2;
      const nxp = core.x + s * ax2 * off, nyp = core.y + s * ay2 * off;
      p.vx = nxp - p.x; p.vy = nyp - p.y;
      p.x = nxp; p.y = nyp;
    }

    // Delivery: the core centre must stay in the zone for a moment.
    const z = this.zone;
    const inside = Math.hypot(core.x - z.x, core.y - z.y) < z.r;
    z.progress = inside ? z.progress + S : Math.max(0, z.progress - 2 * S);
    z.active = inside;
    if (z.progress >= ZONE_DELIVER_TIME) this.deliverCore();
  }

  spawnCore() {
    const r = this.rng.core;
    const live = this.livePlayers();
    const ref = live.length ? live : this.players;
    const ox = ref.reduce((s, p) => s + p.x, 0) / ref.length;
    const oy = ref.reduce((s, p) => s + p.y, 0) / ref.length;
    const clampX = (v) => Math.max(ARENA_MARGIN, Math.min(ARENA_W - ARENA_MARGIN, v));
    const clampY = (v) => Math.max(ARENA_MARGIN, Math.min(ARENA_H - ARENA_MARGIN, v));
    let cx = 0, cy = 0, zx = 0, zy = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = r() * Math.PI * 2;
      const d = CORE_SPAWN_MIN + r() * (CORE_SPAWN_MAX - CORE_SPAWN_MIN);
      cx = clampX(ox + Math.cos(a) * d);
      cy = clampY(oy + Math.sin(a) * d);
      const za = r() * Math.PI * 2;
      const zd = ZONE_DIST_MIN + r() * (ZONE_DIST_MAX - ZONE_DIST_MIN);
      zx = clampX(cx + Math.cos(za) * zd);
      zy = clampY(cy + Math.sin(za) * zd);
      if (Math.hypot(zx - cx, zy - cy) > ZONE_DIST_MIN * 0.75) break;
    }
    this.core = {
      id: this.id('core'), x: cx, y: cy, theta: (r() - 0.5) * Math.PI * 2,
      vx: 0, vy: 0, omega: 0, tension: 0, holders: [], attach: {},
    };
    this.zone = { id: this.id('zone'), x: zx, y: zy, r: ZONE_RADIUS, progress: 0, active: false };
    this.emit('evt', 'spawn', { id: this.core.id, type: 'core' });
    this.emit('evt', 'spawn', { id: this.zone.id, type: 'drop_zone' });
  }

  releaseCore(p, mode) {
    const core = this.core;
    if (!core || !core.holders.includes(p.sid)) return;
    core.holders = core.holders.filter((s) => s !== p.sid);
    delete core.attach[p.sid];
    if (p.carrying !== undefined) p.carrying = '';
    const inside = this.zone && Math.hypot(core.x - this.zone.x, core.y - this.zone.y) < this.zone.r;
    this.emit('evt', 'release', { seat: p.sid, object: core.id, mode, on: '', inside: inside ? this.zone.id : '' });
  }

  deliverCore() {
    const core = this.core, zone = this.zone;
    const carriers = core.holders.slice();
    for (const sid of carriers) this.releaseCore(this.player(sid), 'place');
    this.score++;
    this.emit('evt', 'subgoal', { id: 'deliver_core', seats: carriers, object: core.id, zone: zone.id, n: this.score });
    for (const p of this.players) {
      if (p.bledOut) continue;
      if (carriers.includes(p.sid)) p.stats.deliveries++;
      if (!p.downed) p.health = Math.min(p.maxHealth, p.health + p.maxHealth * CORE_HEAL_RATIO);
      this.giveXP(p, CORE_XP_REWARD);
    }
    this.emit('evt', 'despawn', { id: core.id, type: 'core', reason: 'delivered' });
    this.emit('evt', 'despawn', { id: zone.id, type: 'drop_zone', reason: 'delivered' });
    this.core = null;
    this.zone = null;
    this.nextCoreAt = this.gameTime + CORE_RESPAWN;
  }

  // ---- Waves and enemies ---------------------------------------------------
  updateSpawning() {
    this.spawnTimer += S;
    if (this.spawnTimer >= this.spawnRate) {
      this.spawnTimer = 0;
      if (this.enemies.length < MAX_ALIVE_ENEMIES) this.spawnEnemy();
    }
    this.difficultyTimer += S;
    if (this.difficultyTimer >= WAVE_DURATION) {
      this.difficultyTimer = 0;
      this.wave++;
      this.spawnRate = Math.max(MIN_SPAWN_RATE, this.spawnRate - SPAWN_RATE_DECREASE);
      this.emit('fx', 'wave', { wave: this.wave });
    }
  }

  spawnEnemy() {
    const r = this.rng.spawn;
    const live = this.livePlayers();
    if (live.length === 0) return;
    const anchor = live[Math.floor(r() * live.length)];
    const R = PLAYER_BASE_LIGHT_RADIUS * (1 + anchor.lightRadiusBonus) * 1.5;
    const angle = pickSpawnAngle(anchor.x, anchor.y, R, r);
    if (angle === null) return;
    const type = enemyTypeFor(this.wave, r());
    const t = ENEMY_TYPES[type];
    let scale = 1 + (this.wave - 1) * ENEMY_SCALING_PER_WAVE;
    if (this.wave >= WAVE_SCALING_BOOST_1) scale += (this.wave - WAVE_SCALING_BOOST_1) * 0.05;
    if (this.wave >= WAVE_SCALING_BOOST_2) scale += (this.wave - WAVE_SCALING_BOOST_2) * 0.1;
    const e = {
      id: this.id('e'), n: this.nextId, type, w: t.w,
      x: anchor.x + Math.cos(angle) * R, y: anchor.y + Math.sin(angle) * R,
      vx: 0, vy: 0, angle: 0,
      maxHealth: Math.floor(t.hp * scale), health: 0,
      speed: t.speed * (this.wave >= 12 ? 1 + (this.wave - 12) * 0.04 : 1),
      damage: Math.floor(t.damage * scale), xpValue: t.xp,
      frozen: false, freezeTimer: 0,
      shooter: type === 'shooter' || type === 'ice', shooterState: 0, stateTimer: 0,
      burstCount: 0, kneel: false, shootRate: t.shootRate || 0,
    };
    e.health = e.maxHealth;
    this.enemies.push(e);
    this.emit('evt', 'spawn', { id: e.id, type: `enemy_${type}` });
  }

  updateEnemies() {
    const live = this.livePlayers();
    for (const e of this.enemies) {
      if (e.freezeTimer > 0) {
        e.freezeTimer -= S;
        if (e.freezeTimer <= 0) { e.frozen = false; e.freezeTimer = 0; }
      }
      if (e.frozen) { e.vx = 0; e.vy = 0; continue; }

      let mod = 1;
      for (const p of live) {
        if (!p.stasisUnlocked) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < (p.stasisRadius || POLAR_VORTEX_RADIUS) + e.w / 2) mod *= 1 - p.stasisSlow;
      }

      let target = null, best = Infinity;
      for (const p of live) {
        const d = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
        if (d < best) { best = d; target = p; }
      }
      const tx = target ? target.x : this.players[0].x;
      const ty = target ? target.y : this.players[0].y;
      const dx = tx - e.x, dy = ty - e.y;
      const dist = Math.hypot(dx, dy);
      e.angle = Math.atan2(dy, dx);

      const moving = !(e.shooter && e.shooterState !== 0);
      if (dist > 0 && moving) {
        e.vx = (dx / dist) * e.speed * mod * S;
        e.vy = (dy / dist) * e.speed * mod * S;
      } else {
        e.vx = 0; e.vy = 0;
      }
      e.x += e.vx;
      e.y += e.vy;

      if (e.shooter) this.updateShooter(e, dist, target);
    }
  }

  updateShooter(e, dist, target) {
    const inRange = dist <= SHOOTER_STOP_RANGE && !!target;
    switch (e.shooterState) {
      case 0:
        if (inRange) { e.shooterState = 1; e.stateTimer = 60; e.kneel = true; e.vx = 0; e.vy = 0; }
        break;
      case 1:
        e.vx = 0; e.vy = 0; e.kneel = true; e.stateTimer -= S;
        if (!inRange) { e.shooterState = 0; e.kneel = false; }
        else if (e.stateTimer <= 0) { e.shooterState = 2; e.burstCount = 0; e.stateTimer = 0; }
        break;
      case 2:
        e.vx = 0; e.vy = 0; e.kneel = true; e.stateTimer -= S;
        if (e.stateTimer <= 0 && e.burstCount < 3 && target) {
          e.burstCount++;
          e.stateTimer = 18;
          this.fireEnemy(e, target);
        }
        if (e.burstCount >= 3) { e.shooterState = 3; e.stateTimer = e.shootRate; }
        break;
      case 3:
        e.vx = 0; e.vy = 0; e.kneel = true; e.stateTimer -= S;
        if (!inRange) { e.shooterState = 0; e.kneel = false; }
        else if (e.stateTimer <= 0) { e.shooterState = 1; e.stateTimer = 60; }
        break;
    }
  }

  fireEnemy(e, target) {
    const m = muzzle(e);
    let angle = Math.atan2(target.y - m.y, target.x - m.x);
    angle += (this.rng.combat() - 0.5) * 0.25;
    this.spawnBullet({
      isPlayer: false, x: m.x, y: m.y, angle, speed: ENEMY_BULLET_SPEED, damage: e.damage,
      maxDist: ENEMY_BULLET_RANGE, enemyType: e.type, forceFreeze: e.type === 'ice',
    });
  }

  updateContacts() {
    for (const p of this.players) {
      if (p.downed || p.bledOut || p.health <= 0) continue;
      const h = PLAYER_W / 2 + 25;
      for (const e of this.hash.query(p.x - h, p.y - h, p.x + h, p.y + h)) {
        if (e.health <= 0) continue;
        if (!overlap(p.x, p.y, PLAYER_W, e.x, e.y, e.w)) continue;
        const blocked = p.shieldActive;
        this.damagePlayer(p, e.damage, e.type);
        this.emit('evt', 'contact', { a: e.id, b: p.sid, kind: blocked ? 'blocked_hit' : 'hit' });
        this.removeEnemy(e, 'expended', '');
        if (p.downed) break;
      }
    }
    this.enemies = this.enemies.filter((e) => e.health > 0);
  }

  removeEnemy(e, reason, by) {
    if (e.health <= 0 && e.removed) return;
    e.health = 0;
    e.removed = true;
    this.emit('fx', 'kill', { id: e.id, type: e.type, x: r1(e.x), y: r1(e.y), a: r3(e.angle), reason, by });
    this.emit('evt', 'despawn', { id: e.id, type: `enemy_${e.type}`, reason });
  }

  killEnemy(e, by) {
    if (e.removed) return;
    this.kills++;
    const owner = by ? this.player(by) : null;
    if (owner) owner.stats.kills++;
    this.spawnLoot(e.x, e.y, e.xpValue);
    this.removeEnemy(e, 'killed', by || '');
  }

  // ---- Bullets ---------------------------------------------------------------
  updateBullets() {
    const live = this.livePlayers();
    const keep = [];
    for (const b of this.bullets) {
      let scale = 1;
      if (!b.isPlayer) {
        for (const p of live) {
          if (p.stasisBulletSlow && Math.hypot(b.x - p.x, b.y - p.y) < (p.stasisRadius || POLAR_VORTEX_RADIUS)) {
            scale *= 1 - p.stasisSlow;
            break;
          }
        }
      }
      b.x += b.vx * S * scale;
      b.y += b.vy * S * scale;
      b.dist += b.speed * S * scale;
      if (b.x < -50 || b.x > ARENA_W + 50 || b.y < -50 || b.y > ARENA_H + 50 || b.dist > b.maxDist) {
        this.emit('fx', 'bend', { id: b.id, why: 'range' });
        continue;
      }
      const alive = b.isPlayer ? this.bulletVsEnemies(b) : this.bulletVsPlayers(b, live);
      if (alive) keep.push(b);
    }
    this.bullets = keep;
    this.enemies = this.enemies.filter((e) => e.health > 0);
  }

  bulletVsEnemies(b) {
    const h = BULLET_W / 2 + 25;
    for (const e of this.hash.query(b.x - h, b.y - h, b.x + h, b.y + h)) {
      if (e.health <= 0 || b.hit.has(e.id)) continue;
      if (!overlap(b.x, b.y, BULLET_W, e.x, e.y, e.w)) continue;
      b.hit.add(e.id);
      const owner = b.owner ? this.player(b.owner) : null;
      e.health -= b.damage;
      if (owner) { owner.stats.hits++; owner.stats.damageDealt += b.damage; }
      if (e.health <= 0) {
        this.killEnemy(e, b.owner);
      } else if (b.forceFreeze || (b.freezeChance > 0 && this.rng.combat() < b.freezeChance)) {
        e.frozen = true;
        e.freezeTimer = Math.max(e.freezeTimer, 120);
        this.emit('fx', 'hit', { id: e.id, f: 1 });
      } else {
        this.emit('fx', 'hit', { id: e.id });
      }
      if (b.splashRadius > 0) {
        const r = b.splashRadius;
        const ex = b.x + (this.rng.combat() - 0.5) * 15;
        const ey = b.y + (this.rng.combat() - 0.5) * 15;
        this.emit('fx', 'splash', { x: r1(ex), y: r1(ey), r });
        for (const o of this.hash.query(ex - r, ey - r, ex + r, ey + r)) {
          if (o === e || o.health <= 0) continue;
          if ((o.x - e.x) ** 2 + (o.y - e.y) ** 2 <= r * r) {
            const dmg = b.damage * b.splashDamageRatio;
            o.health -= dmg;
            if (owner) owner.stats.damageDealt += dmg;
            if (o.health <= 0) this.killEnemy(o, b.owner);
          }
        }
      }
      b.piercing--;
      if (b.piercing < 0) {
        this.emit('fx', 'bend', { id: b.id, why: 'hit' });
        return false;
      }
    }
    return true;
  }

  bulletVsPlayers(b, live) {
    for (const p of live) {
      if (!overlap(b.x, b.y, BULLET_W, p.x, p.y, PLAYER_W)) continue;
      if (p.deflectUnlocked && p.deflectCharges > 0) {
        const incoming = Math.atan2(b.vy, b.vx) + Math.PI;
        if (Math.abs(wrapAngle(incoming - p.angle)) <= Math.PI / 3) {
          p.deflectCharges--;
          let targetAngle = incoming;
          let best = Infinity;
          for (const e of this.hash.query(p.x - 800, p.y - 800, p.x + 800, p.y + 800)) {
            if (e.health <= 0) continue;
            const a = Math.atan2(e.y - b.y, e.x - b.x);
            if (Math.abs(wrapAngle(a - incoming)) > Math.PI / 3) continue;
            const d = (e.x - b.x) ** 2 + (e.y - b.y) ** 2;
            if (d < best) { best = d; targetAngle = a; }
          }
          b.isPlayer = true;
          b.owner = p.sid;
          b.angle = targetAngle;
          b.speed *= 1.5;
          b.vx = Math.cos(targetAngle) * b.speed;
          b.vy = Math.sin(targetAngle) * b.speed;
          if (b.enemyType === 'ice') { b.damage = 0; b.forceFreeze = true; } else b.damage = p.damage;
          b.piercing = p.piercing;
          b.freezeChance = p.freezeChance;
          b.splashRadius = p.splashRadius;
          b.splashDamageRatio = p.splashDamageRatio;
          b.dist = 0;
          this.emit('fx', 'deflect', { id: b.id, by: p.sid, x: r1(b.x), y: r1(b.y), a: r3(targetAngle), v: b.speed });
          return true;
        }
      }
      if (b.enemyType === 'ice') {
        p.slowEffects.push({ amount: 0.25, timer: 120 });
        this.emit('fx', 'phit', { seat: p.sid, ice: 1 });
      } else {
        this.damagePlayer(p, b.damage, b.enemyType || 'bullet');
        this.emit('fx', 'phit', { seat: p.sid });
      }
      this.emit('fx', 'bend', { id: b.id, why: 'hit' });
      return false;
    }
    return true;
  }

  // ---- Items -----------------------------------------------------------------
  spawnLoot(x, y, n) {
    const r = this.rng.loot;
    for (let i = 0; i < n && this.items.length < MAX_ITEMS; i++) {
      this.addItem('xp', x, y, r() * Math.PI * 2, 2.5 + r() * 2.5, 20 + r() * 14);
    }
    const bonus = this.players.reduce((m, p) => Math.max(m, p.dropBonus), 0);
    if (r() < HEALTH_DROP_BASE_RATE + bonus && this.items.length < MAX_ITEMS) {
      this.addItem('health', x, y, r() * Math.PI * 2, 3 + r() * 2.5, 24 + r() * 12);
    }
  }

  addItem(type, x, y, angle, speed, duration) {
    const it = {
      id: this.id('i'), type, x, y, vx: 0, vy: 0,
      tossVx: Math.cos(angle) * speed, tossVy: Math.sin(angle) * speed, tossTimer: duration, age: 0,
    };
    this.items.push(it);
    this.emit('evt', 'spawn', { id: it.id, type: type === 'xp' ? 'xp_orb' : 'health_pack' });
  }

  updateItems() {
    const live = this.livePlayers();
    const keep = [];
    for (const it of this.items) {
      it.age += S;
      if (it.age > ITEM_LIFETIME) {
        this.emit('evt', 'despawn', { id: it.id, type: it.type === 'xp' ? 'xp_orb' : 'health_pack', reason: 'expired' });
        continue;
      }
      if (it.tossTimer > 0) {
        it.tossTimer -= S;
        it.x = Math.max(ITEM_W / 2, Math.min(ARENA_W - ITEM_W / 2, it.x + it.tossVx * S));
        it.y = Math.max(ITEM_W / 2, Math.min(ARENA_H - ITEM_W / 2, it.y + it.tossVy * S));
        const damp = Math.pow(0.94, S);
        it.tossVx *= damp;
        it.tossVy *= damp;
        it.vx = 0; it.vy = 0;
        keep.push(it);
        continue;
      }
      const pool = it.type === 'health' ? live.filter((p) => p.health < p.maxHealth) : live;
      let closest = null, best = Infinity;
      for (const p of pool) {
        const d = (it.x - p.x) ** 2 + (it.y - p.y) ** 2;
        if (d < best) { best = d; closest = p; }
      }
      it.vx = 0; it.vy = 0;
      if (closest) {
        const dist = Math.sqrt(best);
        const range = ITEM_MAGNET_BASE_RANGE * (1 + closest.magnetBonus);
        if (dist < range && dist > 0) {
          const sp = closest.speed * 1.1 * S;
          it.vx = ((closest.x - it.x) / dist) * sp;
          it.vy = ((closest.y - it.y) / dist) * sp;
          it.x += it.vx;
          it.y += it.vy;
        }
        if (overlap(it.x, it.y, ITEM_W, closest.x, closest.y, PLAYER_W)) {
          this.collect(it, closest);
          continue;
        }
      }
      keep.push(it);
    }
    this.items = keep;
  }

  collect(it, p) {
    this.emit('fx', 'pickup', { id: it.id, seat: p.sid, type: it.type });
    this.emit('evt', 'despawn', { id: it.id, type: it.type === 'xp' ? 'xp_orb' : 'health_pack', reason: 'collected', by: p.sid });
    if (it.type === 'health') {
      p.health = Math.min(p.maxHealth, p.health + HEALTH_RESTORE_AMOUNT);
      return;
    }
    // Shared XP: every player still in the run gets the orb's XP.
    for (const q of this.players) if (!q.bledOut) this.giveXP(q, 1);
  }

  // ---- Levels and skills -----------------------------------------------------
  giveXP(p, amount) {
    p.xp += amount;
    while (p.xp >= p.xpToLevel) {
      p.level++;
      p.xp -= p.xpToLevel;
      p.xpToLevel = Math.floor(p.xpToLevel * XP_LEVEL_MULTIPLIER);
      if (!p.downed) p.health = p.maxHealth; // the original heals to full on level-up
      const offer = { level: p.level, choices: this.rollSkills(p, new Set()), rerollUsed: false };
      if (offer.choices.length === 0) continue;
      p.offers.push(offer);
      this.emit('fx', 'levelup', { seat: p.sid, level: p.level });
      this.emit('private', 'offer', offer, p.sid);
    }
  }

  rollSkills(p, exclude) {
    const n = p.extraChoice ? SKILL_CHOICES_WITH_EXTRA : SKILL_CHOICES_BASE;
    const ok = (s) => (p.skills[s.id] || 0) < (s.maxLevel || Infinity);
    let pool = OFFERABLE.filter((s) => ok(s) && !exclude.has(s.id));
    if (pool.length < n && exclude.size) pool = OFFERABLE.filter(ok);
    const out = [];
    const r = this.rng.skills;
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0].id);
    return out;
  }

  pickSkill(sid, level, skillId) {
    const p = this.player(sid);
    if (!p) return { ok: false, reason: 'no_player' };
    const i = p.offers.findIndex((o) => o.level === level);
    if (i < 0) return { ok: false, reason: 'no_offer' };
    const offer = p.offers[i];
    if (!offer.choices.includes(skillId)) return { ok: false, reason: 'not_offered' };
    const skill = SKILLS.find((s) => s.id === skillId);
    skill.apply(p);
    p.offers.splice(i, 1);
    this.emit('fx', 'skill', { seat: sid, skill: skillId, level });
    return { ok: true };
  }

  reroll(sid, level) {
    const p = this.player(sid);
    const offer = p?.offers.find((o) => o.level === level);
    if (!offer || offer.rerollUsed) return null;
    offer.choices = this.rollSkills(p, new Set(offer.choices));
    offer.rerollUsed = true;
    return offer;
  }

  // ---- End of run ------------------------------------------------------------
  checkEnd() {
    if (this.players.every((p) => p.downed || p.bledOut || p.health <= 0)) {
      this.over = true;
      this.outcome = 'fail';
      this.reason = 'all_players_down';
    } else if (this.gameTime >= RUN_LENGTH) {
      this.over = true;
      this.outcome = 'success';
      this.reason = 'survived';
    }
  }

  endEarly(outcome, reason) {
    this.over = true;
    this.outcome = outcome;
    this.reason = reason;
  }
}

// ---- helpers ------------------------------------------------------------------
function r1(v) { return Math.round(v * 10) / 10; }
function r3(v) { return Math.round(v * 1000) / 1000; }

/** Muzzle of a shooter's gun (port of EnemyInstancedAnimation.getMuzzlePosition, centre-based). */
export function muzzle(e) {
  let s = 0.85;
  if (e.type === 'tank') s = 1.2;
  if (e.type === 'fast') s = 0.7;
  const armX = 6 * s;
  const ext = 18 * s + 15 * s;
  const a = -e.angle + Math.PI / 2;
  const cos = Math.cos(a), sin = Math.sin(a);
  const sx = e.x + armX * cos;
  const sz = e.y + armX * -sin;
  return { x: sx + ext * sin, y: sz + ext * cos };
}

function enemyTypeFor(wave, rand) {
  if (wave >= 20) return rand < 0.35 ? 'tank' : rand < 0.6 ? 'shooter' : rand < 0.8 ? 'ice' : rand < 0.95 ? 'fast' : 'basic';
  if (wave >= WAVE_SCALING_BOOST_1) return rand < 0.3 ? 'tank' : rand < 0.55 ? 'shooter' : rand < 0.75 ? 'ice' : rand < 0.9 ? 'fast' : 'basic';
  if (wave >= 10) return rand < 0.2 ? 'tank' : rand < 0.45 ? 'shooter' : rand < 0.65 ? 'ice' : rand < 0.85 ? 'fast' : 'basic';
  if (wave >= WAVE_UNLOCK_ICE) return rand < 0.1 ? 'tank' : rand < 0.3 ? 'shooter' : rand < 0.45 ? 'ice' : rand < 0.7 ? 'fast' : 'basic';
  if (wave >= WAVE_UNLOCK_TANK) return rand < 0.1 ? 'tank' : rand < 0.35 ? 'shooter' : rand < 0.65 ? 'fast' : 'basic';
  if (wave >= WAVE_UNLOCK_SHOOTER) return rand < 0.25 ? 'shooter' : rand < 0.55 ? 'fast' : 'basic';
  if (wave >= WAVE_UNLOCK_FAST) return rand < 0.35 ? 'fast' : 'basic';
  return 'basic';
}

/** Port of EnemySpawner.spawn's "smart bounds": a random angle on the circle of
 * radius R around (ox, oy) whose point stays within 50 units of the arena. */
function pickSpawnAngle(ox, oy, R, rand) {
  const TWO_PI = Math.PI * 2;
  const minCos = (-50 - ox) / R, maxCos = (ARENA_W + 50 - ox) / R;
  const minSin = (-50 - oy) / R, maxSin = (ARENA_H + 50 - oy) / R;
  const bad = [];
  if (minCos > -1) { const s = Math.acos(Math.max(-1, Math.min(1, minCos))); bad.push([Math.PI - s, Math.PI + s]); }
  if (maxCos < 1) { const s = Math.acos(Math.max(-1, Math.min(1, maxCos))); bad.push([TWO_PI - s, s]); }
  if (minSin > -1) { const a = Math.asin(Math.max(-1, Math.min(1, minSin))); bad.push([Math.PI - a, TWO_PI + a]); }
  if (maxSin < 1) { const a = Math.asin(Math.max(-1, Math.min(1, maxSin))); bad.push([a, Math.PI - a]); }
  const clean = [];
  for (const [s0, e0] of bad) {
    let s = s0 % TWO_PI, e = e0 % TWO_PI;
    if (s < 0) s += TWO_PI;
    if (e < 0) e += TWO_PI;
    if (e < s) { clean.push([s, TWO_PI]); clean.push([0, e]); } else clean.push([s, e]);
  }
  clean.sort((a, b) => a[0] - b[0]);
  const union = [];
  for (const c of clean) {
    const last = union[union.length - 1];
    if (last && c[0] < last[1]) last[1] = Math.max(last[1], c[1]); else union.push([c[0], c[1]]);
  }
  const good = [];
  let cursor = 0;
  for (const [s, e] of union) { if (s > cursor) good.push([cursor, s]); cursor = Math.max(cursor, e); }
  if (cursor < TWO_PI) good.push([cursor, TWO_PI]);
  if (good.length === 0) return null;
  const total = good.reduce((sum, g) => sum + g[1] - g[0], 0);
  let pick = rand() * total;
  for (const [s, e] of good) {
    if (pick <= e - s) return s + pick;
    pick -= e - s;
  }
  return good[good.length - 1][1];
}
