const fs = require('fs');

function toNumber(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function main() {
  const file =
    'debug/gsc_keywords_raw_sc-domain_ebook-pro.com_20250701-20250913.json';
  const keyword = 'תרגום ספר לאנגלית';
  const startDate = '2025-07-24';
  const endDate = '2025-07-31';

  console.log(
    `Analyzing keyword: "${keyword}" from ${startDate} to ${endDate}`
  );
  console.log('='.repeat(60));

  const json = JSON.parse(fs.readFileSync(file, 'utf8'));

  // Filter rows for the specific keyword and date range
  const filteredRows = json.rows.filter((row) => {
    if (!row || !Array.isArray(row.keys) || row.keys.length < 3) return false;
    const date = row.keys[0];
    const q = row.keys[1];

    const dateMatch = date >= startDate && date <= endDate;
    const queryMatch = q === keyword;

    return dateMatch && queryMatch;
  });

  console.log(
    `Found ${filteredRows.length} rows for this keyword in date range`
  );

  if (filteredRows.length === 0) {
    console.log('No data found for this keyword/date combination');
    return;
  }

  // Group by page and calculate total impressions per page
  const pageImpressions = {};
  const pageData = {};

  filteredRows.forEach((row) => {
    const page = row.keys[2];
    const impressions = toNumber(row.impressions);
    const clicks = toNumber(row.clicks);
    const position = toNumber(row.position);

    if (!pageImpressions[page]) {
      pageImpressions[page] = 0;
      pageData[page] = {
        totalImpressions: 0,
        totalClicks: 0,
        weightedPositionSum: 0,
        days: 0,
      };
    }

    pageImpressions[page] += impressions;
    pageData[page].totalImpressions += impressions;
    pageData[page].totalClicks += clicks;
    pageData[page].weightedPositionSum += position * impressions;
    pageData[page].days++;
  });

  // Sort pages by total impressions
  const sortedPages = Object.entries(pageImpressions).sort(
    ([, a], [, b]) => b - a
  );

  // Show all pages for debugging
  console.log('\nALL PAGES:');
  console.log('-'.repeat(60));
  sortedPages.forEach(([page, totalImpressions], index) => {
    const data = pageData[page];
    const avgPosition =
      data.totalImpressions > 0
        ? data.weightedPositionSum / data.totalImpressions
        : 0;

    console.log(`${index + 1}. ${page}`);
    console.log(`   Total Impressions: ${totalImpressions}`);
    console.log(`   Average Position: ${avgPosition.toFixed(2)}`);
    console.log(`   Total Clicks: ${data.totalClicks}`);
    console.log(`   Days with data: ${data.days}`);
    console.log('');
  });

  // Show only the top page
  if (sortedPages.length > 0) {
    const [topPage, topImpressions] = sortedPages[0];
    const topData = pageData[topPage];
    const topAvgPosition =
      topData.totalImpressions > 0
        ? topData.weightedPositionSum / topData.totalImpressions
        : 0;

    console.log('\nTOP PAGE:');
    console.log('='.repeat(60));
    console.log(`Page: ${topPage}`);
    console.log(`Total Impressions: ${topImpressions}`);
    console.log(`Average Position: ${topAvgPosition.toFixed(2)}`);
    console.log(`Total Clicks: ${topData.totalClicks}`);
    console.log(`Days with data: ${topData.days}`);
  }
}

main();
