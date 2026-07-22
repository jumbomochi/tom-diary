// Idle-commit timing + commit geometry. Pure logic; renderCommitPng touches canvas.

/**
 * Ported from riddle main.rs: IDLE_COMMIT window measured from the last pen
 * sample, only counting while the pen is up.
 */
export function createIdleTimer(delayMs, onFire) {
  let handle = null;
  let down = false;
  const clear = () => { if (handle) { clearTimeout(handle); handle = null; } };
  const schedule = () => { clear(); if (!down) handle = setTimeout(onFire, delayMs); };
  return {
    activity() { schedule(); },
    penDown() { down = true; clear(); },
    penUp() { down = false; schedule(); },
    cancel() { clear(); },
  };
}
