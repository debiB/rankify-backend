const { CronService } = require('./dist/services/cronService');

async function testCronJobs() {
  console.log('🧪 Testing cron jobs...');

  const cronService = CronService.getInstance();

  // Test daily traffic job
  console.log('\n📅 Testing daily traffic job...');
  try {
    await cronService.triggerDailyTraffic();
    console.log('✅ Daily traffic job completed successfully');
  } catch (error) {
    console.error('❌ Daily traffic job failed:', error);
  }

  // Get cron status
  console.log('\n📊 Cron job status:');
  const status = cronService.getCronStatus();
  console.log(JSON.stringify(status, null, 2));
}

testCronJobs().catch(console.error);
