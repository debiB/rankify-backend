import axios from 'axios';

export interface LeadPayload {
  name: string;
  email: string;
  phone?: string | null;
  source: string;
  starRating?: number | null;
  isDealClosed?: boolean;
  dealAmount?: number | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  createdAt?: Date | string;
}

export class SlackService {
  private static getWebhookUrl(): string | undefined {
    return process.env.SLACK_LEADS_WEBHOOK_URL;
  }

  static async sendLeadNotification(lead: LeadPayload): Promise<void> {
    const url = this.getWebhookUrl();
    if (!url) {
      console.warn('SLACK_LEADS_WEBHOOK_URL is not set; skipping Slack notification');
      return;
    }

    const lines: string[] = [];
    lines.push(`New Organic Lead`);
    lines.push(`Name: ${lead.name}`);
    lines.push(`Email: ${lead.email}`);
    if (lead.phone) lines.push(`Phone: ${lead.phone}`);
    lines.push(`Source: ${lead.source}`);
    const created = lead.createdAt ? new Date(lead.createdAt).toISOString() : new Date().toISOString();
    lines.push(`Created: ${created}`);
    const utm = [lead.utmSource, lead.utmMedium, lead.utmCampaign].filter(Boolean).join('/');
    if (utm) lines.push(`UTM: ${utm}`);
    if (typeof lead.starRating === 'number') lines.push(`Rating: ${lead.starRating}/5`);
    if (typeof lead.dealAmount === 'number') lines.push(`Deal Amount: ${lead.dealAmount}`);
    if (typeof lead.isDealClosed === 'boolean') lines.push(`Deal Closed: ${lead.isDealClosed ? 'Yes' : 'No'}`);

    try {
      await axios.post(url, {
        text: lines.join('\n'),
      });
    } catch (err) {
      console.error('Failed to send Slack lead notification', err);
    }
  }
}
