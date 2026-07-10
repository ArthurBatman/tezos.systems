#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = path.join(ROOT, 'data/nakamoto-sources.json');
const CHAINSPECT_URL = 'https://chainspect.app/chain/tezos-ecosystem';
const CHAINSPECT_DASHBOARD_URL = 'https://chainspect.app/dashboard/decentralization';
const EDI_CSV_URL = 'https://blockchainlab.inf.ed.ac.uk/edi-dashboard/output/consensus/tezos/output_clustered.csv';

const MANUAL_SOURCES = [
  {
    id: 'coinclear',
    name: 'CoinClear',
    provenance: 'secondary-report',
    sourceUrl: 'https://coinclear.io/layer1/tezos',
    dataAsOf: '2026-02-16',
    window: 'Not stated',
    resourceBasis: 'Not stated',
    entityBasis: 'Not stated',
    methodologyStatus: 'unspecified',
    metrics: [{
      key: 'reported_nc',
      label: 'Estimate',
      value: 8,
      displayValue: '~8',
      approximate: true,
      thresholdPct: null,
      thresholdBasis: 'unspecified',
      thresholdLabel: 'threshold unstated',
      population: null,
      populationLabel: ''
    }]
  }
];

function hasFlag(name) {
  return process.argv.includes(name);
}

