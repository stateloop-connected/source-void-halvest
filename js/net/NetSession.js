// Online co-op session: connects to the Colyseus server, sends one input per
// fixed step, predicts the local player's movement, and mirrors the server's
// state into the game's existing entities so the original renderers draw it.
// The server is the authority; nothing here decides game outcomes.
import { Client, Predict } from '@colyseus/sdk';
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { Item } from '../entities/Item.js';
import { Bullet } from '../entities/Bullet.js';
import { BIOMES } from '../biomes.js';
import { ENEMY_DEATH_TOTAL_FRAMES, PARTICLE_COUNT_HIT, PARTICLE_COUNT_DEATH } from '../constants.js';
import { stepPlayerMove } from '../../shared/sim/move.js';
import { CORE_LENGTH, PLAYER_W } from '../../shared/sim/config.js';
import { CoreVisuals } from './CoreVisuals.js';
import { NetHud } from './NetHud.js';

const RENDER_DELAY_MS = 100;          // remote interpolation delay (2 patches at 20 Hz)
const BASE_TICK_MS = 1000 / 144;       // the original game's unit of time
const GAME_SPEED = 0.85;

/** Server address: the build-time value (Creator browser configuration). The
 * page parameter only works in builds without one (local development), so a
 * link cannot point a published build at another server. */
export function serverUrl() {
  // eslint-disable-next-line no-undef
  const built = typeof __COOP_SERVER_URL__ !== 'undefined' ? __COOP_SERVER_URL__ : '';
  if (built) return built;
  return new URLSearchParams(location.search).get('COOP_SERVER_URL') || 'ws://localhost:2567';
}

export class NetSession {
  constructor(game) {
    this.game = game;
    this.client = new Client(serverUrl());
    this.room = null;
    this.active = false;       // true while an episode is being played
    this.players = new Map();  // sid -> Player (game entity)
    this.enemies = new Map();  // id -> Enemy (game entity)
    this.items = new Map();    // id -> Item
    this.bullets = new Map();  // id -> Bullet
    this.fxQueue = [];         // [applyAt, list]
    this.core = new CoreVisuals(game.scene);
    this.hud = new NetHud(game, this);
    this.lastSnapTime = 0;
  }

  get state() { return this.room ? this.room.state : null; }
  get sid() { return this.room ? this.room.sessionId : ''; }

  // ---- matchmaking -------------------------------------------------------------
  async quickMatch(name, color) { this.isPrivate = false; return this.attach(await this.client.joinOrCreate('coop', { name, color })); }
  async createRoom(name, color) { this.isPrivate = true; return this.attach(await this.client.create('coop', { name, color, private: true })); }
  async joinCode(code, name, color) { this.isPrivate = true; return this.attach(await this.client.joinById(code.trim().toUpperCase(), { name, color })); }

  attach(room) {
    this.room = room;
    this.input = room.input();
    this.predict = Predict.get(room, { mode: 'lerp', delay: RENDER_DELAY_MS });
    this.predict.attachAll('players', { mode: 'lerp', fields: ['x', 'y'] });
    this.predict.attachAll('players', { mode: 'lerp', fields: ['yaw'], angle: true });
    this.predict.attachAll('agents', { mode: 'lerp', fields: ['x', 'y'] });
    this.predict.attachAll('agents', { mode: 'lerp', fields: ['yaw'], angle: true });
    this.predict.attachAll('objects', { mode: 'lerp', fields: ['x', 'y'] });
    this.predict.attachAll('objects', { mode: 'lerp', fields: ['yaw'], angle: true });
    this.me = null;

    room.onMessage('fx', (list) => this.fxQueue.push([performance.now() + RENDER_DELAY_MS, list]));
    room.onMessage('offer', (offer) => this.hud.addOffer(offer));
    room.onMessage('chat', (m) => this.hud.showChat(m));
    room.onMessage('ping', (m) => this.hud.showPing(m));
    room.onMessage('rate', () => {});
    room.onMessage('evt:episode_start', (m) => this.onEpisodeStart(m));
    room.onMessage('evt:episode_end', (m) => this.onEpisodeEnd(m));
    room.onMessage('*', () => {}); // other evt:* labels are for the recording
    room.onStateChange(() => this.hud.onState(room.state));
    room.onLeave((code) => this.onLeave(code));
    this.hud.onJoined(room);
    return room;
  }

