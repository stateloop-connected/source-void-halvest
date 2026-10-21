// Seeded random numbers for the simulation. The server owns the seed and
// records it, so a run can be replayed exactly from seed + inputs.

/** mulberry32: small, fast, good enough for gameplay. Returns floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive an independent stream from a seed and a label, so adding a draw in
 * one system does not shift every other system's numbers. */
export function stream(seed, label) {
  let h = seed >>> 0;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 2654435761) >>> 0;
  }
  return mulberry32(h);
}
