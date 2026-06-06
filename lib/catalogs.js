/** @typedef {'kitchen' | 'soft_furniture'} CatalogId */

/**
 * @typedef {Object} ProductCatalog
 * @property {CatalogId} id
 * @property {string} buttonLabel
 * @property {string} urlsEnv
 * @property {string} urlPrefix
 * @property {string | undefined} postbackPayloadEnv
 */

export const CATALOG_IDS = {
  KITCHEN: "kitchen",
  SOFT_FURNITURE: "soft_furniture",
};

/** Meta default payloads — never map these to a catalog without a matching title. */
const GENERIC_POSTBACK_PAYLOADS = new Set([
  "",
  "get_started",
  "get started",
  "get_started_payload",
  "menu",
  "main_menu",
]);

/**
 * @returns {ProductCatalog[]}
 */
export function getProductCatalogs() {
  return [
    {
      id: CATALOG_IDS.KITCHEN,
      buttonLabel:
        process.env.KITCHEN_BUTTON_LABEL?.trim() ||
        process.env.KITCHEN_TEXT_TRIGGER?.trim() ||
        "სამზარეულო",
      urlsEnv: "KITCHEN_IMAGE_URLS",
      urlPrefix: "KITCHEN_IMAGE_URL_",
      postbackPayloadEnv: "KITCHEN_POSTBACK_PAYLOAD",
    },
    {
      id: CATALOG_IDS.SOFT_FURNITURE,
      buttonLabel:
        process.env.SOFT_FURNITURE_BUTTON_LABEL?.trim() || "რბილი ავეჯი",
      urlsEnv: "SOFT_FURNITURE_IMAGE_URLS",
      urlPrefix: "SOFT_FURNITURE_IMAGE_URL_",
      postbackPayloadEnv: "SOFT_FURNITURE_POSTBACK_PAYLOAD",
    },
  ];
}

/**
 * @param {CatalogId} catalogId
 * @returns {ProductCatalog | undefined}
 */
export function getCatalogById(catalogId) {
  return getProductCatalogs().find((c) => c.id === catalogId);
}

/**
 * @param {ProductCatalog} catalog
 */
function getConfiguredPostbackPayload(catalog) {
  if (!catalog.postbackPayloadEnv) return "";
  return process.env[catalog.postbackPayloadEnv]?.trim() || "";
}

/**
 * @param {string | undefined} value
 */
function normalizeTriggerToken(value) {
  if (!value || typeof value !== "string") return "";
  return value.normalize("NFKC").trim().toLowerCase();
}

/**
 * @param {string | undefined} payload
 */
function isGenericPostbackPayload(payload) {
  return GENERIC_POSTBACK_PAYLOADS.has(normalizeTriggerToken(payload));
}

/**
 * @param {ProductCatalog} catalog
 * @param {string | undefined} value
 */
export function matchesCatalogButtonLabelExact(catalog, value) {
  const token = normalizeTriggerToken(value);
  const label = normalizeTriggerToken(catalog.buttonLabel);
  return Boolean(token && label && token === label);
}

/**
 * @param {ProductCatalog} catalog
 * @param {string | undefined} value
 */
export function matchesCatalogButtonLabelFuzzy(catalog, value) {
  const token = normalizeTriggerToken(value);
  const label = normalizeTriggerToken(catalog.buttonLabel);
  if (!token || !label) return false;
  if (token === label) return true;
  if (label.length >= 4 && token.includes(label)) return true;
  if (token.length >= 4 && label.includes(token)) return true;
  return false;
}

/**
 * Soft furniture Chat builder question markers (when Meta sends variant text).
 * @param {string | undefined} value
 */
function matchesSoftFurnitureMarkers(value) {
  const token = normalizeTriggerToken(value);
  if (!token) return false;
  const hasSoft =
    token.includes("რბილი") ||
    token.includes("rbili") ||
    token.includes("soft");
  const hasFurniture =
    token.includes("ავეჯ") || token.includes("avyaj") || token.includes("furniture");
  return hasSoft && hasFurniture;
}

