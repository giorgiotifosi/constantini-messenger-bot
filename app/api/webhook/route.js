import { waitUntil } from "@vercel/functions";
import { isDuplicateWebhookBody } from "@/lib/kitchen-send-lock";
import {
  collectKitchenSendFromInboxLabel,
  collectKitchenSendsFromMessagingEvent,
  flushPendingKitchenSends,
} from "@/lib/webhook-handlers";

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

  if (isDuplicateWebhookBody(body)) {
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  const entries = body.entry ?? [];
  console.log(`Webhook: ${entries.length} entries`);

  waitUntil(processWebhookEntries(entries));

  return new Response("EVENT_RECEIVED", { status: 200 });
}

/**
 * Scan all events first, then send at most once per PSID (avoids referral + echo double fire).
 * @param {Array<Record<string, unknown>>} entries
 */
async function processWebhookEntries(entries) {
  const batchSent = new Set();
  /** @type {Map<string, import('@/lib/webhook-handlers').PendingKitchenSend>} */
  const pending = new Map();

  for (const entry of entries) {
    console.log(
      `Page ${entry.id}: messaging=${entry.messaging?.length ?? 0}, changes=${entry.changes?.length ?? 0}`
    );

    for (const change of entry.changes ?? []) {
      if (change.field === "inbox_labels") {
        collectKitchenSendFromInboxLabel(change.value, pending);
      }
    }

    for (const event of entry.messaging ?? []) {
      logEventSummary(event);
      collectKitchenSendsFromMessagingEvent(event, pending);
    }
  }

  if (pending.size > 0) {
    console.log(
      `Album sends queued: ${[...pending.values()].map((p) => `${p.psid}:${p.catalogId}:${p.trigger}`).join(", ")}`
    );
  }

  await flushPendingKitchenSends(pending, batchSent);
}

function logEventSummary(event) {
  const postback = event.postback;
  console.log(
    JSON.stringify({
      sender: event.sender?.id,
      recipient: event.recipient?.id,
      referral_only: Boolean(event.referral && !event.message),
      optin: Boolean(event.optin),
      postback: Boolean(postback),
      postback_title: postback?.title,
      postback_payload: postback?.payload,
      echo: Boolean(event.message?.is_echo),
      text: event.message?.text?.slice(0, 80),
    })
  );
}
