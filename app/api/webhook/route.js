import { after } from "next/server";
import { sendKitchenAlbumToUser } from "@/lib/messenger";
import {
  getSavedTemplateLabelName,
  isKitchenTextTrigger,
  isLabelAssignmentAction,
  isMatchingAdReferral,
  isSavedTemplateEcho,
  isSavedTemplateLabel,
} from "@/lib/triggers";

/** Allow time to upload many images on Vercel (Pro: up to 60s). */
export const maxDuration = 60;

/**
 * Meta webhook verification (GET).
 * @see https://developers.facebook.com/docs/messenger-platform/webhooks
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.VERIFY_TOKEN;

  if (!verifyToken) {
    console.error("VERIFY_TOKEN is not set");
    return new Response("Server configuration error", { status: 500 });
  }

  if (mode === "subscribe" && token === verifyToken) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response("Forbidden", { status: 403 });
}

/**
 * Meta Messenger webhook events (POST).
 */
export async function POST(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (body.object !== "page") {
    return new Response("Not Found", { status: 404 });
  }

  const entries = body.entry ?? [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (change.field === "inbox_labels") {
        after(() => processInboxLabelChange(change.value));
      }
    }

    for (const event of entry.messaging ?? []) {
      after(() => processMessagingEvent(event));
    }
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

/**
 * Meta Inbox label assigned to a conversation.
 * @see https://developers.facebook.com/docs/messenger-platform/identity/custom-labels
 */
async function processInboxLabelChange(value) {
  const psid = value?.user?.id;
  const labelName = value?.label?.page_label_name;
  const action = value?.action;

  if (!psid || !labelName) return;

  if (!isLabelAssignmentAction(action)) {
    console.log(`Label change ignored (action=${action}) for ${psid}`);
    return;
  }

  if (!isSavedTemplateLabel(labelName)) return;

  await sendAlbumSafe(psid, "inbox_label", `Label "${getSavedTemplateLabelName()}"`);
}

/**
 * Click-to-Messenger ad / m.me referral (Ads Manager Chat builder).
 * @see https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messaging_referrals
 */
async function processMessagingReferral(event) {
  const psid = event.sender?.id;
  const referral = event.referral ?? event.postback?.referral;

  if (!psid || !referral) return;
  if (!isMatchingAdReferral(referral)) {
    console.log(
      `Ad referral ignored for ${psid} (source=${referral.source}, ad_id=${referral.ad_id ?? "n/a"})`
    );
    return;
  }

  await sendAlbumSafe(psid, "ad_referral", "Click-to-Messenger ad");
}

async function processMessagingEvent(event) {
  const senderId = event.sender?.id;

  if (senderId && (event.referral || event.postback?.referral)) {
    await processMessagingReferral(event);
  }

  if (event.postback && !event.message) {
    return;
  }

  const message = event.message;
  if (!message) return;

  const isEcho = Boolean(message.is_echo);

  if (isEcho) {
    await processPageEcho(event);
    return;
  }

  if (!senderId) return;

  if (message.referral && isMatchingAdReferral(message.referral)) {
    await sendAlbumSafe(senderId, "ad_referral_message", "Ad referral on first message");
    return;
  }

  const text = message.text;
  if (!text || !isKitchenTextTrigger(text)) return;

  await sendAlbumSafe(senderId, "customer_text", "Customer text trigger");
}

/**
 * Page sent a message (e.g. saved reply template from Inbox).
 */
async function processPageEcho(event) {
  const recipientId = event.recipient?.id;
  const text = event.message?.text;

  if (!recipientId || !text) return;
  if (!isSavedTemplateEcho(text)) return;

  await sendAlbumSafe(recipientId, "saved_reply_echo", "Saved reply echo");
}

/**
 * @param {string} psid
 * @param {string} trigger
 * @param {string} label
 */
async function sendAlbumSafe(psid, trigger, label) {
  try {
    const result = await sendKitchenAlbumToUser(psid, { trigger });
    console.log(
      `${label} → sent ${result.imageCount} images to ${psid} (${result.mode})`
    );
  } catch (error) {
    console.error(`Failed (${trigger}) for ${psid}:`, error.message);
  }
}
