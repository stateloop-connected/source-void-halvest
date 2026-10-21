// Player movement: the one function both the server and the predicting
// client run. It must stay pure: no randomness, no clock, no outside state.
import { ARENA_W, ARENA_H, PLAYER_W, UNITS_PER_TICK } from './config.js';

const HALF = PLAYER_W / 2;

/**
 * Moves a player one fixed step.
 * `s` holds x, y (centre, game units), speed, slow (0..1), alive, downed, carrying.
 * `cmd` holds mx, my: the wanted direction in world axes, length <= 1.
 * `dtScale` is the number of fixed steps (1 on the server).
 */
export function stepPlayerMove(s, cmd, dtScale = 1) {
  if (!s.alive || s.downed || s.carrying) {
    s.vx = 0;
    s.vy = 0;
    return;
  }
  let mx = Number(cmd.mx) || 0;
  let my = Number(cmd.my) || 0;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  const speed = s.speed * (1 - Math.min(1, s.slow)) * UNITS_PER_TICK * dtScale;
  s.vx = mx * speed;
  s.vy = my * speed;
  s.x = Math.max(HALF, Math.min(ARENA_W - HALF, s.x + s.vx));
  s.y = Math.max(HALF, Math.min(ARENA_H - HALF, s.y + s.vy));
}
