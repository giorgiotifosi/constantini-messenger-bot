#!/bin/sh
# Check if your Page is subscribed to this app's webhooks.
# Usage: PAGE_ACCESS_TOKEN=xxx PAGE_ID=xxx ./scripts/check-page-subscription.sh

set -e

TOKEN="${PAGE_ACCESS_TOKEN:?Set PAGE_ACCESS_TOKEN}"
PAGE_ID="${PAGE_ID:?Set PAGE_ID}"

echo "Checking subscribed apps for Page ${PAGE_ID}..."
curl -sS \
  "https://graph.facebook.com/v22.0/${PAGE_ID}/subscribed_apps?access_token=${TOKEN}" \
  | python3 -m json.tool
