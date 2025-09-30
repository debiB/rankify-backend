#!/usr/bin/env tsx

/**
 * Test script to verify cannibalization optimization fixes
 */

import { keywordCannibalizationService } from '../services/keywordCannibalization';

async function testCannibalizationOptimization() {
  console.log('🧪 Testing Cannibalization Optimization Fixes\n');

  // Test campaign ID (replace with actual campaign ID)
  const campaignId = 'test-campaign-id';
  
  // Test date ranges
  const testRanges = [
    {
      name: 'Last 7 days',
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate: new Date()
    },
    {
      name: 'Last 30 days', 
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate: new Date()
    },
    {
      name: 'Last 3 months',
      startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      endDate: new Date()
    }
  ];

  console.log('📊 Testing getCannibalizationResults with different date ranges:\n');

  for (const range of testRanges) {
    console.log(`Testing ${range.name}:`);
    console.log(`  Date range: ${range.startDate.toISOString()} to ${range.endDate.toISOString()}`);
    
    try {
      const startTime = Date.now();
      const results = await keywordCannibalizationService.getCannibalizationResults(
        campaignId,
        10, // limit
        range.startDate,
        range.endDate
      );
      const endTime = Date.now();
      
      console.log(`  ✅ Query completed in ${endTime - startTime}ms`);
      console.log(`  Results: ${results ? `Found audit with ${results.results?.length || 0} cannibalization issues` : 'No audit data found'}`);
      
      if (results) {
        console.log(`  Audit period: ${results.startDate} to ${results.endDate}`);
        console.log(`  Total keywords analyzed: ${results.totalKeywords || 'N/A'}`);
      }
      
    } catch (error) {
      console.log(`  ❌ Error: ${error}`);
    }
    
    console.log('');
  }

  console.log('🔄 Testing multiple rapid requests (simulating frontend behavior):\n');
  
  // Simulate rapid date range changes
  const rapidTestRange = testRanges[0];
  const promises = [];
  
  for (let i = 0; i < 5; i++) {
    promises.push(
      keywordCannibalizationService.getCannibalizationResults(
        campaignId,
        10,
        rapidTestRange.startDate,
        rapidTestRange.endDate
      )
    );
  }
  
  try {
    const startTime = Date.now();
    const results = await Promise.all(promises);
    const endTime = Date.now();
    
    console.log(`✅ 5 concurrent requests completed in ${endTime - startTime}ms`);
    console.log(`All requests returned same data: ${results.every(r => r?.id === results[0]?.id)}`);
    
  } catch (error) {
    console.log(`❌ Concurrent requests failed: ${error}`);
  }

  console.log('\n✨ Test completed!');
}

// Run the test
testCannibalizationOptimization().catch(console.error);