  async leave() {
    if (this.room) await this.room.leave(true).catch(() => {});
  }

  onLeave(code) {
    this.endLocalEpisode();
    this.room = null;
    this.me = null;
    this.meFor = null;
    this.hud.onLeft(code);
  }

  // ---- episodes ------------------------------------------------------------------
  onEpisodeStart(msg) {
    const g = this.game;
    this.endLocalEpisode();
    g.netMode = true;
    g.isMultiplayer = true;
    g.trainingMode = false;
    const biomeKeys = Object.keys(BIOMES);
    g.currentBiome = BIOMES[biomeKeys[(msg.seed || 0) % biomeKeys.length]];
    if (g.sessionManager.applyBiomeVisuals) g.sessionManager.applyBiomeVisuals();

    // One game Player per seat, in seat order (the renderers expect an array).
    const entries = [...this.state.players.entries()].sort((a, b) => a[1].slot - b[1].slot);
    g.players = entries.map(([sid, s]) => {
      const p = new Player(s.x - 12, s.y - 12, g.scene, s.slot, s.color);
      p.canBeRevived = true;
      p.netSid = sid;
      this.players.set(sid, p);
      return p;
    });
    g.player = this.players.get(this.sid) || g.players[0];
    if (g.overheadUI) { g.overheadUI.clear(); g.players.forEach((p) => g.overheadUI.register(p)); }
    if (g.itemManager) { g.itemManager.players = g.players; g.itemManager.player = g.player; }
    if (g.cameraSystem) g.cameraSystem.reset();

    const self = this.state.players.get(this.sid);
    if (this.me && this.meFor === self) {
      this.me.reset();
    } else {
      this.me = this.predict.reconciler(self, {
        input: this.input,
        fields: ['x', 'y', 'vx', 'vy', 'speed', 'slow', 'alive', 'downed', 'carrying'],
        step: (ctx, s, cmd) => stepPlayerMove(s, cmd),
      });
      this.meFor = self;
    }

    g.autoshootEnabled = g.metaProgress.autoshootEnabled !== undefined ? g.metaProgress.autoshootEnabled : true;
    g.state = 'playing';
    this.active = true;
    this.hud.onEpisodeStart(msg);
    if (!g.gameLoopRunning) {
      g.gameLoopRunning = true;
      g.lastTime = performance.now();
      requestAnimationFrame(() => g.gameLoop());
    }
  }

  onEpisodeEnd(msg) {
    this.active = false;
    this.game.state = 'netEnded';
    this.hud.onEpisodeEnd(msg);
  }

  endLocalEpisode() {
    const g = this.game;
    this.active = false;
    for (const p of this.players.values()) if (p.visuals) p.visuals.dispose();
    this.players.clear();
    for (const e of this.enemies.values()) if (g.healthBarSystem) g.healthBarSystem.unregister(e);
    this.enemies.clear();
    g.enemies.length = 0;
    for (const it of this.items.values()) g.scene.remove(it.mesh);
    this.items.clear();
    if (g.itemManager) g.itemManager.items.length = 0;
    for (const b of this.bullets.values()) g.scene.remove(b.mesh);
    this.bullets.clear();
    if (g.bulletManager) g.bulletManager.bullets.length = 0;
    if (g.particleManager) g.particleManager.clear();
    this.core.clear();
    this.fxQueue.length = 0;
    this.hud.clearOffers();
  }

  // ---- per frame ---------------------------------------------------------------------
  /** Called from Game.gameLoop instead of the local simulation. */
  frame(now, dt) {
    if (!this.room || !this.predict) return;
    const steps = this.predict.tick(now);
    if (this.active) {
      for (let i = 0; i < steps; i++) {
        Object.assign(this.input.data, this.sampleInput());
        this.input.send();
      }
    }
    if (this.active) this.mirror(now, dt);
    this.hud.frame(now, dt);
  }

