/*
  Usage:
    node scripts/sliceCheck.js --file "debug/gsc_keywords_raw_sc-domain_ebook-pro.com_20250701-20250913.json" \
      --query "תרגום ספרים לאנגלית" \
      --page "https://ebook-pro.com/%D7%AA%D7%A8%D7%92%D7%95%D7%9D-%D7%9E%D7%A2%D7%91%D7%A8%D7%99%D7%AA-%D7%9C%D7%90%D7%A0%D7%92%D7%9C%D7%99%D7%AA/" \
      --start 2025-08-24 --end 2025-08-31
*/

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--file') result.file = args[++i];
    else if (a === '--query') result.query = args[++i];
    else if (a === '--page') result.page = args[++i];
    else if (a === '--start') result.start = args[++i];
    else if (a === '--end') result.end = args[++i];
  }
  if (
    !result.file ||
    !result.query ||
    !result.page ||
    !result.start ||
    !result.end
  ) {
    console.error('Missing required args. See header for usage.');
    process.exit(1);
  }
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
  return json.rows;
}

function toNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function inRange(date, start, end) {
  return date >= start && date <= end;
}

function main() {
  const { file, query, page, start, end } = parseArgs();
  const rows = readJson(file);

  const filtered = rows.filter((row) => {
    if (!row || !Array.isArray(row.keys) || row.keys.length < 3) return false;
    const date = row.keys[0];
    const q = row.keys[1];
    const p = row.keys[2] || '';
    return q === query && p === page && inRange(date, start, end);
  });

  let totalImpr = 0;
  let totalClicks = 0;
  let posImprWeightedSum = 0;

  for (const row of filtered) {
    const impr = toNumber(row.impressions);
    const clk = toNumber(row.clicks);
    const pos = toNumber(row.position);
    totalImpr += impr;
    totalClicks += clk;
    posImprWeightedSum += pos * impr;
  }

  const avgPos = totalImpr > 0 ? posImprWeightedSum / totalImpr : 0;
  console.log('Slice diagnostics:');
  console.log({
    start,
    end,
    query,
    page,
    rows: filtered.length,
    impressions: totalImpr,
    clicks: totalClicks,
    position: Number(avgPos.toFixed(2)),
  });
}

main();
