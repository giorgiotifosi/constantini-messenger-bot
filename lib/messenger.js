import {
  CATALOG_IDS,
  getCatalogById,
} from "@/lib/catalogs";

const GRAPH_API_VERSION = "v22.0";
const MAX_IMAGES_PER_MESSAGE = 30;
/** Parallel /message_attachments uploads (as in 403ece8 — fits the 60s budget). */
const UPLOAD_CONCURRENCY = 5;

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
 * Upload one image to Meta and return its reusable attachment_id.
 *
 * Restored from 403ece8 — the proven path for large albums: Meta fetches the
 * image once here, so the album send itself carries no URLs.
 *
 * @param {string} imageUrl
 * @param {number} index zero-based
 * @param {number} total
 * @param {import("@/lib/catalogs").CatalogId} catalogId
 * @param {string} recipientId
 * @returns {Promise<string>}
 */
async function uploadImageAttachment(imageUrl, index, total, catalogId, recipientId) {
  const endpoint = getUploadApiUrl();

  try {
    const { status, data } = await requestGraphApi(endpoint, {
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

    const attachmentId = data?.attachment_id;

    if (!attachmentId) {
      console.error(
        `Attachment upload ${index + 1}/${total} returned no attachment_id ${JSON.stringify({
          catalog: catalogId,
          image_index: index + 1,
          total_images: total,
          image_url: imageUrl,
          recipient_psid: recipientId,
          endpoint,
          http_status: status,
          attachment_id: null,
        })}`
      );
      throw new Error(`No attachment_id returned for ${imageUrl}`);
    }

    console.log(
      `Attachment uploaded ${index + 1}/${total} ${JSON.stringify({
        catalog: catalogId,
        image_index: index + 1,
        total_images: total,
        image_url: imageUrl,
        recipient_psid: recipientId,
        endpoint,
        graph_api_version: GRAPH_API_VERSION,
        http_status: status,
        attachment_id: attachmentId,
      })}`
    );

    return attachmentId;
  } catch (error) {
    console.error(
      `Attachment upload ${index + 1}/${total} FAILED ${JSON.stringify({
        catalog: catalogId,
        image_index: index + 1,
        total_images: total,
        image_url: imageUrl,
        recipient_psid: recipientId,
        endpoint,
        graph_api_version: GRAPH_API_VERSION,
        attachment_id: null,
        ...describeGraphError(error),
      })}`
    );

    // Propagate untouched: an incomplete album must never be sent.
    throw error;
  }
}

/**
 * Upload every image, preserving the original order in the returned IDs.
 *
 * Fails fast: once one upload errors, no further upload is started. The album
 * cannot be sent anyway, so the remaining calls would only burn rate limit and
 * clutter the logs during a demo.
 *
 * @param {string[]} imageUrls
 * @param {import("@/lib/catalogs").CatalogId} catalogId
 * @param {string} recipientId
 * @returns {Promise<string[]>}
 */
async function uploadAllImages(imageUrls, catalogId, recipientId) {
  /** @type {unknown} */
  let firstError = null;

  const ids = await mapWithConcurrency(
    imageUrls,
    UPLOAD_CONCURRENCY,
    async (url, index) => {
      if (firstError) return null;

      try {
        return await uploadImageAttachment(
          url,
          index,
          imageUrls.length,
          catalogId,
          recipientId
        );
      } catch (error) {
        firstError ??= error;
        throw error;
      }
    }
  );

  if (firstError) throw firstError;

  return ids;
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
 * One Send API call carrying the whole album.
 *
 * Restored from 403ece8: `message.attachments` array of
 * `{type:"image", payload:{attachment_id}}`, hardcoded
 * `messaging_type: "RESPONSE"`. No message tag, no chunking, no fallback.
 *
 * @param {string} recipientId
 * @param {Array<Record<string, unknown>>} attachments
 */
async function sendAttachmentsAlbum(recipientId, attachments) {
  return requestGraphApi(getSendApiUrl(), {
    recipient: { id: recipientId },
    messaging_type: "RESPONSE",
    message: { attachments },
  });
}

/**
 * Send one catalog album: upload every image, then one album request carrying
 * all attachment IDs.
 *
 * A single upload failure aborts before the album request — one clean,
 * diagnosable failure instead of a partial album or hidden fallbacks.
 *
 * @param {string} recipientId
 * @param {string[]} imageUrls
 * @param {import("@/lib/catalogs").CatalogId} catalogId
 */
export async function sendCatalogAlbum(recipientId, imageUrls, catalogId) {
  const count = imageUrls.length;

  if (count === 0) {
    throw new Error("At least one image URL is required");
  }

  if (count > MAX_IMAGES_PER_MESSAGE) {
    throw new Error(
      `Maximum ${MAX_IMAGES_PER_MESSAGE} images per message (got ${count})`
    );
  }

  const endpoint = getSendApiUrl();

  console.log(
    `Album send → ${JSON.stringify({
      catalog: catalogId,
      recipient_psid: recipientId,
      image_count: count,
      upload_endpoint: getUploadApiUrl(),
      endpoint,
      graph_api_version: GRAPH_API_VERSION,
      messaging_type: "RESPONSE",
    })}`
  );

  // Step 1 — every image must upload before anything is sent.
  const attachmentIds = await uploadAllImages(imageUrls, catalogId, recipientId);

  console.log(
    `Album uploads complete ${JSON.stringify({
      catalog: catalogId,
      recipient_psid: recipientId,
      attachment_count: attachmentIds.length,
      image_count: count,
    })}`
  );

  // Step 2 — one album request with every attachment_id, in image order.
  try {
    const { status, data } = await sendAttachmentsAlbum(
      recipientId,
      buildIdAttachments(attachmentIds)
    );

    console.log(
      `Album sent ${JSON.stringify({
        catalog: catalogId,
        recipient_psid: recipientId,
        attachment_count: attachmentIds.length,
        endpoint,
        graph_api_version: GRAPH_API_VERSION,
        http_status: status,
        message_id: data?.message_id ?? null,
        fbtrace_id: null,
        fb_error: null,
      })}`
    );

    return {
      mode: "album-uploaded",
      imageCount: count,
      attachmentCount: attachmentIds.length,
      messageId: data?.message_id ?? null,
    };
  } catch (error) {
    console.error(
      `Album FAILED ${JSON.stringify({
        catalog: catalogId,
        recipient_psid: recipientId,
        attachment_count: attachmentIds.length,
        endpoint,
        graph_api_version: GRAPH_API_VERSION,
        message_id: null,
        ...describeGraphError(error),
      })}`
    );

    // No fallback on purpose — surface the real Graph error to the caller.
    throw error;
  }
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

  // Tags stay off for the App Review demo: the admin types the keyword right
  // before the album goes out, so RESPONSE is the correct messaging type.
  const tag = options.tag?.trim();
  if (tag) {
    console.log(`Album send ignores tag "${tag}" — sending as RESPONSE`);
  }

  const result = await sendCatalogAlbum(recipientId, imageUrls, catalogId);

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
