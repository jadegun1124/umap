import { PUBLIC_NAVER_CLIENT_ID } from '../src/lib/naverAuth.mjs';
import { createMemoryAccountStore, handleAccountOperation } from './account.mjs';
import { appendTrailPart, applyAlert, applyDirectMessage, applyKeyPut, applySubscription, alertPushPayload, chatPushPayload, commitPlace, commitProfile, commitTrail, emptyRoom, memberRoomToken, parseOperation, placeWriteHeld, planForgetMember, previousPlaceSharing, pushesForAlert, pushesForChat, removeSubscriptions, storageQuotaResponse, viewDirectMessages, viewFamilyPlaces, viewMyThreads, viewRoom, withCors } from './protocol.mjs';
import { createVapidKeys, sendWebPush } from './webpush.mjs';

// One Durable Object per family room. The id is a hash of the invite code,
// the write key, and the read-key hash. The read key itself is not stored.
// idFromName('umap-push-meta') keeps the VAPID keypair. It is not a family room.
export class FamilyRoom {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    try {
      return await this.perform(request);
    } catch (error) {
      const limited = storageQuotaResponse(error);
      if (limited) return limited;
      throw error;
    }
  }

  async perform(request) {
    const op = await request.json();
    if (op.kind === 'vapid') {
      let keys = await this.ctx.storage.get('vapid');
      if (!keys || !keys.publicKey || !keys.jwk) {
        keys = await createVapidKeys();
        await this.ctx.storage.put('vapid', keys);
      }
      return Response.json({ publicKey: keys.publicKey, jwk: keys.jwk });
    }
    if (op.kind === 'vapid-public') {
      let keys = await this.ctx.storage.get('vapid');
      if (!keys || !keys.publicKey || !keys.jwk) {
        keys = await createVapidKeys();
        await this.ctx.storage.put('vapid', keys);
      }
      return Response.json({ publicKey: keys.publicKey });
    }

    let room = (await this.ctx.storage.get('room')) || emptyRoom();
    if (op.kind === 'get') {
      const { authorizeReader } = await import('./protocol.mjs');
      const auth = await authorizeReader(room, op.viewerId, op.profileKey);
      if (auth.error) return auth.error;
      return Response.json(viewRoom(room, op.since));
    }
    if (op.kind === 'family') {
      const { authorizeReader } = await import('./protocol.mjs');
      const auth = await authorizeReader(room, op.viewerId, op.profileKey);
      if (auth.error) return auth.error;
      return Response.json(viewFamilyPlaces(room));
    }
    if (op.kind === 'chat-get') {
      const view = op.peer ? viewDirectMessages(room, op.me, op.peer) : viewMyThreads(room, op.me);
      if (!view) return Response.json({ error: 'chat' }, { status: 400 });
      return Response.json(view);
    }
    if (op.kind === 'chat') {
      const next = applyDirectMessage(room, op.message, Date.now());
      const view = viewDirectMessages(next.room, op.message.from, op.message.to) || { messages: [] };
      if (!next.ignored) {
        room = next.room;
        await this.ctx.storage.put('room', room);
        return Response.json({
          ...view,
          pushes: pushesForChat(room, op.message),
          payload: chatPushPayload(op.message, op.code || ''),
        });
      }
      return Response.json(view);
    }
    if (op.kind === 'place') {
      const next = await commitPlace(room, op.place, op.profileKey || '');
      if (next.error) return next.error;
      let stored = next.room;
      let ignored = next.ignored === true;
      if (op.place.trailSeal && op.place.memberId) {
        const trailed = appendTrailPart(stored, op.place.memberId, op.place.at, op.place.moving === true, op.place.trailSeal);
        stored = trailed.room;
        ignored = ignored && trailed.ignored;
      }
      const memberId = typeof op.place?.memberId === 'string' ? op.place.memberId : '';
      const at = typeof op.place?.at === 'number' ? op.place.at : Date.now();
      // One room rewrite per member per 8s for a plain 1.54 fix. A flush, a
      // trail batch, a stop, or a sharing change is written now.
      const lastAt = memberId && this.persistedPlaceAt ? this.persistedPlaceAt.get(memberId) || 0 : 0;
      const held = !ignored && placeWriteHeld(op.place, lastAt, at, previousPlaceSharing(room, op.place));
      if (!ignored && !held) {
        room = stored;
        await this.ctx.storage.put('room', room);
        if (memberId) {
          if (!this.persistedPlaceAt) this.persistedPlaceAt = new Map();
          this.persistedPlaceAt.set(memberId, at);
        }
      }
      return Response.json({
        ok: true,
        collected: !ignored && !held && !!memberId,
        memberId,
        at,
      });
    }
    if (op.kind === 'profile') {
      const next = await commitProfile(room, op.profile, op.profileKey || '');
      if (next.error) return next.error;
      if (!next.ignored) {
        room = next.room;
        await this.ctx.storage.put('room', room);
      }
      return Response.json({ ok: true });
    }
    if (op.kind === 'trail') {
      const next = await commitTrail(room, op.trail, op.profileKey || '');
      if (next.error) return next.error;
      if (!next.ignored) {
        room = next.room;
        await this.ctx.storage.put('room', room);
      }
      return Response.json({
        ok: true,
        collected: next.ignored !== true && !!op.trail?.memberId,
        memberId: op.trail?.memberId || '',
        at: op.trail?.at || Date.now(),
        history: true,
      });
    }
    if (op.kind === 'keys') {
      if (!this.keyPutAt) this.keyPutAt = new Map();
      const next = await applyKeyPut(room, op.keys, op.profileKey || '', this.keyPutAt, Date.now());
      if (next.error) return next.error;
      if (next.wrote) await this.ctx.storage.put('room', next.room);
      return Response.json({ ok: true, keys: next.directory });
    }
    if (op.kind === 'alert') {
      const next = applyAlert(room, op.alert, Date.now());
      if (!next.ignored) {
        room = next.room;
        await this.ctx.storage.put('room', room);
        return Response.json({ ok: true, pushes: pushesForAlert(room, op.alert), payload: alertPushPayload(op.alert) });
      }
      return Response.json({ ok: true, pushes: [], payload: null });
    }
    if (op.kind === 'push-subscribe') {
      room = applySubscription(room, op.subscription);
      await this.ctx.storage.put('room', room);
      return Response.json({ ok: true });
    }
    if (op.kind === 'push-remove') {
      room = removeSubscriptions(room, op.endpoints || []);
      await this.ctx.storage.put('room', room);
      return Response.json({ ok: true });
    }
    if (op.kind === 'delete') {
      await this.ctx.storage.delete('room');
      return Response.json({ ok: true });
    }
    if (op.kind === 'forget-member') {
      const memberId = typeof op.memberId === 'string' ? op.memberId : '';
      if (!memberId) return Response.json({ error: 'member' }, { status: 400 });
      const plan = planForgetMember(room, memberId, op.deleteIfAlone === true);
      if (plan.deleted) {
        await this.ctx.storage.delete('room');
        return Response.json({ ok: true, deleted: true });
      }
      await this.ctx.storage.put('room', plan.room);
      return Response.json({ ok: true, deleted: false });
    }
    return Response.json({ error: 'method' }, { status: 405 });
  }
}

