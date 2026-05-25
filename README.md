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
| `MESSENGER_AD_IDS` | Yes | Comma-separated ad IDs allowed to send photos |
| `MESSENGER_AD_REF` | No | Optional ref param (must match ad Advanced ref) |
| `MESSENGER_AD_TITLE_KEYWORD` | No | Optional: match `ad_title` from webhook |
| `MESSENGER_AD_SEND_ON_ALL` | No | `true` = all ads (default is **specific ads only**) |
| `SAVED_TEMPLATE_LABEL` | No | Inbox label name (optional) |
| `KITCHEN_IMAGE_URLS` | Yes* | 1–30 image URLs: comma/newline-separated, or JSON array |
| `SAVED_TEMPLATE_ECHO_TEXT` | No | Text the Page sends with saved reply (defaults to label name) |
| `KITCHEN_TEXT_TRIGGER` | No | Optional: send when customer **types** this word (off by default) |
| `MESSENGER_AD_GREETING_ECHO` | No | `false` to disable send on Chat builder greeting (default **on**) |
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
   - Open the template → **Advanced** (if shown) → **Connect an app** → select this app.
   - Without **Connect app**, Meta sends the greeting itself; your bot only sees webhooks when the **customer replies** (any text → album by default).
6. **Page must use this app**: Meta App → Messenger → connect your Facebook Page (Generate token for that Page).
7. Subscribe the Page to webhooks (Graph API Explorer):

```http
POST /{PAGE_ID}/subscribed_apps?subscribed_fields=messages,message_echoes,messaging_referrals,messaging_optins,messaging_postbacks
```

8. App in **Live** mode (or add testers).

### Chat builder: 30 photos on chat open (no reply)

The template name `სამზარეულო bot 30 ფოტო` is **not** sent to the bot. When someone clicks **Send message** on the ad:

1. Meta shows the Chat builder greeting (text only).
2. Meta sends **`messaging_referrals`** (`source: ADS`) = chat opened.
3. The bot sends the **30-photo album** automatically (~30–60 s). **No customer message required.**

Run once to link Page + webhooks:

```bash
PAGE_ACCESS_TOKEN=xxx PAGE_ID=xxx ./scripts/subscribe-page.sh
```

In Chat builder → template → **Advanced** → **Connect an app** → select this app.

### Allowed ads only

Photos send **only** if the webhook `ad_id` is listed in `MESSENGER_AD_IDS`, or `ref` matches `MESSENGER_AD_REF`.

Find ad ID in Ads Manager: open the ad → URL contains `selected_ad_ids=**123456789**` or use the numeric ad ID from the ad editor.

```bash
MESSENGER_AD_IDS=111111111,222222222
```

Other Click-to-Messenger ads → **no photos** (logged as `Referral ignored`).

### How triggering works

| Source | Bot behavior |
|--------|--------------|
| **Listed ad** click → chat opens | `messaging_referrals` → photos immediately (no tap) |
| Chat builder greeting (Page echo) | Default **on** — send when thread opens (`message_echoes`) |
| Other ads | Ignored (unless `MESSENGER_AD_SEND_ON_ALL=true`) |
| Button / quick reply `სამზარეულო` | **Ignored** (no send on tap) |
| Customer types keyword | Off unless you set `KITCHEN_TEXT_TRIGGER` |
| Inbox label | Optional (`inbox_labels`) |

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
