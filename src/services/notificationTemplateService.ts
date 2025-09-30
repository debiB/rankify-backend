export interface NotificationTemplate {
  subject: string;
  emailBody: string;
  whatsappMessage: string;
}

export class NotificationTemplateService {
  /**
   * Generate notification template preview for milestone messages
   */
  static generateMilestoneTemplate(
    campaignName: string = '[Campaign Name]',
    milestoneType: string = '[Position X / X clicks]',
    value: number | string = '[Value]',
    keyword?: string,
    achievedDate?: Date
  ): NotificationTemplate {
    const dateStr = achievedDate ? achievedDate.toLocaleDateString() : new Date().toLocaleDateString();
    const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/campaigns/[campaign-id]`;
    
    // Email subject
    const subject = `Milestone Reached – Month ${new Date().getMonth() + 1}`;
    
    // Email body
    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px;">🎉 Milestone Achieved!</h1>
        </div>
        
        <div style="padding: 20px; background: #f9f9f9;">
          <h2 style="color: #333; margin-top: 0;">Campaign: ${campaignName}</h2>
          
          ${keyword ? `<p><strong>🔍 Keyword:</strong> ${keyword}</p>` : ''}
          
          <p><strong>🎯 Achievement:</strong> ${milestoneType}</p>
          <p><strong>📈 Value:</strong> ${value}</p>
          <p><strong>📅 Date:</strong> ${dateStr}</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${dashboardUrl}" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              🔗 View Dashboard
            </a>
          </div>
          
          <p style="text-align: center; color: #666; margin-top: 30px;">
            Congratulations! We have reached the milestone for ${milestoneType} as of ${dateStr}.
          </p>
          
          <p style="text-align: center; color: #666; margin-top: 30px;">
            ✨ Keep up the great work!
          </p>
        </div>
        
        <div style="background: #333; color: white; padding: 10px; text-align: center; font-size: 12px;">
          Rank Ranger - SEO Campaign Management
        </div>
      </div>
    `;
    
    // WhatsApp message
    let whatsappMessage = `🎉 *Milestone Achieved!*\n\n`;
    whatsappMessage += `📊 *Campaign:* ${campaignName}\n`;
    
    if (keyword) {
      whatsappMessage += `🔍 *Keyword:* ${keyword}\n`;
    }
    
    whatsappMessage += `🎯 *Achievement:* ${milestoneType}\n`;
    whatsappMessage += `📈 *Value:* ${value}\n`;
    whatsappMessage += `📅 *Date:* ${dateStr}\n`;
    whatsappMessage += `\nCongratulations! We have reached the milestone for ${milestoneType} as of ${dateStr}.\n`;
    whatsappMessage += `\n🔗 *View Dashboard:* ${dashboardUrl}`;
    whatsappMessage += `\n\n✨ Keep up the great work!`;
    
    return {
      subject,
      emailBody,
      whatsappMessage,
    };
  }

  /**
   * Generate template preview with sample data
   */
  static generateSampleTemplate(): NotificationTemplate {
    return this.generateMilestoneTemplate(
      'Sample SEO Campaign',
      'Position 1',
      1,
      'best seo tools',
      new Date()
    );
  }
}
