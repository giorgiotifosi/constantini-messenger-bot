#!/bin/sh
# Subscribe your Facebook Page to this app's webhooks (run once).
# Usage: PAGE_ACCESS_TOKEN=xxx PAGE_ID=xxx ./scripts/subscribe-page.sh

set -e

TOKEN="${PAGE_ACCESS_TOKEN:?Set PAGE_ACCESS_TOKEN}"
PAGE_ID="${PAGE_ID:?Set PAGE_ID}"

FIELDS="messages,message_echoes,messaging_referrals,messaging_optins,messaging_postbacks"

curl -sS -X POST \
  "https://graph.facebook.com/v22.0/${PAGE_ID}/subscribed_apps" \
  -d "subscribed_fields=${FIELDS}" \
  -d "access_token=${TOKEN}" | python3 -m json.tool

echo ""
echo "Subscribed fields: ${FIELDS}"
