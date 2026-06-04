# Constantini Messenger Bot

Next.js webhook bot for [Meta Facebook Messenger](https://developers.facebook.com/docs/messenger-platform). When a chat gets the Meta Inbox label **სამზარეულო bot 30 ფოტო** (or the Page sends that saved reply), the bot sends up to **30 images in one album** via the [Send API](https://developers.facebook.com/docs/messenger-platform/send-messages).

## Requirements

- Node.js 18+
- A Facebook Page connected to a Meta app with Messenger enabled
- Public HTTPS URL (Vercel provides this automatically)

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PAGE_ACCESS_TOKEN` | Yes | Page access token from Meta Developer Console |
| `VERIFY_TOKEN` | Yes | Any secret string you choose; must match webhook setup |
| `KITCHEN_BUTTON_LABEL` | No | Kitchen button (default **სამზარეულო**) → `KITCHEN_IMAGE_URLS` album |
| `SOFT_FURNITURE_BUTTON_LABEL` | No | Soft furniture button (default **რბილი ავეჯი**) → `SOFT_FURNITURE_IMAGE_URLS` album |
| `SOFT_FURNITURE_IMAGE_URLS` | No* | Up to 30 divan photo URLs (same format as kitchen) |
| `MESSENGER_AD_IDS` | No | Optional: only these ad IDs trigger photos on **chat open** |
| `MESSENGER_AD_REF` | No | Optional ref param for chat-open filter |
| `MESSENGER_AD_TITLE_KEYWORD` | No | Optional: match `ad_title` from webhook |
| `MESSENGER_AD_SEND_ON_ALL` | No | `true` = photos on every ad chat open |
| `SAVED_TEMPLATE_LABEL` | No | Inbox label name (optional) |
| `KITCHEN_IMAGE_URLS` | Yes* | 1–30 image URLs: comma/newline-separated, or JSON array |
| `SAVED_TEMPLATE_ECHO_TEXT` | No | Text the Page sends with saved reply (defaults to label name) |
| `KITCHEN_TEXT_TRIGGER` | No | Alias for button label if customer types instead of taps |
| `KITCHEN_IMAGE_URL_1` … `_30` | Alt* | Optional numbered URLs instead of `KITCHEN_IMAGE_URLS` |

\* At least one image URL required. Meta allows max **30 images per message**. Prefer **JPG or PNG** for large albums.

Example:

```bash
KITCHEN_IMAGE_URLS=https://cdn.example.com/k1.jpg,https://cdn.example.com/k2.jpg
```

Copy `.env.example` to `.env.local` for local development:

```bash
cp .env.example .env.local
```

## Local development

```bash
npm install
npm run dev
```

Expose your local server with [ngrok](https://ngrok.com/) or similar:

```bash
ngrok http 3000
```

Use `https://<your-ngrok-host>/api/webhook` as the webhook URL in Meta.

## Meta app setup

1. Create an app at [developers.facebook.com](https://developers.facebook.com/) and add the **Messenger** product.
2. Connect your Facebook Page and generate a **Page access token** → set `PAGE_ACCESS_TOKEN`.
3. Under **Messenger → Settings → Webhooks**, click **Add Callback URL**:
   - **Callback URL**: `https://<your-domain>/api/webhook`
   - **Verify token**: same value as `VERIFY_TOKEN`
4. Subscribe to webhook fields (all required for Chat builder ads):
   - **messages**
   - **messaging_referrals**
   - **message_echoes** — when Meta sends the Chat builder greeting from your Page
   - **inbox_labels** (optional, for Inbox labels only)
5. **Ads Manager → Engagement ad → Chat builder**:
   - Add a button labeled **სამზარეულო** (or set `KITCHEN_BUTTON_LABEL`).
   - Subscribe to **messaging_postbacks** (included in subscribe script below).
   - **Connect an app** (Advanced) is optional — photos send when the user **taps the button**, no `MESSENGER_AD_IDS` required.
6. **Page must use this app**: Meta App → Messenger → connect your Facebook Page (Generate token for that Page).
7. Subscribe the Page to webhooks (Graph API Explorer):

```http
POST /{PAGE_ID}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_echoes,messaging_referrals,messaging_optins
```

8. App in **Live** mode (or add testers).

### Default: photos when user taps **სამზარეულო**

No `MESSENGER_AD_IDS` needed. When the customer taps the Chat builder button (or sends that text), the bot sends kitchen photos **one per message** (~1–2 min for 30).

Run once to link Page + webhooks:

```bash
PAGE_ACCESS_TOKEN=xxx PAGE_ID=xxx ./scripts/subscribe-page.sh
```

### Optional: photos on ad chat open

Set `MESSENGER_AD_IDS`, `MESSENGER_AD_REF`, or `MESSENGER_AD_SEND_ON_ALL=true` if you also want photos **before** the button tap (requires **Connect app** + `messaging_referrals`).

### How triggering works

| Source | Bot behavior |
|--------|--------------|
| Tap **სამზარეულო** | Kitchen album (`KITCHEN_IMAGE_URLS`) |
| Tap **რბილი ავეჯი** | Divan album (`SOFT_FURNITURE_IMAGE_URLS`) |
| Ad chat open | Only if `MESSENGER_AD_IDS` / ref / `MESSENGER_AD_SEND_ON_ALL` set |
| Greeting echo | Off (`MESSENGER_AD_GREETING_ECHO=true` to enable) |
| Inbox label | Optional (`inbox_labels`) |
| Any customer message | Off (`MESSENGER_SEND_ON_ANY_MESSAGE=true` to enable) |

### Preview / admin testing (photos work for you but not a friend)

| Situation | What happens |
|-----------|----------------|
| **Ads Manager → Preview** on a phone | Meta often **does not** call your webhook (or only shows the greeting). This is a Meta limitation, not a bot bug. |
| App in **Development** mode | Automated replies go only to people with a role on the **Meta app** (Admin / Developer / **Tester**). A **Page admin** who is not an **App Tester** may see no photos. |
| Photos only after **სამზარეულო** tap | Opening the chat alone is not enough if `MESSENGER_AD_IDS` is unset. The friend must **tap the button** (or type the same word). |

**Reliable test:** use a normal Facebook account (not only Page admin), open the **live** ad from the feed (not Preview), tap **სამზარეულო**, wait ~1–2 min for 30 messages.

**Fix for a Page-admin friend:** Meta Developer Console → your app → **App roles** → add their Facebook account as **Tester**, or switch the app to **Live** mode.

Check Vercel **Logs** when they tap: you should see `Kitchen button postback →` or `Postback ignored` with the real button title.

## Deploy to Vercel

### Option A: Vercel CLI

```bash
npm install -g vercel
vercel
```

Follow prompts to link the project. Then add environment variables:

```bash
vercel env add PAGE_ACCESS_TOKEN
vercel env add VERIFY_TOKEN
vercel env add KITCHEN_IMAGE_URLS
```

Redeploy so variables take effect:

```bash
vercel --prod
```

Production URL example: `https://constantini-messenger-bot.vercel.app`

- Webhook: `https://constantini-messenger-bot.vercel.app/api/webhook`
- Privacy policy (Meta **App settings → Basic**): `https://constantini-messenger-bot.vercel.app/privacy`

### Option B: Vercel Dashboard

1. Push this repo to GitHub (or GitLab/Bitbucket).
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Framework preset: **Next.js** (auto-detected).
4. Open **Settings → Environment Variables** and add:
   - `PAGE_ACCESS_TOKEN`
   - `VERIFY_TOKEN`
   - `KITCHEN_IMAGE_URLS` (or `KITCHEN_IMAGE_URL_1` … `_30`)
5. Deploy. Copy your production URL, e.g. `https://constantini-messenger-bot.vercel.app`.

### Configure Meta webhook after deploy

1. In Meta Developer Console → **Messenger → Webhooks**, set:
   - **Callback URL**: `https://<your-vercel-domain>/api/webhook`
   - **Verify token**: your `VERIFY_TOKEN` value
2. Click **Verify and Save**.
3. Subscribe your Page to **messages**.

## API routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/webhook` | Webhook verification (`hub.challenge`) |
| `POST` | `/api/webhook` | Incoming Messenger events |

## Project structure

```
app/
  api/webhook/route.js   # Webhook verification + message handling
  layout.js
  page.js
lib/
  messenger.js           # Send API + album upload
  triggers.js            # Label / saved reply matching
```

## Testing

1. Open your Page in Messenger and send a message to the Page.
2. In Page Inbox, assign the label **სამზარეულო bot 30 ფოტო** to the conversation (or send that saved reply).
3. The customer should receive one album with all configured images (up to 30).

Check Vercel **Functions → Logs** if messages are not delivered.
