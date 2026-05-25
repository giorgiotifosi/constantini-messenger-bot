/** Default Meta Inbox label / saved template / Ads chat template name */
const DEFAULT_SAVED_TEMPLATE_LABEL = "სამზარეულო bot 30 ფოტო";

/**
 * Label name from Meta Inbox (custom label or saved reply).
 */
export function getSavedTemplateLabelName() {
  return (
    process.env.SAVED_TEMPLATE_LABEL?.trim() || DEFAULT_SAVED_TEMPLATE_LABEL
  );
}

/**
 * Optional: exact text when Page sends the saved reply (message_echoes).
 */
export function getSavedTemplateEchoText() {
  const echo = process.env.SAVED_TEMPLATE_ECHO_TEXT?.trim();
  if (echo) return echo;
  return getSavedTemplateLabelName();
}

/**
 * Optional: customer typing this word also triggers photos (leave unset to disable).
 */
export function getKitchenTextTrigger() {
  return process.env.KITCHEN_TEXT_TRIGGER?.trim() || "";
}

/**
 * Optional ref from Click-to-Messenger ad (Ads Manager → advanced / m.me ref).
 */
export function getMessengerAdRef() {
  return process.env.MESSENGER_AD_REF?.trim() || "";
}

/**
 * @returns {string[]}
 */
export function getMessengerAdIds() {
  const raw = process.env.MESSENGER_AD_IDS?.trim();
  if (!raw) return [];
  return raw.split(/[\n,]+/).map((id) => id.trim()).filter(Boolean);
}

/**
 * Match ad_title from referral.ads_context_data (partial match).
 */
export function getAdTitleKeyword() {
  return (
    process.env.MESSENGER_AD_TITLE_KEYWORD?.trim() ||
    "სამზარეულო"
  );
}

export function isMessengerAdSendOnAll() {
  return process.env.MESSENGER_AD_SEND_ON_ALL === "true";
}

/**
 * @param {string | undefined} labelName
 */
export function isSavedTemplateLabel(labelName) {
  if (!labelName || typeof labelName !== "string") return false;
  return labelName.trim() === getSavedTemplateLabelName();
}

/**
 * @param {string | undefined} text
 */
export function isSavedTemplateEcho(text) {
  if (!text || typeof text !== "string") return false;
  const normalized = text.trim();
  const trigger = getSavedTemplateEchoText();
  return normalized === trigger || normalized.includes(trigger);
}

/**
 * @param {string | undefined} text
 */
export function isKitchenTextTrigger(text) {
  const trigger = getKitchenTextTrigger();
  if (!trigger || !text || typeof text !== "string") return false;
  return text.trim() === trigger;
}

/**
 * @param {string | undefined} action
 */
export function isLabelAssignmentAction(action) {
  if (!action) return true;
  const value = String(action).toLowerCase();
  return (
    !value.includes("remove") &&
    !value.includes("delete") &&
    !value.includes("unlabel")
  );
}

/**
 * Click-to-Messenger ad or m.me link opened a conversation.
 * @param {Record<string, unknown> | undefined} referral
 */
export function isMatchingAdReferral(referral) {
  if (!referral || typeof referral !== "object") return false;

  const source = String(referral.source ?? "");
  const type = String(referral.type ?? "");
  const ref = referral.ref != null ? String(referral.ref) : "";
  const adId = referral.ad_id != null ? String(referral.ad_id) : "";

  const adsContext =
    referral.ads_context_data && typeof referral.ads_context_data === "object"
      ? referral.ads_context_data
      : {};
  const adTitle = String(adsContext.ad_title ?? "");

  const isAdOpen =
    (source === "ADS" || source === "SHORTLINK") && type === "OPEN_THREAD";

  if (!isAdOpen && source !== "ADS") {
    return false;
  }

  const configuredRef = getMessengerAdRef();
  if (configuredRef && ref === configuredRef) {
    return true;
  }

  const adIds = getMessengerAdIds();
  if (adId && adIds.includes(adId)) {
    return true;
  }

  const templateName = getSavedTemplateLabelName();
  if (templateName && adTitle.includes(templateName)) {
    return true;
  }

  const keyword = getAdTitleKeyword();
  if (keyword && adTitle.toLowerCase().includes(keyword.toLowerCase())) {
    return true;
  }

  if (isMessengerAdSendOnAll() && source === "ADS") {
    return true;
  }

  return false;
}
