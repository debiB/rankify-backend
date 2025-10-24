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
- Required fields: `name` and at least one contact: `email` or `phone`.
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

## De-duplication
- To avoid spam, submissions with the same `email` or `phone` within the last 10 minutes are skipped.
- Response: HTTP 200 with `{ ok: true, skipped: true, reason: 'duplicate_recent', id: '<existing_id>' }`.

## Slack message format
- Title: `New Organic Lead`
- Includes: Name, Email, Phone (if present), Source, Created timestamp, UTM (if present), Rating (if present), Work Status (`Completed`/`Not completed`), Deal Amount (if present), Deal Closed (if present).

### Example (human-readable)
```
New Organic Lead
Name: Dana Cohen
Email: dana@example.com
Phone: +972-50-111-2223
Source: organic
Created: 2025-10-20T09:15:00.000Z
Rating: 4/5
Work Status: Not completed
Deal Amount: 0
Deal Closed: No
```

## Backend requirements
1. Install dependencies and generate Prisma client:
   - `npm install`
   - `npm run db:generate`
2. Ensure DB has the `Lead` table (dev):
   - `npm run db:push` (or use migrations with `npm run db:migrate`)
3. Start the server:
   - `npm run dev` (or build and start)

## REST Leads API (for in-app listing and updates)

### GET /leads
- Query params: `page` (default 1), `limit` (default 10, max 100), `search` (optional; matches name/email/phone)
- Auth: Admin JWT in `Authorization: Bearer <TOKEN>`

Example cURL:
```bash
curl -X GET "${BACKEND_URL}/leads?page=1&limit=10&search=" \
  -H "Authorization: Bearer $ADMIN_JWT"
```

### PUT /leads/:id
- Body: any subset of `{ starRating (1–5), isDealClosed (boolean), workCompleted (boolean), dealAmount (>= 0) }`
- Auth: Admin JWT in `Authorization: Bearer <TOKEN>`

Example cURL:
```bash
curl -X PUT "${BACKEND_URL}/leads/<LEAD_ID>" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "starRating": 5,
    "isDealClosed": false,
    "workCompleted": false,
    "dealAmount": 0
  }'
```

## Test cURL recipes

### 1) Organic lead (should create + Slack)
```bash
curl -X POST "$BACKEND_URL/webhooks/wordpress" \
  -H "Content-Type: application/json" \
  -H "x-wp-signature: $WP_WEBHOOK_SECRET" \
  -d '{
    "name": "Dana Cohen",
    "email": "dana@example.com",
    "phone": "+972-50-111-2223",
    "created": "2025-10-20T09:15:00Z",
    "utm_source": "google",
    "utm_medium": "organic",
    "utm_campaign": "blog_post_x",
    "star_rating": 4,
    "is_deal_closed": false,
    "deal_amount": 0
  }'
```

### 2) Paid traffic (should skip)
```bash
curl -X POST "$BACKEND_URL/webhooks/wordpress" \
  -H "Content-Type: application/json" \
  -H "x-wp-signature: $WP_WEBHOOK_SECRET" \
  -d '{
    "name": "Paid User",
    "email": "paid@example.com",
    "utm_source": "google_ads",
    "utm_medium": "cpc"
  }'
```

### 3) Missing contact (should 400)
```bash
curl -X POST "$BACKEND_URL/webhooks/wordpress" \
  -H "Content-Type: application/json" \
  -H "x-wp-signature: $WP_WEBHOOK_SECRET" \
  -d '{
    "name": "No Contact",
    "utm_source": "google",
    "utm_medium": "organic"
  }'
```

### 4) Duplicate within 10 minutes (should skip as duplicate_recent)
Run the organic cURL twice within 10 minutes with the same email/phone.

### 5) List leads (admin)
```bash
curl -X GET "${BACKEND_URL}/leads?page=1&limit=10" \
  -H "Authorization: Bearer $ADMIN_JWT"
```

### 6) Update lead (admin)
```bash
curl -X PUT "${BACKEND_URL}/leads/<LEAD_ID>" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "starRating": 5,
    "isDealClosed": true,
    "workCompleted": true,
    "dealAmount": 1500
  }'
```

## Troubleshooting
- "Property 'lead' does not exist": run `npm run db:generate` and restart your IDE/TS server.
- 401 Invalid signature: ensure `x-wp-signature` matches `WP_WEBHOOK_SECRET`, or unset the env to disable verification.
- No Slack messages: verify `SLACK_LEADS_WEBHOOK_URL` is set and the channel allows posts from your app.
