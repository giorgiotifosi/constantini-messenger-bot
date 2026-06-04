import {
  CATALOG_IDS,
  findCatalogFromPostback,
  findCatalogFromQuickReply,
  findCatalogFromText,
} from "@/lib/catalogs";
import {
  enqueueAlbumSendForPsid,
  releaseAlbumSend,
  tryAcquireAlbumSend,
} from "@/lib/kitchen-send-lock";
import { sendProductAlbumToUser } from "@/lib/messenger";
import {
  formatReferralForLog,
  getAdReferralSkipReason,
  getSavedTemplateLabelName,
  isChatOpenReferral,
  isLabelAssignmentAction,
  isMatchingAdReferral,
  isSavedTemplateEcho,
  isSavedTemplateLabel,
  shouldSendOnAnyCustomerMessage,
  shouldSendOnGreetingEcho,
} from "@/lib/triggers";

/**
 * @typedef {'ad_referral' | 'postback_referral' | 'ad_referral_message' | 'button_postback' | 'quick_reply' | 'optin' | 'greeting_echo' | 'inbox_label' | 'customer_text' | 'keyword'} AlbumTrigger
 */

/**
 * @typedef {{ psid: string, catalogId: import("@/lib/catalogs").CatalogId, trigger: AlbumTrigger, label: string, priority: number }} PendingAlbumSend
 */

const TRIGGER_PRIORITY = {
  ad_referral: 1,
  postback_referral: 2,
  ad_referral_message: 3,
  optin: 4,
  greeting_echo: 5,
  inbox_label: 6,
  button_postback: 7,
  quick_reply: 8,
  keyword: 9,
  customer_text: 10,
};

/**
 * @param {PendingAlbumSend | undefined} current
 * @param {PendingAlbumSend} next
 */
function shouldReplacePending(current, next) {
  if (!current) return true;
  return next.priority < current.priority;
}

/**
 * @param {Map<string, PendingAlbumSend>} pending
 * @param {PendingAlbumSend} item
 */
function queueAlbumSend(pending, item) {
  const key = `${item.psid}:${item.catalogId}`;
  const existing = pending.get(key);
  if (shouldReplacePending(existing, item)) {
    pending.set(key, item);
  }
}

/**
 * @param {Record<string, unknown>} referral
 * @param {string} psid
 * @param {AlbumTrigger} trigger
 * @param {Map<string, PendingAlbumSend>} pending
 */
function considerReferralChatOpen(referral, psid, trigger, pending) {
  if (!referral || !isChatOpenReferral(referral)) return;

  console.log(`Referral payload: ${formatReferralForLog(referral)}`);

  if (!isMatchingAdReferral(referral)) {
    console.log(`Referral ignored for ${psid}: ${getAdReferralSkipReason(referral)}`);
    return;
  }

  queueAlbumSend(pending, {
    psid,
    catalogId: CATALOG_IDS.KITCHEN,
    trigger,
    label: trigger,
    priority: TRIGGER_PRIORITY[trigger],
  });
}

/**
 * @param {import("@/lib/catalogs").ProductCatalog} catalog
 * @param {string} psid
 * @param {AlbumTrigger} trigger
 * @param {Map<string, PendingAlbumSend>} pending
 */
function queueCatalogButtonSend(catalog, psid, trigger, pending) {
  console.log(`${catalog.buttonLabel} (${catalog.id}) → ${psid}`);
  queueAlbumSend(pending, {
    psid,
    catalogId: catalog.id,
    trigger,
    label: catalog.buttonLabel,
    priority: TRIGGER_PRIORITY[trigger],
  });
}

/**
 * @param {Record<string, unknown>} event
 * @param {Map<string, PendingAlbumSend>} pending
 */
