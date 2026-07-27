import test from "node:test";
import assert from "node:assert/strict";

import { GraphApiError, sendProductAlbumToUser } from "@/lib/messenger";
import {
  collectKitchenSendsFromMessagingEvent,
  flushPendingKitchenSends,
} from "@/lib/webhook-handlers";

const PAGE_ACCESS_TOKEN = "EAAG-TEST-PAGE-TOKEN-do-not-log";
const PAGE_ID = "1466968153607115";
const SEND_ENDPOINT = `https://graph.facebook.com/v22.0/${PAGE_ID}/messages`;
const UPLOAD_ENDPOINT = `https://graph.facebook.com/v22.0/${PAGE_ID}/message_attachments`;

const KITCHEN_KEYWORD = "სამზარეულო";
/** The admin's personal profile PSID — arrives as event.recipient.id on echoes. */
const ADMIN_PROFILE_PSID = "PSID_PERSONAL_PROFILE";

/** Mirrors the production catalog naming. */
const kitchenUrl = (n) => `https://constantini.ge/wp-content/uploads/2026/05/${n}.jpg`;
const kitchenUrls = Array.from({ length: 30 }, (_, i) => kitchenUrl(i + 1));
/** Rejected by Meta with 400 / code 100 / subcode 2018047. */
const BLOCKED_URL = kitchenUrl(5);
/** What the temporary App Review demo subset must select. */
const DEMO_URLS = [kitchenUrl(1), kitchenUrl(2), kitchenUrl(3), kitchenUrl(4)];

const softUrls = Array.from(
  { length: 12 },
  (_, i) => `https://cdn.example.com/soft/${i + 1}.jpg`
);

process.env.PAGE_ACCESS_TOKEN = PAGE_ACCESS_TOKEN;
process.env.PAGE_ID = PAGE_ID;
process.env.KITCHEN_IMAGE_URLS = kitchenUrls.join(",");
process.env.SOFT_FURNITURE_IMAGE_URLS = softUrls.join(",");
// Neither of these may influence the restored album path.
process.env.KITCHEN_SEND_MODE = "sequential";
process.env.SOFT_FURNITURE_SEND_MODE = "sequential";

// Safety net: any fetch escaping a test's stub must fail loudly instead of
// reaching the real Graph API.
globalThis.fetch = async (url) => {
  const message = `Unstubbed fetch escaped a test: ${String(url).split("?")[0]}`;
  console.error(message);
  throw new Error(message);
};

/** attachment_id Meta returns for a given image URL. */
const attachmentIdFor = (url) =>
  `att_${url.split("/").pop().replace(".jpg", "")}`;

/**
 * Stubs fetch + console. `overrides` can fail a specific upload or the album.
 * @param {{ failUploadUrl?: string, albumResponse?: () => Response }} [overrides]
 */
function install(overrides = {}) {
  const record = { uploads: [], sends: [], other: [], logs: [] };

  const realFetch = globalThis.fetch;
  const realConsole = { log: console.log, warn: console.warn, error: console.error };

  for (const level of ["log", "warn", "error"]) {
    console[level] = (...args) => record.logs.push(args.join(" "));
  }

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const endpoint = href.split("?")[0];
    const body = init.body ? JSON.parse(init.body) : null;
    const call = { url: href, endpoint, method: init.method, headers: init.headers, body };

    if (endpoint === UPLOAD_ENDPOINT) {
      record.uploads.push(call);
      const imageUrl = body?.message?.attachment?.payload?.url;

      if (overrides.failUploadUrl && imageUrl === overrides.failUploadUrl) {
        return new Response(
          JSON.stringify({
            error: {
              message: "(#100) Upload attachment failure",
              type: "OAuthException",
              code: 100,
              error_subcode: 2018047,
              error_user_title: "Image unavailable",
              error_user_msg: "The image could not be fetched.",
              error_data: { attachment_url: imageUrl },
              fbtrace_id: "UploadTrace24",
            },
          }),
          { status: 400, statusText: "Bad Request", headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ attachment_id: attachmentIdFor(imageUrl) }), {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
      });
    }

    if (endpoint === SEND_ENDPOINT) {
      record.sends.push(call);
      if (overrides.albumResponse) return overrides.albumResponse();
      return new Response(
        JSON.stringify({ recipient_id: body?.recipient?.id, message_id: "mid.ALBUM" }),
        { status: 200, statusText: "OK", headers: { "Content-Type": "application/json" } }
      );
    }

    // take_thread_control and anything else
    record.other.push(call);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  record.restore = () => {
    globalThis.fetch = realFetch;
    Object.assign(console, realConsole);
  };

  const uploadedUrls = () =>
    record.uploads.map((u) => u.body.message.attachment.payload.url);
  record.uploadedUrls = uploadedUrls;

  return record;
}

