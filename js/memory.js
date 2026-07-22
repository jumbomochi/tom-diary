// The diary's memory: an IndexedDB page store plus the pure catalog/date/gist/
// decimation/recent-dialogue logic. Ported from riddle/src/memory.rs.

/** Newest memories the diary keeps; older pages are pruned. (memory.rs:20) */
export const MAX_MEMORIES = 400;
/** Decimation: drop replay points closer than √9 = 3px to the last kept one. (memory.rs:23) */
export const MIN_POINT_DIST2 = 9;

/**
 * Decimate stored strokes ([x,y,r] triples): drop points within MIN_POINT_DIST2
 * of the last kept point, always keep each stroke's last point. (memory.rs:199-220)
 */
export function decimate(strokes) {
  return strokes.map((s) => {
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const [x, y, r] = s[i];
      const last = out[out.length - 1];
      let keep;
      if (!last) {
        keep = true;
      } else {
        const dx = x - last[0], dy = y - last[1];
        keep = dx * dx + dy * dy >= MIN_POINT_DIST2 || i === s.length - 1;
      }
      if (keep) out.push([x, y, r]);
    }
    return out;
  }).filter((s) => s.length > 0);
}

/** Convert Plan 1 ink strokes ({points:[{x,y,r}]}) to integer [x,y,r] triples. */
export function strokesToTriples(inkStrokes) {
  return inkStrokes.map((s) => s.points.map((p) => [
    Math.round(p.x), Math.round(p.y), Math.round(p.r ?? 2),
  ]));
}

const divEuclid = (a, b) => Math.floor(a / b);
const remEuclid = (a, b) => ((a % b) + b) % b;

/** Seconds-since-epoch to civil date + hour (Howard Hinnant). (memory.rs:281-294) */
function civil(secs) {
  const days = divEuclid(secs, 86400);
  const hour = divEuclid(remEuclid(secs, 86400), 3600);
  const z = days + 719468;
  const era = divEuclid(z, 146097);
  const doe = remEuclid(z, 146097);
  const yoe = divEuclid(doe - divEuclid(doe, 1460) + divEuclid(doe, 36524) - divEuclid(doe, 146096), 365);
  const doy = doe - (365 * yoe + divEuclid(yoe, 4) - divEuclid(yoe, 100));
  const mp = divEuclid(5 * doy + 2, 153);
  const d = doy - divEuclid(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { d, mo: m, h: hour };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "the 6th of July, in the evening" — year omitted; UTC + offsetHours. (memory.rs:245-278) */
export function spokenDate(id, offsetHours = 0) {
  const t = id + Math.trunc(offsetHours * 3600);
  const { d, mo, h } = civil(t);
  let suffix;
  if (d >= 11 && d <= 13) suffix = 'th';
  else if (d % 10 === 1) suffix = 'st';
  else if (d % 10 === 2) suffix = 'nd';
  else if (d % 10 === 3) suffix = 'rd';
  else suffix = 'th';
  let tod;
  if (h <= 4) tod = 'in the small hours';
  else if (h <= 11) tod = 'in the morning';
  else if (h <= 17) tod = 'in the afternoon';
  else if (h <= 21) tod = 'in the evening';
  else tod = 'late at night';
  return `the ${d}${suffix} of ${MONTHS[mo - 1]}, ${tod}`;
}

/** Collapse whitespace to single spaces, cap at `max` Unicode chars. (memory.rs:195-197) */
export function oneLine(s, max) {
  const collapsed = s.split(/\s+/).filter(Boolean).join(' ');
  return Array.from(collapsed).slice(0, max).join('');
}

/** Catalog gist: transcript, or "(reply: …)" when the transcript is blank. (memory.rs:179-183) */
export function gist(entry) {
  if (entry.transcript.trim() === '') return `(reply: ${oneLine(entry.reply, 70)})`;
  return oneLine(entry.transcript, 70);
}
