import { after } from "next/server";
import { sendKitchenAlbumToUser } from "@/lib/messenger";
import {
  getSavedTemplateLabelName,
  isKitchenTextTrigger,
  isLabelAssignmentAction,
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

  try {
    const result = await sendKitchenAlbumToUser(psid, {
      trigger: "inbox_label",
    });
    console.log(
      `Label "${getSavedTemplateLabelName()}" → sent ${result.imageCount} images to ${psid} (${result.mode})`
    );
  } catch (error) {
    console.error("Failed to send photos for inbox label:", error.message);
  }
}

async function processMessagingEvent(event) {
  const message = event.message;
  if (!message) return;

  const isEcho = Boolean(message.is_echo);

  if (isEcho) {
    await processPageEcho(event);
    return;
  }

  const senderId = event.sender?.id;
  if (!senderId) return;

  const text = message.text;
  if (!text || !isKitchenTextTrigger(text)) return;

  try {
    const result = await sendKitchenAlbumToUser(senderId, {
      trigger: "customer_text",
    });
    console.log(
      `Text trigger → sent ${result.imageCount} images to ${senderId} (${result.mode})`
    );
  } catch (error) {
    console.error("Failed to handle customer text:", error.message);
  }
}

/**
 * Page sent a message (e.g. saved reply template from Inbox).
 */
async function processPageEcho(event) {
  const recipientId = event.recipient?.id;
  const text = event.message?.text;

  if (!recipientId || !text) return;
  if (!isSavedTemplateEcho(text)) return;

  try {
    const result = await sendKitchenAlbumToUser(recipientId, {
      trigger: "saved_reply_echo",
    });
    console.log(
      `Saved reply echo → sent ${result.imageCount} images to ${recipientId} (${result.mode})`
    );
  } catch (error) {
    console.error("Failed to handle saved reply echo:", error.message);
  }
}
