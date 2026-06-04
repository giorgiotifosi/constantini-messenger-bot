/** @typedef {'kitchen' | 'soft_furniture'} CatalogId */

/**
 * @typedef {Object} ProductCatalog
 * @property {CatalogId} id
 * @property {string} buttonLabel
 * @property {string} urlsEnv
 * @property {string} urlPrefix
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
    },
    {
      id: CATALOG_IDS.SOFT_FURNITURE,
      buttonLabel:
        process.env.SOFT_FURNITURE_BUTTON_LABEL?.trim() || "რბილი ავეჯი",
      urlsEnv: "SOFT_FURNITURE_IMAGE_URLS",
      urlPrefix: "SOFT_FURNITURE_IMAGE_URL_",
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
export function matchesCatalogButtonLabel(catalog, value) {
  const token = normalizeTriggerToken(value);
  const label = normalizeTriggerToken(catalog.buttonLabel);
  if (!token || !label) return false;
  if (token === label) return true;
  if (label.length >= 3 && token.includes(label)) return true;
  return false;
}

/**
 * @param {string | undefined} value
 * @returns {ProductCatalog | null}
 */
export function findCatalogByButtonValue(value) {
  for (const catalog of getProductCatalogs()) {
    if (matchesCatalogButtonLabel(catalog, value)) return catalog;
  }
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
  return findCatalogByButtonValue(title) || findCatalogByButtonValue(payload);
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
