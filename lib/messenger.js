const GRAPH_API_VERSION = "v22.0";
const SEND_API_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages`;
const UPLOAD_API_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/message_attachments`;
const MAX_IMAGES_PER_MESSAGE = 30;
const UPLOAD_CONCURRENCY = 5;

function getPageAccessToken() {
  const token = process.env.PAGE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("PAGE_ACCESS_TOKEN is not set");
  }
  return token;
}

/**
 * @param {string | undefined} raw
 * @returns {string[]}
 */
function parseImageUrlsList(raw) {
  if (!raw || typeof raw !== "string") return [];

  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item) => typeof item === "string" && item.trim())
          .map((item) => item.trim());
      }
    } catch {
      // fall through to delimiter split
    }
  }

  return trimmed
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Collects image URLs from KITCHEN_IMAGE_URLS and/or KITCHEN_IMAGE_URL_1 … _30.
 * @returns {string[]}
 */
export function getKitchenImageUrls() {
  const fromList = parseImageUrlsList(process.env.KITCHEN_IMAGE_URLS);
  const fromNumbered = [];

  for (let i = 1; i <= MAX_IMAGES_PER_MESSAGE; i++) {
    const url = process.env[`KITCHEN_IMAGE_URL_${i}`];
    if (url?.trim()) {
      fromNumbered.push(url.trim());
    }
  }

  const urls = fromList.length > 0 ? fromList : fromNumbered;

  if (urls.length === 0) {
    throw new Error(
      "Set KITCHEN_IMAGE_URLS (comma/newline-separated or JSON array) or KITCHEN_IMAGE_URL_1 … KITCHEN_IMAGE_URL_30"
    );
  }

  if (urls.length > MAX_IMAGES_PER_MESSAGE) {
    console.warn(
      `Kitchen album has ${urls.length} URLs; sending first ${MAX_IMAGES_PER_MESSAGE} only`
    );
    return urls.slice(0, MAX_IMAGES_PER_MESSAGE);
  }

  return urls;
}

/**
 * @param {string} endpoint
 * @param {Record<string, unknown>} body
 */
async function callGraphApi(endpoint, body) {
  const response = await fetch(
    `${endpoint}?access_token=${encodeURIComponent(getPageAccessToken())}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    const err = data.error ?? {};
    const detail = [
      err.message,
      err.error_subcode != null ? `subcode ${err.error_subcode}` : null,
      err.fbtrace_id ? `trace ${err.fbtrace_id}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    throw new Error(detail || response.statusText);
  }

  return data;
}

/**
 * @param {Record<string, unknown>} body
 */
function callSendApi(body) {
  return callGraphApi(SEND_API_URL, body);
}

/**
 * @param {string} imageUrl
 * @returns {Promise<string>}
 */
async function uploadImageAttachment(imageUrl) {
  const data = await callGraphApi(UPLOAD_API_URL, {
    message: {
      attachment: {
        type: "image",
        payload: {
          url: imageUrl,
          is_reusable: true,
        },
      },
    },
  });

  const attachmentId = data.attachment_id;
  if (!attachmentId) {
    throw new Error(`No attachment_id returned for ${imageUrl}`);
  }

  return attachmentId;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<unknown>} fn
 */
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/**
 * @param {string[]} imageUrls
 * @returns {Promise<string[]>}
 */
async function uploadAllImages(imageUrls) {
  return mapWithConcurrency(imageUrls, UPLOAD_CONCURRENCY, (url) =>
    uploadImageAttachment(url)
  );
}

/**
 * @param {string} recipientId
 * @param {string} imageUrl
 */
async function sendSingleImage(recipientId, imageUrl) {
  return callSendApi({
    recipient: { id: recipientId },
    messaging_type: "RESPONSE",
    message: {
      attachment: {
        type: "image",
        payload: {
          url: imageUrl,
          is_reusable: true,
        },
      },
    },
  });
}

/**
 * @param {string} recipientId
 * @param {string[]} imageUrls
 */
function buildUrlAttachments(imageUrls) {
  return imageUrls.map((url) => ({
    type: "image",
    payload: { url },
  }));
}

/**
 * @param {string[]} attachmentIds
 */
