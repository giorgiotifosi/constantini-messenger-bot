import { waitUntil } from "@vercel/functions";
import { sendKitchenAlbumToUser } from "@/lib/messenger";
import {
  formatReferralForLog,
  getSavedTemplateLabelName,
  isKitchenTextTrigger,
  isLabelAssignmentAction,
  isMatchingAdReferral,
  isSavedTemplateEcho,
  isSavedTemplateLabel,
  shouldSendOnAnyCustomerMessage,
} from "@/lib/triggers";

/** Allow time to upload many images on Vercel (Pro: up to 60s). */
export const maxDuration = 60;

/**
 * Meta webhook verification (GET).
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
  console.log(`Webhook received: ${entries.length} entries`);

  for (const entry of entries) {
    const messagingCount = entry.messaging?.length ?? 0;
    const changesCount = entry.changes?.length ?? 0;
    console.log(
      `Page ${entry.id}: ${messagingCount} messaging, ${changesCount} changes`
    );

    for (const change of entry.changes ?? []) {
      if (change.field === "inbox_labels") {
        waitUntil(
          processInboxLabelChange(change.value).catch((error) => {
            console.error("inbox_labels error:", error.message);
          })
        );
      }
    }

    for (const event of entry.messaging ?? []) {
      waitUntil(
        processMessagingEvent(event).catch((error) => {
          console.error("messaging error:", error.message);
        })
      );
    }
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

async function processInboxLabelChange(value) {
  const psid = value?.user?.id;
  const labelName = value?.label?.page_label_name;
  const action = value?.action;

  if (!psid || !labelName) return;

  if (!isLabelAssignmentAction(action)) {
    console.log(`Label ignored (action=${action}) psid=${psid}`);
    return;
  }

  if (!isSavedTemplateLabel(labelName)) return;

  await sendAlbumSafe(
    psid,
    "inbox_label",
    `Label "${getSavedTemplateLabelName()}"`
  );
}

function logEventSummary(event) {
  const message = event.message;
  console.log(
    JSON.stringify({
      sender: event.sender?.id,
      recipient: event.recipient?.id,
      optin: Boolean(event.optin),
      postback: Boolean(event.postback),
      referral: Boolean(event.referral || event.message?.referral),
      message: message
        ? {
            is_echo: message.is_echo,
            has_text: Boolean(message.text),
            text_preview: message.text?.slice(0, 40),
          }
        : null,
    })
  );
}

async function processMessagingReferral(event) {
  const psid = event.sender?.id;
  const referral = event.referral ?? event.postback?.referral;

  if (!psid || !referral) return;

  console.log(`Referral for ${psid}: ${formatReferralForLog(referral)}`);

  if (!isMatchingAdReferral(referral)) {
    console.log(`Referral ignored for ${psid}`);
    return;
  }

  await sendAlbumSafe(psid, "ad_referral", "Click-to-Messenger ad");
}

async function processMessagingEvent(event) {
  logEventSummary(event);

  const senderId = event.sender?.id;
  const sentToPsids = new Set();

  if (senderId && event.optin) {
    console.log(`Opt-in from ${senderId}`);
    await sendAlbumSafe(senderId, "optin", "Messenger opt-in", sentToPsids);
    return;
  }

  if (senderId && (event.referral || event.postback?.referral)) {
    await processMessagingReferral(event);
  }

  if (event.postback && senderId && !event.message) {
    console.log(`Postback from ${senderId}: ${event.postback.payload ?? ""}`);
    await sendAlbumSafe(senderId, "postback", "Postback", sentToPsids);
    return;
  }

  const message = event.message;
  if (!message) return;

  if (message.is_echo) {
    await processPageEcho(event, sentToPsids);
    return;
  }

  if (!senderId) return;

  if (message.referral && isMatchingAdReferral(message.referral)) {
    await sendAlbumSafe(
      senderId,
      "ad_referral_message",
      "Referral on message",
      sentToPsids
    );
    return;
  }

  const text = message.text;
  if (!text) return;

  if (shouldSendOnAnyCustomerMessage()) {
    await sendAlbumSafe(
      senderId,
      "customer_any_text",
      `Customer message: ${text.slice(0, 30)}`
    );
    return;
  }

  if (isKitchenTextTrigger(text)) {
    await sendAlbumSafe(senderId, "customer_text", "Keyword სამზარეულო");
  }
}

async function processPageEcho(event, sentToPsids) {
  const recipientId = event.recipient?.id;
  const text = event.message?.text;

  if (!recipientId || !text) return;

  console.log(`Page echo → ${recipientId}: ${text.slice(0, 60)}…`);

  if (!isSavedTemplateEcho(text)) {
    console.log("Echo text did not match chat builder / template markers");
    return;
  }

  await sendAlbumSafe(
    recipientId,
    "chat_builder_echo",
    "Chat builder greeting echo",
    sentToPsids
  );
}

/**
 * @param {string} psid
 * @param {string} trigger
 * @param {string} label
 * @param {Set<string>} [sentToPsids]
 */
async function sendAlbumSafe(psid, trigger, label, sentToPsids = new Set()) {
  if (sentToPsids.has(psid)) {
    console.log(`Skip duplicate for ${psid} (${trigger})`);
    return;
  }

  sentToPsids.add(psid);

  try {
    const result = await sendKitchenAlbumToUser(psid, { trigger });
    console.log(
      `${label} → sent ${result.imageCount} images to ${psid} (${result.mode})`
    );
  } catch (error) {
    console.error(`FAILED (${trigger}) psid=${psid}:`, error.message);
    sentToPsids.delete(psid);
  }
}