export function collectKitchenSendsFromMessagingEvent(event, pending) {
  const psid = event.sender?.id;
  if (!psid) return;

  if (event.referral) {
    considerReferralChatOpen(event.referral, psid, "ad_referral", pending);
    return;
  }

  if (event.postback) {
    const catalog = findCatalogFromPostback(event.postback);
    if (catalog) {
      queueCatalogButtonSend(catalog, psid, "button_postback", pending);
      return;
    }

    console.log(
      `Postback ignored for ${psid}: title=${JSON.stringify(event.postback.title)} payload=${JSON.stringify(event.postback.payload)}`
    );

    if (event.postback.referral) {
      considerReferralChatOpen(
        event.postback.referral,
        psid,
        "postback_referral",
        pending
      );
    }
    return;
  }

  if (event.optin) {
    queueAlbumSend(pending, {
      psid,
      catalogId: CATALOG_IDS.KITCHEN,
      trigger: "optin",
      label: "optin",
      priority: TRIGGER_PRIORITY.optin,
    });
    return;
  }

  const message = event.message;
  if (!message) return;

  if (message.is_echo) {
    const recipientId = event.recipient?.id;
    const text = message.text;

    if (
      recipientId &&
      text &&
      shouldSendOnGreetingEcho() &&
      isSavedTemplateEcho(text)
    ) {
      queueAlbumSend(pending, {
        psid: recipientId,
        catalogId: CATALOG_IDS.KITCHEN,
        trigger: "greeting_echo",
        label: "greeting echo",
        priority: TRIGGER_PRIORITY.greeting_echo,
      });
    }
    return;
  }

  const quickReplyCatalog = message.quick_reply
    ? findCatalogFromQuickReply(message.quick_reply)
    : null;
  if (quickReplyCatalog) {
    queueCatalogButtonSend(quickReplyCatalog, psid, "quick_reply", pending);
    return;
  }

  const text = message.text;
  const textCatalog = text ? findCatalogFromText(text) : null;
  if (textCatalog) {
    queueCatalogButtonSend(textCatalog, psid, "keyword", pending);
    return;
  }

  if (message.referral) {
    considerReferralChatOpen(
      message.referral,
      psid,
      "ad_referral_message",
      pending
    );
    return;
  }

  if (!text) return;

  if (shouldSendOnAnyCustomerMessage()) {
    queueAlbumSend(pending, {
      psid,
      catalogId: CATALOG_IDS.KITCHEN,
      trigger: "customer_text",
      label: text.slice(0, 30),
      priority: TRIGGER_PRIORITY.customer_text,
    });
  }
}

/**
 * @param {Record<string, unknown>} value
 * @param {Map<string, PendingAlbumSend>} pending
 */
export function collectKitchenSendFromInboxLabel(value, pending) {
  const psid = value?.user?.id;
  const labelName = value?.label?.page_label_name;
  const action = value?.action;

  if (!psid || !labelName || !isLabelAssignmentAction(action)) return;
  if (!isSavedTemplateLabel(labelName)) return;

  queueAlbumSend(pending, {
    psid,
    catalogId: CATALOG_IDS.KITCHEN,
    trigger: "inbox_label",
    label: `Label ${getSavedTemplateLabelName()}`,
    priority: TRIGGER_PRIORITY.inbox_label,
  });
}

/**
 * @param {Map<string, PendingAlbumSend>} pending
 * @param {Set<string>} batchSent
 */
export async function flushPendingKitchenSends(pending, batchSent) {
  for (const item of pending.values()) {
    await sendAlbumOnce(item, batchSent);
  }
}

/**
 * @param {PendingAlbumSend} item
 * @param {Set<string>} batchSent
 */
async function sendAlbumOnce(item, batchSent) {
  await enqueueAlbumSendForPsid(item.psid, item.catalogId, async () => {
    const acquired = await tryAcquireAlbumSend(
      item.psid,
      item.catalogId,
      batchSent
    );
    if (!acquired) {
      console.log(
        `Skip duplicate send for ${item.psid} (${item.catalogId}, ${item.trigger})`
      );
      return;
    }

    try {
      const result = await sendProductAlbumToUser(
        item.psid,
        item.catalogId,
        { trigger: item.trigger }
      );
      console.log(
        `${item.label} → ${result.imageCount} images (${result.mode}) catalog=${item.catalogId} trigger=${item.trigger}`
      );
      await releaseAlbumSend(item.psid, item.catalogId, true);
    } catch (error) {
      console.error(
        `FAILED ${item.label} psid=${item.psid} catalog=${item.catalogId}:`,
        error.message
      );
      batchSent.delete(`${item.psid}:${item.catalogId}`);
      await releaseAlbumSend(item.psid, item.catalogId, false);
    }
  });
}