async function forgetMemberDurable(env, target) {
  if (!env?.FAMILY_ROOM) return;
  const token = await memberRoomToken(target);
  if (!token) return;
  const stub = env.FAMILY_ROOM.get(env.FAMILY_ROOM.idFromName(token));
  await stub.fetch('https://room.internal/op', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'forget-member',
      memberId: target.memberId,
      deleteIfAlone: target.deleteIfAlone === true,
    }),
  });
}

function accountRuntimeOptions(env) {
  return {
    naverClientId: env.NAVER_CLIENT_ID || PUBLIC_NAVER_CLIENT_ID,
    naverClientSecret: env.NAVER_CLIENT_SECRET || '',
    kakaoAdminKey: env.KAKAO_ADMIN_KEY || '',
    diagReadToken: env.DIAG_READ_TOKEN || '',
    forgetMember: env.FAMILY_ROOM ? (target) => forgetMemberDurable(env, target) : undefined,
  };
}

function durableAccountStore(storage) {
  return {
    async get(key) {
      return storage.get(key);
    },
    async put(key, value) {
      await storage.put(key, value);
    },
    async delete(key) {
      await storage.delete(key);
    },
  };
}

export class FamilyAccount {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env || {};
  }

  async fetch(request) {
    try {
      const body = await request.json();
      const env = this.env || {};
      return await handleAccountOperation(durableAccountStore(this.ctx.storage), body.op, {
        ...accountRuntimeOptions(env),
        naverClientId: body.naverClientId || env.NAVER_CLIENT_ID || PUBLIC_NAVER_CLIENT_ID,
        naverClientSecret: body.naverClientSecret || env.NAVER_CLIENT_SECRET || '',
        now: body.now,
      });
    } catch (error) {
      const limited = storageQuotaResponse(error);
      if (limited) return limited;
      throw error;
    }
  }
}

async function vapidKeys(env) {
  const stub = env.FAMILY_ROOM.get(env.FAMILY_ROOM.idFromName('umap-push-meta'));
  const response = await stub.fetch('https://room.internal/op', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'vapid' }),
  });
  return response.json();
}

async function deliverAlert(env, stub, data) {
  const pushes = Array.isArray(data.pushes) ? data.pushes : [];
  if (!pushes.length || !data.payload) return;
  let keys;
  try {
    keys = await vapidKeys(env);
  } catch {
    return;
  }
  const gone = [];
  await Promise.all(pushes.map(async (subscription) => {
    try {
      const status = await sendWebPush(keys, subscription, data.payload);
      if (status === 404 || status === 410) gone.push(subscription.endpoint);
    } catch {
      /* 다음 알림에서 다시 보낸다 */
    }
  }));
  if (!gone.length) return;
  await stub.fetch('https://room.internal/op', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'push-remove', endpoints: gone }),
  }).catch(() => undefined);
}

