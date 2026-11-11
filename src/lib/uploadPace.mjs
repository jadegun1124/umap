// Upload clock mirrored from LocationKeepService.
// UPLOAD_MOVING_MS and UPLOAD_STILL_MS are read from that file. Distance does not upload.

export function uploadPaceFromJava(source) {
  const num = (name) => {
    const match = source.match(new RegExp(`${name} = ([0-9_]+)L`));
    if (!match) throw new Error(`missing ${name}`);
    return Number(match[1].replaceAll('_', ''));
  };
  return {
    movingMs: num('UPLOAD_MOVING_MS'),
    stillMs: num('UPLOAD_STILL_MS'),
  };
}

/**
 * events: { at, moving } in order. A change of moving uploads immediately and
 * restarts the 10s or 60s clock from that upload. The first event uploads.
 */
export function planUploads(pace, events) {
  let last = null;
  let mode = null;
  const uploads = [];
  for (const event of events) {
    const changed = mode !== null && event.moving !== mode;
    const gap = event.moving ? pace.movingMs : pace.stillMs;
    const due = last === null || event.at - last >= gap;
    if (changed || due) {
      uploads.push({ at: event.at, reason: changed ? 'state' : 'interval' });
      last = event.at;
    }
    mode = event.moving;
  }
  return uploads;
}

/** How many place writes one phone makes in a day at this cadence. */
export function placePutsPerDay(pace, movingHours, stillHours) {
  const moving = (movingHours * 3_600_000) / pace.movingMs;
  const still = (stillHours * 3_600_000) / pace.stillMs;
  return Math.round(moving + still);
}

/**
 * events may carry a point. A due upload takes at most `batch` pending points.
 * While `at` is still inside a backoff window the clock does not fire another request.
 */
export function drainUploads(pace, events, { batch = 80, backoffUntil = 0 } = {}) {
  let last = null;
  let mode = null;
  let pending = [];
  const sends = [];
  let blocked = 0;
  for (const event of events) {
    if (event.point) pending.push(event.point);
    const changed = mode !== null && event.moving !== mode;
    const gap = event.moving ? pace.movingMs : pace.stillMs;
    const due = last === null || event.at - last >= gap;
    if (changed || due) {
      if (event.at < backoffUntil) blocked += 1;
      else {
        const taken = pending.slice(0, batch);
        pending = pending.slice(taken.length);
        sends.push({ at: event.at, reason: changed ? 'state' : 'interval', points: taken });
        last = event.at;
      }
    }
    mode = event.moving;
  }
  return { sends, pending, blocked };
}
