import axios from 'axios';

export interface WhatsAppGroup {
  id: string;
  name: string;
  description?: string;
  participants?: number;
}

export interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class WhatsAppService {
  private readonly apiUrl = 'https://gate.whapi.cloud';
  private readonly token: string | undefined;

  constructor() {
    this.token = process.env.WHAPI_TOKEN || undefined;
  }

  /**
   * Get all WhatsApp groups from Whapi API
   */
  async getGroups(): Promise<WhatsAppGroup[]> {
    if (!this.token || this.token.startsWith('your_')) {
      // Gracefully handle missing token by returning empty list
      return [];
    }
    try {
      const response = await axios.get(`${this.apiUrl}/groups`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.data && response.data.groups) {
        return response.data.groups.map((group: any) => ({
          id: group.id,
          name: group.name || group.subject || 'Unnamed Group',
          description: group.description || group.desc,
          participants: group.participants?.length || 0,
        }));
      }

      return [];
    } catch (error) {
      console.error('Error fetching WhatsApp groups:', error);
      throw new Error('Failed to fetch WhatsApp groups');
    }
  }

  /**
   * Send a text message to a WhatsApp group
   */
  async sendMessage(
    groupId: string,
    message: string
  ): Promise<SendMessageResponse> {
    if (!this.token || this.token.startsWith('your_')) {
      return {
        success: false,
        error: 'WHAPI_TOKEN not configured',
      };
    }
    try {
      const response = await axios.post(
        `${this.apiUrl}/messages/text`,
        {
          to: groupId,
          body: message,
        },
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data && response.data.sent) {
        return {
          success: true,
          messageId: response.data.id,
        };
      }

      return {
        success: false,
        error: 'Message not sent - unknown error',
      };
    } catch (error: any) {
      console.error('Error sending WhatsApp message:', error);
      return {
        success: false,
        error:
          error.response?.data?.message ||
          error.message ||
          'Failed to send message',
      };
    }
  }

  /**
   * Validate if a group ID exists and is accessible
   */
  async validateGroup(groupId: string): Promise<boolean> {
    if (!this.token || this.token.startsWith('your_')) {
      return false;
    }
    try {
      const groups = await this.getGroups();
      return groups.some((group) => group.id === groupId);
    } catch (error) {
      console.error('Error validating WhatsApp group:', error);
      return false;
    }
  }

  /**
   * Format milestone message for WhatsApp
   */
  formatMilestoneMessage(
    campaignName: string,
    milestoneType: string,
    milestoneValue: number | string,
    keyword?: string,
    dashboardUrl?: string,
    achievedDate?: Date
  ): string {
    const dateStr = achievedDate
      ? achievedDate.toLocaleDateString()
      : new Date().toLocaleDateString();

    let message = `🎉 *Milestone Achieved!*\n\n`;
    message += `📊 *Campaign:* ${campaignName}\n`;

    if (keyword) {
      message += `🔍 *Keyword:* ${keyword}\n`;
    }

    message += `🎯 *Achievement:* ${milestoneType}\n`;
    message += `📈 *Value:* ${milestoneValue}\n`;
    message += `📅 *Date:* ${dateStr}\n`;

    if (dashboardUrl) {
      message += `\n🔗 *View Dashboard:* ${dashboardUrl}`;
    }

    message += `\n\n✨ Keep up the great work!`;

    return message;
  }
}
