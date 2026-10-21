// The co-op room: two seats, a lobby, then runs ("episodes") of the shared
// simulation on a fixed 60 Hz step. The server is the authority: clients send
// inputs, the server moves everything and broadcasts what happened.
import { Room } from 'colyseus';
import { InputCmd, CoopState, Player, Obj, Enemy, Attach } from './schema.js';
import { World } from '../../shared/sim/world.js';
import { SIM_HZ, UNITS_PER_TICK, GAME_DURATION, CORE_LENGTH, ZONE_DELIVER_TIME } from '../../shared/sim/config.js';

const COUNTDOWN_S = 3;
const MAX_INPUT_BACKLOG = 4; // frames (~67 ms) before stale input is skipped
const INPUT_HOLD_TICKS = 15;  // reuse the last frame's movement for at most 250 ms
const GRIP_HOLD_TICKS = 60;   // a held interact (grip, revive) survives a 1 s stall
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const SEAT_COLORS = ['#00ffff', '#ffaa44'];

export class CoopRoom extends Room {
  maxClients = 2;
  patchRate = 50;                // 20 Hz state patches
  maxMessagesPerSecond = 200;    // 60 input frames/s plus messages
  state = new CoopState();
  inputs = this.defineInput(InputCmd, {
    bufferMaxSize: 32,
    sanitize: { mx: [-1, 1], my: [-1, 1], aimX: [-1000, 5500], aimY: [-1000, 5500] },
  });

  messages = {
    ready: (client, msg) => this.onReady(client, msg),
    name: (client, msg) => this.onName(client, msg),
    pick: (client, msg) => this.onPick(client, msg),
    reroll: (client, msg) => this.onReroll(client, msg),
    chat: (client, msg) => this.onChat(client, msg),
    ping: (client, msg) => this.onPing(client, msg),
    ui: (client, msg) => this.onUi(client, msg),
    rate: (client, msg) => this.onRate(client, msg),
    '*': () => {},
  };

  async onCreate(options = {}) {
    this.roomId = await this.uniqueCode();
    this.state.code = this.roomId;
    if (options.private) await this.setPrivate(true);
    await this.setMetadata({ code: this.roomId, private: !!options.private });
    this.world = null;
    this.countdownTicks = 0;
    this.lastInputTick = new Map();
    this.setFixedTimestep((ctx) => this.step(ctx), SIM_HZ);
  }

