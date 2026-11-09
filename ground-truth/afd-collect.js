#!/usr/bin/env node
// Ground truth, source: NOAA Area Forecast Discussion (observed-forecaster
// narrative, not a model field).
//
//   node ground-truth/afd-collect.js record
//   node ground-truth/afd-collect.js report --days=3
//
// GSP (Greenville-Spartanburg office) covers the Blue Ridge Parkway sites.
// Issued ~4x/day by a human forecaster; often states cloud-trend confidence
// in plain language a single model field can't ("models disagree on timing
// of clearing"). Stored as raw text plus a cheap keyword tag for quick
// scanning — this is NOT an attempt at real NLP summarization, just enough
// to flag discussions worth reading by hand. See
// docs/ground-truth-data-plan-2026-11-08.md.
const { q, n, sql, rows } = require('./db');

const OFFICE = process.env.FF_AFD_OFFICE || 'GSP';
const UA = 'skymagic.app/1.0 ground-truth research (jw@earlyasset.com)';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS afd_products (
  product_id    TEXT PRIMARY KEY,
  office        TEXT    NOT NULL,
  issuance_ms   INTEGER NOT NULL,
  fetched_ms    INTEGER NOT NULL,
  text          TEXT    NOT NULL,
  cloud_keywords TEXT             -- comma-joined hits, cheap relevance flag
);
`;

// Not NLP — just flags discussions worth a human read. Deliberately small and
// literal; expand only if it proves too noisy or too quiet in practice.
const KEYWORDS = [
  'clearing', 'breaks developing', 'models disagree', 'low confidence',
  'high confidence', 'cloud deck', 'overcast', 'broken clouds', 'undercast',
  'sunset', 'sunrise', 'fog', 'low stratus', 'cu field', 'cumulus',
];

function tag(text) {
  const lower = text.toLowerCase();
  return KEYWORDS.filter(k => lower.includes(k));
}

async function latestProductId() {
  const res = await fetch(`https://api.weather.gov/products?type=AFD&location=${OFFICE}&limit=1`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`products list: HTTP ${res.status}`);
  const body = await res.json();
  return body['@graph']?.[0] || null;
}

async function record() {
  sql(SCHEMA);
  const head = await latestProductId();
  if (!head) return console.log('No AFD product found.');
  const existing = rows(`SELECT 1 FROM afd_products WHERE product_id = ${q(head.id)}`);
  if (existing.length) return console.log(`${head.id}: already have this issuance (${head.issuanceTime})`);

  const res = await fetch(`https://api.weather.gov/products/${head.id}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`product fetch: HTTP ${res.status}`);
  const body = await res.json();
  const text = body.productText || '';
  const hits = tag(text);
  const fetchedMs = Date.now();
  const issuanceMs = new Date(head.issuanceTime).getTime();
  sql(
    `INSERT INTO afd_products (product_id, office, issuance_ms, fetched_ms, text, cloud_keywords) VALUES (` +
    [q(head.id), q(OFFICE), n(issuanceMs), n(fetchedMs), q(text), q(hits.join(', '))].join(', ') +
    `);`
  );
  console.log(`${head.id}: new issuance ${head.issuanceTime} — keywords: ${hits.join(', ') || '(none)'}`);
}

function report(opts) {
  const since = Date.now() - (opts.days || 3) * 86400000;
  const products = rows(`SELECT product_id, issuance_ms, cloud_keywords FROM afd_products WHERE office=${q(OFFICE)} AND issuance_ms > ${n(since)} ORDER BY issuance_ms`);
  if (!products.length) return console.log(`No AFD rows for ${OFFICE} in the last ${opts.days || 3} day(s). Run 'record' first.`);
  console.log(`\n${OFFICE} AFD — ${products.length} issuance(s)\n`);
  for (const p of products) {
    console.log(`  ${new Date(p.issuance_ms).toISOString().slice(0, 16)}  ${p.cloud_keywords || '(no keyword hits)'}`);
  }
}

const cmd = process.argv[2] || 'record';
const opts = {};
for (let i = 3; i < process.argv.length; i++) {
  const m = process.argv[i].match(/^--([^=]+)=(.*)$/);
  if (m) opts[m[1]] = /^\d+$/.test(m[2]) ? +m[2] : m[2];
}
if (cmd === 'record') record().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
else if (cmd === 'report') report(opts);
else { console.error(`Unknown command '${cmd}'. Use: record | report`); process.exit(1); }
