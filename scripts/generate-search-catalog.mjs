#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'data/search-catalog.json');

const MILESTONE_DESTINATIONS = {
  blocks: 'health',
  'funded-wallets': 'pulse',
  transactions: 'pulse',
  'smart-contracts': 'ecosystem',
  tokens: 'ecosystem',
  bakers: 'leaderboard',
  'tz4-adoption': 'tz4',
  staking: 'staking-chamber',
  burned: 'capital',
  cycle: 'health',
  'uptime-days': 'health',
  'protocol-upgrades': 'anthology',
  rollups: 'tezlink'
};

function parseArgs() {
  return { check: process.argv.includes('--check') };
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(ROOT, relativePath), 'utf8'));
}

async function loadSiteMapModule() {
  const source = await fs.readFile(path.join(ROOT, 'js/core/site-map.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

function strings(values, limit = 32) {
  const seen = new Set();
  const result = [];
  for (const value of values.flat(Infinity)) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function routeForEntry(siteMap, siteMapRoute, id, fallback = '/') {
  const entry = siteMap.find((candidate) => candidate.id === id);
  return entry ? siteMapRoute(entry) : fallback;
}

function ecosystemRows(data) {
  return (data.apps || []).map((app) => {
    const layers = app.layers || [];
    const layerIds = strings(layers.map((layer) => layer.id), 4);
    const aliases = strings([
      app.id,
      app.category,
      app.description,
      layers.flatMap((layer) => layer.contractSource?.aliasPatterns || []),
      layers.flatMap((layer) => layer.contractSource?.addresses || []),
      layers.flatMap((layer) => (layer.proofUrls || []).flatMap((url) => (
        String(url).match(/(?:KT1[1-9A-HJ-NP-Za-km-z]{33}|0x[a-fA-F0-9]{40})/g) || []
      )))
    ]);
    const params = new URLSearchParams();
    if (layerIds.length === 1) params.set('layer', layerIds[0]);
    params.set('app', app.id);
    return {
      id: `app:${app.id}`,
      kind: 'app',
      group: 'Reviewed ecosystem apps',
      title: app.name,
      detail: `${app.description} · ${layerIds.join(' + ')} · reviewed contract universe`,
      badge: layerIds.join('+') || 'app',
      href: `/ecosystem/?${params.toString()}`,
      aliases
    };
  });
}

function tezosCrpRows(data) {
  return (data.people_summary || []).map((person) => ({
    id: `tezoscrp:${person.person_id}`,
    kind: 'identity',
    group: 'TezosCRP identities',
    title: person.display_name,
    detail: `${Number(person.total_awards || 0).toLocaleString('en-US')} official category listings across ${Number(person.distinct_periods || 0).toLocaleString('en-US')} recognized months`,
    badge: 'official archive',
    href: `/tezoscrp/?view=archive&q=${encodeURIComponent(person.display_name)}`,
    aliases: strings([
      person.person_id,
      person.aliases || [],
      person.raw_names || [],
      Object.keys(person.categories || {})
    ])
  }));
}

function protocolDebateRows(debates, protocolData) {
  const knownProtocols = new Set((protocolData.protocols || []).map((protocol) => protocol.name));
  return (debates.debates || []).map((debate) => ({
    id: `debate:${String(debate.protocol).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    kind: 'history',
    group: 'Protocol debates',
    title: `${debate.protocol} debate`,
    detail: `${debate.outcome} · ${debate.stage} · ${debate.summary}`,
    badge: String(debate.outcome || 'history').toLowerCase(),
    href: knownProtocols.has(debate.protocol)
      ? `/#protocol=${encodeURIComponent(debate.protocol)}`
      : '/anthology/',
    aliases: strings([debate.protocol, debate.date, debate.stage, debate.outcome, debate.summary])
  }));
}

function milestoneRows(data, siteMap, siteMapRoute) {
  return Object.entries(data.tracks || {}).map(([id, track]) => {
    const label = id.replaceAll('-', ' ');
    const destination = MILESTONE_DESTINATIONS[id];
    return {
      id: `milestone:${id}`,
      kind: 'milestone',
      group: 'Network milestones',
      title: `${label.replace(/\b\w/g, (letter) => letter.toUpperCase())} milestones`,
      detail: `Current ${Number(track.current || 0).toLocaleString('en-US')} · next ${Number(track.nextTarget || 0).toLocaleString('en-US')}`,
      badge: 'network proof',
      href: routeForEntry(siteMap, siteMapRoute, destination, '/pulse/'),
      aliases: strings([
        id,
        label,
        track.current,
        track.nextTarget,
        (track.thresholds || []).map((value) => Number(value).toLocaleString('en-US'))
      ])
    };
  });
}

async function renderCatalog() {
  const [ecosystem, tezosCrp, debates, protocols, milestones, siteMapModule] = await Promise.all([
    readJson('data/ecosystem-apps.json'),
    readJson('data/tezoscrp-awards.json'),
    readJson('data/protocol-debates.json'),
    readJson('data/protocol-data.json'),
    readJson('data/milestone-catalog.json'),
    loadSiteMapModule()
  ]);
  const rows = [
    ...ecosystemRows(ecosystem),
    ...tezosCrpRows(tezosCrp),
    ...protocolDebateRows(debates, protocols),
    ...milestoneRows(milestones, siteMapModule.SITE_MAP, siteMapModule.siteMapRoute)
  ].sort((left, right) => left.group.localeCompare(right.group)
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id));
  const ids = new Set();
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) throw new Error(`Duplicate search catalog id: ${row.id}`);
    if (!row.title || !row.href) throw new Error(`Incomplete search catalog row: ${row.id}`);
    ids.add(row.id);
  }
  const contentHash = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  return `${JSON.stringify({
    schemaVersion: 1,
    contentHash,
    counts: rows.reduce((counts, row) => ({
      ...counts,
      [row.kind]: (counts[row.kind] || 0) + 1
    }), {}),
    rows
  }, null, 2)}\n`;
}

async function main() {
  const { check } = parseArgs();
  const rendered = await renderCatalog();
  if (check) {
    const current = await fs.readFile(TARGET, 'utf8').catch(() => '');
    if (current !== rendered) throw new Error('data/search-catalog.json is stale; run npm run refresh:search-catalog');
    console.log('Search catalog is current');
    return;
  }
  await fs.writeFile(TARGET, rendered);
  console.log(`Wrote ${path.relative(ROOT, TARGET)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
