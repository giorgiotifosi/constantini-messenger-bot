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
  return value.trim().toLowerCase();
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
  return false;
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
  const exact = findAllCatalogMatches(value, false);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const fuzzy = findAllCatalogMatches(value, true);
  if (fuzzy.length === 1) return fuzzy[0];
  return null;
}

/**
 * @param {Record<string, unknown> | undefined} postback
 * @returns {ProductCatalog | null}
 */
export function findCatalogFromPostback(postback) {
  if (!postback || typeof postback !== "object") return null;

  const title = postback.title != null ? String(postback.title) : "";
  const payload = postback.payload != null ? String(postback.payload) : "";

  for (const catalog of getProductCatalogs()) {
    const expectedPayload = getConfiguredPostbackPayload(catalog);
    if (expectedPayload && payload === expectedPayload) {
      return catalog;
    }
  }

  const fromTitle = findCatalogByButtonValue(title);
  if (fromTitle) return fromTitle;

  const fromPayloadLabel = findCatalogByButtonValue(payload);
  if (fromPayloadLabel) return fromPayloadLabel;

  return null;
}

/**
 * @param {Record<string, unknown> | undefined} quickReply
 * @param {string | undefined} messageText
 * @returns {ProductCatalog | null}
 */
export function findCatalogFromQuickReply(quickReply, messageText) {
  if (!quickReply || typeof quickReply !== "object") return null;
  const payload =
    quickReply.payload != null ? String(quickReply.payload) : "";
  return (
    findCatalogByButtonValue(payload) || findCatalogByButtonValue(messageText)
  );
}

/**
 * @param {string | undefined} text
 * @returns {ProductCatalog | null}
 */
export function findCatalogFromText(text) {
  if (!text || typeof text !== "string") return null;
  return findCatalogByButtonValue(text);
}

/** @deprecated */
export function matchesCatalogButtonLabel(catalog, value) {
  return matchesCatalogButtonLabelFuzzy(catalog, value);
}