  sampleInput() {
    const g = this.game;
    const k = g.input.keys;
    const typing = this.hud.isTyping();
    let ix = 0, iy = 0;
    if (!typing) {
      if (k.w) iy -= 1;
      if (k.s) iy += 1;
      if (k.a) ix -= 1;
      if (k.d) ix += 1;
    }
    const len = Math.hypot(ix, iy) || 1;
    ix /= len; iy /= len;
    // Rotate the camera-relative WASD vector into world axes (as Player.update did).
    const yaw = g.rendering.camYaw || 0;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const mx = ix * cos + iy * sin;
    const my = iy * cos - ix * sin;
    const aim = g.rendering.getMouseWorldPosition(g.input.mouseX, g.input.mouseY);
    return {
      mx, my,
      aimX: Number.isFinite(aim.x) ? aim.x : 0,
      aimY: Number.isFinite(aim.z) ? aim.z : 0,
      fire: !typing && !!g.input.mouseDown,
      auto: !!g.autoshootEnabled,
      interact: !typing && !!k.e,
    };
  }

  /** Copy the (interpolated / predicted) server state into the game entities. */
  mirror(now, dt) {
    const g = this.game;
    const st = this.state;
    const pv = (inst, f) => this.predict.value(inst, f);
    const animScale = (dt / BASE_TICK_MS) * GAME_SPEED;

    g.gameTime = st.gameTime || 0;
    g.wave = st.wave || 1;
    g.kills = st.kills || 0;

    // the core as drawn this frame: carriers are placed on its handles so the
    // local carrier (otherwise predicted, i.e. newer) never floats off the bar
    let drawnCore = null;
    st.objects.forEach((o, id) => {
      if (o.type === 'core') drawnCore = { id, o, x: pv(o, 'x'), y: pv(o, 'y'), yaw: pv(o, 'yaw') };
    });

    // players
    for (const [sid, s] of st.players.entries()) {
      const p = this.players.get(sid);
      if (!p) continue;
      let x, y;
      const grip = drawnCore && s.carrying === drawnCore.id ? drawnCore.o.attach.get(sid) : null;
      if (grip) {
        const side = grip.handle === 0 ? -1 : 1;
        const off = CORE_LENGTH / 2 + PLAYER_W / 2;
        x = drawnCore.x + side * Math.cos(drawnCore.yaw) * off;
        y = drawnCore.y + side * Math.sin(drawnCore.yaw) * off;
      } else if (sid === this.sid && this.me && !s.carrying && !s.downed) {
        x = this.me.value('x');
        y = this.me.value('y');
      } else {
        x = pv(s, 'x');
        y = pv(s, 'y');
      }
      p.x = x - p.width / 2;
      p.y = y - p.height / 2;
      p.vx = s.vx; p.vy = s.vy;
      p.angle = sid === this.sid ? Math.atan2(s.aimY - y, s.aimX - x) : pv(s, 'yaw');
      if (sid === this.sid && !s.carrying) {
        // face the local cursor immediately; the server confirms within a tick
        const aim = g.rendering.getMouseWorldPosition(g.input.mouseX, g.input.mouseY);
        if (Number.isFinite(aim.x)) p.angle = Math.atan2(aim.z - y, aim.x - x);
      }
      p.health = s.hp; p.maxHealth = s.maxHp;
      p.isDowned = s.downed; p.isBledOut = s.bledOut; p.canBeRevived = s.canBeRevived;
      p.downedTimer = s.downedTimer; p.reviveProgress = s.reviveProgress;
      p.level = s.level; p.xp = s.xp; p.xpToLevel = s.xpToLevel;
      const skills = {};
      s.skills.forEach((v, key) => { skills[key] = v; });
      p.skills = skills;
      p.shieldActive = s.shield; p.shieldUnlocked = !!skills.shield;
      p.deflectCharges = s.deflect; p.deflectUnlocked = !!skills.deflect; p.deflectMaxCharges = skills.deflect || 0;
      p.lightRadiusBonus = s.lightBonus;
      p.stasisUnlocked = !!skills.stasis;
      p.color = s.color;
      if (p.visuals && p.visuals.setReviveProgress) {
        p.visuals.setReviveProgress(s.downed ? s.reviveProgress / 120 : 0, s.color);
      }
    }

    // enemies: add/update; removed ones topple as corpses (deathTime advances locally)
    const seen = new Set();
    for (const [id, s] of st.agents.entries()) {
      seen.add(id);
      let e = this.enemies.get(id);
      if (!e) {
        e = new Enemy(s.x, s.y, s.type);
        e.netId = id;
        this.enemies.set(id, e);
        g.enemies.push(e);
        if (g.healthBarSystem) g.healthBarSystem.register(e);
      }
      const x = pv(s, 'x'), y = pv(s, 'y');
      e.vx = s.vx; e.vy = s.vy;
      e.x = x - e.width / 2;
      e.y = y - e.height / 2;
      e.angle = pv(s, 'yaw');
      e.frozen = s.frozen; e.isKneeling = s.kneel;
      e.health = s.hp; e.maxHealth = s.maxHp;
    }
    for (const [id, e] of this.enemies) {
      if (seen.has(id) || e.isDying) continue;
      // gone from state without a kill fx yet (fx is delayed): fade it out
      if (now - (e.netGoneAt || (e.netGoneAt = now)) > RENDER_DELAY_MS * 2) this.killEnemyVisual(id);
    }
    for (let i = g.enemies.length - 1; i >= 0; i--) {
      const e = g.enemies[i];
      if (!e.isDying) continue;
      e.deathTime += animScale;
      if (e.deathTime >= ENEMY_DEATH_TOTAL_FRAMES) {
        g.enemies.splice(i, 1);
        this.enemies.delete(e.netId);
      }
    }

    // objects: core + zone handled by CoreVisuals; items mirrored into Item meshes
    const seenObj = new Set();
    const core = drawnCore;
    let zone = null;
    for (const [id, o] of st.objects.entries()) {
      if (o.type === 'core') continue;
      if (o.type === 'drop_zone') { zone = { id, o }; continue; }
      seenObj.add(id);
      let it = this.items.get(id);
      if (!it) {
        it = new Item(o.x - 6, o.y - 6, o.type === 'xp_orb' ? 'xp' : 'health');
        it.applyDiscoveredVisuals();
        it.isDiscovered = true;
        this.items.set(id, it);
        g.itemManager.items.push(it);
        g.scene.add(it.mesh);
      }
      it.x = pv(o, 'x') - 6;
      it.y = pv(o, 'y') - 6;
    }
    for (const [id, it] of this.items) {
      if (seenObj.has(id)) continue;
      g.scene.remove(it.mesh);
      const idx = g.itemManager.items.indexOf(it);
      if (idx >= 0) g.itemManager.items.splice(idx, 1);
      this.items.delete(id);
    }
    this.core.update(core, zone, st.players, now);

    // bullets: straight lines between shot/end events
    for (const b of this.bullets.values()) b.update(animScale);

    // The solo update() ages particles; online it is skipped, so do it here
    // (without it every hit spark stays in the scene for the whole run).
    if (g.particleManager) g.particleManager.update();
    this.updateLights();
    g.ui.updateHUD();

    // delayed cosmetic events
    while (this.fxQueue.length && this.fxQueue[0][0] <= now) {
      const [, list] = this.fxQueue.shift();
      for (const [name, data] of list) this.applyFx(name, data);
    }
  }

