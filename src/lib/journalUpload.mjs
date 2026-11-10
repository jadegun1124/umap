/** Which sealed journal rows a restarted process may upload. Mirrors LocationKeepService. */

export function markUploaded(journal, sent) {
  const next = (Array.isArray(journal) ? journal : []).map((point) => ({ ...point }));
  const batch = Array.isArray(sent) ? sent : [];
  let cursor = 0;
  let uploadedThrough = 0;
  for (const point of next) {
    if (point && Number(point.at) > uploadedThrough && point.up === true) uploadedThrough = Number(point.at);
  }
  for (const point of next) {
    if (cursor >= batch.length) break;
    const done = batch[cursor];
    if (!point || point.up === true || !done) continue;
    if (Number(point.at) !== Number(done.at) || Number(point.lat) !== Number(done.lat) || Number(point.lng) !== Number(done.lng)) continue;
    point.up = true;
    if (Number(point.at) > uploadedThrough) uploadedThrough = Number(point.at);
    cursor += 1;
  }
  return { journal: next, uploadedThrough };
}

export function pendingFromJournal(journal, uploadedThrough = 0) {
  const pending = [];
  for (const point of Array.isArray(journal) ? journal : []) {
    if (!point) continue;
    const at = Number(point.at);
    if (point.up === true) continue;
    if (at > 0 && at <= uploadedThrough) continue;
    pending.push(point);
  }
  return pending;
}
