#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_FILE = path.join(ROOT, 'llms.txt');
const OPENAPI_FILE = path.join(ROOT, '.well-known', 'openapi.json');
const PROTOCOL_DATA_FILE = path.join(ROOT, 'data', 'protocol-data.json');

async function loadSiteMapModule() {
  const source = await fs.readFile(path.join(ROOT, 'js/core/site-map.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

function absoluteSiteUrl(href) {
  const url = new URL(href, 'https://tezos.systems');
  url.hash = '';
  return url.toString();
}

function oneLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export async function renderLlmsTxt() {
  const [{ SITE_MAP, siteMapSitemapEntries }, openApiText, protocolDataText] = await Promise.all([
    loadSiteMapModule(),
    fs.readFile(OPENAPI_FILE, 'utf8'),
    fs.readFile(PROTOCOL_DATA_FILE, 'utf8')
  ]);
  const openApi = JSON.parse(openApiText);
  const protocolData = JSON.parse(protocolDataText);
  const destinationDetails = new Map(SITE_MAP.map((entry) => [entry.id, entry.detail]));
  const destinations = siteMapSitemapEntries();
  const dataEntries = Object.entries(openApi.paths || {})
    .map(([dataPath, pathItem]) => ({ dataPath, operation: pathItem.get }))
    .filter(({ operation }) => operation)
    .sort((a, b) => a.dataPath.localeCompare(b.dataPath));

  const lines = [
    '# Tezos Systems',
    '',
    '> A source-backed, live Tezos dashboard and public research archive built by Primate.',
    '',
    'Tezos Systems presents Tezos L1 and Etherlink network activity, governance, staking, bakers, protocol history, markets, recognition archives, personal browser-local tools, and reproducible public datasets. Live surfaces disclose their source and freshness; a failed refresh retains the last complete reading rather than presenting partial data as current.',
    '',
    '## Canonical destinations',
    ''
  ];

  for (const destination of destinations) {
    const detail = destinationDetails.get(destination.id)
      || destinationDetails.get(destination.parentId)
      || 'A canonical Tezos Systems destination.';
    lines.push(`- [${oneLine(destination.title)}](${absoluteSiteUrl(destination.href)}): ${oneLine(detail)}`);
  }

  for (const protocol of protocolData.protocols || []) {
    const slug = String(protocol?.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) continue;
    const title = protocol.history?.title || `${protocol.name} Protocol`;
    const detail = protocol.history?.subtitle || protocol.headline || 'A Protocol Anthology chapter.';
    lines.push(`- [${oneLine(title)}](${absoluteSiteUrl(`/anthology/${slug}/`)}): ${oneLine(detail)}`);
  }

  lines.push('', '## Public JSON data', '');
  for (const { dataPath, operation } of dataEntries) {
    const cadence = oneLine(operation['x-refresh-cadence']);
    const license = oneLine(operation['x-license-boundary']);
    const label = oneLine(operation.summary);
    const destination = dataPath.includes('{')
      ? `${label} — path template: \`${dataPath}\``
      : `[${label}](${absoluteSiteUrl(dataPath)})`;
    lines.push(`- ${destination}: ${oneLine(operation.description)} Cadence: ${cadence}. Licence boundary: ${license}`);
  }

  lines.push(
    '',
    '## Sources, attribution, and licence boundary',
    '',
    '- Primary data sources include TzKT, Octez RPC, Teztale, CoinGecko, Tezos Domains, OBJKT, Etherlink sources, Supabase history, and source links carried by individual artifacts.',
    '- Tezos Systems is built by Primate, the baker behind Baking Benjamins and a co-founding member of Tez Capital. Tez Capital provides RPC infrastructure used by the project.',
    '- [Source code](https://github.com/Primate411/tezos.systems) is distributed under [MPL-2.0](https://tezos.systems/LICENSE).',
    '- [NOTICE](https://tezos.systems/NOTICE) defines the data boundary: CC BY 4.0 applies only to original selection, arrangement, and commentary to the extent Primate owns those rights; underlying facts and third-party data retain their source terms.',
    '- [OpenAPI catalogue](https://tezos.systems/.well-known/openapi.json) is the machine-readable inventory for the JSON artifacts above.',
    ''
  );

  return lines.join('\n');
}

export async function writeLlmsTxt() {
  const rendered = await renderLlmsTxt();
  await fs.writeFile(OUTPUT_FILE, rendered);
  return rendered;
}

async function main() {
  const rendered = await renderLlmsTxt();
  if (process.argv.includes('--check')) {
    const existing = await fs.readFile(OUTPUT_FILE, 'utf8');
    assert.equal(existing, rendered, 'llms.txt is stale; run node scripts/generate-llms-txt.mjs');
    console.log('llms.txt is current');
    return;
  }
  await fs.writeFile(OUTPUT_FILE, rendered);
  console.log('Wrote llms.txt from canonical site map and OpenAPI catalogue');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
