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
| `SAVED_TEMPLATE_LABEL` | Yes | Meta Inbox label name (default: `სამზარეულო bot 30 ფოტო`) |
| `KITCHEN_IMAGE_URLS` | Yes* | 1–30 image URLs: comma/newline-separated, or JSON array |
| `SAVED_TEMPLATE_ECHO_TEXT` | No | Text the Page sends with saved reply (defaults to label name) |
| `KITCHEN_TEXT_TRIGGER` | No | Optional: also send when customer types this word |
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
4. Subscribe to webhook fields:
   - **messages**
   - **messaging_referrals** — Click-to-Messenger ads (Ads Manager Chat builder)
   - **message_echoes** — Page saved reply (optional)
   - **inbox_labels** — Page Inbox label (optional)
5. **Ads Manager Chat builder** (your screenshot): connect this app to the Page in the ad’s Messenger settings, then set referral ref `kitchen30` in the ad (if available) and add `MESSENGER_AD_REF=kitchen30` on Vercel. Or set `MESSENGER_AD_SEND_ON_ALL=true` while testing a single kitchen ad.
6. Ensure your app is in **Live** mode (or add testers).

### How triggering works

| Source | Bot behavior |
|--------|--------------|
| User opens Messenger from your **Click-to-Messenger ad** | Sends album (`messaging_referrals`, `source: ADS`) |
| Inbox label **სამზარეულო bot 30 ფოტო** | Sends album (`inbox_labels`) |
| Page sends saved reply with template text | Sends album (`message_echoes`) |
| Customer types trigger word | Only if `KITCHEN_TEXT_TRIGGER` is set |

**Note:** The Chat builder template name in Ads Manager is **not** sent in the webhook. Meta sends `ad_id`, `ref`, and `ad_title` instead — use `MESSENGER_AD_REF` or `MESSENGER_AD_IDS`.

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