test("DEMO: kitchen uploads exactly 4 images then ONE album request", async () => {
  const record = install();

  try {
    const result = await sendProductAlbumToUser(ADMIN_PROFILE_PSID, "kitchen", {
      trigger: "admin_echo",
    });

    assert.equal(record.uploads.length, 4, "one /message_attachments call per demo image");
    assert.equal(record.sends.length, 1, "exactly one /messages request");

    assert.deepEqual(
      record.uploadedUrls(),
      DEMO_URLS,
      "the first four usable kitchen images, in order"
    );

    for (const upload of record.uploads) {
      assert.equal(upload.method, "POST");
      assert.deepEqual(upload.headers, { "Content-Type": "application/json" });
      assert.equal(upload.body.message.attachment.type, "image");
      assert.equal(
        upload.body.message.attachment.payload.is_reusable,
        true,
        "every upload must be reusable"
      );
    }

    const album = record.sends[0];
    assert.deepEqual(album.body.recipient, { id: ADMIN_PROFILE_PSID });
    assert.equal(album.body.messaging_type, "RESPONSE");
    assert.equal("tag" in album.body, false, "no MESSAGE_TAG / HUMAN_AGENT");
    assert.equal(album.body.message.attachments.length, 4, "no chunking");
    assert.deepEqual(
      album.body.message.attachments.map((a) => a.payload.attachment_id),
      DEMO_URLS.map(attachmentIdFor),
      "attachment IDs preserve the original image order"
    );
    assert.deepEqual(album.body.message.attachments[0], {
      type: "image",
      payload: { attachment_id: attachmentIdFor(DEMO_URLS[0]) },
    });

    assert.equal(result.mode, "album-uploaded");
    assert.equal(result.imageCount, 4);
    assert.equal(result.attachmentCount, 4);
    assert.equal(result.messageId, "mid.ALBUM");
  } finally {
    record.restore();
  }
});

test("DEMO: the failing image 5.jpg is never uploaded or sent", async () => {
  const record = install();

  try {
    await sendProductAlbumToUser(ADMIN_PROFILE_PSID, "kitchen", { trigger: "admin_echo" });

    assert.ok(
      !record.uploadedUrls().includes(BLOCKED_URL),
      "5.jpg must not be uploaded"
    );
    assert.ok(
      !record.uploads.some((u) => u.body.message.attachment.payload.url === BLOCKED_URL),
      "5.jpg must not appear in any upload payload"
    );
    assert.ok(
      !JSON.stringify(record.sends[0].body).includes("/5.jpg"),
      "5.jpg must not reach the album request"
    );
  } finally {
    record.restore();
  }
});

test("DEMO: 5.jpg is excluded even when it falls inside the first four URLs", async () => {
  const original = process.env.KITCHEN_IMAGE_URLS;
  // 5.jpg deliberately placed second.
  process.env.KITCHEN_IMAGE_URLS = [
    kitchenUrl(1),
    BLOCKED_URL,
    kitchenUrl(2),
    kitchenUrl(3),
    kitchenUrl(4),
    kitchenUrl(6),
  ].join(",");

  const record = install();

  try {
    await sendProductAlbumToUser(ADMIN_PROFILE_PSID, "kitchen", { trigger: "admin_echo" });

    assert.equal(record.uploads.length, 4);
    assert.deepEqual(
      record.uploadedUrls(),
      [kitchenUrl(1), kitchenUrl(2), kitchenUrl(3), kitchenUrl(4)],
      "the blocked URL is skipped, not merely truncated away"
    );
  } finally {
    record.restore();
    process.env.KITCHEN_IMAGE_URLS = original;
  }
});

