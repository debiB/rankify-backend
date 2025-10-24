import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { SlackService } from '../services/slackService';

const router = Router();

// Simple helper to detect paid UTM
const isPaidUtm = (utmSource?: string | null, utmMedium?: string | null): boolean => {
  const paidMediums = new Set(['cpc', 'ppc', 'paid', 'paid_social', 'display', 'ads', 'affiliate']);
  const paidSources = new Set(['google_ads', 'facebook_ads', 'meta_ads', 'bing_ads', 'tiktok_ads']);
  const medium = (utmMedium || '').toLowerCase();
  const source = (utmSource || '').toLowerCase();
  return paidMediums.has(medium) || paidSources.has(source);
};

// Optional simple signature verification (shared secret)
const verifySignature = (req: any): boolean => {
  const secret = process.env.WP_WEBHOOK_SECRET;
  if (!secret) return true; // if no secret set, allow (environment controlled)
  const header = req.header('x-wp-signature') || req.header('x-signature');
  return header === secret;
};

router.post('/wordpress', async (req, res) => {
  try {
    if (!verifySignature(req)) {
      return res.status(401).json({ ok: false, error: 'Invalid signature' });
    }

    const {
      name,
      email,
      phone,
      created,
      utm_source,
      utm_medium,
      utm_campaign,
      star_rating,
      is_deal_closed,
      deal_amount,
    } = req.body || {};

    // Require at least name and one contact (email or phone)
    if (!name || (!email && !phone)) {
      return res
        .status(400)
        .json({ ok: false, error: 'name and at least one of email or phone are required' });
    }

    // Drop paid UTM
    if (isPaidUtm(utm_source, utm_medium)) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'paid_utm' });
    }

    const submittedAt = created ? new Date(created) : undefined;

    // Deduplicate: skip if a recent lead (10 min window) exists with same email or phone
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const existing = await prisma.lead.findFirst({
      where: {
        AND: [
          { createdAt: { gte: tenMinutesAgo } },
          {
            OR: [
              email ? { email } : undefined,
              phone ? { phone } : undefined,
            ].filter(Boolean) as any,
          },
        ],
      },
    });
    if (existing) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'duplicate_recent', id: existing.id });
    }

    const starRating =
      star_rating !== undefined && star_rating !== null && !isNaN(Number(star_rating))
        ? Math.max(1, Math.min(5, Math.round(Number(star_rating))))
        : undefined;
    const dealAmount =
      deal_amount !== undefined && deal_amount !== null && !isNaN(Number(deal_amount))
        ? Number(deal_amount)
        : undefined;
    const isDealClosed =
      typeof is_deal_closed === 'boolean'
        ? is_deal_closed
        : typeof is_deal_closed === 'string'
        ? is_deal_closed.toLowerCase() === 'true'
        : undefined;

    // Persist lead
    const lead = await prisma.lead.create({
      data: {
        name,
        email,
        phone,
        source: 'organic',
        starRating,
        isDealClosed: isDealClosed ?? false,
        dealAmount,
        utmSource: utm_source,
        utmMedium: utm_medium,
        utmCampaign: utm_campaign,
        submittedAt,
      },
    });

    // Notify Slack
    await SlackService.sendLeadNotification({
      name: lead.name,
      email: lead.email,
      phone: lead.phone ?? undefined,
      source: lead.source,
      starRating: lead.starRating ?? undefined,
      isDealClosed: lead.isDealClosed,
      // workCompleted not editable yet via webhook; remains default
      dealAmount: lead.dealAmount ?? undefined,
      utmSource: lead.utmSource ?? undefined,
      utmMedium: lead.utmMedium ?? undefined,
      utmCampaign: lead.utmCampaign ?? undefined,
      createdAt: lead.submittedAt ?? lead.createdAt,
    });

    return res.status(201).json({ ok: true, id: lead.id });
  } catch (err) {
    console.error('WP webhook failed', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

export default router;
