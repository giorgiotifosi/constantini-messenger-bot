const GRAPH_API_VERSION = "v21.0";
const SEND_API_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages`;
const MAX_IMAGES_PER_MESSAGE = 30;

const TRIGGER_WORD = "სამზარეულო";

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
 * Send up to 30 images in one Messenger message (album-style).
 * @see https://developers.facebook.com/docs/messenger-platform/send-messages
 * @param {string} recipientId - Messenger PSID
 * @param {string[]} imageUrls
 */
export async function sendImageAlbum(recipientId, imageUrls) {
  if (imageUrls.length === 0) {
    throw new Error("At least one image URL is required");
  }

  if (imageUrls.length > MAX_IMAGES_PER_MESSAGE) {
    throw new Error(
      `Maximum ${MAX_IMAGES_PER_MESSAGE} images per message (got ${imageUrls.length})`
    );
  }

  const attachments = imageUrls.map((url) => ({
    type: "image",
    payload: { url },
  }));

  const response = await fetch(
    `${SEND_API_URL}?access_token=${encodeURIComponent(getPageAccessToken())}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: { attachments },
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Send API error: ${data.error?.message ?? response.statusText}`
    );
  }

  return data;
}

/**
 * @param {string | undefined} text
 */
export function isKitchenTrigger(text) {
  if (!text || typeof text !== "string") return false;
  return text.trim() === TRIGGER_WORD;
}

/**
 * @param {string} senderId - Messenger PSID
 * @param {string} text - Incoming message text
 */
export async function handleIncomingText(senderId, text) {
  if (!isKitchenTrigger(text)) return { handled: false };

  const imageUrls = getKitchenImageUrls();
  await sendImageAlbum(senderId, imageUrls);

  return { handled: true, imageCount: imageUrls.length };
}
