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

function lockKey(psid) {
  return `kitchen:send:${psid}`;
}

/**
 * @param {string} psid
 */
function isCompletedInMemory(psid) {
  const exp = getMemoryState().completedUntil.get(psid);
  if (!exp) return false;
  if (Date.now() < exp) return true;
  getMemoryState().completedUntil.delete(psid);
  return false;
}

/**
 * @param {string} psid
 */
function markCompletedInMemory(psid) {
  getMemoryState().completedUntil.set(psid, Date.now() + COMPLETED_TTL_MS);
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
 * @param {Set<string>} batchSent
 * @returns {Promise<boolean>}
 */
export async function tryAcquireKitchenSend(psid, batchSent) {
  if (batchSent.has(psid)) return false;
  if (isCompletedInMemory(psid)) return false;

  const memory = getMemoryState();
  if (memory.inFlight.has(psid)) return false;

  const kvResult = await tryAcquireKvLock(lockKey(psid));
  if (kvResult === false) {
    console.log(`Skip kitchen send: KV lock held for ${psid}`);
    return false;
  }

  memory.inFlight.add(psid);
  batchSent.add(psid);
  return true;
}

/**
 * Serialize kitchen sends per PSID on the same serverless instance.
 * @param {string} psid
 * @param {() => Promise<void>} task
 */
export function enqueueKitchenSendForPsid(psid, task) {
  if (!globalStore.__kitchenSendChains) {
    globalStore.__kitchenSendChains = new Map();
  }
  const chains = globalStore.__kitchenSendChains;

  const prev = chains.get(psid) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(task)
    .finally(() => {
      if (chains.get(psid) === next) chains.delete(psid);
    });

  chains.set(psid, next);
  return next;
}

/**
 * @param {string} psid
 * @param {boolean} success
 */
export async function releaseKitchenSend(psid, success) {
  getMemoryState().inFlight.delete(psid);

  if (success) {
    markCompletedInMemory(psid);
    return;
  }

  await releaseKvLock(lockKey(psid));
}
