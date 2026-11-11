/** Which sealed journal rows a restarted process may upload. Mirrors LocationKeepService. */

export function markUploaded(journal, sent) {
  const next = (Array.isArray(journal) ? journal : []).map((point) => ({ ...point }));
  const batch = Array.isArray(sent) ? sent : [];
  let cursor = 0;
  let uploadedThrough = 0;
  let index = 0;
  for (const point of next) {
    if (point && point.up === true && Number(point.at) > uploadedThrough) uploadedThrough = Number(point.at);
  }
  while (index < next.length && cursor < batch.length) {
    const point = next[index];
    const done = batch[cursor];
    if (!done) {
      cursor += 1;
      continue;
    }
    if (!point || point.up === true) {
      index += 1;
      continue;
    }
    const same = Number(point.at) === Number(done.at)
      && Number(point.lat) === Number(done.lat)
      && Number(point.lng) === Number(done.lng);
    if (same) {
      point.up = true;
      if (Number(point.at) > uploadedThrough) uploadedThrough = Number(point.at);
      cursor += 1;
      index += 1;
      continue;
    }
    if (Number(point.at) > Number(done.at)) {
      if (Number(done.at) > uploadedThrough) uploadedThrough = Number(done.at);
      cursor += 1;
      continue;
    }
    index += 1;
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