test("the demo subset is kitchen-only: soft furniture still sends its full catalog", async () => {
  const record = install();

  try {
    const result = await sendProductAlbumToUser("PSID_SOFT", "soft_furniture", {
      trigger: "button_postback",
    });

    assert.equal(record.uploads.length, 12, "soft furniture is not capped");
    assert.equal(record.sends.length, 1);
    assert.deepEqual(
      record.sends[0].body.message.attachments.map((a) => a.payload.attachment_id),
      softUrls.map(attachmentIdFor)
    );
    assert.equal(result.mode, "album-uploaded");
  } finally {
    record.restore();
  }
});

test("kitchen never uses direct URL albums or individual image messages", async () => {
  const record = install();

  try {
    await sendProductAlbumToUser(ADMIN_PROFILE_PSID, "kitchen", { trigger: "keyword" });

    const bodies = record.sends.map((s) => s.body);
    assert.ok(
      !bodies.some((b) => (b?.message?.attachments ?? []).some((a) => "url" in a.payload)),
      "no direct URL album"
    );
    assert.ok(
      !bodies.some((b) => b?.message?.attachment),
      "no individual single-image /messages request"
    );
    assert.equal(record.sends.length, 1, "no chunking, no repeat sends");
  } finally {
    record.restore();
  }
});

test("a failed upload aborts before the album and propagates GraphApiError", async () => {
  const failing = DEMO_URLS[1];
  const record = install({ failUploadUrl: failing });

  try {
    await assert.rejects(
      () => sendProductAlbumToUser(ADMIN_PROFILE_PSID, "kitchen", { trigger: "admin_echo" }),
      (error) => {
        assert.ok(error instanceof GraphApiError, "original GraphApiError propagates");
        assert.equal(error.status, 400);
        assert.equal(error.code, 100);
        assert.equal(error.type, "OAuthException");
        assert.equal(error.errorSubcode, 2018047);
        assert.equal(error.errorUserTitle, "Image unavailable");
        assert.deepEqual(error.errorData, { attachment_url: failing });
        assert.equal(error.fbtraceId, "UploadTrace24");
        return true;
      }
    );

    assert.equal(record.sends.length, 0, "an incomplete album must never be sent");

    const logged = record.logs.join("\n");
    assert.ok(logged.includes(failing), "the exact failed image URL is logged");
    assert.ok(logged.includes("UploadTrace24"), "fbtrace_id is logged");
    assert.ok(logged.includes('"error_subcode":2018047'), "full FB error is logged");
  } finally {
    record.restore();
  }
});

test("a failed album request does not retry the chain", async () => {
  const record = install({
    albumResponse: () =>
      new Response(
        JSON.stringify({
          error: {
            message: "(#-1) Send message failure",
            type: "OAuthException",
            code: -1,
            fbtrace_id: "AlbumTrace24",
          },
        }),
        { status: 400, statusText: "Bad Request", headers: { "Content-Type": "application/json" } }
      ),
  });

  try {
    await assert.rejects(
      () =>
        sendProductAlbumToUser(ADMIN_PROFILE_PSID, "kitchen", {
          trigger: "admin_echo",
          tag: "HUMAN_AGENT",
        }),
      (error) => {
        assert.ok(error instanceof GraphApiError);
        assert.equal(error.code, -1);
        assert.equal(error.fbtraceId, "AlbumTrace24");
        return true;
      }
    );

    assert.equal(record.sends.length, 1, "no whole-chain retry");
    assert.equal(record.uploads.length, 4, "images are not re-uploaded");
  } finally {
    record.restore();
  }
});

