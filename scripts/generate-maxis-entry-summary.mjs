#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_FILE = path.join(ROOT, 'data/maxis-leaders.json');
const L2_GOVERNANCE_FILE = path.join(ROOT, 'data/maxis-l2-governance.json');
const MANIFEST_FILE = path.join(ROOT, 'data/maxis/manifest.json');
const OUTPUT_FILE = path.join(ROOT, 'data/maxis/entry-summary.json');
const OUTPUT_PATH = '/data/maxis/entry-summary.json';
const MAX_OUTPUT_BYTES = 24 * 1024;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function contentHash(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function textHash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJsonSource(file, publicPath) {
  const text = await fs.readFile(file, 'utf8');
  const value = JSON.parse(text);
  return {
    value,
    receipt: {
      path: publicPath,
      bytes: Buffer.byteLength(text),
      sha256: textHash(text),
      schema: Number(value?.schema) || null,
      generatedAt: value?.generatedAt || null
    }
  };
}

function sourceFileFromPublicPath(publicPath) {
  const relative = String(publicPath || '').replace(/^\/+/, '');
  const file = path.resolve(ROOT, relative);
  const maxisRoot = path.join(ROOT, 'data/maxis');
  if (!(file === maxisRoot || file.startsWith(`${maxisRoot}${path.sep}`))) {
    throw new Error(`Maxis entry summary source escapes data/maxis: ${publicPath}`);
  }
  return file;
}

function activeSeason(manifest) {
  const id = String(
    manifest?.activeSeasonId
    || manifest?.current?.seasonId
    || manifest?.current?.id
    || ''
  );
  return (manifest?.seasons || []).find((season) => String(season?.id || season?.seasonId || '') === id)
    || manifest?.seasons?.[0]
    || manifest?.current
    || null;
}

function currentSummaryPath(manifest, season) {
  const value = manifest?.current?.summaryPath
    || manifest?.current?.summaryUrl
    || season?.summaryPath
    || season?.summaryUrl;
  if (!value) throw new Error('Maxis manifest does not declare a current season summary path');
  const url = new URL(String(value), 'https://tezos.systems/');
  if (url.origin !== 'https://tezos.systems') {
    throw new Error(`Maxis current summary must be a first-party path: ${value}`);
  }
  return url.pathname;
}

function category(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/_maxi$/, '');
}

function rankingRows(data, lane) {
  const key = category(lane);
  const rankings = data?.rankings;
  if (Array.isArray(rankings)) {
    const group = rankings.find((entry) => category(entry?.category || entry?.lane || entry?.id) === key);
    if (Array.isArray(group)) return group;
    return group?.entries || group?.rows || group?.ranking || group?.rankings || [];
  }
  if (!rankings || typeof rankings !== 'object') return [];
  const directKey = Object.keys(rankings).find((candidate) => category(candidate) === key);
  const rows = directKey ? rankings[directKey] : [];
  if (Array.isArray(rows)) return rows;
  return rows?.entries || rows?.rows || rows?.ranking || rows?.rankings || [];
}

function compactLeader(entry, overrides = {}) {
  const source = { ...(entry || {}), ...overrides };
  return Object.fromEntries(Object.entries({
    category: category(source.category || source.lane),
    title: source.title || null,
    status: source.status || null,
    rank: Number(source.rank) || 1,
    address: source.address || source.account || source.wallet || null,
    alias: source.alias || null,
    name: source.name || null,
    displayName: source.displayName || null,
    windowKind: source.windowKind || source.window || source.clock || null
  }).filter(([, value]) => value !== null && value !== ''));
}

function uniqueRankedWalletCount(legacy, l2Governance) {
  const addresses = new Set();
  const add = (entry) => {
    const address = String(entry?.address || entry?.account || entry?.wallet || '').toLowerCase();
    if (address) addresses.add(address);
  };
  const categories = new Set([
    ...(legacy?.leaders || []).map((entry) => category(entry?.category || entry?.lane)),
    'l2_governance'
  ]);
  categories.forEach((lane) => {
    if (lane === 'l2_governance') {
      (l2Governance?.rankings || []).forEach(add);
      return;
    }
    rankingRows(legacy, lane).forEach(add);
  });
  return addresses.size;
}

