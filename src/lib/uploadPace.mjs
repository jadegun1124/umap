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
 * restarts the 30s or 60s clock from that upload. The first event uploads.
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
