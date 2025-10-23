# WordPress Organic Leads Webhook

Brief guide to capture organic leads from WordPress into Rankify and notify Slack.

## Overview
- **Endpoint**: `POST /webhooks/wordpress`
- **Purpose**: Store organic leads and send a Slack notification.
- **Skips paid UTM**: If UTM medium/source indicates paid traffic, the lead is not stored or sent to Slack.

## Environment variables
Add these to `rankify-backend/.env`:

```dotenv
# Slack Incoming Webhook URL (channel that will receive new-lead notifications)
SLACK_LEADS_WEBHOOK_URL=https://hooks.slack.com/services/...
# Optional shared secret to verify incoming WP webhook requests
WP_WEBHOOK_SECRET=my_super_secret_1234dflkafajsdfhlaskjdf
```

> Keep these values private. Do not commit real secrets or webhook URLs.

## How to obtain SLACK_LEADS_WEBHOOK_URL
1. Go to your Slack workspace apps: https://api.slack.com/apps
2. Click **Create New App** → **From scratch** → name it (e.g., "Leads Bot").
3. In the left sidebar, select **Incoming Webhooks** → toggle **Activate Incoming Webhooks** ON.
4. Click **Add New Webhook to Workspace** → pick the channel → **Allow**.
5. Copy the generated URL (looks like `https://hooks.slack.com/services/...`).
6. Set it as `SLACK_LEADS_WEBHOOK_URL` in `.env`.

## How to set WP_WEBHOOK_SECRET
- Choose any sufficiently random string and set `WP_WEBHOOK_SECRET` in `.env`.
- Configure your WordPress webhook sender to include this value in a header:
  - Header name (supported): `x-wp-signature` or `x-signature`.
- The backend will reject requests whose header value doesn’t match the secret (if the secret is set).

## WordPress → Backend integration
- Send a `POST` request to: `{BACKEND_URL}/webhooks/wordpress` with JSON body.
- Required fields: `name`, `email`.
- Optional fields: `phone`, `created`, `utm_source`, `utm_medium`, `utm_campaign`, `star_rating` (1–5), `is_deal_closed` (boolean or 'true'/'false'), `deal_amount` (number).

Example payload:
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+1-555-0000",
  "created": "2025-10-23T06:30:00Z",
  "utm_source": "blog",
  "utm_medium": "organic",
  "utm_campaign": "october-seo",
  "star_rating": 5,
  "is_deal_closed": "false",
  "deal_amount": 0
}
```

Example cURL:
```bash
curl -X POST "$BACKEND_URL/webhooks/wordpress" \
  -H "Content-Type: application/json" \
  -H "x-wp-signature: $WP_WEBHOOK_SECRET" \
  -d '{
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+1-555-0000",
    "created": "2025-10-23T06:30:00Z",
    "utm_source": "blog",
    "utm_medium": "organic",
    "utm_campaign": "october-seo",
    "star_rating": 5,
    "is_deal_closed": "false",
    "deal_amount": 0
  }'
```

## Paid UTM skip logic
- The request is skipped (HTTP 200 with `{ skipped: true, reason: 'paid_utm' }`) if:
  - `utm_medium` is one of: `cpc`, `ppc`, `paid`, `paid_social`, `display`, `ads`, `affiliate`, or
  - `utm_source` is one of: `google_ads`, `facebook_ads`, `meta_ads`, `bing_ads`, `tiktok_ads`.

## Slack message format
- Title: `New Organic Lead`
- Includes: Name, Email, Phone (if present), Source, Created timestamp, UTM (if present), Rating (if present), Deal Amount (if present), Deal Closed (if present).

## Backend requirements
1. Install dependencies and generate Prisma client:
   - `npm install`
   - `npm run db:generate`
2. Ensure DB has the `Lead` table (dev):
   - `npm run db:push` (or use migrations with `npm run db:migrate`)
3. Start the server:
   - `npm run dev` (or build and start)

## Troubleshooting
- "Property 'lead' does not exist": run `npm run db:generate` and restart your IDE/TS server.
- 401 Invalid signature: ensure `x-wp-signature` matches `WP_WEBHOOK_SECRET`, or unset the env to disable verification.
- No Slack messages: verify `SLACK_LEADS_WEBHOOK_URL` is set and the channel allows posts from your app.
