import {
  CATALOG_IDS,
  getCatalogById,
} from "@/lib/catalogs";

const GRAPH_API_VERSION = "v22.0";
const MAX_IMAGES_PER_MESSAGE = 30;
const UPLOAD_CONCURRENCY = 5;
/** Kitchen is temporarily sent one image per message; pause between sends. */
const KITCHEN_IMAGE_DELAY_MS = 500;

function getPageAccessToken() {
  const token = process.env.PAGE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("PAGE_ACCESS_TOKEN is not set");
  }
  return token;
}

function getPageId() {
  const pageId = process.env.PAGE_ID;
  if (!pageId) {
    throw new Error("PAGE_ID is not set");
  }
  return pageId;
}

function getSendApiUrl() {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${getPageId()}/messages`;
}

function getUploadApiUrl() {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${getPageId()}/message_attachments`;
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
 * @param {import("@/lib/catalogs").ProductCatalog} catalog
 * @returns {string[]}
 */
export function getImageUrlsForCatalog(catalog) {
  const fromList = parseImageUrlsList(process.env[catalog.urlsEnv]);
  const fromNumbered = [];

  for (let i = 1; i <= MAX_IMAGES_PER_MESSAGE; i++) {
    const url = process.env[`${catalog.urlPrefix}${i}`];
    if (url?.trim()) {
      fromNumbered.push(url.trim());
    }
  }

  const urls = [...new Set(fromList.length > 0 ? fromList : fromNumbered)];

  if (urls.length === 0) {
    throw new Error(
      `Set ${catalog.urlsEnv} (comma/newline-separated or JSON array) or ${catalog.urlPrefix}1 … _${MAX_IMAGES_PER_MESSAGE}`
    );
  }

  if (urls.length > MAX_IMAGES_PER_MESSAGE) {
    console.warn(
      `${catalog.id} album has ${urls.length} URLs; sending first ${MAX_IMAGES_PER_MESSAGE} only`
    );
    return urls.slice(0, MAX_IMAGES_PER_MESSAGE);
  }

  return urls;
}

/** @returns {string[]} */
export function getKitchenImageUrls() {
  const catalog = getCatalogById(CATALOG_IDS.KITCHEN);
  if (!catalog) throw new Error("Kitchen catalog not configured");
  return getImageUrlsForCatalog(catalog);
}

/** @returns {string[]} */
export function getSoftFurnitureImageUrls() {
  const catalog = getCatalogById(CATALOG_IDS.SOFT_FURNITURE);
  if (!catalog) throw new Error("Soft furniture catalog not configured");
  return getImageUrlsForCatalog(catalog);
}

/**
 * Graph API failure with the whole Facebook error object kept intact.
 *
 * `error.message` stays in the previous `message | subcode N | trace X` shape so
 * existing log lines and matchers are unaffected; everything Facebook returned
 * is available on the instance (and via `describeGraphError`).
 */
export class GraphApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status: number, statusText: string, endpoint: string, error: Record<string, unknown> | null, raw: unknown }} context
   */
  constructor(message, context) {
    super(message);
    this.name = "GraphApiError";
    /** HTTP status of the Graph response */
    this.status = context.status;
    this.statusText = context.statusText;
    /** Endpoint without the query string — never carries the access token */
    this.endpoint = context.endpoint;
    /** Full parsed `error` object exactly as Facebook returned it */
    this.fbError = context.error ?? null;
    this.fbMessage = context.error?.message;
    this.type = context.error?.type;
    this.code = context.error?.code;
    this.errorSubcode = context.error?.error_subcode;
    this.errorUserTitle = context.error?.error_user_title;
    this.errorUserMsg = context.error?.error_user_msg;
    this.errorData = context.error?.error_data;
    this.fbtraceId = context.error?.fbtrace_id;
    /** Parsed response body, or the raw text when the body was not JSON */
    this.raw = context.raw;
  }
}

/**
 * Log-safe view of a failure: every Facebook error field, no access token.
 * @param {unknown} error
 */