/**
 * @param {string | undefined} value
 * @returns {ProductCatalog[]}
 */
function findAllCatalogMatches(value, fuzzy) {
  const matcher = fuzzy
    ? matchesCatalogButtonLabelFuzzy
    : matchesCatalogButtonLabelExact;
  return getProductCatalogs().filter((catalog) => matcher(catalog, value));
}

/**
 * @param {string | undefined} value
 * @returns {ProductCatalog | null}
 */
export function findCatalogByButtonValue(value) {
  if (matchesSoftFurnitureMarkers(value)) {
    const soft = getCatalogById(CATALOG_IDS.SOFT_FURNITURE);
    if (soft) return soft;
  }

  const exact = findAllCatalogMatches(value, false);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const fuzzy = findAllCatalogMatches(value, true);
  if (fuzzy.length === 1) return fuzzy[0];
  return null;
}

/**
 * @param {string} title
 * @param {string} payload
 * @returns {ProductCatalog | null}
 */
function findBestCatalogFromFields(title, payload) {
  for (const catalog of getProductCatalogs()) {
    const expectedPayload = getConfiguredPostbackPayload(catalog);
    if (expectedPayload && payload === expectedPayload) {
      return catalog;
    }
  }

  const fromTitle = findCatalogByButtonValue(title);
  if (fromTitle) return fromTitle;

  if (!isGenericPostbackPayload(payload)) {
    const fromPayload = findCatalogByButtonValue(payload);
    if (fromPayload) return fromPayload;
  }

  const combined = `${title} ${payload}`.trim();
  return findCatalogByButtonValue(combined);
}

/**
 * @param {Record<string, unknown> | undefined} postback
 * @returns {ProductCatalog | null}
 */
export function findCatalogFromPostback(postback) {
  if (!postback || typeof postback !== "object") return null;

  const title = postback.title != null ? String(postback.title) : "";
  const payload = postback.payload != null ? String(postback.payload) : "";

  return findBestCatalogFromFields(title, payload);
}

/**
 * @param {Record<string, unknown> | undefined} quickReply
 * @returns {ProductCatalog | null}
 */
export function findCatalogFromQuickReply(quickReply) {
  if (!quickReply || typeof quickReply !== "object") return null;
  const payload =
    quickReply.payload != null ? String(quickReply.payload) : "";
  return findCatalogByButtonValue(payload);
}

/**
 * @param {string | undefined} text
 * @returns {ProductCatalog | null}
 */
export function findCatalogFromText(text) {
  if (!text || typeof text !== "string") return null;
  return findCatalogByButtonValue(text);
}

/** Max length for Page admin inbox commands (avoids long automated greeting echoes). */
const ADMIN_ECHO_MAX_LENGTH = 40;

/**
 * Page admin typed a catalog keyword in Inbox (message echo to customer).
 * Exact label match only — not fuzzy.
 * @param {string | undefined} text
 * @returns {ProductCatalog | null}
 */
export function findCatalogFromAdminEcho(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > ADMIN_ECHO_MAX_LENGTH) return null;

  for (const catalog of getProductCatalogs()) {
    if (matchesCatalogButtonLabelExact(catalog, trimmed)) {
      return catalog;
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} event
 * @returns {ProductCatalog | null}
 */
export function findCatalogFromMessagingEvent(event) {
  if (event.postback) {
    const fromPostback = findCatalogFromPostback(event.postback);
    if (fromPostback) return fromPostback;
  }

  const message = event.message;
  if (!message || message.is_echo) return null;

  if (message.quick_reply) {
    const fromQuickReply = findCatalogFromQuickReply(message.quick_reply);
    if (fromQuickReply) return fromQuickReply;
  }

  if (message.text) {
    return findCatalogFromText(String(message.text));
  }

  return null;
}

/** @deprecated */
export function matchesCatalogButtonLabel(catalog, value) {
  return matchesCatalogButtonLabelFuzzy(catalog, value);
}