function isoDateFromMs(value) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid timestamp ${value}`);
  return date.toISOString().slice(0, 10);
}

function stableRecordSignature(source) {
  return JSON.stringify({
    id: source?.id,
    dataAsOf: source?.dataAsOf,
    metrics: source?.metrics,
    historicalSnapshots: source?.historicalSnapshots
  });
}

function keepRetrievedAt(next, previous, now) {
  return {
    ...next,
    retrievedAt: previous && stableRecordSignature(previous) === stableRecordSignature(next)
      ? previous.retrievedAt
      : now
  };
}

async function readExisting() {
  try {
    return JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'tezos.systems Nakamoto source refresher/1.0' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

function parseChainspect(html, previous) {
  const payload = html.match(/decCalculated:new Date\((\d+)\),nc:\{value:(\d+)(?:\.\d+)?,change:[^}]+\},stakeOrHashrate:[\s\S]{0,300}?validatorsOrMiners:\{value:(\d+)/);
  if (!payload) throw new Error('Chainspect Tezos decentralization payload was not found');
  const [, calculatedMs, valueRaw, validatorsRaw] = payload;
  return {
    id: 'chainspect',
    name: 'Chainspect',
    provenance: 'publisher',
    sourceUrl: CHAINSPECT_DASHBOARD_URL,
    dataAsOf: isoDateFromMs(calculatedMs),
    window: 'Current provider snapshot',
    resourceBasis: 'Validator stake or voting power (provider wording)',
    entityBasis: 'Validators; operator clustering is not disclosed',
    methodologyStatus: 'opaque',
    metrics: [{
      key: 'reported_nc',
      label: 'Reported NC',
      value: Number(valueRaw),
      displayValue: String(Number(valueRaw)),
      approximate: false,
      thresholdPct: 33,
      thresholdBasis: 'source-claimed',
      thresholdLabel: '33% claimed',
      population: Number(validatorsRaw),
      populationLabel: 'validators'
    }],
    historicalSnapshots: previous?.historicalSnapshots || [
      {
        publisher: 'Merlin',
        value: 14,
        dataAsOf: '2026-04-28',
        derivedFrom: 'chainspect',
        sourceUrl: 'https://www.merlincrypto.com/blog/the-most-decentralized-cryptocurrencies-in-2026/'
      },
      {
        publisher: 'ThriveInMarkets',
        value: 13,
        dataAsOf: '2026-07-07',
        derivedFrom: 'chainspect',
        sourceUrl: 'https://thriveinmarkets.com/market-insights/top-blockchains-by-nakamoto-coefficient-2026-07/'
      }
    ]
  };
}

function parseCsvLine(line) {
  return line.split(',').map((value) => value.trim());
}

function parseEdi(csv) {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('EDI CSV did not include data rows');
  const headers = parseCsvLine(lines[0]);
  const values = parseCsvLine(lines.at(-1));
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  const number = (key) => {
    const value = Number(row[key]);
    if (!Number.isFinite(value)) throw new Error(`EDI CSV field ${key} is invalid`);
    return value;
  };
  const population = number('total_entities');
  return {
    id: 'edinburgh-edi',
    name: 'Edinburgh EDI',
    provenance: 'research-dataset',
    sourceUrl: EDI_CSV_URL,
    methodologyUrl: 'https://blockchainlab.inf.ed.ac.uk/edi-dashboard/',
    dataAsOf: row.date,
    window: '30-day block-production window',
    resourceBasis: 'Blocks produced',
    entityBasis: 'Clustered block producers',
    methodologyStatus: 'published',
    metrics: [
      ['tau_33', 'tau 33', number('tau_index=0.33'), 33],
      ['nakamoto_50', 'NC 50', number('nakamoto_coefficient'), 50],
      ['tau_66', 'tau 66', number('tau_index=0.66'), 66]
    ].map(([key, label, value, thresholdPct]) => ({
      key,
      label,
      value,
      displayValue: String(value),
      approximate: false,
      thresholdPct,
      thresholdBasis: 'calculated',
      thresholdLabel: `${thresholdPct}%`,
      population,
      populationLabel: 'clustered entities'
    }))
  };
}

function validateSource(source) {
  if (!source || typeof source !== 'object') throw new Error('Source must be an object');
  for (const key of ['id', 'name', 'sourceUrl', 'dataAsOf', 'methodologyStatus']) {
    if (!source[key]) throw new Error(`Source ${source.id || '(unknown)'} is missing ${key}`);
  }
  if (!/^https:\/\//.test(source.sourceUrl)) throw new Error(`Source ${source.id} must use an HTTPS URL`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.dataAsOf)) throw new Error(`Source ${source.id} has an invalid dataAsOf`);
  if (!Array.isArray(source.metrics) || !source.metrics.length) throw new Error(`Source ${source.id} has no metrics`);
  for (const metric of source.metrics) {
    if (!metric.key || !metric.label || !Number.isFinite(Number(metric.value))) {
      throw new Error(`Source ${source.id} has an invalid metric`);
    }
    if (metric.thresholdPct !== null && !Number.isFinite(Number(metric.thresholdPct))) {
      throw new Error(`Source ${source.id} has an invalid threshold`);
    }
  }
}

function validateArtifact(artifact) {
  if (artifact?.schemaVersion !== 1) throw new Error('Nakamoto source schemaVersion must be 1');
  if (!Array.isArray(artifact.sources) || artifact.sources.length < 3) throw new Error('Nakamoto source artifact must include at least three sources');
  artifact.sources.forEach(validateSource);
  const ids = artifact.sources.map((source) => source.id);
  for (const expected of ['chainspect', 'edinburgh-edi', 'coinclear']) {
    if (!ids.includes(expected)) throw new Error(`Nakamoto source artifact is missing ${expected}`);
  }
}

async function refreshSource({ id, previous, build }) {
  try {
    return await build();
  } catch (error) {
    if (!previous) throw error;
    console.warn(`warn - ${id} refresh failed; preserving last-known-good data: ${error.message}`);
    return previous;
  }
}

async function main() {
  const existing = await readExisting();
  if (hasFlag('--check')) {
    validateArtifact(existing);
    console.log('ok - Nakamoto source artifact is valid');
    return;
  }

  const previousById = new Map((existing?.sources || []).map((source) => [source.id, source]));
  const [chainspect, edi] = await Promise.all([
    refreshSource({
      id: 'Chainspect',
      previous: previousById.get('chainspect'),
      build: async () => parseChainspect(await fetchText(CHAINSPECT_URL), previousById.get('chainspect'))
    }),
    refreshSource({
      id: 'Edinburgh EDI',
      previous: previousById.get('edinburgh-edi'),
      build: async () => parseEdi(await fetchText(EDI_CSV_URL))
    })
  ]);
  const now = new Date().toISOString();
  const sources = [chainspect, edi, ...MANUAL_SOURCES].map((source) => (
    keepRetrievedAt(source, previousById.get(source.id), now)
  ));
  const changed = JSON.stringify(sources.map(stableRecordSignature)) !== JSON.stringify((existing?.sources || []).map(stableRecordSignature));
  const artifact = {
    schemaVersion: 1,
    updatedAt: changed || !existing?.updatedAt ? now : existing.updatedAt,
    sources
  };
  validateArtifact(artifact);
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)} (${changed ? 'source data changed' : 'no metric changes'})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