export function describeGraphError(error) {
  if (error instanceof GraphApiError) {
    return {
      http_status: error.status,
      http_status_text: error.statusText,
      endpoint: error.endpoint,
      message: error.fbMessage ?? error.message,
      type: error.type ?? null,
      code: error.code ?? null,
      error_subcode: error.errorSubcode ?? null,
      error_user_title: error.errorUserTitle ?? null,
      error_user_msg: error.errorUserMsg ?? null,
      error_data: error.errorData ?? null,
      fbtrace_id: error.fbtraceId ?? null,
      fb_error: error.fbError,
      raw_body: error.fbError ? undefined : error.raw,
    };
  }

  return {
    http_status: null,
    message: error instanceof Error ? error.message : String(error),
    type: error instanceof Error ? error.name : typeof error,
    code: null,
    error_subcode: null,
    error_user_title: null,
    error_user_msg: null,
    error_data: null,
    fbtrace_id: null,
    fb_error: null,
  };
}

/**
 * POST to Graph and return the status alongside the parsed body.
 * Throws {@link GraphApiError} on any non-2xx or unparseable response.
 * @param {string} endpoint
 * @param {Record<string, unknown>} body
 * @returns {Promise<{ status: number, statusText: string, data: Record<string, unknown> }>}
 */
async function requestGraphApi(endpoint, body) {
  const response = await fetch(
    `${endpoint}?access_token=${encodeURIComponent(getPageAccessToken())}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  // Read as text first: Meta answers with HTML on some 5xx / throttling pages,
  // and response.json() would throw before the error could be inspected.
  const rawText = await response.text();
  /** @type {Record<string, unknown> | null} */
  let data = null;
  let parseFailed = false;

  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    parseFailed = true;
  }

  if (!response.ok || parseFailed) {
    const err = (data && data.error) || null;
    const detail = [
      err?.message,
      err?.error_subcode != null ? `subcode ${err.error_subcode}` : null,
      err?.fbtrace_id ? `trace ${err.fbtrace_id}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    throw new GraphApiError(
      detail || response.statusText || `HTTP ${response.status}`,
      {
        status: response.status,
        statusText: response.statusText,
        endpoint,
        error: err,
        raw: data ?? rawText.slice(0, 1000),
      }
    );
  }

  return { status: response.status, statusText: response.statusText, data };
}

/**
 * @param {string} endpoint
 * @param {Record<string, unknown>} body
 */
async function callGraphApi(endpoint, body) {
  const { data } = await requestGraphApi(endpoint, body);
  return data;
}

/**
 * @param {Record<string, unknown>} body
 */
function callSendApi(body) {
  return callGraphApi(getSendApiUrl(), body);
}

/**
 * Standard 24h reply uses RESPONSE; a human agent handling the thread can use
 * the HUMAN_AGENT tag (up to 7 days). Anything else passes through as a tag.
 * @param {{ tag?: string }} [options]
 * @returns {Record<string, string>}
 */
function buildMessagingFields(options = {}) {
  const tag = options.tag?.trim();
  if (!tag || tag.toUpperCase() === "RESPONSE") {
    return { messaging_type: "RESPONSE" };
  }
  return { messaging_type: "MESSAGE_TAG", tag };
}

/**
 * @param {string} imageUrl
 * @returns {Promise<string>}
 */
