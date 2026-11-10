// Family location seal. The server stores these envelopes and never the keys.
// X25519 wraps a 32-byte family key. AES-GCM carries coordinates and place names.
// The account vault uses PBKDF2 of the 12-character recovery code, which the
// server stores only as a hash after the first sealed backup.

const TEXT = new TextEncoder();
const KEY_PART = /^[A-Za-z0-9_-]{16,64}$/;
const B64 = /^[A-Za-z0-9_-]+$/;
export const VAULT_ITERATIONS = 600_000;

export function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value) {
  if (typeof value !== 'string' || !B64.test(value) || value.length > 200_000) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomBytes(size) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function randomFamilyId() {
  return bytesToBase64Url(randomBytes(16));
}

export function isSeal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.v !== 1 || value.alg !== 'A256GCM') return false;
  if (!KEY_PART.test(value.kid || '')) return false;
  const iv = base64UrlToBytes(value.iv);
  const ct = base64UrlToBytes(value.ct);
  return !!iv && iv.length === 12 && !!ct && ct.length >= 16 && ct.length <= 180_000;
}

export function isPublicKey(value) {
  const bytes = typeof value === 'string' ? base64UrlToBytes(value) : null;
  return !!bytes && bytes.length === 32;
}

export function isKeyWrap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const epk = base64UrlToBytes(value.epk);
  const iv = base64UrlToBytes(value.iv);
  const ct = base64UrlToBytes(value.ct);
  return !!epk && epk.length === 32 && !!iv && iv.length === 12 && !!ct && ct.length >= 16 && ct.length <= 128;
}

export function isHistoryKey(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const iv = base64UrlToBytes(value.iv);
  const ct = base64UrlToBytes(value.ct);
  return !!iv && iv.length === 12 && !!ct && ct.length >= 16 && ct.length <= 128;
}

const HISTORY_ACCOUNT_INFO = 'umap-history-account-v1';

export async function wrapContentKeyForAccount(accountKey, contentKey) {
  if (typeof accountKey !== 'string' || accountKey.length < 16) return null;
  const raw = typeof contentKey === 'string' ? base64UrlToBytes(contentKey) : contentKey;
  if (!(raw instanceof Uint8Array) || raw.length !== 32) return null;
  const kek = await hkdfKey(TEXT.encode(accountKey), 'umap-account', HISTORY_ACCOUNT_INFO);
  return sealRaw(kek, raw);
}

export async function openContentKeyForAccount(accountKey, wrap) {
  if (typeof accountKey !== 'string' || accountKey.length < 16 || !isHistoryKey(wrap)) return null;
  const kek = await hkdfKey(TEXT.encode(accountKey), 'umap-account', HISTORY_ACCOUNT_INFO);
  return openRaw(kek, wrap.iv, wrap.ct);
}

export function isVault(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.kdf !== 'PBKDF2-SHA256' || value.iter !== VAULT_ITERATIONS) return false;
  const salt = base64UrlToBytes(value.salt);
  const iv = base64UrlToBytes(value.iv);
  const ct = base64UrlToBytes(value.ct);
  return !!salt && salt.length === 16 && !!iv && iv.length === 12 && !!ct && ct.length >= 16 && ct.length <= 4096;
}

async function aesKey(raw) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function sealRaw(keyRaw, plain) {
  const iv = randomBytes(12);
  const key = await aesKey(keyRaw);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { iv: bytesToBase64Url(iv), ct: bytesToBase64Url(ct) };
}

async function openRaw(keyRaw, ivB64, ctB64) {
  const iv = base64UrlToBytes(ivB64);
  const ct = base64UrlToBytes(ctB64);
  if (!iv || !ct) return null;
  try {
    const key = await aesKey(keyRaw);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  } catch {
    return null;
  }
}

export async function sealJson(keyRaw, kid, value) {
  if (!(keyRaw instanceof Uint8Array) || keyRaw.length !== 32 || !KEY_PART.test(kid || '')) return null;
  const sealed = await sealRaw(keyRaw, TEXT.encode(JSON.stringify(value)));
  return { v: 1, alg: 'A256GCM', kid, iv: sealed.iv, ct: sealed.ct };
}

