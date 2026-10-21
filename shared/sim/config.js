// Simulation constants for the online co-op version.
// Gameplay constants come from the original game (js/constants.js); this file
// adds the fixed-tick conversion and the new co-op mechanic.

export * from '../../js/constants.js';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../../js/constants.js';

/** Server fixed step. Inputs, simulation and recording all count these ticks. */
export const SIM_HZ = 60;

/** The original game advanced 144 "units" per real second at speed 1.0 and
 * played at speed 0.85 ("Fast"). One server tick therefore advances: */
export const GAME_SPEED = 0.85;
export const UNITS_PER_TICK = (144 * GAME_SPEED) / SIM_HZ; // 2.04

export const ARENA_W = CANVAS_WIDTH;
export const ARENA_H = CANVAS_HEIGHT;

/** Scale for recordings and the manifest: one game unit in metres.
 * A player (24 units wide) is about 0.5 m. */
export const UNIT_M = 0.02;

// ---- Players ---------------------------------------------------------------
export const PLAYER_W = 24;
export const REVIVE_RANGE = 100;
export const REVIVE_TIME = 120;          // game units (~1 s real)
export const AUTOSHOOT_OVERRIDE = 2 * 122.4; // manual fire suspends autoshoot ~2 s
export const LIGHT_HEIGHT_BASE = 300;    // cursor light height before bonus
export const LIGHT_LIT_FACTOR = 1.8;     // lit radius = height * factor

// ---- Items -------------------------------------------------------------------
export const ITEM_W = 12;
export const ITEM_LIFETIME = 60 * 122.4; // uncollected drops vanish after ~60 s
export const MAX_ITEMS = 400;

// ---- Void Core: the carry-together mechanic --------------------------------
export const CORE_LENGTH = 120;          // handle to handle
export const CORE_WIDTH = 36;
export const CORE_MASS_KG = 40;          // for robot conversion only
export const CORE_GRAB_RANGE = 46;       // player centre to handle
export const CORE_CARRY_SPEED = 0.6;     // fraction of the slower carrier's speed
export const CORE_MAX_TURN = 0.02;       // rad per unit of game time
export const CORE_FIRST_SPAWN = 1.0 * 900; // first core after one wave
export const CORE_RESPAWN = 600;         // game units after a delivery
export const CORE_SPAWN_MIN = 650;
export const CORE_SPAWN_MAX = 950;
export const ZONE_RADIUS = 150;
export const ZONE_DIST_MIN = 1100;
export const ZONE_DIST_MAX = 1600;
export const ZONE_DELIVER_TIME = 90;     // game units the core centre must stay inside
export const ARENA_MARGIN = 280;
export const CORE_XP_REWARD = 12;        // XP for each player per delivery
export const CORE_HEAL_RATIO = 0.35;     // fraction of max health healed per delivery
