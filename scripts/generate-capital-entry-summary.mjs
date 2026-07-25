#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PATH = 'data/capital-snapshot.json';
const OUTPUT_PATH = 'data/capital-entry-summary.json';
const SOURCE_FILE = path.join(ROOT, SOURCE_PATH);
const OUTPUT_FILE = path.join(ROOT, OUTPUT_PATH);
const DAY_MS = 24 * 60 * 60 * 1000;
const ENTRY_HISTORY_DAYS = 90;
const MAX_OUTPUT_BYTES = 16 * 1024;

function hasFlag(name) {
  return process.argv.includes(name);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableHash(value) {
  return sha256(JSON.stringify(stableValue(value)));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateSource(snapshot) {
  assert(snapshot?.schemaVersion === 1, 'Capital snapshot schemaVersion 1 is required');
  assert(Number.isFinite(Date.parse(snapshot?.generatedAt || '')), 'Capital snapshot generatedAt must be an ISO timestamp');
  assert(/^[0-9a-f]{64}$/.test(snapshot?.contentHash || ''), 'Capital snapshot contentHash must be a SHA-256 digest');
  const { contentHash: ignored, ...unsigned } = snapshot;
  assert(stableHash(unsigned) === snapshot.contentHash, 'Capital snapshot contentHash does not match its unsigned payload');
  for (const id of ['tezos', 'etherlink']) {
    const chain = snapshot.defi?.chains?.find((row) => row?.id === id);
    assert(Number.isFinite(chain?.tvl?.currentUsd), `Capital snapshot is missing ${id} current TVL`);
    assert(Number.isFinite(chain?.stablecoins?.currentUsd), `Capital snapshot is missing ${id} current stablecoin value`);
  }
  assert(Number.isFinite(snapshot.markets?.xtz?.coin?.currentPriceUsd), 'Capital snapshot is missing the current XTZ/USD quote');
  assert(Number.isFinite(snapshot.markets?.xtz?.coin?.change24hPct), 'Capital snapshot is missing the XTZ 24-hour return');
  const history = snapshot.markets?.xtz?.priceHistory?.usd;
  assert(Array.isArray(history) && history.length, 'Capital snapshot is missing XTZ/USD price history');
}

function entryPriceHistory(rows) {
  const normalized = rows
    .map((row) => ({
      date: row?.date,
      timestamp: Date.parse(row?.date),
      value: Number(row?.value)
    }))
    .filter((row) => row.date && Number.isFinite(row.timestamp) && Number.isFinite(row.value))
    .sort((a, b) => a.timestamp - b.timestamp);
  assert(normalized.length, 'Capital snapshot has no usable XTZ/USD price points');
  const cutoff = normalized.at(-1).timestamp - (ENTRY_HISTORY_DAYS * DAY_MS);
  return normalized
    .filter((row) => row.timestamp >= cutoff)
    .map(({ date, value }) => ({ date, value }));
}

function buildProjection(snapshot, sourceText) {
  const chains = ['tezos', 'etherlink'].map((id) => {
    const source = snapshot.defi.chains.find((row) => row.id === id);
    return {
      id,
      tvl: { currentUsd: source.tvl.currentUsd },
      stablecoins: { currentUsd: source.stablecoins.currentUsd }
    };
  });
  const coin = snapshot.markets.xtz.coin;
  const unsigned = {
    schemaVersion: 1,
    generatedAt: snapshot.generatedAt,
    source: {
      path: SOURCE_PATH,
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      contentHash: snapshot.contentHash,
      fileSha256: sha256(sourceText)
    },
    defi: { chains },
    markets: {
      xtz: {
        coin: {
          currentPriceUsd: coin.currentPriceUsd,
          change24hPct: coin.change24hPct
        },
        priceHistory: {
          usd: entryPriceHistory(snapshot.markets.xtz.priceHistory.usd)
        }
      }
    }
  };
  return {
    schemaVersion: unsigned.schemaVersion,
    generatedAt: unsigned.generatedAt,
    contentHash: stableHash(unsigned),
    source: unsigned.source,
    defi: unsigned.defi,
    markets: unsigned.markets
  };
}

function validateProjection(projection, byteLength) {
  assert(projection?.schemaVersion === 1, 'Capital entry summary schemaVersion 1 is required');
  assert(Number.isFinite(Date.parse(projection?.generatedAt || '')), 'Capital entry summary generatedAt must be an ISO timestamp');
  assert(/^[0-9a-f]{64}$/.test(projection?.contentHash || ''), 'Capital entry summary contentHash must be a SHA-256 digest');
  const { contentHash: ignored, ...unsigned } = projection;
  assert(stableHash(unsigned) === projection.contentHash, 'Capital entry summary contentHash does not match its unsigned payload');
  assert(projection.source?.path === SOURCE_PATH, `Capital entry summary source must be ${SOURCE_PATH}`);
  assert(/^[0-9a-f]{64}$/.test(projection.source?.contentHash || ''), 'Capital entry summary source contentHash is invalid');
  assert(/^[0-9a-f]{64}$/.test(projection.source?.fileSha256 || ''), 'Capital entry summary source fileSha256 is invalid');
  assert(projection.markets?.xtz?.priceHistory?.usd?.length >= 89, 'Capital entry summary must retain the trailing 90-day XTZ/USD chart input');
  assert(byteLength <= MAX_OUTPUT_BYTES, `Capital entry summary is ${byteLength} bytes; maximum is ${MAX_OUTPUT_BYTES}`);
}

async function main() {
  const sourceText = await fs.readFile(SOURCE_FILE, 'utf8');
  const snapshot = JSON.parse(sourceText);
  validateSource(snapshot);
  const projection = buildProjection(snapshot, sourceText);
  const outputText = `${JSON.stringify(projection, null, 2)}\n`;
  validateProjection(projection, Buffer.byteLength(outputText));

  if (hasFlag('--check')) {
    const existing = await fs.readFile(OUTPUT_FILE, 'utf8');
    assert(existing === outputText, `${OUTPUT_PATH} is stale; run node scripts/generate-capital-entry-summary.mjs`);
    console.log(`ok - Capital entry summary matches ${SOURCE_PATH} (${Buffer.byteLength(outputText)} bytes, ${projection.contentHash.slice(0, 12)})`);
    return;
  }

  await fs.writeFile(OUTPUT_FILE, outputText);
  console.log(`Wrote ${OUTPUT_PATH} (${Buffer.byteLength(outputText)} bytes, ${projection.contentHash.slice(0, 12)})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