export async function openJson(keyRaw, envelope) {
  if (!(keyRaw instanceof Uint8Array) || keyRaw.length !== 32 || !isSeal(envelope)) return null;
  const plain = await openRaw(keyRaw, envelope.iv, envelope.ct);
  if (!plain) return null;
  try {
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

export async function mintFamilyKey() {
  return { kid: randomFamilyId(), key: randomBytes(32) };
}

export async function mintDeviceKey() {
  const pair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const publicKey = bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const privateKey = bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)));
  return {
    publicKey,
    privateKey,
    contentKey: bytesToBase64Url(randomBytes(32)),
  };
}

async function hkdfKey(bits, salt, info) {
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: TEXT.encode(salt),
    info: TEXT.encode(info),
  }, base, 256);
  return new Uint8Array(derived);
}

async function sharedSecret(privateKey, publicRaw) {
  const remote = await crypto.subtle.importKey('raw', publicRaw, { name: 'X25519' }, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'X25519', public: remote }, privateKey, 256);
  return new Uint8Array(bits);
}

export async function wrapFamilyKey(recipientPublic, familyKey, kid) {
  const pub = base64UrlToBytes(recipientPublic);
  if (!pub || pub.length !== 32 || !(familyKey instanceof Uint8Array) || familyKey.length !== 32 || !KEY_PART.test(kid || '')) return null;
  const pair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const secret = await sharedSecret(pair.privateKey, pub);
  const kek = await hkdfKey(secret, kid, 'umap-family-wrap-v1');
  const sealed = await sealRaw(kek, familyKey);
  const epk = bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  return { epk, iv: sealed.iv, ct: sealed.ct };
}

export async function unwrapFamilyKey(recipientPrivate, wrap, kid) {
  const priv = base64UrlToBytes(recipientPrivate);
  const epk = wrap ? base64UrlToBytes(wrap.epk) : null;
  if (!priv || !epk || !isKeyWrap(wrap) || !KEY_PART.test(kid || '')) return null;
  try {
    const privateKey = await crypto.subtle.importKey('pkcs8', priv, { name: 'X25519' }, false, ['deriveBits']);
    const secret = await sharedSecret(privateKey, epk);
    const kek = await hkdfKey(secret, kid, 'umap-family-wrap-v1');
    return openRaw(kek, wrap.iv, wrap.ct);
  } catch {
    return null;
  }
}

async function recoveryKey(code, salt) {
  const base = await crypto.subtle.importKey('raw', TEXT.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt,
    iterations: VAULT_ITERATIONS,
  }, base, 256);
  return new Uint8Array(bits);
}

export async function wrapVault(recoveryCode, secret) {
  const code = typeof recoveryCode === 'string' ? recoveryCode : '';
  if (code.length < 12 || !secret || typeof secret.privateKey !== 'string' || typeof secret.publicKey !== 'string' || typeof secret.contentKey !== 'string') return null;
  const salt = randomBytes(16);
  const kek = await recoveryKey(code, salt);
  const sealed = await sealRaw(kek, TEXT.encode(JSON.stringify({
    privateKey: secret.privateKey,
    publicKey: secret.publicKey,
    contentKey: secret.contentKey,
  })));
  return { kdf: 'PBKDF2-SHA256', iter: VAULT_ITERATIONS, salt: bytesToBase64Url(salt), iv: sealed.iv, ct: sealed.ct };
}

export async function unwrapVault(recoveryCode, vault) {
  const code = typeof recoveryCode === 'string' ? recoveryCode : '';
  if (code.length < 12 || !isVault(vault)) return null;
  const salt = base64UrlToBytes(vault.salt);
  if (!salt) return null;
  const kek = await recoveryKey(code, salt);
  const plain = await openRaw(kek, vault.iv, vault.ct);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(plain));
    if (!parsed || typeof parsed.privateKey !== 'string' || typeof parsed.publicKey !== 'string' || typeof parsed.contentKey !== 'string') return null;
    if (!isPublicKey(parsed.publicKey) || !base64UrlToBytes(parsed.contentKey) || base64UrlToBytes(parsed.contentKey).length !== 32) return null;
    return parsed;
  } catch {
    return null;
  }
}
