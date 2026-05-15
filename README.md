# Constantini Messenger Bot

Next.js webhook bot for [Meta Facebook Messenger](https://developers.facebook.com/docs/messenger-platform). When a user sends **სამზარეულო**, the bot replies with three image messages via the [Send API](https://developers.facebook.com/docs/messenger-platform/send-messages).

## Requirements

- Node.js 18+
- A Facebook Page connected to a Meta app with Messenger enabled
- Public HTTPS URL (Vercel provides this automatically)

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PAGE_ACCESS_TOKEN` | Yes | Page access token from Meta Developer Console |
| `VERIFY_TOKEN` | Yes | Any secret string you choose; must match webhook setup |
| `KITCHEN_IMAGE_URL_1` | Yes* | Public HTTPS URL for image 1 |
| `KITCHEN_IMAGE_URL_2` | Yes* | Public HTTPS URL for image 2 |
| `KITCHEN_IMAGE_URL_3` | Yes* | Public HTTPS URL for image 3 |

\* Required when users send the trigger word. Images must be reachable by Meta’s servers (HTTPS, no auth).

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
4. Subscribe to webhook fields: at minimum **messages**.
5. Ensure your app is in **Live** mode (or add testers) so real users can message the Page.

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
vercel env add KITCHEN_IMAGE_URL_1
vercel env add KITCHEN_IMAGE_URL_2
vercel env add KITCHEN_IMAGE_URL_3
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
   - `KITCHEN_IMAGE_URL_1`
   - `KITCHEN_IMAGE_URL_2`
   - `KITCHEN_IMAGE_URL_3`
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
  messenger.js           # Send API helpers + trigger logic
```

## Testing

1. Open your Page in Messenger and send a message to the Page.
2. Send exactly: `სამზარეულო`
3. You should receive three image messages in order.

Check Vercel **Functions → Logs** if messages are not delivered.
