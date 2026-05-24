import { after } from "next/server";
import { handleIncomingText } from "@/lib/messenger";

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
    const events = entry.messaging ?? [];

    for (const event of events) {
      after(() => processMessagingEvent(event));
    }
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}

async function processMessagingEvent(event) {
  const senderId = event.sender?.id;
  if (!senderId) return;

  const message = event.message;
  if (!message || message.is_echo) return;

  const text = message.text;
  if (!text) return;

  try {
    const result = await handleIncomingText(senderId, text);
    if (result.handled) {
      console.log(
        `Sent ${result.imageCount} images to ${senderId} (${result.mode})`
      );
    }
  } catch (error) {
    console.error("Failed to handle message:", error.message);
  }
}
