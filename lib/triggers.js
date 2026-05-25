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
 * Optional: customer typing this word also triggers photos.
 */
export function getKitchenTextTrigger() {
  const fromEnv = process.env.KITCHEN_TEXT_TRIGGER?.trim();
  if (fromEnv) return fromEnv;
  return "სამზარეულო";
}

/** Send album when customer sends any text (needed for Engagement ads without Connect App). */
export function shouldSendOnAnyCustomerMessage() {
  return process.env.MESSENGER_SEND_ON_ANY_MESSAGE !== "false";
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

/** If false (default), any ADS click triggers photos unless MESSENGER_AD_STRICT=true */
export function isMessengerAdStrict() {
  return process.env.MESSENGER_AD_STRICT === "true";
}

/**
 * @param {string | undefined} labelName
 */
export function isSavedTemplateLabel(labelName) {
  if (!labelName || typeof labelName !== "string") return false;
  return labelName.trim() === getSavedTemplateLabelName();
}

/**
 * Ads Chat builder automated greeting (Page echo text, not template name).
 * @param {string | undefined} text
 */
export function isChatBuilderGreetingEcho(text) {
  if (!text || typeof text !== "string") return false;
  const normalized = text.toLowerCase();
  const markers = [
    "სამზარეულო",
    "დაკავშირებისთვის",
    "574 12 02 12",
  ];
  return markers.some((marker) => normalized.includes(marker.toLowerCase()));
}

/**
 * @param {string | undefined} text
 */
export function isSavedTemplateEcho(text) {
  if (!text || typeof text !== "string") return false;
  if (isChatBuilderGreetingEcho(text)) return true;

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
  const ref = referral.ref != null ? String(referral.ref) : "";
  const adId = referral.ad_id != null ? String(referral.ad_id) : "";

  const adsContext =
    referral.ads_context_data && typeof referral.ads_context_data === "object"
      ? referral.ads_context_data
      : {};
  const adTitle = String(adsContext.ad_title ?? "");

  if (source !== "ADS" && source !== "SHORTLINK") {
    return false;
  }

  if (isMessengerAdSendOnAll()) {
    return true;
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

  // Default: any Messenger ad click sends album (kitchen-only account).
  // Set MESSENGER_AD_STRICT=true to require ref / ad id / title match only.
  if (source === "ADS" && !isMessengerAdStrict()) {
    return true;
  }

  return false;
}

/**
 * @param {Record<string, unknown> | undefined} referral
 */
export function formatReferralForLog(referral) {
  if (!referral) return "none";
  try {
    return JSON.stringify(referral);
  } catch {
    return String(referral);
  }
}