  async uniqueCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!(await this.presence.sismember('vh:codes', code))) {
        await this.presence.sadd('vh:codes', code);
        return code;
      }
    }
  }

  onJoin(client, options = {}) {
    const taken = new Set([...this.state.players.values()].map((p) => p.seat));
    const seat = taken.has(0) ? 1 : 0;
    const p = new Player();
    p.seat = seat;
    p.name = String(options.name || `Player ${seat + 1}`).slice(0, 16);
    p.color = /^#[0-9a-fA-F]{6}$/.test(options.color || '') ? options.color : SEAT_COLORS[seat];
    p.x = 2250 + (seat === 0 ? -60 : 60);
    p.y = 2250;
    p.hp = 100; p.maxHp = 100; p.speed = 3; p.level = 1; p.xpToLevel = 10;
    p.act = new InputCmd();
    this.state.players.set(client.sessionId, p);
    if (this.state.phase === 'lobby' && this.state.players.size === 2) this.startCountdown();
  }

  async onDrop(client) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = false;
    try {
      await this.allowReconnection(client, 20);
    } catch {
      // timed out: onLeave follows
    }
  }

  onReconnect(client) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = true;
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    if (this.world && !this.world.over && this.state.phase === 'playing') {
      this.world.endEarly('abandon', 'partner_left');
      this.finishEpisode();
    }
    if (this.state.phase !== 'playing') {
      this.state.phase = 'lobby';
      for (const q of this.state.players.values()) q.ready = false;
    }
  }

  async onDispose() {
    await this.presence.srem('vh:codes', this.roomId);
  }

  // ---- phases ----------------------------------------------------------------
  startCountdown() {
    this.state.phase = 'countdown';
    this.countdownTicks = COUNTDOWN_S * SIM_HZ;
    this.state.countdown = COUNTDOWN_S;
  }

  startEpisode() {
    const seats = [...this.state.players.entries()].map(([sid, p]) => ({ sid, seat: p.seat, name: p.name, color: p.color }));
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.world = new World(seed, seats);
    this.state.episode += 1;
    this.lastInputTick.clear();
    this.applied = null;
    this.state.seed = seed;
    this.state.outcome = '';
    this.state.reason = '';
    this.state.objects.clear();
    this.state.enemies.clear();
    for (const p of this.state.players.values()) {
      p.ready = false;
      p.skills.clear();
      p.shown.clear();
    }
    this.state.phase = 'playing';
    this.sync();
    this.broadcast('evt:episode_start', { episode: this.state.episode, levelId: this.state.levelId, seed });
  }

  finishEpisode() {
    const w = this.world;
    this.state.phase = 'ended';
    this.state.outcome = w.outcome;
    this.state.reason = w.reason;
    this.sync();
    this.broadcast('evt:episode_end', {
      episode: this.state.episode,
      outcome: w.outcome,
      reason: w.reason,
      wave: w.wave,
      kills: w.kills,
      cores: w.score,
      players: w.players.map((p) => ({ seat: p.sid, level: p.level, ...p.stats })),
    });
  }

  // ---- fixed step ------------------------------------------------------------
  step() {
    const phase = this.state.phase;
    if (phase === 'countdown') {
      this.drainInputs(); // input sent before the run starts must not leak into it
      this.countdownTicks--;
      this.state.countdown = Math.max(0, this.countdownTicks / SIM_HZ);
      if (this.countdownTicks <= 0) this.startEpisode();
      return;
    }
    if (phase !== 'playing' || !this.world) {
      this.drainInputs();
      return;
    }

    const inputs = {};
    for (const sid of this.state.players.keys()) {
      const acc = this.inputs.get(sid);
      // A client whose clock runs slightly fast fills the buffer and plays
      // with up to bufferMaxSize frames (~0.5 s) of lag. Skip stale frames.
      if (acc && acc.size > MAX_INPUT_BACKLOG) while (acc.size > 1) acc.next();
      let cmd = acc ? acc.next() : undefined;
      const p = this.state.players.get(sid);
      if (cmd) this.lastInputTick.set(sid, this.state.tick);
      const quiet = this.state.tick - (this.lastInputTick.get(sid) ?? -Infinity);
      const last = acc?.latest;
      if (!p.connected || (!cmd && !last)) {
        inputs[sid] = { mx: 0, my: 0, fire: false, interact: false };
      } else if (cmd || quiet <= INPUT_HOLD_TICKS) {
        // a fresh frame, or a short gap (network jitter): hold the last frame
        const c = cmd || last;
        inputs[sid] = { mx: c.mx, my: c.my, aimX: c.aimX, aimY: c.aimY, fire: c.fire, auto: c.auto, interact: c.interact };
      } else {
        // The client stopped sending (slow frame, background tab): stop moving
        // and firing, but keep a held grip for a moment so a hitch does not
        // drop the core or cancel a revive.
        inputs[sid] = { mx: 0, my: 0, aimX: last.aimX, aimY: last.aimY, fire: false, auto: last.auto, interact: !!last.interact && quiet <= GRIP_HOLD_TICKS };
      }
    }

    const events = this.world.step(inputs);
    this.applied = inputs;
    this.sync();

    const fx = [];
    for (const e of events) {
      if (e.ch === 'evt') this.broadcast(`evt:${e.name}`, e.data);
      else if (e.ch === 'fx') fx.push([e.name, e.data]);
      else if (e.ch === 'private') {
        const c = this.clients.getById(e.to);
        if (c) c.send(e.name, e.data);
      }
    }
    if (fx.length) this.broadcast('fx', fx);
    if (this.world.over) this.finishEpisode();
  }

  drainInputs() {
    for (const sid of this.state.players.keys()) this.inputs.get(sid)?.drain();
  }

  /** Copy the simulation into the synced state. */
  sync() {
    const w = this.world;
    const st = this.state;
    if (!w) return;
    st.tick = w.tick;
    st.gameTime = w.gameTime;
    st.timeLeft = Math.max(0, GAME_DURATION - w.gameTime / 60);
    st.wave = w.wave;
    st.kills = w.kills;
    st.score = w.score;

    for (const sp of w.players) {
      const p = st.players.get(sp.sid);
      if (!p) continue;
      p.x = sp.x; p.y = sp.y; p.z = 0;
      p.yaw = sp.angle; p.pitch = 0;
      p.vx = sp.vx; p.vy = sp.vy;
      p.aimX = sp.aimX; p.aimY = sp.aimY;
      p.alive = !sp.bledOut;
      p.hp = sp.health; p.maxHp = sp.maxHealth;
      p.downed = sp.downed; p.bledOut = sp.bledOut; p.canBeRevived = sp.canBeRevived;
      p.downedTimer = sp.downedTimer; p.reviveProgress = sp.reviveProgress;
      p.speed = sp.speed; p.slow = sp.slow;
      p.carrying = sp.carrying;
      p.level = sp.level; p.xp = sp.xp; p.xpToLevel = sp.xpToLevel;
      for (const [k, v] of Object.entries(sp.skills)) if (p.skills.get(k) !== v) p.skills.set(k, v);
      p.shield = sp.shieldActive; p.deflect = sp.deflectCharges; p.lightBonus = sp.lightRadiusBonus;
      p.autoshoot = sp.autoshoot;
      p.pendingPicks = sp.offers.length;
      p.kills = sp.stats.kills; p.revives = sp.stats.revives; p.deliveries = sp.stats.deliveries;
      const a = this.applied?.[sp.sid];
      if (a && p.act) {
        p.act.mx = a.mx || 0; p.act.my = a.my || 0;
        if (Number.isFinite(a.aimX)) { p.act.aimX = a.aimX; p.act.aimY = a.aimY; }
        p.act.fire = !!a.fire; p.act.auto = a.auto !== false; p.act.interact = !!a.interact;
      }
    }

    // objects: core, zone, items
    const want = new Set();
    if (w.core) {
      const c = w.core;
      want.add(c.id);
      const o = this.objectFor(c.id, 'core');
      o.x = c.x; o.y = c.y; o.z = 0; o.yaw = c.theta;
      o.vx = c.vx; o.vy = c.vy; o.omega = c.omega; o.tension = c.tension;
      const holders = c.holders.join(',');
      if (o.heldBy.join(',') !== holders) {
        o.heldBy.clear();
        for (const sid of c.holders) o.heldBy.push(sid);
      }
      for (const key of [...o.attach.keys()]) if (!(key in c.attach)) o.attach.delete(key);
      for (const [sid, h] of Object.entries(c.attach)) {
        if (o.attach.get(sid)?.handle === h) continue;
        const a = new Attach();
        a.handle = h;
        a.x = (h === 0 ? -1 : 1) * CORE_LENGTH / 2;
        a.y = 0;
        a.yaw = 0;
        o.attach.set(sid, a);
      }
    }
    if (w.zone) {
      const z = w.zone;
      want.add(z.id);
      const o = this.objectFor(z.id, 'drop_zone');
      o.x = z.x; o.y = z.y; o.r = z.r;
      o.active = z.active;
      o.progress = Math.min(1, z.progress / ZONE_DELIVER_TIME);
    }
    for (const it of w.items) {
      want.add(it.id);
      const o = this.objectFor(it.id, it.type === 'xp' ? 'xp_orb' : 'health_pack');
      o.x = it.x; o.y = it.y; o.vx = it.vx; o.vy = it.vy;
    }
    for (const id of [...st.objects.keys()]) if (!want.has(id)) st.objects.delete(id);

    const wantE = new Set();
    for (const e of w.enemies) {
      wantE.add(e.id);
      let s = st.enemies.get(e.id);
      if (!s) {
        s = new Enemy();
        s.type = e.type;
        st.enemies.set(e.id, s);
      }
      s.x = e.x; s.y = e.y; s.yaw = e.angle; s.vx = e.vx; s.vy = e.vy;
      s.hp = e.health; s.maxHp = e.maxHealth; s.frozen = e.frozen; s.kneel = e.kneel;
    }
    for (const id of [...st.enemies.keys()]) if (!wantE.has(id)) st.enemies.delete(id);
  }

  objectFor(id, type) {
    let o = this.state.objects.get(id);
    if (!o) {
      o = new Obj();
      o.type = type;
      this.state.objects.set(id, o);
    }
    return o;
  }

  // ---- messages ----------------------------------------------------------------
  onReady(client) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.ready = true;
    const all = [...this.state.players.values()];
    if (this.state.phase === 'ended' && all.length === 2 && all.every((q) => q.ready)) this.startCountdown();
  }

  onName(client, msg) {
    const p = this.state.players.get(client.sessionId);
    if (p && msg && typeof msg.name === 'string') p.name = msg.name.slice(0, 16);
  }

  onPick(client, msg) {
    if (!this.world || !msg) return;
    const r = this.world.pickSkill(client.sessionId, Number(msg.level), String(msg.skill));
    if (!r.ok) client.send('pick_rejected', { level: msg.level, reason: r.reason });
  }

  onReroll(client, msg) {
    if (!this.world || !msg) return;
    const offer = this.world.reroll(client.sessionId, Number(msg.level));
    if (offer) client.send('offer', offer);
  }

  onChat(client, msg) {
    const text = String(msg?.text || '').slice(0, 200).trim();
    if (text) this.broadcast('chat', { from: client.sessionId, text });
  }

  onPing(client, msg) {
    const x = Number(msg?.x), y = Number(msg?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.broadcast('ping', { from: client.sessionId, x, y, z: 0, target: String(msg.target || ''), kind: String(msg.kind || 'here').slice(0, 16) });
  }

  onUi(client, msg) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !Array.isArray(msg?.shown)) return;
    p.shown.clear();
    for (const s of msg.shown.slice(0, 8)) p.shown.push(String(s).slice(0, 32));
  }

  onRate(client, msg) {
    const score = Math.round(Number(msg?.score));
    if (score >= 1 && score <= 5) this.broadcast('rate', { from: client.sessionId, score, episode: this.state.episode });
  }
}

export const STEP_UNITS = UNITS_PER_TICK;
