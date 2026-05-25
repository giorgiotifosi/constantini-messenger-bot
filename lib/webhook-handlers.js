import { sendKitchenAlbumOnChatOpen } from "@/lib/messenger";
import {
  formatReferralForLog,
  getAdReferralSkipReason,
  getKitchenButtonLabel,
  getSavedTemplateLabelName,
  isChatOpenReferral,
  isKitchenButtonPostback,
  isKitchenQuickReply,
  isKitchenTextTrigger,
  isLabelAssignmentAction,
  isMatchingAdReferral,
  isSavedTemplateEcho,
  isSavedTemplateLabel,
  shouldSendOnAnyCustomerMessage,
  shouldSendOnGreetingEcho,
} from "@/lib/triggers";
import {
  enqueueKitchenSendForPsid,
  releaseKitchenSend,
  tryAcquireKitchenSend,
} from "@/lib/kitchen-send-lock";

/**
 * @typedef {'ad_referral' | 'postback_referral' | 'ad_referral_message' | 'button_postback' | 'quick_reply' | 'optin' | 'greeting_echo' | 'inbox_label' | 'customer_text' | 'keyword'} KitchenTrigger
 */

/**
 * @typedef {{ psid: string, trigger: KitchenTrigger, label: string, priority: number }} PendingKitchenSend
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
 * @param {PendingKitchenSend | undefined} current
 * @param {PendingKitchenSend} next
 */
function shouldReplacePending(current, next) {
  if (!current) return true;
  return next.priority < current.priority;
}

/**
 * @param {Map<string, PendingKitchenSend>} pending
 * @param {PendingKitchenSend} item
 */
function queueKitchenSend(pending, item) {
  const existing = pending.get(item.psid);
  if (shouldReplacePending(existing, item)) {
    pending.set(item.psid, item);
  }
}

/**
 * @param {Record<string, unknown>} referral
 * @param {string} psid
 * @param {KitchenTrigger} trigger
 * @param {Map<string, PendingKitchenSend>} pending
 */
function considerReferralChatOpen(referral, psid, trigger, pending) {
  if (!referral || !isChatOpenReferral(referral)) return;

  console.log(`Referral payload: ${formatReferralForLog(referral)}`);

  if (!isMatchingAdReferral(referral)) {
    console.log(`Referral ignored for ${psid}: ${getAdReferralSkipReason(referral)}`);
    return;
  }

  queueKitchenSend(pending, {
    psid,
    trigger,
    label: trigger,
    priority: TRIGGER_PRIORITY[trigger],
  });
}

/**
 * @param {Record<string, unknown>} event
 * @param {Map<string, PendingKitchenSend>} pending
 */
export function collectKitchenSendsFromMessagingEvent(event, pending) {
  const psid = event.sender?.id;
  if (!psid) return;

  if (event.referral) {
    considerReferralChatOpen(event.referral, psid, "ad_referral", pending);
    return;
  }

  if (event.postback) {
    if (isKitchenButtonPostback(event.postback)) {
      console.log(`Kitchen button postback → ${psid}`);
      queueKitchenSend(pending, {
        psid,
        trigger: "button_postback",
        label: getKitchenButtonLabel(),
        priority: TRIGGER_PRIORITY.button_postback,
      });
      return;
    }

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
    queueKitchenSend(pending, {
      psid,
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
      queueKitchenSend(pending, {
        psid: recipientId,
        trigger: "greeting_echo",
        label: "greeting echo",
        priority: TRIGGER_PRIORITY.greeting_echo,
      });
    }
    return;
  }

  if (message.quick_reply && isKitchenQuickReply(message.quick_reply)) {
    console.log(`Kitchen quick reply → ${psid}`);
    queueKitchenSend(pending, {
      psid,
      trigger: "quick_reply",
      label: getKitchenButtonLabel(),
      priority: TRIGGER_PRIORITY.quick_reply,
    });
    return;
  }

  const text = message.text;
  if (text && isKitchenTextTrigger(text)) {
    console.log(`Kitchen button text → ${psid}`);
    queueKitchenSend(pending, {
      psid,
      trigger: "keyword",
      label: getKitchenButtonLabel(),
      priority: TRIGGER_PRIORITY.keyword,
    });
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
    queueKitchenSend(pending, {
      psid,
      trigger: "customer_text",
      label: text.slice(0, 30),
      priority: TRIGGER_PRIORITY.customer_text,
    });
    return;
  }

}

/**
 * @param {Record<string, unknown>} value
 * @param {Map<string, PendingKitchenSend>} pending
 */
export function collectKitchenSendFromInboxLabel(value, pending) {
  const psid = value?.user?.id;
  const labelName = value?.label?.page_label_name;
  const action = value?.action;

  if (!psid || !labelName || !isLabelAssignmentAction(action)) return;
  if (!isSavedTemplateLabel(labelName)) return;

  queueKitchenSend(pending, {
    psid,
    trigger: "inbox_label",
    label: `Label ${getSavedTemplateLabelName()}`,
    priority: TRIGGER_PRIORITY.inbox_label,
  });
}

/**
 * @param {Map<string, PendingKitchenSend>} pending
 * @param {Set<string>} batchSent
 */
export async function flushPendingKitchenSends(pending, batchSent) {
  for (const item of pending.values()) {
    await sendKitchenOnce(item, batchSent);
  }
}

/**
 * @param {PendingKitchenSend} item
 * @param {Set<string>} batchSent
 */
async function sendKitchenOnce(item, batchSent) {
  await enqueueKitchenSendForPsid(item.psid, async () => {
    const acquired = await tryAcquireKitchenSend(item.psid, batchSent);
    if (!acquired) {
      console.log(
        `Skip duplicate kitchen send for ${item.psid} (${item.trigger})`
      );
      return;
    }

    try {
      const result = await sendKitchenAlbumOnChatOpen(item.psid);
      console.log(
        `${item.label} → ${result.imageCount} images (${result.mode}) trigger=${item.trigger}`
      );
      await releaseKitchenSend(item.psid, true);
    } catch (error) {
      console.error(
        `FAILED ${item.label} psid=${item.psid}:`,
        error.message
      );
      batchSent.delete(item.psid);
      await releaseKitchenSend(item.psid, false);
    }
  });
}