async function noteHandling(env, op, data) {
  if (!env?.FAMILY_ACCOUNT || !data) return;
  const accounts = env.FAMILY_ACCOUNT.get(env.FAMILY_ACCOUNT.idFromName('umap-account-book'));
  const post = (event) => accounts.fetch('https://account.internal/op', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: { kind: 'account-handling-record', event } }),
  });
  if ((op.kind === 'place' || op.kind === 'trail') && data.collected && data.memberId) {
    await post({
      kind: 'collect',
      memberId: data.memberId,
      actor: data.memberId,
      categories: data.history ? ['history'] : ['location'],
      at: data.at,
    });
    return;
  }
  if ((op.kind !== 'family' && op.kind !== 'get') || !op.viewerId) return;
  const seen = new Set();
  for (const place of Array.isArray(data.places) ? data.places : []) {
    if (!place || typeof place.memberId !== 'string' || place.memberId === op.viewerId || seen.has(`p:${place.memberId}`)) continue;
    seen.add(`p:${place.memberId}`);
    await post({
      kind: 'use',
      memberId: place.memberId,
      actor: op.viewerId,
      categories: ['location'],
      at: Date.now(),
    });
  }
  for (const trail of Array.isArray(data.trails) ? data.trails : []) {
    if (!trail || typeof trail.memberId !== 'string' || trail.memberId === op.viewerId || seen.has(`t:${trail.memberId}`)) continue;
    seen.add(`t:${trail.memberId}`);
    await post({
      kind: 'use',
      memberId: trail.memberId,
      actor: op.viewerId,
      categories: ['history'],
      at: Date.now(),
    });
  }
}

async function purgeDisclosureLedger(env) {
  if (!env?.FAMILY_ACCOUNT) return;
  const accounts = env.FAMILY_ACCOUNT.get(env.FAMILY_ACCOUNT.idFromName('umap-account-book'));
  await accounts.fetch('https://account.internal/op', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: { kind: 'account-disclosure-purge' } }),
  });
}

export async function quotaResponse(response) {
  if (!response || response.status !== 503) return null;
  const body = await response.clone().json().catch(() => null);
  if (!body || body.error !== 'quota') return null;
  return response;
}

export async function presentRoomResponse(kind, response) {
  if (kind === 'alert' || kind === 'chat') {
    const quota = await quotaResponse(response);
    if (quota) return quota;
    const data = await response.json();
    if (kind === 'alert') return Response.json({ ok: data.ok === true });
    return Response.json({ messages: Array.isArray(data.messages) ? data.messages : [] });
  }
  if (kind === 'place' || kind === 'trail' || kind === 'family' || kind === 'get') {
    const data = await response.json();
    return Response.json(data, { status: response.status });
  }
  return response;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(purgeDisclosureLedger(env).catch(() => undefined));
  },
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    const { inviteLandingResponse } = await import('./invite.mjs');
    const landing = inviteLandingResponse(request);
    if (landing) return landing;
    const op = await parseOperation(request);
    if (op instanceof Response) return withCors(op);
    if (op.kind === 'health') {
      return withCors(Response.json({ ok: true, service: 'umap-family-sync' }));
    }
    if (op.kind === 'vapid-public') {
      try {
        const keys = await vapidKeys(env);
        return withCors(Response.json({ publicKey: keys.publicKey }));
      } catch {
        return withCors(Response.json({ error: 'vapid' }, { status: 503 }));
      }
    }
    if (typeof op.kind === 'string' && op.kind.startsWith('account-')) {
      const accounts = env.FAMILY_ACCOUNT
        ? env.FAMILY_ACCOUNT.get(env.FAMILY_ACCOUNT.idFromName('umap-account-book'))
        : null;
      if (!accounts) {
        return withCors(await handleAccountOperation(createMemoryAccountStore(), op, accountRuntimeOptions(env)));
      }
      try {
        const response = await accounts.fetch('https://account.internal/op', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            op,
            naverClientId: env.NAVER_CLIENT_ID || PUBLIC_NAVER_CLIENT_ID,
            naverClientSecret: env.NAVER_CLIENT_SECRET || '',
          }),
        });
        return withCors(response);
      } catch (error) {
        const limited = storageQuotaResponse(error);
        if (limited) return withCors(limited);
        throw error;
      }
    }
    const stub = env.FAMILY_ROOM.get(env.FAMILY_ROOM.idFromName(op.token));
    let response;
    try {
      response = await stub.fetch('https://room.internal/op', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(op),
      });
    } catch (error) {
      const limited = storageQuotaResponse(error);
      if (limited) return withCors(limited);
      throw error;
    }
    if (op.kind === 'alert' || op.kind === 'chat') {
      const quota = await quotaResponse(response);
      if (!quota) {
        const data = await response.clone().json().catch(() => null);
        if (data) await deliverAlert(env, stub, data);
      }
    }
    if (op.kind === 'place' || op.kind === 'trail' || op.kind === 'family' || op.kind === 'get') {
      const data = await response.clone().json().catch(() => null);
      if (data && response.status !== 503) await noteHandling(env, op, data).catch(() => undefined);
    }
    return withCors(await presentRoomResponse(op.kind, response));
  },
};