function compactSeason(season) {
  if (!season || typeof season !== 'object') return null;
  return Object.fromEntries(Object.entries({
    id: season.id || season.seasonId || null,
    seasonId: season.seasonId || season.id || null,
    seasonOrdinal: season.seasonOrdinal ?? season.number ?? null,
    displayLabel: season.displayLabel || season.seasonLabel || season.title || null,
    protocolName: season.protocolName || (typeof season.protocol === 'string' ? season.protocol : season.protocol?.name) || null,
    status: season.status || null,
    activatedAt: season.activatedAt || season.startsAt || null,
    endsAt: season.endsAt || null,
    estimatedEnd: season.estimatedEnd || null,
    endsWhen: season.endsWhen || null,
    summaryPath: season.summaryPath || season.summaryUrl || null
  }).filter(([, value]) => value !== null && value !== ''));
}

function compactManifest(manifest) {
  const season = activeSeason(manifest);
  const seasons = (manifest?.seasons || []).map(compactSeason).filter(Boolean);
  return {
    generatedAt: manifest?.generatedAt || null,
    activeSeasonId: manifest?.activeSeasonId || season?.id || season?.seasonId || null,
    current: compactSeason({ ...(season || {}), ...(manifest?.current || {}) }),
    seasons: seasons.length ? seasons : [compactSeason(season)].filter(Boolean)
  };
}

function compactLegacy(legacy, l2Governance) {
  const l2Leader = compactLeader(l2Governance?.rankings?.[0], {
    category: 'l2_governance',
    title: 'L2 Governance Maxi',
    status: l2Governance?.rankings?.length ? 'ready' : 'empty',
    windowKind: 'all-time-active'
  });
  return {
    generatedAt: legacy?.generatedAt || null,
    staleAfterHours: Number(legacy?.staleAfterHours) || 48,
    rankedWalletCount: uniqueRankedWalletCount(legacy, l2Governance),
    leaders: [
      ...(legacy?.leaders || []).filter((entry) => category(entry?.category || entry?.lane) !== 'l2_governance').map(compactLeader),
      l2Leader
    ]
  };
}

function compactSummary(summary) {
  return {
    generatedAt: summary?.generatedAt || null,
    staleAfterHours: Number(summary?.staleAfterHours) || 48,
    season: compactSeason(summary?.season),
    passports: {
      indexedAddresses: Number(summary?.passports?.indexedAddresses || summary?.coverage?.indexedAddresses || 0)
    },
    leaders: (summary?.leaders || []).map(compactLeader)
  };
}

function validateSources({ legacy, l2Governance, manifest, summary, season, summaryPath }) {
  const errors = [];
  if (Number(legacy?.schema) !== 2 || !Array.isArray(legacy?.leaders) || !legacy?.rankings) {
    errors.push('ongoing Maxis source has an unsupported schema');
  }
  if (Number(l2Governance?.schema) !== 1
    || l2Governance?.kind !== 'maxis-l2-governance-careers'
    || l2Governance?.coverage?.status !== 'complete'
    || l2Governance?.coverage?.absenceMeansZero !== true
    || !Array.isArray(l2Governance?.rankings)) {
    errors.push('L2 Governance source is incomplete or unsupported');
  }
  if (Number(manifest?.schema) !== 1 || !manifest?.activeSeasonId || !season) {
    errors.push('season manifest has no active season');
  }
  const seasonId = String(season?.id || season?.seasonId || '');
  const summarySeasonId = String(summary?.season?.id || summary?.season?.seasonId || '');
  if (Number(summary?.schema) !== 1
    || !Array.isArray(summary?.leaders)
    || !summary?.passports
    || !seasonId
    || summarySeasonId !== seasonId) {
    errors.push(`current season summary ${summaryPath} does not match the active manifest season`);
  }
  if (errors.length) throw new Error(`Cannot build Maxis entry summary: ${errors.join('; ')}`);
}

