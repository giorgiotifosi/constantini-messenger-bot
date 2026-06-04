import { createHash } from "crypto";

const LOCK_TTL_SEC = 600;
const COMPLETED_TTL_MS = 10 * 60 * 1000;
const WEBHOOK_BODY_TTL_MS = 5 * 60 * 1000;

const globalStore = globalThis;
if (!globalStore.__kitchenSendState) {
  globalStore.__kitchenSendState = {
    inFlight: new Set(),
    completedUntil: new Map(),
    recentWebhookHashes: new Map(),
  };
}

function getMemoryState() {
  return globalStore.__kitchenSendState;
}

/**
 * @returns {boolean | null} true = acquired, false = held, null = KV not configured
 */
async function tryAcquireKvLock(key) {
  const base = process.env.KV_REST_API_URL?.replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN;
  if (!base || !token) return null;

  const res = await fetch(
    `${base}/set/${encodeURIComponent(key)}/1?EX=${LOCK_TTL_SEC}&NX=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    console.warn(`KV lock request failed: ${res.status}`);
    return null;
  }

  const data = await res.json();
  return data.result === "OK";
}

/**
 * @param {string} key
 */
async function releaseKvLock(key) {
  const base = process.env.KV_REST_API_URL?.replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN;
  if (!base || !token) return;

  await fetch(`${base}/del/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

/**
 * @param {string} psid
 * @param {string} catalogId
 */
function sendKey(psid, catalogId) {
  return `${psid}:${catalogId}`;
}

/**
 * @param {string} psid
 * @param {string} catalogId
 */
function lockKey(psid, catalogId) {
  return `album:send:${catalogId}:${psid}`;
}

/**
 * @param {string} psid
 * @param {string} catalogId
 */
function isCompletedInMemory(psid, catalogId) {
  const key = sendKey(psid, catalogId);
  const exp = getMemoryState().completedUntil.get(key);
  if (!exp) return false;
  if (Date.now() < exp) return true;
  getMemoryState().completedUntil.delete(key);
  return false;
}

/**
 * @param {string} psid
 * @param {string} catalogId
 */
function markCompletedInMemory(psid, catalogId) {
  getMemoryState().completedUntil.set(
    sendKey(psid, catalogId),
    Date.now() + COMPLETED_TTL_MS
  );
}

/**
 * Same webhook payload retried by Meta (often identical body).
 * @param {unknown} body
 */
export function isDuplicateWebhookBody(body) {
  const hash = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");
  const store = getMemoryState().recentWebhookHashes;
  const existing = store.get(hash);
  if (existing && Date.now() < existing) {
    console.log(`Skip duplicate webhook body hash=${hash.slice(0, 12)}`);
    return true;
  }
  store.set(hash, Date.now() + WEBHOOK_BODY_TTL_MS);

  if (store.size > 200) {
    const now = Date.now();
    for (const [h, exp] of store) {
      if (exp <= now) store.delete(h);
    }
  }
  return false;
}

/**
 * @param {string} psid
 * @param {string} catalogId
 * @param {Set<string>} batchSent
 * @returns {Promise<boolean>}
 */
export async function tryAcquireAlbumSend(psid, catalogId, batchSent) {
  const key = sendKey(psid, catalogId);
  if (batchSent.has(key)) return false;
  if (isCompletedInMemory(psid, catalogId)) return false;

  const memory = getMemoryState();
  if (memory.inFlight.has(key)) return false;

  const kvResult = await tryAcquireKvLock(lockKey(psid, catalogId));
  if (kvResult === false) {
    console.log(`Skip album send: KV lock held for ${key}`);
    return false;
  }

  memory.inFlight.add(key);
  batchSent.add(key);
  return true;
}

/** @deprecated use tryAcquireAlbumSend */
export async function tryAcquireKitchenSend(psid, batchSent) {
  return tryAcquireAlbumSend(psid, "kitchen", batchSent);
}

/**
 * @param {string} psid
 * @param {string} catalogId
 * @param {() => Promise<void>} task
 */
export function enqueueAlbumSendForPsid(psid, catalogId, task) {
  if (!globalStore.__kitchenSendChains) {
    globalStore.__kitchenSendChains = new Map();
  }
  const chains = globalStore.__kitchenSendChains;
  const chainKey = sendKey(psid, catalogId);

  const prev = chains.get(chainKey) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(task)
    .finally(() => {
      if (chains.get(chainKey) === next) chains.delete(chainKey);
    });

  chains.set(chainKey, next);
  return next;
}

/** @deprecated use enqueueAlbumSendForPsid */
export function enqueueKitchenSendForPsid(psid, task) {
  return enqueueAlbumSendForPsid(psid, "kitchen", task);
}

/**
 * @param {string} psid
 * @param {string} catalogId
 * @param {boolean} success
 */
export async function releaseAlbumSend(psid, catalogId, success) {
  const key = sendKey(psid, catalogId);
  getMemoryState().inFlight.delete(key);

  if (success) {
    markCompletedInMemory(psid, catalogId);
    return;
  }

  await releaseKvLock(lockKey(psid, catalogId));
}

/** @deprecated use releaseAlbumSend */
export async function releaseKitchenSend(psid, success) {
  return releaseAlbumSend(psid, "kitchen", success);
}
