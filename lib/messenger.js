const GRAPH_API_VERSION = "v21.0";
const SEND_API_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages`;

const TRIGGER_WORD = "სამზარეულო";

function getPageAccessToken() {
  const token = process.env.PAGE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("PAGE_ACCESS_TOKEN is not set");
  }
  return token;
}

function getKitchenImageUrls() {
  const urls = [
    process.env.KITCHEN_IMAGE_URL_1,
    process.env.KITCHEN_IMAGE_URL_2,
    process.env.KITCHEN_IMAGE_URL_3,
  ].filter(Boolean);

  if (urls.length !== 3) {
    throw new Error(
      "KITCHEN_IMAGE_URL_1, KITCHEN_IMAGE_URL_2, and KITCHEN_IMAGE_URL_3 must all be set"
    );
  }

  return urls;
}

/**
 * @param {string} recipientId - Messenger PSID
 * @param {string} imageUrl - Public HTTPS image URL
 */
export async function sendImageMessage(recipientId, imageUrl) {
  const response = await fetch(
    `${SEND_API_URL}?access_token=${encodeURIComponent(getPageAccessToken())}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: "image",
            payload: {
              url: imageUrl,
              is_reusable: true,
            },
          },
        },
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
 * @param {string} recipientId
 * @param {string[]} imageUrls
 */
export async function sendImageMessages(recipientId, imageUrls) {
  const results = [];
  for (const url of imageUrls) {
    results.push(await sendImageMessage(recipientId, url));
  }
  return results;
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
  await sendImageMessages(senderId, imageUrls);

  return { handled: true, imageCount: imageUrls.length };
}