function validateProjection(document, byteLength) {
  const errors = [];
  if (Number(document?.schema) !== 1) errors.push('schema must be 1');
  if (document?.kind !== 'maxis-entry-summary') errors.push('kind must be maxis-entry-summary');
  if (!Number.isFinite(Date.parse(document?.generatedAt || ''))) errors.push('generatedAt must be an ISO timestamp');
  if (!Array.isArray(document?.payload?.legacy?.leaders)) errors.push('payload legacy leaders are missing');
  if (!Number.isInteger(document?.payload?.legacy?.rankedWalletCount)
    || document.payload.legacy.rankedWalletCount < 0) errors.push('payload ranked wallet count is missing');
  if (!Array.isArray(document?.payload?.manifest?.seasons)) errors.push('payload manifest seasons are missing');
  if (!Array.isArray(document?.payload?.summary?.leaders)) errors.push('payload season leaders are missing');
  if (!Number.isInteger(byteLength) || byteLength > MAX_OUTPUT_BYTES) {
    errors.push(`projection is ${byteLength} bytes; maximum is ${MAX_OUTPUT_BYTES}`);
  }
  const expectedCategories = new Set(['transaction', 'collector', 'artist', 'minter', 'defi', 'gaming', 'governance', 'l2_governance', 'staking', 'unicorn']);
  const actualCategories = new Set((document?.payload?.legacy?.leaders || []).map((entry) => entry.category));
  expectedCategories.forEach((lane) => {
    if (!actualCategories.has(lane)) errors.push(`ongoing projection is missing ${lane}`);
  });
  const receipts = document?.sourceReceipts;
  for (const key of ['legacy', 'l2Governance', 'manifest', 'currentSeasonSummary']) {
    const receipt = receipts?.[key];
    if (!receipt?.path || !Number.isInteger(receipt?.bytes) || receipt.bytes <= 0 || !/^[a-f0-9]{64}$/.test(receipt?.sha256 || '')) {
      errors.push(`${key} source receipt is invalid`);
    }
  }
  const { integrity, ...unsigned } = document || {};
  if (integrity?.algorithm !== 'sha256-stable-json-v1' || integrity?.contentHash !== contentHash(unsigned)) {
    errors.push('projection integrity hash is invalid');
  }
  return errors;
}

async function buildProjection() {
  const [legacy, l2Governance, manifest] = await Promise.all([
    readJsonSource(LEGACY_FILE, '/data/maxis-leaders.json'),
    readJsonSource(L2_GOVERNANCE_FILE, '/data/maxis-l2-governance.json'),
    readJsonSource(MANIFEST_FILE, '/data/maxis/manifest.json')
  ]);
  const season = activeSeason(manifest.value);
  const summaryPath = currentSummaryPath(manifest.value, season);
  const summary = await readJsonSource(sourceFileFromPublicPath(summaryPath), summaryPath);
  validateSources({
    legacy: legacy.value,
    l2Governance: l2Governance.value,
    manifest: manifest.value,
    summary: summary.value,
    season,
    summaryPath
  });
  const generatedAt = [
    legacy.value?.generatedAt,
    l2Governance.value?.generatedAt,
    manifest.value?.generatedAt,
    summary.value?.generatedAt
  ].filter(Boolean).sort().at(-1);
  const unsigned = {
    schema: 1,
    kind: 'maxis-entry-summary',
    generatedAt,
    outputPath: OUTPUT_PATH,
    sourceReceipts: {
      legacy: legacy.receipt,
      l2Governance: l2Governance.receipt,
      manifest: manifest.receipt,
      currentSeasonSummary: summary.receipt
    },
    payload: {
      legacy: compactLegacy(legacy.value, l2Governance.value),
      manifest: compactManifest(manifest.value),
      summary: compactSummary(summary.value)
    }
  };
  return {
    ...unsigned,
    integrity: {
      algorithm: 'sha256-stable-json-v1',
      contentHash: contentHash(unsigned)
    }
  };
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temporary, jsonText(value));
  await fs.rename(temporary, file);
}

async function main() {
  const projection = await buildProjection();
  const expected = jsonText(projection);
  const errors = validateProjection(projection, Buffer.byteLength(expected));
  if (errors.length) throw new Error(`Invalid Maxis entry summary: ${errors.join('; ')}`);
  if (process.argv.includes('--check')) {
    const actual = await fs.readFile(OUTPUT_FILE, 'utf8');
    if (actual !== expected) {
      throw new Error('data/maxis/entry-summary.json is stale; run node scripts/generate-maxis-entry-summary.mjs');
    }
    console.log(`Maxis entry summary is current (${Buffer.byteLength(actual).toLocaleString('en-US')} bytes)`);
    return;
  }
  await writeJsonAtomic(OUTPUT_FILE, projection);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_FILE)} (${Buffer.byteLength(expected).toLocaleString('en-US')} bytes)`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
