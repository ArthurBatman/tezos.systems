#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEZOSCRP_RSS_URL,
  TEZOSCRP_SCHEMA_VERSION,
  buildTezosCrpSummary,
  mergeNewArticles,
  parseMediumRss,
  rebuildDerivedFields,
  validateTezosCrpDataset
} from './lib/tezoscrp-awards.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'data', 'tezoscrp-awards.json');
const SUMMARY_FILE = path.join(ROOT, 'data', 'tezoscrp-summary.json');

function hasFlag(name) {
  return process.argv.includes(name);
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function equalJson(left, right) {
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assertValid(dataset) {
  const errors = validateTezosCrpDataset(dataset);
  if (errors.length) throw new Error(`TezosCRP dataset validation failed:\n- ${errors.join('\n- ')}`);
}

function assertDerived(dataset) {
  const rebuilt = rebuildDerivedFields(dataset, dataset.generated_at);
  const fields = ['schema_version', 'program', 'coverage', 'category_summary', 'people_summary'];
  const drift = fields.filter((field) => !equalJson(dataset[field], rebuilt[field]));
  if (drift.length) throw new Error(`TezosCRP derived fields drifted: ${drift.join(', ')}. Run npm run refresh:tezoscrp -- --rebuild-only.`);
}

async function check(dataset) {
  assertValid(dataset);
  assertDerived(dataset);
  const expectedSummary = buildTezosCrpSummary(dataset);
  const actualSummary = await readJson(SUMMARY_FILE);
  if (!equalJson(actualSummary, expectedSummary)) throw new Error('data/tezoscrp-summary.json does not match the full TezosCRP dataset');
  console.log(`TezosCRP dataset valid: ${dataset.awards.length} awards, ${dataset.people_summary.length} identities, ${dataset.coverage.covered_periods} months`);
}

async function fetchRss() {
  const response = await fetch(TEZOSCRP_RSS_URL, {
    headers: { 'user-agent': 'tezos.systems TezosCRP archive updater (+https://tezos.systems/tezoscrp/)' },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Medium RSS returned HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const current = await readJson(DATA_FILE);
  if (hasFlag('--check')) {
    await check(current);
    return;
  }

  let next = current;
  let addedPeriods = [];
  if (hasFlag('--rebuild-only')) {
    next = rebuildDerivedFields(current, current.generated_at || new Date().toISOString());
  } else {
    const items = parseMediumRss(await fetchRss());
    const merged = mergeNewArticles(current, items);
    next = merged.dataset;
    addedPeriods = merged.addedPeriods;
  }

  if (next.schema_version !== TEZOSCRP_SCHEMA_VERSION) {
    next = rebuildDerivedFields(next, next.generated_at || new Date().toISOString());
  }
  assertValid(next);
  assertDerived(next);

  if (!equalJson(current, next)) await writeJson(DATA_FILE, next);
  const summary = buildTezosCrpSummary(next);
  let currentSummary = null;
  try { currentSummary = await readJson(SUMMARY_FILE); } catch { /* first build */ }
  if (!equalJson(currentSummary, summary)) await writeJson(SUMMARY_FILE, summary);

  if (addedPeriods.length) console.log(`Added TezosCRP award periods: ${addedPeriods.join(', ')}`);
  else console.log('No new TezosCRP winner article found; dataset remains current');
  await check(next);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
