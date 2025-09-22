export class NotificationTemplateService {
  static generateEmailTemplate(data: {
    campaignName: string;
    keywordChanges: Array<{
      keyword: string;
      oldPosition: number;
      newPosition: number;
      change: 'improved' | 'declined';
    }>;
    totalKeywords: number;
    improvedCount: number;
    declinedCount: number;
  }): { subject: string; html: string; text: string } {
    const { campaignName, keywordChanges, totalKeywords, improvedCount, declinedCount } = data;
    
    const subject = `Rank Update: ${campaignName} - ${improvedCount} improved, ${declinedCount} declined`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Ranking Update for ${campaignName}</h2>
        
        <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Summary</h3>
          <p><strong>Total Keywords:</strong> ${totalKeywords}</p>
          <p><strong>Improved:</strong> <span style="color: #10B981;">${improvedCount}</span></p>
          <p><strong>Declined:</strong> <span style="color: #EF4444;">${declinedCount}</span></p>
        </div>
        
        ${keywordChanges.length > 0 ? `
        <h3>Keyword Changes</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f8f9fa;">
              <th style="padding: 12px; text-align: left; border: 1px solid #dee2e6;">Keyword</th>
              <th style="padding: 12px; text-align: center; border: 1px solid #dee2e6;">Old Position</th>
              <th style="padding: 12px; text-align: center; border: 1px solid #dee2e6;">New Position</th>
              <th style="padding: 12px; text-align: center; border: 1px solid #dee2e6;">Change</th>
            </tr>
          </thead>
          <tbody>
            ${keywordChanges.map(change => `
              <tr>
                <td style="padding: 12px; border: 1px solid #dee2e6;">${change.keyword}</td>
                <td style="padding: 12px; text-align: center; border: 1px solid #dee2e6;">${change.oldPosition}</td>
                <td style="padding: 12px; text-align: center; border: 1px solid #dee2e6;">${change.newPosition}</td>
                <td style="padding: 12px; text-align: center; border: 1px solid #dee2e6;">
                  <span style="color: ${change.change === 'improved' ? '#10B981' : '#EF4444'};">
                    ${change.change === 'improved' ? '↗' : '↘'} ${Math.abs(change.newPosition - change.oldPosition)}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ` : ''}
        
        <p style="margin-top: 30px; color: #666; font-size: 14px;">
          This is an automated notification from Rank Ranger.
        </p>
      </div>
    `;
    
    const text = `
Ranking Update for ${campaignName}

Summary:
- Total Keywords: ${totalKeywords}
- Improved: ${improvedCount}
- Declined: ${declinedCount}

${keywordChanges.length > 0 ? `
Keyword Changes:
${keywordChanges.map(change => 
  `${change.keyword}: ${change.oldPosition} → ${change.newPosition} (${change.change === 'improved' ? '+' : '-'}${Math.abs(change.newPosition - change.oldPosition)})`
).join('\n')}
` : ''}

This is an automated notification from Rank Ranger.
    `;
    
    return { subject, html, text };
  }
  
  static generateWhatsAppTemplate(data: {
    campaignName: string;
    totalKeywords: number;
    improvedCount: number;
    declinedCount: number;
    topChanges: Array<{
      keyword: string;
      oldPosition: number;
      newPosition: number;
      change: 'improved' | 'declined';
    }>;
  }): string {
    const { campaignName, totalKeywords, improvedCount, declinedCount, topChanges } = data;
    
    let message = `🔔 *Rank Update: ${campaignName}*\n\n`;
    message += `📊 *Summary:*\n`;
    message += `• Total Keywords: ${totalKeywords}\n`;
    message += `• Improved: ${improvedCount} 📈\n`;
    message += `• Declined: ${declinedCount} 📉\n\n`;
    
    if (topChanges.length > 0) {
      message += `🔝 *Top Changes:*\n`;
      topChanges.slice(0, 5).forEach(change => {
        const emoji = change.change === 'improved' ? '📈' : '📉';
        const changeValue = Math.abs(change.newPosition - change.oldPosition);
        message += `${emoji} ${change.keyword}: ${change.oldPosition} → ${change.newPosition} (${change.change === 'improved' ? '+' : '-'}${changeValue})\n`;
      });
    }
    
    message += `\n_Automated notification from Rank Ranger_`;
    
    return message;
  }
  
  static generateMilestoneTemplate(
    campaignName?: string,
    milestoneType?: string,
    value?: number | string,
    keyword?: string,
    date?: Date
  ): { subject: string; html: string; text: string } {
    const campaign = campaignName || 'Sample Campaign';
    const milestone = milestoneType || 'position_improvement';
    const val = value || 5;
    const kw = keyword || 'sample keyword';
    const dateStr = date ? date.toLocaleDateString() : new Date().toLocaleDateString();
    
    const subject = `Milestone Alert: ${campaign} - ${milestone}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Milestone Alert for ${campaign}</h2>
        
        <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Milestone Details</h3>
          <p><strong>Type:</strong> ${milestone}</p>
          <p><strong>Keyword:</strong> ${kw}</p>
          <p><strong>Value:</strong> ${val}</p>
          <p><strong>Date:</strong> ${dateStr}</p>
        </div>
        
        <p style="margin-top: 30px; color: #666; font-size: 14px;">
          This is an automated milestone notification from Rank Ranger.
        </p>
      </div>
    `;
    
    const text = `
Milestone Alert for ${campaign}

Milestone Details:
- Type: ${milestone}
- Keyword: ${kw}
- Value: ${val}
- Date: ${dateStr}

This is an automated milestone notification from Rank Ranger.
    `;
    
    return { subject, html, text };
  }
  
  static generateSampleTemplate(): { subject: string; html: string; text: string } {
    return this.generateMilestoneTemplate(
      'Sample Campaign',
      'Position Improvement',
      5,
      'sample keyword',
      new Date()
    );
  }
}
