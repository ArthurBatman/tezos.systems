#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileContractCoverage,
  isImplicitAddress,
  rankAccounts,
  rankAppActivity,
  rankDelegates,
  rankMints,
  rankSalesStats,
  rankUnicorn,
  validateMaxisConfig
} from './lib/maxis-ranking.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'data/maxis-contracts.json');
const OUTPUT_FILE = path.join(ROOT, 'data/maxis-leaders.json');
const TZKT = 'https://api.tzkt.io/v1';
const OBJKT = 'https://data.objkt.com/v3/graphql';
const PAGE_SIZE = 1000;
const TZKT_PAGE_SIZE = 10000;
const MAX_PAGES = 60;
const CONTRACT_BATCH = 40;
const RANKING_LIMIT = 5;
const EXPECTED_CATEGORIES = ['transaction', 'collector', 'artist', 'minter', 'defi', 'gaming', 'governance', 'staking', 'unicorn'];

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function formatInteger(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US');
}

function formatXtz(mutez) {
  return `${(Number(mutez || 0) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })} ꜩ`;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function validateSnapshot(snapshot) {
  const errors = [];
  if (Number(snapshot?.schema) !== 2) errors.push('snapshot schema must be 2');
  if (!Number.isFinite(Date.parse(snapshot?.generatedAt || ''))) errors.push('snapshot generatedAt must be an ISO timestamp');
  if (!Array.isArray(snapshot?.leaders)) errors.push('snapshot leaders must be an array');
  if (!snapshot?.rankings || typeof snapshot.rankings !== 'object') errors.push('snapshot rankings must be an object');
  if (Number(snapshot?.rankingLimit) !== RANKING_LIMIT) errors.push(`snapshot rankingLimit must be ${RANKING_LIMIT}`);
  const categories = new Set((snapshot?.leaders || []).map((leader) => leader.category));
  for (const category of EXPECTED_CATEGORIES) {
    if (!categories.has(category)) errors.push(`snapshot missing ${category}`);
    const ranking = snapshot?.rankings?.[category];
    if (!Array.isArray(ranking)) {
      errors.push(`snapshot missing ${category} ranking`);
      continue;
    }
    if (ranking.length !== RANKING_LIMIT) errors.push(`${category} ranking must contain ${RANKING_LIMIT} accounts`);
    const addresses = new Set();
    ranking.forEach((entry, index) => {
      if (entry?.status !== 'ready') errors.push(`${category} rank ${index + 1} is not ready`);
      if (Number(entry?.rank) !== index + 1) errors.push(`${category} rank order is invalid`);
      if (!isImplicitAddress(entry?.address)) errors.push(`${category} rank ${index + 1} has invalid address`);
      if (!entry?.scoreLabel || !entry?.method || !entry?.sourceUrl) errors.push(`${category} rank ${index + 1} is missing display evidence`);
      if (addresses.has(entry?.address)) errors.push(`${category} ranking repeats ${entry.address}`);
      addresses.add(entry?.address);
    });
    const leaderAddress = (snapshot?.leaders || []).find((leader) => leader.category === category)?.address;
    if (ranking[0]?.address && ranking[0].address !== leaderAddress) errors.push(`${category} leader does not match rank 1`);
  }
  for (const leader of snapshot?.leaders || []) {
    if (!['ready', 'empty'].includes(leader?.status)) errors.push(`${leader?.category || 'unknown'} has invalid status`);
    if (leader?.status === 'ready' && !isImplicitAddress(leader.address)) errors.push(`${leader.category} has invalid address`);
    if (leader?.status === 'ready' && (!leader.scoreLabel || !leader.method || !leader.sourceUrl)) errors.push(`${leader.category} is missing display evidence`);
  }
  if (snapshot?.truncation?.mints || snapshot?.truncation?.appTransactions) errors.push('snapshot contains truncated rankings');
  return errors;
}

async function fetchJson(url, options = {}, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.errors?.length) throw new Error(payload.errors.map((item) => item.message).join('; '));
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function tzkt(pathname) {
  return fetchJson(`${TZKT}${pathname}`, { headers: { Accept: 'application/json' } });
}

async function objkt(query, variables) {
  const payload = await fetchJson(OBJKT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  return payload.data;
}

async function fetchObjktSales(days) {
  const query = `query MaxisSales($days: Int!, $limit: Int!) {
    sales_stat(
      where: { interval_days: { _eq: $days }, type: { _in: [buyer, artist] }, subject: { flag: { _eq: none } } }
      order_by: { volume: desc }
      limit: $limit
    ) {
      interval_days rank type volume subject_address
      subject { alias tzdomain flag }
    }
  }`;
  const data = await objkt(query, { days, limit: 500 });
  return data?.sales_stat || [];
}

async function fetchObjktMints(fromIso) {
  const query = `query MaxisMints($from: timestamptz!, $limit: Int!, $offset: Int!) {
    event(
      where: { event_type: { _eq: mint }, reverted: { _eq: false }, timestamp: { _gte: $from } }
      order_by: { id: asc }
      limit: $limit
      offset: $offset
    ) {
      id timestamp creator_address amount ophash fa_contract token_pk
      creator { alias tzdomain flag }
    }
  }`;
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await objkt(query, { from: fromIso, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    const batch = data?.event || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

async function fetchAppTransactions(coverage, fromIso) {
  const rows = [];
  let truncated = false;
  for (const batch of chunks(coverage, CONTRACT_BATCH)) {
    const addresses = batch.map((item) => item.address).join(',');
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        'target.in': addresses,
        'timestamp.ge': fromIso,
        status: 'applied',
        select: 'id,hash,counter,nonce,timestamp,sender,initiator,target',
        'sort.asc': 'id',
        offset: String(page * TZKT_PAGE_SIZE),
        limit: String(TZKT_PAGE_SIZE)
      });
      const batchRows = await tzkt(`/operations/transactions?${query}`);
      rows.push(...batchRows);
      if (batchRows.length < TZKT_PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }
  }
  return { rows, truncated };
}

function sourceUrl(category, address) {
  return ['collector', 'artist', 'minter'].includes(category)
    ? `https://objkt.com/profile/${encodeURIComponent(address)}`
    : `https://tzkt.io/${encodeURIComponent(address)}`;
}

function leader(category, title, row, scoreLabel, context, method, windowKind, rank = null) {
  if (!row) return { category, title, status: 'empty', method, windowKind };
  return {
    category,
    title,
    status: 'ready',
    rank,
    address: row.address,
    alias: row.alias || null,
    score: row.score,
    scoreLabel,
    context: context.filter(Boolean),
    lastActivity: row.lastActivity || null,
    sourceUrl: sourceUrl(category, row.address),
    method,
    windowKind
  };
}

function buildRanking({ category, title, rows, display, method, windowKind }) {
  return rows.slice(0, RANKING_LIMIT).map((row, index) => {
    const evidence = display(row);
    return leader(category, title, row, evidence.scoreLabel, evidence.context || [], method, windowKind, index + 1);
  });
}

function appLabels(row, apps) {
  const labels = new Map(apps.map((app) => [app.id, app.label]));
  return (row?.apps || []).map((id) => labels.get(id) || id).join(', ');
}

function buildSnapshot({ now, fromIso, config, accounts, delegates, sales, mints, coverage, appRows, truncation }) {
  const transactions = rankAccounts(accounts);
  const governance = rankDelegates(delegates, 'governance');
  const staking = rankDelegates(delegates, 'staking');
  const collectors = rankSalesStats(sales, 'buyer');
  const artists = rankSalesStats(sales, 'artist');
  const minters = rankMints(mints);
  const categoryLookup = Object.fromEntries(['defi', 'gaming'].map((category) => {
    const scopedCoverage = coverage.filter((item) => item.app.category === category);
    const lookup = new Map(scopedCoverage.map((item) => [item.address, item.app]));
    return [category, rankAppActivity(appRows.filter((row) => lookup.has(row?.target?.address)), lookup)];
  }));
  const unicorns = rankUnicorn({
    collector: collectors,
    artist: artists,
    minter: minters,
    defi: categoryLookup.defi,
    gaming: categoryLookup.gaming,
    governance
  }, 3, 500);

  const specs = [
    {
      category: 'transaction', title: 'Transaction Maxi', rows: transactions,
      display: (row) => ({ scoreLabel: `${formatInteger(row.transactions)} transactions`, context: ['All-time TzKT account counter'] }),
      method: 'Highest all-time transaction count among implicit user accounts indexed by TzKT.', windowKind: 'all-time'
    },
    {
      category: 'collector', title: 'Collector Maxi', rows: collectors,
      display: (row) => ({ scoreLabel: `${formatXtz(row.volume)} collected`, context: ['OBJKT-indexed 30d buyer volume'] }),
      method: 'Highest 30-day buyer volume in OBJKT sales statistics; flagged profiles excluded.', windowKind: 'rolling-30d'
    },
    {
      category: 'artist', title: 'Art Maxi', rows: artists,
      display: (row) => ({ scoreLabel: `${formatXtz(row.volume)} art volume`, context: ['OBJKT-indexed 30d artist volume'] }),
      method: 'Highest 30-day artist volume in OBJKT sales statistics; flagged profiles excluded.', windowKind: 'rolling-30d'
    },
    {
      category: 'minter', title: 'Mint Maxi', rows: minters,
      display: (row) => ({ scoreLabel: `${formatInteger(row.tokens)} tokens minted`, context: [`${formatInteger(row.mintOperations)} mint operations`, `${formatInteger(row.editions)} editions`] }),
      method: 'Most distinct token mints in OBJKT-indexed, non-reverted mint events during the rolling window.', windowKind: 'rolling-30d'
    },
    {
      category: 'defi', title: 'DeFi Maxi', rows: categoryLookup.defi,
      display: (row) => ({ scoreLabel: `${formatInteger(row.appCount)} apps · ${formatInteger(row.calls)} calls`, context: [appLabels(row, config.apps), `${formatInteger(row.contractCount)} recognized contracts`] }),
      method: 'Most distinct recognized DeFi apps used, then successful top-level wallet calls, across the curated TzKT alias taxonomy.', windowKind: 'rolling-30d'
    },
    {
      category: 'gaming', title: 'Gaming Maxi', rows: categoryLookup.gaming,
      display: (row) => ({ scoreLabel: `${formatInteger(row.appCount)} games · ${formatInteger(row.calls)} calls`, context: [appLabels(row, config.apps), `${formatInteger(row.contractCount)} recognized contracts`] }),
      method: 'Most distinct recognized Tezos games used, then successful top-level wallet calls, across the curated TzKT alias taxonomy.', windowKind: 'rolling-30d'
    },
    {
      category: 'governance', title: 'Governance Maxi', rows: governance,
      display: (row) => ({ scoreLabel: `${formatInteger(row.governanceActions)} governance actions`, context: [`${formatInteger(row.ballots)} ballots`, `${formatInteger(row.proposals)} proposals`] }),
      method: 'Most all-time ballots plus proposals among currently active TzKT delegates.', windowKind: 'all-time-active'
    },
    {
      category: 'staking', title: 'Staking Maxi', rows: staking,
      display: (row) => ({ scoreLabel: `${formatXtz(row.stakedBalance)} staked`, context: [`${formatInteger(row.stakers)} stakers`, `${formatXtz(row.bakingPower)} baking power`] }),
      method: 'Largest live staked balance among active TzKT delegates.', windowKind: 'live'
    },
    {
      category: 'unicorn', title: 'Tezos Unicorn', rows: unicorns,
      display: (row) => ({ scoreLabel: `${formatInteger(row.breadth)} lanes crossed`, context: [row.categories.map((item) => `${item.category} #${item.rank}`).join(' · ')] }),
      method: 'Breadth first across the top 500 available Collector, Art, Mint, DeFi, Gaming, and Governance ranks; normalized rank points break ties. Requires three lanes.', windowKind: 'mixed'
    }
  ];
  const rankings = Object.fromEntries(specs.map((spec) => [spec.category, buildRanking(spec)]));
  const leaders = specs.map((spec) => rankings[spec.category][0]
    || leader(spec.category, spec.title, null, '', [], spec.method, spec.windowKind));

  return {
    schema: 2,
    rankingLimit: RANKING_LIMIT,
    generatedAt: now.toISOString(),
    window: { kind: 'rolling', days: config.windowDays, from: fromIso, to: now.toISOString() },
    staleAfterHours: 48,
    sources: [
      { name: 'TzKT', url: 'https://api.tzkt.io/', role: 'accounts, delegates, contract labels, successful contract calls' },
      { name: 'OBJKT API v3', url: 'https://data.objkt.com/docs/', role: 'buyer and artist sales ranks, mint events, profile identity' }
    ],
    coverage: {
      contractCatalogLimit: config.contractCatalogLimit,
      recognizedContracts: coverage.length,
      recognizedApps: config.apps.length,
      byCategory: Object.fromEntries(['defi', 'gaming'].map((category) => [category, {
        apps: config.apps.filter((app) => app.category === category).length,
        contracts: coverage.filter((item) => item.app.category === category).length
      }])),
      caveat: 'DeFi and Gaming cover successful top-level wallet calls to recently active contracts recognized by the reviewed TzKT-alias taxonomy. Unknown or unlabeled contracts are not classified.'
    },
    truncation,
    leaders,
    rankings
  };
}

async function main() {
  const config = await readJson(CONFIG_FILE);
  const configErrors = validateMaxisConfig(config);
  if (configErrors.length) throw new Error(`Invalid maxis taxonomy: ${configErrors.join('; ')}`);
  if (process.argv.includes('--check')) {
    const snapshotErrors = validateSnapshot(await readJson(OUTPUT_FILE));
    if (snapshotErrors.length) throw new Error(`Invalid maxis snapshot: ${snapshotErrors.join('; ')}`);
    console.log('Maxis taxonomy and committed snapshot are valid');
    return;
  }

  const now = new Date();
  const fromIso = new Date(now.getTime() - config.windowDays * 24 * 60 * 60 * 1000).toISOString();
  const catalogQuery = new URLSearchParams({
    kind: 'smart_contract',
    select: 'address,alias,lastActivityTime',
    'sort.desc': 'lastActivity',
    limit: String(config.contractCatalogLimit)
  });
  const accountsQuery = new URLSearchParams({
    type: 'user',
    'sort.desc': 'numTransactions',
    select: 'address,alias,numTransactions,lastActivityTime',
    limit: '100'
  });
  const delegatesQuery = new URLSearchParams({
    active: 'true',
    select: 'address,alias,numBallots,numProposals,stakedBalance,bakingPower,stakersCount,numDelegators,lastActivityTime',
    limit: '10000'
  });

  const [contracts, accounts, delegates, sales, mintResult] = await Promise.all([
    tzkt(`/contracts?${catalogQuery}`),
    tzkt(`/accounts?${accountsQuery}`),
    tzkt(`/delegates?${delegatesQuery}`),
    fetchObjktSales(config.windowDays),
    fetchObjktMints(fromIso)
  ]);
  const coverage = compileContractCoverage(contracts, config.apps, fromIso);
  const appResult = await fetchAppTransactions(coverage, fromIso);
  const snapshot = buildSnapshot({
    now,
    fromIso,
    config,
    accounts,
    delegates,
    sales,
    mints: mintResult.rows,
    coverage,
    appRows: appResult.rows,
    truncation: { mints: mintResult.truncated, appTransactions: appResult.truncated }
  });

  if (Object.values(snapshot.truncation).some(Boolean)) {
    throw new Error(`Maxis refresh hit a pagination cap: ${JSON.stringify(snapshot.truncation)}`);
  }
  const snapshotErrors = validateSnapshot(snapshot);
  if (snapshotErrors.length) throw new Error(`Generated invalid maxis snapshot: ${snapshotErrors.join('; ')}`);
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
  const rankedCount = Object.values(snapshot.rankings).reduce((sum, rows) => sum + rows.length, 0);
  console.log(`Wrote data/maxis-leaders.json with ${rankedCount} ranked accounts across ${coverage.length} recognized contracts`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