  /** Local cursor light (as in solo) plus a second light at the partner's aim point. */
  updateLights() {
    const g = this.game;
    const local = g.player;
    const partner = g.players.find((p) => p !== local);
    const target = g.rendering.getMouseWorldPosition(g.input.mouseX, g.input.mouseY);
    if (partner) partner.hasPersonalLight = true;
    g.lighting.update(target, local, partner);
    const lm = g.lighting;
    const ps = partner ? this.state.players.get(partner.netSid) : null;
    if (lm.p2Light && ps && !ps.bledOut) {
      const h = lm.p2Light.position.y;
      lm.p2Light.visible = true;
      lm.p2Light.position.set(ps.aimX, h, ps.aimY);
      lm.p2Light.target.position.set(ps.aimX, 0, ps.aimY);
    }
  }

  killEnemyVisual(id, x, y) {
    const g = this.game;
    const e = this.enemies.get(id);
    if (!e || e.isDying) return;
    if (g.healthBarSystem) g.healthBarSystem.unregister(e);
    if (Number.isFinite(x)) { e.x = x - e.width / 2; e.y = y - e.height / 2; }
    e.startDeath();
  }

  applyFx(name, d) {
    const g = this.game;
    const pm = g.particleManager;
    switch (name) {
      case 'shot': {
        const b = new Bullet(d.x, d.y, d.a, d.v, 0, d.player, 0, d.d, d.kind || null, false, {}, d.c || null);
        if (!d.player) { b.x -= b.width / 2; b.y -= b.height / 2; }
        b.netId = d.id;
        this.bullets.set(d.id, b);
        g.bulletManager.bullets.push(b);
        g.scene.add(b.mesh);
        break;
      }
      case 'bend': {
        const b = this.bullets.get(d.id);
        if (!b) break;
        g.scene.remove(b.mesh);
        const i = g.bulletManager.bullets.indexOf(b);
        if (i >= 0) g.bulletManager.bullets.splice(i, 1);
        this.bullets.delete(d.id);
        break;
      }
      case 'deflect': {
        const b = this.bullets.get(d.id);
        if (b) {
          b.isPlayer = true; b.angle = d.a; b.speed = d.v;
          b.vx = Math.cos(d.a) * d.v; b.vy = Math.sin(d.a) * d.v;
          b.x = d.x; b.y = d.y; b.distanceTraveled = 0;
        }
        pm.create(d.x, d.y, '#00ffff', 5);
        break;
      }
      case 'hit': {
        const e = this.enemies.get(d.id);
        if (e) {
          e.flashTime = 80;
          pm.create(e.x, e.y, d.f ? '#00ffff' : '#ffff00', d.f ? 15 : PARTICLE_COUNT_HIT);
        }
        break;
      }
      case 'kill':
        pm.create(d.x - 16, d.y - 16, '#ff0000', PARTICLE_COUNT_DEATH);
        if (d.type === 'tank') g.cameraSystem.addShake(5);
        this.killEnemyVisual(d.id, d.x, d.y);
        break;
      case 'splash':
        pm.create(d.x, d.y, '#ff5500', 8);
        pm.createExplosion(d.x, d.y, '#ff5500', d.r);
        break;
      case 'phit': {
        const p = this.players.get(d.seat);
        if (p) pm.create(p.x, p.y, d.ice ? '#66ccff' : '#ff0000', d.ice ? 8 : PARTICLE_COUNT_HIT);
        if (d.seat === this.sid) g.cameraSystem.addShake(8);
        break;
      }
      case 'pickup': break;
      case 'levelup': {
        const p = this.players.get(d.seat);
        if (p) pm.create(p.x + 12, p.y + 12, '#00ff88', 24);
        break;
      }
      case 'downed':
      case 'bledout':
      case 'revived':
      case 'shield':
      case 'skill':
      case 'wave':
        this.hud.onFx(name, d);
        break;
      default:
        break;
    }
  }

  // ---- messages -------------------------------------------------------------------------
  pick(level, skill) { this.room?.send('pick', { level, skill }); }
  reroll(level) { this.room?.send('reroll', { level }); }
  ready() { this.room?.send('ready', {}); }
  chat(text) { this.room?.send('chat', { text }); }
  ping(x, y, kind = 'here') { this.room?.send('ping', { x, y, kind }); }
  rate(score) { this.room?.send('rate', { score }); }
  ui(shown) { this.room?.send('ui', { shown }); }
}
