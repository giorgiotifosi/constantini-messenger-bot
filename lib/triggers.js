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
 * Chat builder button label / postback title / quick reply text.
 */
export function getKitchenButtonLabel() {
  const fromEnv = process.env.KITCHEN_BUTTON_LABEL?.trim();
  if (fromEnv) return fromEnv;
  const textTrigger = process.env.KITCHEN_TEXT_TRIGGER?.trim();
  if (textTrigger) return textTrigger;
  return "სამზარეულო";
}

/** @deprecated alias */
export function getKitchenTextTrigger() {
  return getKitchenButtonLabel();
}

/**
 * @param {string | undefined} value
 */
function normalizeTriggerToken(value) {
  if (!value || typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

/**
 * @param {string | undefined} value
 */
export function matchesKitchenButtonLabel(value) {
  const token = normalizeTriggerToken(value);
  const label = normalizeTriggerToken(getKitchenButtonLabel());
  if (!token || !label) return false;
  if (token === label) return true;
  // Ads preview / Chat builder sometimes sends a longer title or payload
  if (label.length >= 3 && token.includes(label)) return true;
  return false;
}

/** Fallback only — default off so photos send on chat open, not on reply. */
export function shouldSendOnAnyCustomerMessage() {
  return process.env.MESSENGER_SEND_ON_ANY_MESSAGE === "true";
}

/**
 * User opened Messenger from ad / m.me (chat open — no reply needed).
 * @param {Record<string, unknown> | undefined} referral
 */
export function isChatOpenReferral(referral) {
  if (!referral || typeof referral !== "object") return false;
  const source = String(referral.source ?? "");
  const type = String(referral.type ?? "OPEN_THREAD");
  return (
    (source === "ADS" || source === "SHORTLINK") &&
    (type === "OPEN_THREAD" || type === "")
  );
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
 * Optional: partial match in referral ads_context_data.ad_title.
 */
export function getAdTitleKeyword() {
  return process.env.MESSENGER_AD_TITLE_KEYWORD?.trim() || "";
}

/** Set true only to send on every Click-to-Messenger ad (not recommended). */
export function isMessengerAdSendOnAll() {
  return process.env.MESSENGER_AD_SEND_ON_ALL === "true";
}

/** Default: only ads listed in MESSENGER_AD_IDS / MESSENGER_AD_REF. */
export function isMessengerAdStrict() {
  return !isMessengerAdSendOnAll();
}

/** When false, chat-open referrals are ignored; use the Chat builder button instead. */
export function isAdFilterConfigured() {
  return (
    isMessengerAdSendOnAll() ||
    getMessengerAdIds().length > 0 ||
    Boolean(getMessengerAdRef()) ||
    Boolean(getAdTitleKeyword())
  );
}

/**
 * Customer tapped the Chat builder „სამზარეულო“ button (messaging_postbacks).
 * @param {Record<string, unknown> | undefined} postback
 */
export function isKitchenButtonPostback(postback) {
  if (!postback || typeof postback !== "object") return false;
  const title = postback.title != null ? String(postback.title) : "";
  const payload = postback.payload != null ? String(postback.payload) : "";
  return matchesKitchenButtonLabel(title) || matchesKitchenButtonLabel(payload);
}

/**
 * @param {Record<string, unknown> | undefined} quickReply
 */
export function isKitchenQuickReply(quickReply) {
  if (!quickReply || typeof quickReply !== "object") return false;
  const payload =
    quickReply.payload != null ? String(quickReply.payload) : "";
  return matchesKitchenButtonLabel(payload);
}

/** Greeting echo can fire for any ad using the template — off by default in strict mode. */
export function shouldSendOnGreetingEcho() {
  if (process.env.MESSENGER_AD_GREETING_ECHO === "true") return true;
  if (process.env.MESSENGER_AD_GREETING_ECHO === "false") return false;
  return isMessengerAdSendOnAll();
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
  if (!text || typeof text !== "string") return false;
  return matchesKitchenButtonLabel(text);
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

  if (!isAdFilterConfigured()) {
    return false;
  }

  const adIds = getMessengerAdIds();
  const configuredRef = getMessengerAdRef();

  if (adId && adIds.length > 0 && adIds.includes(adId)) {
    return true;
  }

  if (configuredRef && ref === configuredRef) {
    return true;
  }

  const keyword = getAdTitleKeyword();
  if (keyword && adTitle.toLowerCase().includes(keyword.toLowerCase())) {
    return true;
  }

  return false;
}

/**
 * Human-readable reason when referral was ignored (for logs).
 * @param {Record<string, unknown> | undefined} referral
 */
export function getAdReferralSkipReason(referral) {
  if (!referral) return "no referral";
  const adId = referral.ad_id != null ? String(referral.ad_id) : "(none)";
  const ref = referral.ref != null ? String(referral.ref) : "(none)";
  const ids = getMessengerAdIds();
  const configuredRef = getMessengerAdRef();

  if (!isAdFilterConfigured()) {
    return "ad filter off — photos send on „სამზარეულო“ button tap only";
  }

  return `ad_id=${adId} ref=${ref} not in allowed list (ids=${ids.join(",") || "—"} ref=${configuredRef || "—"})`;
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
