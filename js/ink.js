// Pure geometry + stroke model for the ink surface. No DOM at module scope.

/**
 * Pressure→radius, ported from riddle main.rs:345 (normalized) + ink.rs:41 (growth cap).
 * @param {number} pressure normalized 0..1
 * @param {number|null} prevR previous point's radius, for growth smoothing
 */
export function pressureToRadius(pressure, prevR = null) {
  let r = 2 + pressure * 3;
  if (r < 2) r = 2;
  if (r > 5) r = 5;
  if (prevR != null) r = Math.min(r, prevR + 1);
  return r;
}