function buildIdAttachments(attachmentIds) {
  return attachmentIds.map((attachment_id) => ({
    type: "image",
    payload: { attachment_id },
  }));
}

/**
 * @param {string} recipientId
 * @param {Array<Record<string, unknown>>} attachments
 */
async function sendAttachmentsAlbum(recipientId, attachments) {
  return callSendApi({
    recipient: { id: recipientId },
    messaging_type: "RESPONSE",
    message: { attachments },
  });
}

/**
 * @param {string} recipientId
 * @param {string[]} imageUrls
 */
export async function sendImageAlbum(recipientId, imageUrls) {
  if (imageUrls.length === 0) {
    throw new Error("At least one image URL is required");
  }

  if (imageUrls.length === 1) {
    return sendSingleImage(recipientId, imageUrls[0]);
  }

  if (imageUrls.length > MAX_IMAGES_PER_MESSAGE) {
    throw new Error(
      `Maximum ${MAX_IMAGES_PER_MESSAGE} images per message (got ${imageUrls.length})`
    );
  }

  return sendAttachmentsAlbum(
    recipientId,
    buildUrlAttachments(imageUrls)
  );
}

/**
 * @param {string} recipientId
 * @param {string[]} attachmentIds
 */
async function sendImageAlbumByIds(recipientId, attachmentIds) {
  if (attachmentIds.length === 1) {
    return sendAttachmentsAlbum(recipientId, buildIdAttachments(attachmentIds));
  }

  return sendAttachmentsAlbum(
    recipientId,
    buildIdAttachments(attachmentIds)
  );
}

/** `album` = one message; default `sequential` = one image per message. */
function getKitchenSendMode() {
  return process.env.KITCHEN_SEND_MODE === "album" ? "album" : "sequential";
}

/**
 * Send images one-by-one (separate Messenger messages).
 * @param {string} recipientId
 * @param {string[]} imageUrls
 */
export async function sendImagesSequential(recipientId, imageUrls) {
  const results = [];
  for (const url of imageUrls) {
    results.push(await sendSingleImage(recipientId, url));
  }
  return results;
}

/**
 * @param {string} recipientId
 * @param {string[]} imageUrls
 */
export async function sendKitchenImages(recipientId, imageUrls) {
  const count = imageUrls.length;
  const mode = getKitchenSendMode();
  console.log(
    `Preparing ${count} kitchen images for ${recipientId} (mode=${mode})`
  );

  if (count === 1) {
    await sendSingleImage(recipientId, imageUrls[0]);
    return { mode: "single", imageCount: count };
  }

  if (mode === "sequential") {
    await sendImagesSequential(recipientId, imageUrls);
    return { mode: "sequential", imageCount: count };
  }

  try {
    await sendImageAlbum(recipientId, imageUrls);
    return { mode: "album-url", imageCount: count };
  } catch (urlAlbumError) {
    console.warn(`URL album failed (${count} images):`, urlAlbumError.message);
  }

  try {
    const attachmentIds = await uploadAllImages(imageUrls);
    await sendImageAlbumByIds(recipientId, attachmentIds);
    return { mode: "album-uploaded", imageCount: count };
  } catch (uploadedAlbumError) {
    console.warn(
      `Uploaded album failed (${count} images):`,
      uploadedAlbumError.message
    );
  }

  await sendImagesSequential(recipientId, imageUrls);
  return { mode: "sequential", imageCount: count };
}

/**
 * Send kitchen album to a Messenger user (PSID).
 * @param {string} recipientId
 * @param {{ trigger?: string }} [options]
 */
export async function sendKitchenAlbumToUser(recipientId, options = {}) {
  const imageUrls = getKitchenImageUrls();
  const result = await sendKitchenImages(recipientId, imageUrls);

  return {
    handled: true,
    trigger: options.trigger ?? "unknown",
    ...result,
  };
}

/**
 * Send album when user opens chat from Click-to-Messenger ad (no reply required).
 * @param {string} psid
 */
export async function sendKitchenAlbumOnChatOpen(psid) {
  console.log(`Chat open → sending kitchen photos to ${psid}`);
  return sendKitchenAlbumToUser(psid, { trigger: "chat_open" });
}