async function uploadImageAttachment(imageUrl) {
  const data = await callGraphApi(getUploadApiUrl(), {
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
 * @param {{ tag?: string }} [sendOptions]
 */
async function sendSingleImage(recipientId, imageUrl, sendOptions = {}) {
  return callSendApi({
    recipient: { id: recipientId },
    ...buildMessagingFields(sendOptions),
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
 * @param {{ tag?: string }} [sendOptions]
 */
async function sendAttachmentsAlbum(recipientId, attachments, sendOptions = {}) {
  return callSendApi({
    recipient: { id: recipientId },
    ...buildMessagingFields(sendOptions),
    message: { attachments },
  });
}

/**
 * @param {string} recipientId
 * @param {string[]} imageUrls
 */
export async function sendImageAlbum(recipientId, imageUrls, sendOptions = {}) {
  if (imageUrls.length === 0) {
    throw new Error("At least one image URL is required");
  }

  if (imageUrls.length === 1) {
    return sendSingleImage(recipientId, imageUrls[0], sendOptions);
  }

  if (imageUrls.length > MAX_IMAGES_PER_MESSAGE) {
    throw new Error(
      `Maximum ${MAX_IMAGES_PER_MESSAGE} images per message (got ${imageUrls.length})`
    );
  }

  return sendAttachmentsAlbum(
    recipientId,
    buildUrlAttachments(imageUrls),
    sendOptions
  );
}

/**
 * @param {string} recipientId
 * @param {string[]} attachmentIds
 */
async function sendImageAlbumByIds(recipientId, attachmentIds, sendOptions = {}) {
  return sendAttachmentsAlbum(
    recipientId,
    buildIdAttachments(attachmentIds),
    sendOptions
  );
}

/**
 * @param {import("@/lib/catalogs").CatalogId} catalogId
 */
function getSendModeForCatalog(catalogId) {
  if (catalogId === CATALOG_IDS.SOFT_FURNITURE) {
    return process.env.SOFT_FURNITURE_SEND_MODE === "sequential"
      ? "sequential"
      : "album";
  }
  return process.env.KITCHEN_SEND_MODE === "sequential" ? "sequential" : "album";
}

/**
 * Send images one-by-one (separate Messenger messages).
 * @param {string} recipientId
 * @param {string[]} imageUrls
 */
export async function sendImagesSequential(recipientId, imageUrls, sendOptions = {}) {
  const uniqueUrls = [...new Set(imageUrls)];
  const results = [];

  for (let i = 0; i < uniqueUrls.length; i++) {
    const url = uniqueUrls[i];
    results.push(await sendSingleImage(recipientId, url, sendOptions));
    if (i < uniqueUrls.length - 1) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  return results;
}

/**
 * TEMPORARY (kitchen only): one Send API call per image, no albums, no reusable
 * attachment uploads, no tag retries. A failed image is logged and the sequence
 * continues so one bad URL cannot cost the remaining photos.
 *
 * @param {string} recipientId
 * @param {string} imageUrl
 * @param {number} index zero-based
 * @param {number} total
 * @returns {Promise<{ ok: boolean, index: number, url: string, status: number | null, fbtraceId: string | null, error: ReturnType<typeof describeGraphError> | null }>}
 */
async function sendKitchenImageIndividually(recipientId, imageUrl, index, total) {
  const position = `${index + 1}/${total}`;

  try {
    const { status, data } = await requestGraphApi(getSendApiUrl(), {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: {
        attachment: {
          type: "image",
          payload: {
            url: imageUrl,
            is_reusable: false,
          },
        },
      },
    });

    console.log(
      `Kitchen image ${position} sent ${JSON.stringify({
        image_index: index + 1,
        total_images: total,
        image_url: imageUrl,
        recipient_psid: recipientId,
        http_status: status,
        message_id: data?.message_id ?? null,
        fbtrace_id: null,
        fb_error: null,
      })}`
    );

    return {
      ok: true,
      index: index + 1,
      url: imageUrl,
      status,
      fbtraceId: null,
      error: null,
    };
  } catch (error) {
    const details = describeGraphError(error);

    console.error(
      `Kitchen image ${position} FAILED ${JSON.stringify({
        image_index: index + 1,
        total_images: total,
        image_url: imageUrl,
        recipient_psid: recipientId,
        ...details,
      })}`
    );

    return {
      ok: false,
      index: index + 1,
      url: imageUrl,
      status: details.http_status ?? null,
      fbtraceId: details.fbtrace_id ?? null,
      error: details,
    };
  }
}

/**
 * TEMPORARY kitchen delivery path: every image as its own RESPONSE message,
 * sequentially, {@link KITCHEN_IMAGE_DELAY_MS} apart.
 * @param {string} recipientId
 * @param {string[]} imageUrls
 */
export async function sendKitchenImagesIndividually(recipientId, imageUrls) {
  const uniqueUrls = [...new Set(imageUrls)];
  const total = uniqueUrls.length;

  if (total === 0) {
    throw new Error("At least one image URL is required");
  }

  console.log(
    `Kitchen individual send → psid=${recipientId}: ${total} images, RESPONSE, ${KITCHEN_IMAGE_DELAY_MS}ms apart`
  );

  const results = [];

  for (let i = 0; i < total; i++) {
    results.push(
      await sendKitchenImageIndividually(recipientId, uniqueUrls[i], i, total)
    );

    if (i < total - 1) {
      await new Promise((r) => setTimeout(r, KITCHEN_IMAGE_DELAY_MS));
    }
  }

  const failures = results.filter((r) => !r.ok);
  const sentCount = total - failures.length;

  console.log(
    `Kitchen individual send done → psid=${recipientId}: ${sentCount}/${total} sent, ${failures.length} failed${
      failures.length
        ? ` (failed: ${failures
            .map((f) => `#${f.index} status=${f.status ?? "n/a"} trace=${f.fbtraceId ?? "n/a"}`)
            .join("; ")})`
        : ""
    }`
  );

  // Every image failing means nothing reached the customer — surface it so the
  // send lock is not marked complete and the trigger can fire again.
  if (sentCount === 0) {
    const first = failures[0];
    throw new Error(
      `All ${total} kitchen images failed; first error: ${first?.error?.message ?? "unknown"}`
    );
  }

  return {
    mode: "kitchen-individual",
    imageCount: total,
    sentCount,
    failedCount: failures.length,
    failedImages: failures.map((f) => ({
      index: f.index,
      url: f.url,
      status: f.status,
      fbtrace_id: f.fbtraceId,
    })),
  };
}

/**
 * @param {string} recipientId
 * @param {string[]} imageUrls
 * @param {import("@/lib/catalogs").CatalogId} catalogId
 */
export async function sendKitchenImages(recipientId, imageUrls, catalogId, sendOptions = {}) {
  const count = imageUrls.length;
  const mode = getSendModeForCatalog(catalogId);
  const albumOnly = catalogId === CATALOG_IDS.SOFT_FURNITURE && mode === "album";

  // Tag is mutable: if Meta rejects an unapproved tag, drop it and continue as
  // RESPONSE so a misconfigured tag can never block delivery within the window.
  let opts = { ...sendOptions };
  console.log(
    `Preparing ${count} images for ${recipientId} catalog=${catalogId} (mode=${mode}, tag=${opts.tag ?? "RESPONSE"})`
  );

  /** @param {Error} error */
  const dropTagIfRejected = (error) => {
    if (opts.tag && isMessagingTagError(error.message)) {
      console.warn(
        `Tag "${opts.tag}" rejected (${error.message}); retrying as RESPONSE`
      );
      opts = {};
      return true;
    }
    return false;
  };

  if (count === 1) {
    try {
      await sendSingleImage(recipientId, imageUrls[0], opts);
    } catch (error) {
      if (!dropTagIfRejected(error)) throw error;
      await sendSingleImage(recipientId, imageUrls[0], opts);
    }
    return { mode: "single", imageCount: count };
  }

  if (mode === "sequential") {
    try {
      await sendImagesSequential(recipientId, imageUrls, opts);
    } catch (error) {
      if (!dropTagIfRejected(error)) throw error;
      await sendImagesSequential(recipientId, imageUrls, opts);
    }
    return { mode: "sequential", imageCount: count };
  }

  try {
    await sendImageAlbum(recipientId, imageUrls, opts);
    return { mode: "album-url", imageCount: count };
  } catch (urlAlbumError) {
    console.warn(`URL album failed (${count} images):`, urlAlbumError.message);
    if (dropTagIfRejected(urlAlbumError)) {
      try {
        await sendImageAlbum(recipientId, imageUrls, opts);
        return { mode: "album-url", imageCount: count };
      } catch (retryError) {
        console.warn(`URL album retry (no tag) failed:`, retryError.message);
      }
    }
  }

  try {
    const attachmentIds = await uploadAllImages(imageUrls);
    await sendImageAlbumByIds(recipientId, attachmentIds, opts);
    return { mode: "album-uploaded", imageCount: count };
  } catch (uploadedAlbumError) {
    console.warn(
      `Uploaded album failed (${count} images):`,
      uploadedAlbumError.message
    );
  }

  if (albumOnly) {
    throw new Error(
      `Album send failed for ${catalogId}; set JPG URLs or smaller batch`
    );
  }

  await sendImagesSequential(recipientId, imageUrls, opts);
  return { mode: "sequential", imageCount: count };
}

/**
 * Meta rejects sends with an unapproved/invalid tag or outside the tag window.
 * @param {string} message
 */
function isMessagingTagError(message) {
  const lower = (message ?? "").toLowerCase();
  return (
    lower.includes("tag") ||
    lower.includes("outside") ||
    lower.includes("window") ||
    lower.includes("24") ||
    lower.includes("subcode 2018278") ||
    lower.includes("permission")
  );
}

/**
 * @param {string} recipientId
 * @param {import("@/lib/catalogs").CatalogId} catalogId
 * @param {{ trigger?: string, tag?: string }} [options]
 */
export async function sendProductAlbumToUser(recipientId, catalogId, options = {}) {
  const catalog = getCatalogById(catalogId);
  if (!catalog) {
    throw new Error(`Unknown product catalog: ${catalogId}`);
  }

  const imageUrls = getImageUrlsForCatalog(catalog);
  const tag = options.tag?.trim();

  // TEMPORARY: kitchen bypasses every album path (URL album, uploaded reusable
  // attachments, whole-chain retry) and ignores the messaging tag — each image
  // goes out as its own RESPONSE message. Soft furniture is unchanged.
  if (catalogId === CATALOG_IDS.KITCHEN) {
    if (tag) {
      console.log(
        `Kitchen individual send ignores tag "${tag}" — sending as RESPONSE`
      );
    }

    const kitchenResult = await sendKitchenImagesIndividually(
      recipientId,
      imageUrls
    );

    return {
      handled: true,
      catalogId,
      catalogLabel: catalog.buttonLabel,
      trigger: options.trigger ?? "unknown",
      ...kitchenResult,
    };
  }

  let result;
  try {
    result = await sendKitchenImages(recipientId, imageUrls, catalogId, { tag });
  } catch (error) {
    if (tag && isMessagingTagError(error.message)) {
      console.warn(
        `Tag "${tag}" send failed (${error.message}); retrying as RESPONSE`
      );
      result = await sendKitchenImages(recipientId, imageUrls, catalogId, {});
    } else {
      throw error;
    }
  }

  return {
    handled: true,
    catalogId,
    catalogLabel: catalog.buttonLabel,
    trigger: options.trigger ?? "unknown",
    ...result,
  };
}

/**
 * Send kitchen album to a Messenger user (PSID).
 * @param {string} recipientId
 * @param {{ trigger?: string }} [options]
 */
export async function sendKitchenAlbumToUser(recipientId, options = {}) {
  return sendProductAlbumToUser(recipientId, CATALOG_IDS.KITCHEN, options);
}

/**
 * Send album when user opens chat from Click-to-Messenger ad (no reply required).
 * @param {string} psid
 */
export async function sendKitchenAlbumOnChatOpen(psid) {
  console.log(`Chat open → sending kitchen photos to ${psid}`);
  return sendKitchenAlbumToUser(psid, { trigger: "chat_open" });
}