test("non-JSON Graph response is handled without losing the status", async () => {
  const record = install({
    albumResponse: () =>
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/html" },
      }),
  });

  try {
    await assert.rejects(
      () => sendProductAlbumToUser(ADMIN_PROFILE_PSID, "kitchen", { trigger: "keyword" }),
      (error) => {
        assert.ok(error instanceof GraphApiError);
        assert.equal(error.status, 502);
        assert.equal(error.fbError, null);
        assert.ok(String(error.raw).includes("502 Bad Gateway"));
        return true;
      }
    );
  } finally {
    record.restore();
  }
});

test("PAGE_ACCESS_TOKEN never appears in logs (success or failure)", async () => {
  const ok = install();
  try {
    await sendProductAlbumToUser(ADMIN_PROFILE_PSID, "kitchen", { trigger: "admin_echo" });
    const logged = ok.logs.join("\n");
    assert.ok(!logged.includes(PAGE_ACCESS_TOKEN), "token leaked into success logs");
    assert.ok(!logged.includes("access_token"), "logs must not mention access_token");
  } finally {
    ok.restore();
  }

  const failed = install({ failUploadUrl: DEMO_URLS[0] });
  try {
    await assert.rejects(() =>
      sendProductAlbumToUser(ADMIN_PROFILE_PSID, "kitchen", { trigger: "admin_echo" })
    );
    assert.ok(
      !failed.logs.join("\n").includes(PAGE_ACCESS_TOKEN),
      "token leaked into failure logs"
    );
  } finally {
    failed.restore();
  }
});

test("ACCEPTANCE: admin echo of სამზარეულო sends the album to event.recipient.id", async () => {
  const record = install();

  // Exactly what Meta delivers when the Page admin types the keyword in Inbox:
  // sender.id is the Page, recipient.id is the customer (here, the admin's own
  // personal profile).
  const echoEvent = {
    sender: { id: PAGE_ID },
    recipient: { id: ADMIN_PROFILE_PSID },
    message: {
      is_echo: true,
      app_id: 123456,
      text: KITCHEN_KEYWORD,
    },
  };

  try {
    const pending = new Map();
    collectKitchenSendsFromMessagingEvent(echoEvent, pending);

    assert.equal(pending.size, 1, "the admin echo queues exactly one send");
    const queued = [...pending.values()][0];
    assert.equal(queued.catalogId, "kitchen");
    assert.equal(queued.trigger, "admin_echo");
    assert.equal(
      queued.psid,
      ADMIN_PROFILE_PSID,
      "recipient must be event.recipient.id, not sender.id"
    );

    await flushPendingKitchenSends(pending, new Set());

    assert.equal(record.uploads.length, 4, "4 attachment uploads");
    assert.equal(record.sends.length, 1, "one album request");
    assert.deepEqual(record.sends[0].body.recipient, { id: ADMIN_PROFILE_PSID });
    assert.equal(record.sends[0].body.messaging_type, "RESPONSE");
    assert.equal(record.sends[0].body.message.attachments.length, 4);

    // take_thread_control runs for admin echoes and must stay non-fatal.
    assert.ok(
      record.other.some((c) => c.endpoint.includes("take_thread_control")),
      "thread control is still attempted for admin echoes"
    );

    const logged = record.logs.join("\n");
    assert.ok(logged.includes("4 images (album-uploaded)"), "success line logged");
    assert.ok(!logged.includes(PAGE_ACCESS_TOKEN));
  } finally {
    record.restore();
  }
});

test("ACCEPTANCE: a take_thread_control failure does not block the album", async () => {
  const record = install();
  const realFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("take_thread_control")) {
      record.other.push({ endpoint: "take_thread_control" });
      return new Response(
        JSON.stringify({ error: { message: "(#230) Bot is not the primary receiver", code: 230 } }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    return realFetch(url, init);
  };

  try {
    const pending = new Map();
    collectKitchenSendsFromMessagingEvent(
      {
        sender: { id: PAGE_ID },
        recipient: { id: ADMIN_PROFILE_PSID },
        message: { is_echo: true, text: KITCHEN_KEYWORD },
      },
      pending
    );

    await flushPendingKitchenSends(pending, new Set());

    assert.equal(record.uploads.length, 4, "uploads still ran");
    assert.equal(record.sends.length, 1, "album still sent");
  } finally {
    record.restore();
  }
});
