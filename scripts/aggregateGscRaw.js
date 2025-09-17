/*
  Usage:
    node scripts/aggregateGscRaw.js --file "debug/gsc_keywords_raw_sc-domain_ebook-pro.com_20250701-20250913.json" \
      --queries "תרגום ספרים לאנגלית,תרגום ספר לאנגלית" \
      --months "2025-07,2025-08"

  This script reproduces our aggregation logic:
  - Group by (date, query), aggregate across pages with impressions-weighted position
  - Then aggregate daily → monthly with impressions-weighted position
*/

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--file') result.file = args[++i];
    else if (a === '--queries') result.queries = args[++i];
    else if (a === '--months') result.months = args[++i];
  }
  if (!result.file) {
    console.error('Missing --file path to the exported JSON');
    process.exit(1);
  }
  result.queries = (result.queries || 'תרגום ספרים לאנגלית,תרגום ספר לאנגלית')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  result.months = (result.months || '2025-07,2025-08')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return result;
}

function readJson(filePath) {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, 'utf8');
  const json = JSON.parse(raw);
  if (!json || !Array.isArray(json.rows)) {
    throw new Error('Invalid JSON structure: expected { rows: [...] }');
  }
  return json;
}

function isDateInMonth(dateStr, yyyyMm) {
  // yyyyMm format: YYYY-MM
  return dateStr.startsWith(yyyyMm + '-');
}

function toNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function aggregateMonthly(rows, months, queries) {
  // Step 1: Filter by target queries and months
  const filtered = rows.filter((row) => {
    if (!row || !Array.isArray(row.keys) || row.keys.length < 3) return false;
    const date = row.keys[0];
    const query = row.keys[1];
    if (!queries.includes(query)) return false;
    const inAnyMonth = months.some((m) => isDateInMonth(date, m));
    return inAnyMonth;
  });

  // Step 2: Determine best page per (month, query) by highest total impressions across the month
  const monthQueryPageImpr = new Map(); // key: `${month}__${query}__${page}` -> impressions sum
  for (const row of filtered) {
    const date = row.keys[0];
    const monthKey = date.slice(0, 7);
    const query = row.keys[1];
    const page = row.keys[2] || '';
    const impr = toNumber(row.impressions);
    const key = `${monthKey}__${query}__${page}`;
    monthQueryPageImpr.set(key, (monthQueryPageImpr.get(key) || 0) + impr);
  }

  const bestPageByMonthQuery = new Map(); // key: `${month}__${query}` -> page
  for (const m of months) {
    for (const q of queries) {
      let bestPage = '';
      let bestImpr = -1;
      for (const [key, impr] of monthQueryPageImpr.entries()) {
        const [mk, qq, page] = key.split('__');
        if (mk !== m || qq !== q) continue;
        if (impr > bestImpr) {
          bestImpr = impr;
          bestPage = page;
        }
      }
      bestPageByMonthQuery.set(`${m}__${q}`, bestPage);
    }
  }

  // Step 3: Aggregate monthly metrics using only the best page
  const results = [];
  for (const m of months) {
    for (const q of queries) {
      const bestPage = bestPageByMonthQuery.get(`${m}__${q}`) || '';
      let monthImpr = 0;
      let monthClicks = 0;
      let posImprWeightedSum = 0;

      for (const row of filtered) {
        const date = row.keys[0];
        const monthKey = date.slice(0, 7);
        const query = row.keys[1];
        const page = row.keys[2] || '';
        if (monthKey !== m || query !== q || page !== bestPage) continue;
        const impr = toNumber(row.impressions);
        const clk = toNumber(row.clicks);
        const pos = toNumber(row.position);
        monthImpr += impr;
        monthClicks += clk;
        posImprWeightedSum += pos * impr;
      }

      const position =
        monthImpr > 0 ? Number((posImprWeightedSum / monthImpr).toFixed(2)) : 0;
      results.push({
        month: m,
        query: q,
        bestPage,
        impressions: monthImpr,
        clicks: monthClicks,
        position,
      });
    }
  }

  return { results, diagnostics: { rawRowCount: filtered.length } };
}

function main() {
  const { file, queries, months } = parseArgs();
  const json = readJson(file);
  const { results, diagnostics } = aggregateMonthly(json.rows, months, queries);

  console.log('Diagnostics:', diagnostics);
  console.log('Monthly Results:');
  for (const r of results) {
    console.log(
      `${r.month} | ${r.query} | position=${r.position} | impressions=${
        r.impressions
      } | clicks=${r.clicks} | bestPage=${r.bestPage || ''}`
    );
  }
}

main();
