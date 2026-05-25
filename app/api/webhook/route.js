import { waitUntil } from "@vercel/functions";
import { sendKitchenAlbumOnChatOpen } from "@/lib/messenger";
import {
  formatReferralForLog,
  getSavedTemplateLabelName,
  isChatOpenReferral,
  isKitchenTextTrigger,
  isLabelAssignmentAction,
  isMatchingAdReferral,
  isSavedTemplateEcho,
  isSavedTemplateLabel,
  shouldSendOnAnyCustomerMessage,
} from "@/lib/triggers";

/** Allow time to upload many images on Vercel (Pro: up to 60s). */
export const maxDuration = 60;

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
  console.log(`Webhook: ${entries.length} entries`);

  for (const entry of entries) {
    console.log(
      `Page ${entry.id}: messaging=${entry.messaging?.length ?? 0}, changes=${entry.changes?.length ?? 0}`
    );

    for (const change of entry.changes ?? []) {
      if (change.field === "inbox_labels") {
        waitUntil(processInboxLabelChange(change.value));
      }
    }

    for (const event of entry.messaging ?? []) {
      waitUntil(processMessagingEvent(event));
    }
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

async function processInboxLabelChange(value) {
  const psid = value?.user?.id;
  const labelName = value?.label?.page_label_name;
  const action = value?.action;

  if (!psid || !labelName || !isLabelAssignmentAction(action)) return;
  if (!isSavedTemplateLabel(labelName)) return;

  await sendAlbumSafe(psid, "inbox_label", `Label ${getSavedTemplateLabelName()}`);
}

function logEventSummary(event) {
  console.log(
    JSON.stringify({
      sender: event.sender?.id,
      recipient: event.recipient?.id,
      referral_only: Boolean(event.referral && !event.message),
      optin: Boolean(event.optin),
      postback: Boolean(event.postback),
      echo: Boolean(event.message?.is_echo),
      text: event.message?.text?.slice(0, 50),
    })
  );
}

/**
 * Chat opened from Click-to-Messenger ad — send album immediately (no user reply).
 */
async function handleChatOpen(psid, source, detail) {
  console.log(`CHAT OPEN (${source}) psid=${psid} ${detail}`);
  await sendAlbumSafe(psid, "chat_open", source);
}

async function processMessagingEvent(event) {
  logEventSummary(event);

  const psid = event.sender?.id;
  if (!psid) return;

  const referral = event.referral ?? event.postback?.referral ?? event.message?.referral;

  // 1) Ad click → chat open (messaging_referrals)
  if (referral && isChatOpenReferral(referral)) {
    console.log(`Referral payload: ${formatReferralForLog(referral)}`);
    if (isMatchingAdReferral(referral)) {
      await handleChatOpen(psid, "ad_referral", "matched");
      if (!event.message) return;
    } else {
      console.log(`Referral open but filters not matched for ${psid}`);
    }
  }

  // 2) Messenger opt-in (some ad / plugin flows)
  if (event.optin) {
    await handleChatOpen(psid, "optin", event.optin.type ?? "");
    return;
  }

  // 3) Postback with ad referral (Get Started from ad)
  if (event.postback?.referral && isMatchingAdReferral(event.postback.referral)) {
    await handleChatOpen(psid, "postback_referral", event.postback.title ?? "");
    if (!event.message) return;
  }

  const message = event.message;
  if (!message) return;

  // 4) Chat builder greeting sent by Page (needs message_echoes + often Connect App)
  if (message.is_echo) {
    const recipientId = event.recipient?.id;
    const text = message.text;
    if (recipientId && text && isSavedTemplateEcho(text)) {
      console.log(`Chat builder echo → ${recipientId}`);
      await sendAlbumSafe(
        recipientId,
        "chat_builder_echo",
        "greeting echo"
      );
    }
    return;
  }

  // 5) Fallback: customer typed (disabled by default)
  const text = message.text;
  if (!text) return;

  if (shouldSendOnAnyCustomerMessage()) {
    await sendAlbumSafe(psid, "customer_text", text.slice(0, 30));
    return;
  }

  if (isKitchenTextTrigger(text)) {
    await sendAlbumSafe(psid, "keyword", "სამზარეულო");
  }
}

async function sendAlbumSafe(psid, trigger, label) {
  try {
    const result = await sendKitchenAlbumOnChatOpen(psid);
    console.log(
      `${label} → ${result.imageCount} images (${result.mode}) trigger=${trigger}`
    );
  } catch (error) {
    console.error(`FAILED ${label} psid=${psid}:`, error.message);
  }
}
