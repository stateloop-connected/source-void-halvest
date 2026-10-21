// Synced room state. Names follow the Stateloop co-op data rules
// (guidelines/coop-developer-guide.md §6.5): players, objects, heldBy, attach,
// joint, active, on, inside, levelId, phase, score. Positions are entity
// centres in game units (stateloop.coop.json declares the unit and frame).
import { schema, t } from '@colyseus/schema';

/** One input frame per fixed step. Flat primitives only (Colyseus rule).
 * Every field has a default: Colyseus leaves fields without one undefined
 * until first set, and clients read state before the first full patch. */
export const InputCmd = schema({
  mx: t.float32().default(0),      // wanted move direction, world x (-1..1)
  my: t.float32().default(0),      // wanted move direction, world y (-1..1)
  aimX: t.float32().default(0),    // cursor point on the ground, game units
  aimY: t.float32().default(0),
  fire: t.boolean().default(false),    // manual fire held
  auto: t.boolean().default(false),    // autoshoot toggle state
  interact: t.boolean().default(false),// E held: revive or hold a core handle
}, 'InputCmd');

export const Attach = schema({
  handle: t.int8().default(0),     // index into the object type's handles, -1 = none
  x: t.number().default(0),        // grip position in the object's own frame
  y: t.number().default(0),
  yaw: t.number().default(0),
}, 'Attach');

export const Player = schema({
  slot: t.uint8().default(0),      // 0 or 1, join order. Payloads name players by session id (`seat`).
  bot: t.boolean().default(false), // a test bot or an AI seat, not a person
  name: t.string().default(''),
  color: t.string().default('#00ffff'),
  ready: t.boolean().default(false),
  connected: t.boolean().default(true),
  role: t.string().default('harvester'),
  shown: t.array('string'),
  x: t.number().default(0), y: t.number().default(0), z: t.number().default(0),
  yaw: t.number().default(0), pitch: t.number().default(0),
  vx: t.number().default(0), vy: t.number().default(0),
  aimX: t.float32().default(0), aimY: t.float32().default(0),
  alive: t.boolean().default(true),
  hp: t.number().default(0), maxHp: t.number().default(0),
  downed: t.boolean().default(false), bledOut: t.boolean().default(false), canBeRevived: t.boolean().default(true),
  downedTimer: t.number().default(0), reviveProgress: t.number().default(0),
  speed: t.number().default(0), slow: t.number().default(0),
  carrying: t.string().default(''),
  level: t.uint16().default(0), xp: t.number().default(0), xpToLevel: t.number().default(0),
  skills: t.map('uint8'),
  shield: t.boolean().default(false), deflect: t.uint8().default(0), lightBonus: t.number().default(0),
  autoshoot: t.boolean().default(true),
  pendingPicks: t.uint8().default(0),
  kills: t.uint16().default(0), revives: t.uint16().default(0), deliveries: t.uint16().default(0),
  // The command the simulation applied on the last tick (after buffering,
  // skipping and idle rules), so recordings hold the action, not a guess.
  act: InputCmd,
}, 'Player');

/** Every dynamic object and fixture: the core, the drop zone, XP orbs, health packs. */
export const Obj = schema({
  type: t.string().default(''),
  x: t.number().default(0), y: t.number().default(0), z: t.number().default(0),
  yaw: t.number().default(0),
  vx: t.number().default(0), vy: t.number().default(0), omega: t.number().default(0),
  heldBy: t.array('string'),
  attach: t.map(Attach),
  joint: t.number().default(0),
  active: t.boolean().default(false),
  on: t.string().default(''),
  inside: t.string().default(''),
  r: t.number().default(0),         // drop zone radius
  progress: t.number().default(0),  // drop zone delivery progress (0..1)
  tension: t.number().default(0),   // core: carriers pulling apart (>0) or pushing together (<0)
}, 'Obj');

/** Computer-controlled characters (the guide's reserved `agents` map). */
export const Agent = schema({
  type: t.string().default(''),
  x: t.float32().default(0), y: t.float32().default(0), yaw: t.float32().default(0),
  vx: t.float32().default(0), vy: t.float32().default(0),
  hp: t.number().default(0), maxHp: t.number().default(0),
  frozen: t.boolean().default(false), kneel: t.boolean().default(false),
}, 'Agent');

export const CoopState = schema({
  phase: t.string().default('lobby'), // lobby | countdown | playing | ended
  code: t.string().default(''),
  levelId: t.string().default('arena'),
  episode: t.uint16().default(0),
  seed: t.uint32().default(0),
  countdown: t.number().default(0),
  tick: t.uint32().default(0),
  gameTime: t.number().default(0),
  timeLeft: t.number().default(0),
  wave: t.uint16().default(0),
  kills: t.uint32().default(0),
  score: t.uint16().default(0),
  outcome: t.string().default(''),
  reason: t.string().default(''),
  players: t.map(Player),
  objects: t.map(Obj),
  agents: t.map(Agent),
}, 'CoopState');
