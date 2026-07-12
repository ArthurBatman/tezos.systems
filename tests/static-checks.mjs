#!/usr/bin/env node

import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAMBER_ROUTES, routeUrl } from '../scripts/lib/chamber-routes.mjs';
import {
  MILESTONE_BASE_THRESHOLDS,
  MILESTONE_CATALOG_SCHEMA,
  MILESTONE_REFRESH_COMMITS,
  MILESTONE_REFRESH_DAYS,
  extendMilestoneThresholds,
  generatedMilestoneThresholds,
  milestoneCatalogCadence
} from '../js/features/milestone-catalog.mjs';
import { advanceMilestoneTrack, claimMilestoneArrival, normalizeMilestoneStore, qualifyMilestoneNearState } from '../js/features/milestone-lifecycle.mjs';
import {
  compileContractCoverage,
  rankAppActivity,
  rankMints,
  rankSalesStats,
  rankUnicorn,
  validateMaxisConfig
} from '../scripts/lib/maxis-ranking.mjs';
import { fetchKeysetPages, fetchOffsetPages } from '../scripts/lib/maxis-pagination.mjs';
import {
  CURRENT_MAXIS_EVALUATOR_VERSION,
  DEEP_RANKING_LIMIT,
  PASSPORT_SHARD_ALGORITHM,
  PASSPORT_SHARD_COUNT,
  SEASON_CATEGORY_ORDER,
  SEASON_EVALUATOR_VERSION,
  SEASON_LANE_RULES,
  SEASON_RULES_VERSION,
  addressShard,
  buildSeasonCompetition,
  expandPassportRecord,
  getMaxisEvaluator,
  maxisEvaluatorVersions,
  rankSeasonBuilders,
  rankSeasonDelegation,
  rankSeasonGovernance,
  rankSeasonLiquidity,
  rankSeasonMints,
  rankSeasonNftSales,
  resolveProtocolSeason,
  truncationCoverageErrors,
  validateSeasonCatalog,
  registerMaxisEvaluator
} from '../scripts/lib/maxis-season.mjs';
import {
  getMaxisSource,
  maxisSourceVersions,
  registerMaxisSource
} from '../scripts/lib/maxis-source.mjs';
import {
  artifactBudgetErrors,
  measureSeasonArtifactBudget
} from '../scripts/lib/maxis-artifact-budget.mjs';
import { validateTransactionAccumulator } from '../scripts/lib/maxis-transactions-v2.mjs';
import {
  buildGovernanceCareerArtifact,
  validateGovernanceCareerArtifact
} from '../scripts/lib/maxis-governance-career.mjs';
import { maxisImplementationHash } from '../scripts/refresh-maxis-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];
const passes = [];

function pass(message) {
  passes.push(message);
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

async function readText(file) {
  return fs.readFile(path.join(ROOT, file), 'utf8');
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key])]));
}

function stableJsonHash(value) {
  return createHash('sha256').update(JSON.stringify(stableJsonValue(value))).digest('hex');
}

async function pathExists(file) {
  try {
    await fs.access(path.join(ROOT, file));
    return true;
  } catch {
    return false;
  }
}

async function statOrNull(file) {
  try {
    return await fs.stat(path.join(ROOT, file));
  } catch {
    return null;
  }
}

async function walk(dir, predicate, results = []) {
  const entries = await fs.readdir(path.join(ROOT, dir), { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (child === 'node_modules' || child === '.git') continue;
      await walk(child, predicate, results);
    } else if (predicate(child)) {
      results.push(child.replaceAll(path.sep, '/'));
    }
  }
  return results.sort();
}

function stripUrl(value) {
  return value.split('#')[0].split('?')[0];
}

function isExternalRef(value) {
  return (
    !value ||
    value.startsWith('#') ||
    value.startsWith('data:') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:') ||
    value.startsWith('javascript:') ||
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('//')
  );
}

function resolveLocalRef(fromFile, rawValue) {
  if (isExternalRef(rawValue)) return null;
  let value = stripUrl(rawValue);
  if (!value) value = '/';

  if (value === '/') return 'index.html';
  if (value.endsWith('/')) value += 'index.html';

  const baseDir = path.dirname(fromFile);
  const resolved = value.startsWith('/')
    ? value.slice(1)
    : path.normalize(path.join(baseDir, value));

  return resolved.replaceAll(path.sep, '/');
}

function collectHtmlRefs(file, html) {
  const refs = [];
  const attrPattern = /\b(?:src|href|poster)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(attrPattern)) {
    const raw = match[1].trim();
    if (raw.includes('{{') || raw.includes('${')) continue;
    const resolved = resolveLocalRef(file, raw);
    if (resolved) refs.push({ raw, resolved });
  }
  return refs;
}

function collectCssRefs(file, css) {
  const refs = [];
  const urlPattern = /url\(([^)]+)\)/gi;
  for (const match of css.matchAll(urlPattern)) {
    const raw = match[1].trim().replace(/^["']|["']$/g, '');
    const resolved = resolveLocalRef(file, raw);
    if (resolved) refs.push({ raw, resolved });
  }
  return refs;
}

function collectJsImports(file, js) {
  const refs = [];
  const patterns = [
    /\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\(["']([^"']+)["']\)/g
  ];
  for (const pattern of patterns) {
    for (const match of js.matchAll(pattern)) {
      const raw = match[1].trim();
      if (!raw.startsWith('.')) continue;
      const resolved = resolveLocalRef(file, raw);
      if (!resolved) continue;
      refs.push({ raw, resolved: path.extname(resolved) ? resolved : `${resolved}.js` });
    }
  }
  return refs;
}

async function checkRequiredFiles() {
  const required = [
    'index.html',
    'landing.html',
    'css/styles.css',
    'css/styles.min.css',
    'css/hero-search.css',
    'css/site-map.css',
    'css/leaderboard.css',
    'css/network-pulse.css',
    'css/staking-chamber.css',
    'css/network-health.css',
    'css/maxis.css',
    'js/core/app.js',
    'js/core/api.js',
    'js/core/config.js',
    'js/core/site-map.js',
    'js/core/tzkt-throttle.js',
    'js/core/wallet.js',
    'js/features/governance-alerts.js',
    'js/features/staking-chamber.js',
    'js/features/milestone-catalog.mjs',
    'js/features/search.js',
    'js/landing/site-nav.js',
    'js/ui/wayfinder.js',
    'sw.js',
    'og-image.png',
    'stake/index.html',
    'og/stake.png',
    'version.json',
    'LICENSE',
    'NOTICE',
    'widgets/runtime.js',
    'feed.xml',
    'scripts/refresh-generated-surfaces.mjs',
    'scripts/generate-milestone-catalog.mjs',
    'scripts/refresh-nakamoto-sources.mjs',
    'scripts/refresh-maxis-data.mjs',
    'scripts/refresh-maxis-careers.mjs',
    'scripts/lib/maxis-artifact-budget.mjs',
    'scripts/lib/maxis-coverage-v2.mjs',
    'scripts/lib/maxis-evaluator-v2-primitives.mjs',
    'scripts/lib/maxis-evaluator-v2.mjs',
    'scripts/lib/maxis-governance-career.mjs',
    'scripts/lib/maxis-pagination.mjs',
    'scripts/lib/maxis-season.mjs',
    'scripts/lib/maxis-source.mjs',
    'scripts/lib/maxis-source-v2.mjs',
    'scripts/lib/maxis-transactions-v2.mjs',
    'data/governance-votes.json',
    'data/nakamoto-sources.json',
    'data/governance-refresh-report.json',
    'data/milestone-catalog.json',
    'data/maxis-contracts.json',
    'data/maxis-careers.json',
    'data/maxis-leaders.json',
    'data/maxis/manifest.json',
    'maxis/index.html',
    'og/maxis.png',
    'data/protocol-data.json',
    'data/protocol-debates.json',
    'data/tweets.json'
  ];

  for (const file of required) {
    if (await pathExists(file)) pass(`required file exists: ${file}`);
    else fail(`missing required file: ${file}`);
  }
}

async function checkJsonFiles() {
  const jsonFiles = await walk('.', (file) => file.endsWith('.json') || file.endsWith('.webmanifest'));
  for (const file of jsonFiles) {
    try {
      JSON.parse(await readText(file));
      pass(`valid JSON: ${file}`);
    } catch (error) {
      fail(`invalid JSON in ${file}: ${error.message}`);
    }
  }
}

function hoursSince(iso) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / 36e5;
}

function protocolHashMatches(hash, prefix) {
  if (!hash || !prefix) return false;
  return hash.startsWith(prefix) || hash.startsWith(prefix.slice(0, 8)) || prefix.startsWith(hash.slice(0, 8));
}

function countsAsProtocolUpgrade(protocol) {
  if (!protocol) return false;
  if (protocol.countsAsUpgrade === false || protocol.countsAsSelfAmendment === false) return false;
  const name = String(protocol.name || protocol.alias || protocol.extras?.alias || protocol.metadata?.alias || '').trim().toLowerCase();
  const hash = String(protocol.hash || protocol.protocol || '');
  if (name === 'paris c' || hash.startsWith('PsParisC') || hash.startsWith('PsParisc')) return false;
  const code = Number(protocol.code ?? protocol.number);
  if (Number.isFinite(code) && code < 4) return false;
  if (Object.prototype.hasOwnProperty.call(protocol, 'firstLevel')) {
    const firstLevel = Number(protocol.firstLevel);
    if (Number.isFinite(firstLevel) && firstLevel <= 0) return false;
  }
  return true;
}

function countProtocolUpgrades(protocols) {
  return Array.isArray(protocols) ? protocols.filter(countsAsProtocolUpgrade).length : 0;
}

async function checkGovernanceVotes() {
  const data = JSON.parse(await readText('data/governance-votes.json'));
  const report = JSON.parse(await readText('data/governance-refresh-report.json'));
  const protocolData = JSON.parse(await readText('data/protocol-data.json'));
  const protocols = Array.isArray(protocolData.protocols) ? protocolData.protocols : [];
  const votes = Array.isArray(data.periodVotes) ? data.periodVotes : [];
  const failed = votes.filter((vote) => ['no_quorum', 'no_supermajority'].includes(vote.status));
  const namedFailures = new Set(failed.map((vote) => vote.displayName));

  if (!Array.isArray(data.epochs) || data.epochs.length !== data.epochCount) {
    fail('governance-votes epochCount must match epochs length');
  }
  if (votes.length !== data.periodVoteCount) {
    fail('governance-votes periodVoteCount must match periodVotes length');
  }
  if (votes.length < 20) {
    fail('governance-votes must contain enough exploration/promotion votes for Chamber historical context');
  }
  if (failed.length !== data.failedVoteCount) {
    fail('governance-votes failedVoteCount must match failed period rows');
  }
  for (const expected of ['Brest A', 'Ithaca', 'Oxford', 'Qena', 'Qena42']) {
    if (!namedFailures.has(expected)) fail(`governance-votes missing failed proposal ${expected}`);
  }

  const parisC = protocols.find((protocol) => protocol.name === 'Paris C' || protocolHashMatches(protocol.hash, 'PsParisC'));
  const countedUpgradeTotal = countProtocolUpgrades(protocols);
  if (!parisC) {
    fail('protocol-data must keep the Paris C follow-up record');
  } else if (parisC.countsAsUpgrade !== false) {
    fail('Paris C must be marked countsAsUpgrade:false so totals do not double-count the Paris follow-up');
  }
  if (protocolData.meta?.totalUpgrades !== countedUpgradeTotal) {
    fail(`protocol-data meta.totalUpgrades (${protocolData.meta?.totalUpgrades}) must equal counted upgrade total (${countedUpgradeTotal})`);
  }
  if (countedUpgradeTotal !== 21) {
    fail(`protocol-data counted upgrade total should be 21 with Paris C excluded, got ${countedUpgradeTotal}`);
  }

  if (hoursSince(data.generatedAt) > 72) {
    fail('governance-votes is older than 72 hours; run npm run refresh:governance');
  }
  if (hoursSince(report.generatedAt) > 72) {
    fail('governance refresh report is older than 72 hours; run npm run refresh:governance');
  }
  if (report.status === 'blocked' || report.blockers?.length) {
    fail(`governance refresh report has blockers: ${(report.blockers || []).map((b) => b.code).join(', ')}`);
  }
  if (report.singleEntryPoint !== 'scripts/refresh-governance-data.mjs') {
    fail('governance refresh report must name scripts/refresh-governance-data.mjs as the single entry point');
  }
  if (!Array.isArray(report.generatedFiles) || !report.generatedFiles.includes('feed.xml')) {
    fail('governance refresh report generatedFiles must include feed.xml');
  }

  const feed = await readText('feed.xml');
  if (!feed.includes('<rss version="2.0"') || !feed.includes('https://tezos.systems/chamber/')) {
    fail('feed.xml must be an RSS feed linking governance items to /chamber/');
  }
  const activeName = report.currentGovernance?.proposalName;
  if (activeName && !feed.includes(activeName)) {
    fail(`feed.xml should include active proposal name ${activeName}`);
  }
  const activeHashPrefix = report.currentGovernance?.proposalHash?.slice(0, 8);
  if (activeName && activeHashPrefix && feed.includes(activeHashPrefix)) {
    fail(`feed.xml should use active proposal name ${activeName}, not raw hash prefix ${activeHashPrefix}`);
  }

  const currentProtocol = report.currentProtocol;
  const currentLore = currentProtocol
    ? protocols.find((p) => p.name === currentProtocol.name || protocolHashMatches(currentProtocol.hash, p.hash))
    : null;
  if (currentProtocol && !currentLore) {
    fail(`current protocol ${currentProtocol.name} is missing from data/protocol-data.json`);
  }

  const missingAccepted = report.coverage?.activatedProtocolLore?.missing || [];
  if (missingAccepted.length) {
    fail(`accepted protocol lore missing: ${missingAccepted.map((p) => p.name || p.hash).join(', ')}`);
  }

  pass(`governance vote history checked: ${votes.length} vote periods, ${failed.length} failures`);
}

async function checkLocalReferences() {
  const htmlFiles = await walk('.', (file) => file.endsWith('.html'));
  const cssFiles = await walk('css', (file) => file.endsWith('.css'));
  const jsFiles = await walk('js', (file) => file.endsWith('.js'));

  const refs = [];
  for (const file of htmlFiles) refs.push(...collectHtmlRefs(file, await readText(file)).map((ref) => ({ file, ...ref })));
  for (const file of cssFiles) refs.push(...collectCssRefs(file, await readText(file)).map((ref) => ({ file, ...ref })));
  for (const file of jsFiles) refs.push(...collectJsImports(file, await readText(file)).map((ref) => ({ file, ...ref })));

  let checked = 0;
  for (const ref of refs) {
    if (ref.resolved.includes('*')) continue;
    checked += 1;
    if (!(await pathExists(ref.resolved))) {
      fail(`${ref.file} references missing asset ${ref.raw} -> ${ref.resolved}`);
    }
  }
  pass(`local references checked: ${checked}`);
}

async function checkSiteMapGraphContracts() {
  const source = await readText('js/core/site-map.js');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const {
    SITE_MAP,
    SITE_MAP_NAV_GROUPS,
    SITE_MAP_RELATIONS,
    searchSiteMap,
    searchSiteMapIntents,
    siteMapBrowseEntries,
    siteMapBrowseIntents,
    siteMapDirectoryChildren,
    siteMapRelated,
    siteMapSearchChips,
    siteMapSitemapEntries,
    siteMapStarters
  } = await import(moduleUrl);

  const ids = SITE_MAP.map((entry) => entry.id);
  const hrefs = SITE_MAP.map((entry) => entry.href);
  const knownIds = new Set(ids);
  if (knownIds.size !== ids.length) fail('site map entry ids must be unique');
  if (new Set(hrefs).size !== hrefs.length) fail('site map entry hrefs must be unique');
  const intentEntries = SITE_MAP.flatMap((entry) => (entry.searchIntents || []).map((intent) => ({ ...intent, parentId: entry.id })));
  const intentIds = intentEntries.map((entry) => entry.id);
  if (new Set(intentIds).size !== intentIds.length) fail('site map child intent ids must be unique');
  if (intentIds.some((id) => knownIds.has(id))) fail('site map child intent ids must not collide with top-level ids');

  for (const group of SITE_MAP_NAV_GROUPS) {
    if (!SITE_MAP.some((entry) => entry.group === group)) fail(`site map nav group is empty: ${group}`);
  }
  for (const entry of SITE_MAP) {
    if (!SITE_MAP_NAV_GROUPS.includes(entry.group)) fail(`site map destination is missing from the complete directory groups: ${entry.id}`);
  }
  if (new Set(Object.keys(SITE_MAP_RELATIONS)).size !== SITE_MAP.length || SITE_MAP.some((entry) => !SITE_MAP_RELATIONS[entry.id])) {
    fail('every site map destination must own a semantic relation set');
  }
  for (const [sourceId, relatedIds] of Object.entries(SITE_MAP_RELATIONS)) {
    if (!knownIds.has(sourceId)) fail(`site map relation source is unknown: ${sourceId}`);
    if (new Set(relatedIds).size !== relatedIds.length) fail(`site map relation ${sourceId} contains duplicates`);
    for (const relatedId of relatedIds) {
      if (!knownIds.has(relatedId)) fail(`site map relation ${sourceId} points to unknown id ${relatedId}`);
      if (relatedId === sourceId) fail(`site map relation ${sourceId} must not point to itself`);
    }
  }

  const starterIds = siteMapStarters().map((entry) => entry.id);
  for (const required of ['my-tezos', 'pulse', 'staking-chamber', 'maxis', 'health']) {
    if (!starterIds.includes(required)) fail(`site map starter set is missing ${required}`);
  }
  const chipIds = siteMapSearchChips().map((entry) => entry.id);
  for (const required of ['my-tezos', 'pulse', 'staking-chamber', 'maxis', 'domains', 'health']) {
    if (!chipIds.includes(required)) fail(`site map search chips are missing ${required}`);
  }

  const starterOrders = SITE_MAP.filter((entry) => Number.isFinite(entry.starter)).map((entry) => entry.starter);
  if (new Set(starterOrders).size !== starterOrders.length) fail('site map starter orders must be unique');
  const chipOrders = SITE_MAP.filter((entry) => entry.searchChip).map((entry) => entry.searchChip.order);
  if (new Set(chipOrders).size !== chipOrders.length) fail('site map search chip orders must be unique');

  const expectedBrowseIds = SITE_MAP
    .filter((entry) => SITE_MAP_NAV_GROUPS.includes(entry.group))
    .sort((a, b) => SITE_MAP_NAV_GROUPS.indexOf(a.group) - SITE_MAP_NAV_GROUPS.indexOf(b.group) || ids.indexOf(a.id) - ids.indexOf(b.id))
    .map((entry) => entry.id);
  const browseIds = siteMapBrowseEntries().map((entry) => entry.id);
  if (JSON.stringify(browseIds) !== JSON.stringify(expectedBrowseIds)) {
    fail(`site map browse order must cover every grouped destination exactly once: ${browseIds.join(', ')}`);
  }
  if (browseIds.length !== SITE_MAP.length) fail(`complete site map must include all ${SITE_MAP.length} top-level destinations, got ${browseIds.length}`);

  const inbound = new Map(ids.map((id) => [id, 0]));
  for (const sourceId of ids) {
    for (const related of siteMapRelated(sourceId, 4)) inbound.set(related.id, (inbound.get(related.id) || 0) + 1);
  }
  for (const [id, count] of inbound) {
    if (!count) fail(`site map destination has no rendered inbound semantic route: ${id}`);
  }
  for (const startId of ids) {
    const seen = new Set([startId]);
    const queue = [startId];
    while (queue.length) {
      for (const related of siteMapRelated(queue.shift(), 4)) {
        if (seen.has(related.id)) continue;
        seen.add(related.id);
        queue.push(related.id);
      }
    }
    if (seen.size !== SITE_MAP.length) {
      fail(`site map relation graph is not circular from ${startId}; missing ${ids.filter((id) => !seen.has(id)).join(', ')}`);
    }
  }

  const rankedIntent = {
    'my tezos': 'my-tezos',
    wallet: 'my-tezos',
    '/history': 'history',
    '/leaderboard': 'leaderboard',
    '/compare': 'live-compare',
    widgets: 'widgets',
    '/stake': 'staking-chamber',
    chambers: 'chambers',
    governance: 'chamber',
    staking: 'staking-chamber',
    liquidity: 'liquidity-baking',
    finality: 'health',
    'rewards tracker': 'my-tezos',
    'nakamoto coefficient': 'health',
    "what's hot today": 'hot-today',
    nft: 'hen'
  };
  for (const [query, expectedId] of Object.entries(rankedIntent)) {
    const actual = searchSiteMap(query)[0]?.id;
    if (actual !== expectedId) fail(`site map search ${JSON.stringify(query)} should rank ${expectedId} first, got ${actual || 'none'}`);
  }

  const rankedSubfeatureIntent = {
    season: ['maxis-season', '/maxis/?view=season'],
    passport: ['maxis-passport', '/maxis/?view=passport'],
    champions: ['maxis-champions', '/maxis/?view=champions'],
    'transaction maxi': ['maxis-transaction', '/maxis/?lane=transaction'],
    'transaction season': ['maxis-transaction', '/maxis/?view=season&lane=transaction'],
    'transaction maxi season': ['maxis-transaction', '/maxis/?view=season&lane=transaction'],
    transaction: ['maxis-transaction', '/maxis/?lane=transaction'],
    'delegation maxi': ['maxis-delegation', '/maxis/?view=season&lane=delegation'],
    'bridge maxi': ['maxis-bridge', '/maxis/?view=season&lane=bridge'],
    'tezos vs ethereum': ['compare-ethereum', '/compare/tezos-vs-ethereum.html'],
    ethereum: ['compare-ethereum', '/compare/tezos-vs-ethereum.html'],
    'price widget': ['widget-price', '/widgets/price.html'],
    'baker card widget': ['widget-baker-card', '/widgets/baker-card.html']
  };
  for (const [query, [expectedId, expectedHref]] of Object.entries(rankedSubfeatureIntent)) {
    const actual = searchSiteMapIntents(query)[0];
    if (actual?.id !== expectedId || actual?.href !== expectedHref) {
      fail(`site map subfeature search ${JSON.stringify(query)} should rank ${expectedId} at ${expectedHref}, got ${actual?.id || 'none'} at ${actual?.href || 'none'}`);
    }
  }

  const transactionSeason = searchSiteMapIntents('transaction season')[0];
  if (transactionSeason?.title !== 'Transaction Maxi Season' || !/protocol-season Transaction Maxi race/.test(transactionSeason?.detail || '')) {
    fail('season lane intents must switch title and detail together with their season route');
  }

  const visibleLauncherQueries = {
    'HEN / Teia Collecting': 'hen',
    'Baker Directory': 'leaderboard',
    'Staking Rewards Estimator': 'calculator',
    'Tezos Widgets': 'widgets',
    'ctez Oven Exit': 'ctez'
  };
  for (const [query, expectedId] of Object.entries(visibleLauncherQueries)) {
    if (searchSiteMap(query)[0]?.id !== expectedId) fail(`visible Explore label ${JSON.stringify(query)} must resolve to ${expectedId}`);
  }

  const directoryIntentIds = new Set(SITE_MAP.flatMap((entry) => siteMapDirectoryChildren(entry).map((intent) => intent.id)));
  const browseIntentIds = siteMapBrowseIntents().map((intent) => intent.id);
  if (JSON.stringify(browseIntentIds) !== JSON.stringify([...directoryIntentIds])) {
    fail('empty search browse must expose every nested directory view exactly once');
  }
  for (const entry of siteMapSitemapEntries()) {
    if (entry.parentId && !directoryIntentIds.has(entry.id)) fail(`crawlable child route is missing from the complete human map: ${entry.id}`);
  }

  const expectedWidgetFiles = (await walk('widgets', (name) => name.endsWith('.html') && !name.endsWith('/builder.html')))
    .map((file) => `/${file}`);
  const widgetIntentHrefs = new Set(intentEntries.filter((entry) => entry.parentId === 'widgets').map((entry) => entry.href));
  for (const href of expectedWidgetFiles) {
    if (!widgetIntentHrefs.has(href)) fail(`widget endpoint is missing from canonical site map intents: ${href}`);
  }

  for (const intent of intentEntries) {
    const url = new URL(intent.href, 'https://tezos.systems');
    if (url.origin !== 'https://tezos.systems') continue;
    const local = url.pathname.endsWith('/') ? `${url.pathname.slice(1)}index.html` : url.pathname.slice(1);
    if (local && !(await pathExists(local))) fail(`site map intent ${intent.id} points to missing local route ${intent.href}`);
  }

  for (const route of CHAMBER_ROUTES) {
    const canonicalSlug = route.canonicalSlug || route.slug;
    if (!SITE_MAP.some((entry) => entry.href === `/${canonicalSlug}/`)) {
      fail(`site map is missing canonical chamber route /${canonicalSlug}/`);
    }
    const routeShell = await readText(`${route.slug}/index.html`);
    if (!routeShell.includes('class="chamber-route-shell-intro"')
      || !routeShell.includes(`<h1 id="chamber-route-title">${route.shortTitle}</h1>`)
      || !routeShell.includes(route.description)) {
      fail(`${route.slug}/index.html must expose its route-specific heading and summary before hydration`);
    }
    if (!routeShell.includes('"@type": "WebPage"')
      || !routeShell.includes('"@type": "BreadcrumbList"')
      || routeShell.includes('"@type": "FAQPage"')) {
      fail(`${route.slug}/index.html must use route-specific WebPage/Breadcrumb schema without inherited dashboard FAQ claims`);
    }
  }

  const standalonePages = [
    'staking/index.html',
    'governance/index.html',
    'bakers/index.html',
    'landing.html',
    'compare/index.html',
    'compare/tezos-vs-ethereum.html',
    'compare/tezos-vs-solana.html',
    'compare/tezos-vs-cardano.html',
    'compare/tezos-vs-algorand.html',
    'hen/index.html',
    '404.html',
    'widgets/builder.html'
  ];
  for (const file of standalonePages) {
    const html = await readText(file);
    if (!html.includes('data-site-circulation') || !html.includes('data-site-footer') || !html.includes('/css/site-map.css') || !html.includes('/js/landing/site-nav.js')) {
      fail(`${file} must expose contextual circulation and the complete shared site map`);
    }
  }

  const search = await readText('js/features/search.js');
  const app = await readText('js/core/app.js');
  const index = await readText('index.html');
  const wayfinder = await readText('js/ui/wayfinder.js');
  if (/const\s+CHAMBERS\s*=/.test(search)) fail('hero search must not keep a duplicate Chamber catalog');
  if (!index.includes('data-site-footer-map') || !index.includes('data-site-map-grid')) fail('dashboard footer must expose the manifest-backed complete map');
  if (!app.includes('initSiteWayfinder') || !wayfinder.includes('siteMapRelated')) fail('dashboard Chambers must initialize the shared semantic wayfinder');
  if (!index.includes('data-site-map-complete') || !index.includes('class="feature-launcher-directory-link"') || !index.includes('href="/#site-map"')) {
    fail('Explore must expose one quiet complete-directory utility');
  }
  if (index.includes('id="search-everything-feature-link"')) {
    fail('Explore must not duplicate the global search surface as another feature row');
  }
  const nativePulse = await readText('js/features/network-pulse.js');
  const nativeStaking = await readText('js/features/staking-chamber.js');
  const nativeWayfinders = [nativePulse, nativeStaking];
  for (const native of nativeWayfinders) {
    if (!native.includes('data-site-wayfinder-native') || !native.includes('siteMapRelated(') || !native.includes('href="/#chambers"') || !native.includes('href="/#search"')) {
      fail('native Chamber wayfinders must expose four semantic neighbors plus Chambers and search exits');
    }
  }
  const siteMapCss = await readText('css/site-map.css');
  if (!siteMapCss.includes('.chamber-overlay [data-site-wayfinder-native]')) {
    fail('native Chamber wayfinders must inherit the shared wayfinder color and border variables');
  }
  if ((nativePulse.match(/renderChamberLinks\(\)/g) || []).length < 3 || (nativeStaking.match(/renderNativeWayfinder\(\)/g) || []).length < 3) {
    fail('native Chamber wayfinders must survive both successful and failed live-data renders');
  }

  const jsonLdMatch = index.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  const webAppSchema = jsonLdMatch ? JSON.parse(jsonLdMatch[1]) : null;
  const featureList = new Set(Array.isArray(webAppSchema?.featureList) ? webAppSchema.featureList : []);
  for (const entry of SITE_MAP.filter((item) => item.id !== 'home')) {
    if (!featureList.has(entry.title)) fail(`WebApplication featureList is missing canonical ware: ${entry.title}`);
  }

  pass(`site map graph checked: ${SITE_MAP.length} destinations, ${intentEntries.length} child views, ${SITE_MAP_NAV_GROUPS.length} groups, ${standalonePages.length} standalone surfaces`);
}

async function checkCacheBustAlignment() {
  const index = await readText('index.html');
  const sw = await readText('sw.js');
  const app = await readText('js/core/app.js');
  const heroSearch = await readText('js/features/search.js');
  const leaderboard = await readText('js/features/leaderboard.js');
  const ledgerFlow = await readText('js/features/ledger-flow.js');
  const networkPulse = await readText('js/features/network-pulse.js');
  const stakingChamber = await readText('js/features/staking-chamber.js');
  const networkHealth = await readText('js/features/network-health.js');
  const maxis = await readText('js/features/maxis.js');
  const themePreload = await readText('js/core/theme-preload.js');
  const themeUi = await readText('js/ui/theme.js');
  const cssMatch = index.match(/css\/styles\.min\.css\?v=(\d+)/);
  const heroCssLinkMatch = index.match(/css\/hero-search\.css\?v=(\d+)/);
  const siteMapCssLinkMatch = index.match(/css\/site-map\.css\?v=(\d+)/);
  const appPreloadMatch = index.match(/js\/core\/app\.js\?v=(\d+)/);
  const appScriptMatch = index.match(/<script[^>]+src=["']js\/core\/app\.js\?v=(\d+)["']/);
  const themePreloadScriptMatch = index.match(/js\/core\/theme-preload\.js\?v=(\d+)/);
  const cacheMatch = sw.match(/CACHE_NAME\s*=\s*['"]tezos-systems-v(\d+)['"]/);
  const heroSearchCssMatch = heroSearch.match(/HERO_SEARCH_CSS_URL\s*=\s*['"]\/css\/hero-search\.css\?v=(\d+)['"]/);
  const shellExtrasCssMatch = app.match(/SHELL_EXTRAS_CSS_URL\s*=\s*['"]\/css\/shell-extras\.css\?v=(\d+)['"]/);
  const leaderboardCssMatch = leaderboard.match(/LEADERBOARD_CSS_URL\s*=\s*['"]\/css\/leaderboard\.css\?v=(\d+)['"]/);
  const ledgerFlowCssMatch = ledgerFlow.match(/LEDGER_FLOW_CSS_URL\s*=\s*['"]\/css\/ledger-flow\.css\?v=(\d+)['"]/);
  const networkPulseCssMatch = networkPulse.match(/NETWORK_PULSE_CSS_URL\s*=\s*['"]\/css\/network-pulse\.css\?v=(\d+)['"]/);
  const stakingChamberCssMatch = stakingChamber.match(/STAKING_CSS_URL\s*=\s*['"]\/css\/staking-chamber\.css\?v=(\d+)['"]/);
  const networkHealthCssMatch = networkHealth.match(/NETWORK_HEALTH_CSS_URL\s*=\s*['"]\/css\/network-health\.css\?v=(\d+)['"]/);
  const maxisCssMatch = maxis.match(/MAXIS_CSS_URL\s*=\s*['"]\/css\/maxis\.css\?v=(\d+)['"]/);
  const themePreloadMatch = themePreload.match(/THEME_CSS_VERSION\s*=\s*['"](\d+)['"]/);
  const themeUiMatch = themeUi.match(/THEME_CSS_VERSION\s*=\s*['"](\d+)['"]/);

  if (!cssMatch) fail('index.html must serve css/styles.min.css with a ?v= cache stamp');
  if (!heroCssLinkMatch) fail('index.html must serve css/hero-search.css with a ?v= cache stamp');
  if (!siteMapCssLinkMatch) fail('index.html must serve css/site-map.css with a ?v= cache stamp');
  if (!appPreloadMatch) fail('index.html modulepreload for js/core/app.js must carry a ?v= cache stamp');
  if (!appScriptMatch) fail('index.html app module script must carry a ?v= cache stamp');
  if (!themePreloadScriptMatch) fail('index.html theme-preload.js script must carry a ?v= cache stamp');
  if (!cacheMatch) fail('sw.js CACHE_NAME must be tezos-systems-vNN');
  if (!heroSearchCssMatch) fail('search.js hero-search.css loader must carry a ?v= cache stamp');
  if (!shellExtrasCssMatch) fail('app.js shell-extras.css loader must carry a ?v= cache stamp');
  if (!leaderboardCssMatch) fail('leaderboard.js leaderboard.css loader must carry a ?v= cache stamp');
  if (!ledgerFlowCssMatch) fail('ledger-flow.js ledger-flow.css loader must carry a ?v= cache stamp');
  if (!networkPulseCssMatch) fail('network-pulse.js network-pulse.css loader must carry a ?v= cache stamp');
  if (!stakingChamberCssMatch) fail('staking-chamber.js staking-chamber.css loader must carry a ?v= cache stamp');
  if (!networkHealthCssMatch) fail('network-health.js network-health.css loader must carry a ?v= cache stamp');
  if (!maxisCssMatch) fail('maxis.js maxis.css loader must carry a ?v= cache stamp');
  if (!themePreloadMatch) fail('theme-preload.js must expose THEME_CSS_VERSION');
  if (!themeUiMatch) fail('theme.js must expose THEME_CSS_VERSION');

  const versions = [
    cssMatch?.[1],
    heroCssLinkMatch?.[1],
    siteMapCssLinkMatch?.[1],
    appPreloadMatch?.[1],
    appScriptMatch?.[1],
    themePreloadScriptMatch?.[1],
    cacheMatch?.[1],
    heroSearchCssMatch?.[1],
    shellExtrasCssMatch?.[1],
    leaderboardCssMatch?.[1],
    ledgerFlowCssMatch?.[1],
    networkPulseCssMatch?.[1],
    stakingChamberCssMatch?.[1],
    networkHealthCssMatch?.[1],
    maxisCssMatch?.[1]
  ].filter(Boolean);
  if (new Set(versions).size > 1) {
    fail(`cache stamps are out of sync: ${versions.join(', ')}`);
  } else if (versions.length === 15) {
    pass(`cache stamps aligned at v${versions[0]}`);
  }

  const themeVersions = [themePreloadMatch?.[1], themeUiMatch?.[1], cssMatch?.[1]].filter(Boolean);
  if (new Set(themeVersions).size > 1) {
    fail(`lazy theme CSS versions are out of sync: ${themeVersions.join(', ')}`);
  } else if (themeVersions.length === 3) {
    pass(`lazy theme CSS version aligned at v${themeVersions[0]}`);
  }

  if (!sw.includes("'/version.json'") && !sw.includes('/version.json')) {
    fail('sw.js must handle version.json freshness');
  } else {
    pass('service worker handles version.json freshness');
  }

  const shellAssetsBlock = sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/)?.[1] || '';
  for (const optionalAsset of ["'/anthology/'", "'/pulse/'", "'/widgets/builder.html'", "'/css/styles.css'", "'/css/network-health.css'", "'/data/maxis/manifest.json'"]) {
    if (shellAssetsBlock.includes(optionalAsset)) fail(`sw.js install shell should not precache optional asset ${optionalAsset}`);
  }
  for (const contract of ['RUNTIME_CACHE_LIMIT', "_quality: { status: 'unavailable', observedAt: null }"]) {
    if (!sw.includes(contract)) fail(`sw.js bounded runtime/explicit API failure contract missing ${contract}`);
  }
  if (sw.includes('staleApiFallback') || sw.includes('API_CACHE_MAX_AGE_MS')) {
    fail('sw.js must not return cached API payloads as successful current responses to provenance-unaware consumers');
  }
  if (!shellAssetsBlock.includes("'/offline.html'") || !sw.includes("caches.match('/offline.html')")) {
    fail('sw.js must precache and serve the self-contained offline navigation page');
  }
  pass('service worker uses a small install shell, bounded runtime cache, explicit API failures, and an offline navigation page');

  if (!index.includes('<meta property="og:image:width" content="1200">') || !index.includes('<meta property="og:image:height" content="630">')) {
    fail('index.html root OG image metadata must match generated og-image.png at 1200x630');
  } else {
    pass('root OG image dimensions match generator output');
  }

  if (!app.includes("fetch('/version.json'")) {
    fail('app.js must fetch /version.json from the site root so clean route pages do not request nested version metadata');
  } else {
    pass('app.js fetches version metadata from the site root');
  }
}

async function checkCsp() {
  const index = await readText('index.html');
  const cspMatch = index.match(/http-equiv=["']Content-Security-Policy["'][^>]*content="([^"]+)"/i)
    || index.match(/http-equiv=["']Content-Security-Policy["'][^>]*content='([^']+)'/i);
  if (!cspMatch) {
    fail('index.html is missing a Content-Security-Policy meta tag');
    return;
  }

  const csp = cspMatch[1];
  const requiredScript = [
    'cdn.jsdelivr.net',
    'https://esm.sh'
  ];
  for (const domain of requiredScript) {
    if (!csp.includes(domain)) fail(`CSP script-src is missing ${domain}`);
  }

  const requiredConnect = [
    'api.coingecko.com',
    '*.tzkt.io',
    'api.tezos.domains',
    '*.rpc.tez.capital',
    '*.supabase.co',
    'data.objkt.com',
    'api.github.com',
    'cdn.jsdelivr.net',
    'https://esm.sh',
    '*.octez.io',
    'teztale-server-mainnet-ro-prd.octez.tech',
    'wss://*.octez.io',
    'https://*.papers.tech',
    'wss://*.papers.tech',
    'wss://relay.walletconnect.com',
    'api.llama.fi',
    'explorer.etherlink.com',
    'node.mainnet.etherlink.com'
  ];
  for (const domain of requiredConnect) {
    if (!csp.includes(domain)) fail(`CSP connect-src is missing ${domain}`);
  }
  const mediaDirective = csp.match(/media-src\s+([^;]+)/)?.[1] || '';
  for (const domain of ['assets.objkt.media', 'dweb.link', 'nftstorage.link', 'ipfs.io', 'gateway.pinata.cloud']) {
    if (!mediaDirective.includes(domain)) fail(`CSP media-src is missing HEN media gateway ${domain}`);
  }
  pass('CSP includes required live-data domains');
}

async function checkSitemapCoverage() {
  const sitemap = await readText('sitemap.xml');
  const locs = new Set(Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)).map((match) => match[1].replaceAll('&amp;', '&')));
  const source = await readText('js/core/site-map.js');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const { siteMapSitemapEntries } = await import(moduleUrl);
  const expected = new Set(siteMapSitemapEntries().map((entry) => new URL(entry.href, 'https://tezos.systems').toString()));

  for (const url of expected) {
    if (!locs.has(url)) fail(`sitemap.xml missing ${url}`);
  }
  for (const url of locs) {
    if (!expected.has(url)) fail(`sitemap.xml contains a route outside the canonical site map: ${url}`);
    if (url.includes('#')) fail(`sitemap.xml should use crawlable paths instead of hash fragments: ${url}`);
  }

  const canonicalPages = {
    'landing.html': 'https://tezos.systems/',
    'staking/index.html': 'https://tezos.systems/staking/',
    'governance/index.html': 'https://tezos.systems/governance/',
    'bakers/index.html': 'https://tezos.systems/bakers/',
    'hen/index.html': 'https://tezos.systems/hen/',
    'widgets/builder.html': 'https://tezos.systems/widgets/builder.html'
  };
  for (const file of await walk('widgets', (name) => name.endsWith('.html') && !name.endsWith('/builder.html'))) {
    canonicalPages[file] = `https://tezos.systems/${file}`;
  }
  for (const [file, canonical] of Object.entries(canonicalPages)) {
    const html = await readText(file);
    if (!html.includes(`<link rel="canonical" href="${canonical}">`)) fail(`${file} canonical URL must agree with the site map: ${canonical}`);
    if (file === 'landing.html' && !html.includes(`<meta property="og:url" content="${canonical}">`)) {
      fail(`landing.html Open Graph URL must agree with its Dashboard canonical: ${canonical}`);
    }
  }

  pass(`canonical sitemap equality checked: ${locs.size} URLs`);
}

async function checkSelectorContracts() {
  const index = await readText('index.html');
  const governanceLanding = await readText('governance/index.html');
  const landingLiveData = await readText('js/landing/live-data.js');
  const shareSnippetSource = await readText('js/ui/share.js');
  const requiredIds = [
    'price-bar',
    'ctez-launcher',
    'tzsafe-launcher',
    'features-gear',
    'features-dropdown',
    'ctez-feature-btn',
    'tzsafe-feature-link',
    'chambers-toggle',
    'chambers-section',
    'chambers-grid',
    'block-ticker-strip',
    'block-ticker-line',
    'header-protocol-chip',
    'header-current-protocol',
    'upgrade-clock',
    'hero-slot',
    'hero-search-form',
    'hero-search-input',
    'hero-search-panel',
    'recruit-section',
    'tezos-loop-console',
    'tezos-loop-title',
    'tezos-loop-line',
    'tezos-loop-hints',
    'tezos-loop-search',
    'tezos-loop-link',
    'comparison-summary',
    'widgets-gallery',
    'settings-gear',
    'settings-dropdown',
    'my-tezos-btn',
    'my-tezos-drawer',
    'drawer-close',
    'calc-toggle',
    'calculator-section',
    'share-btn',
    'changelog-btn',
    'changelog-modal',
    'history-copy-link',
    'governance-alert-strip',
    'build-version'
  ];

  for (const id of requiredIds) {
    if (!index.includes(`id="${id}"`)) fail(`index.html missing required QA selector #${id}`);
  }
  pass(`required QA selectors checked: ${requiredIds.length}`);

  const requiredSnippets = [
    ['feature launcher grouped menu', 'class="settings-dropdown feature-launcher"'],
    ['feature launcher command center title', 'Command Center'],
    ['feature launcher happening now group', 'Happening Now'],
    ['feature launcher Tezos Domains row', 'id="domains-feature-link"'],
    ['feature launcher legacy group', 'feature-launcher-group feature-launcher-legacy'],
    ['combined chambers launcher copy link', 'data-copy-hash="#chambers"'],
    ['direct feature copy links', 'data-copy-hash="#compare"'],
    ['widget embed utility panel', 'class="widget-utility-panel"'],
    ['widget embed utility hidden by default', 'class="stats-section widget-utility-section toggleable-section"'],
    ['widget builder CTA', 'href="/widgets/builder.html"'],
    ['share picker styles hook', 'section-picker-note'],
    ['price bar change surface', 'class="price-change"'],
    ['price bar cycle health launcher', 'class="cycle-chip" id="cycle-chip" href="#health"'],
    ['Tezos loop console', 'class="tezos-loop-console"'],
    ['Tezos loop aura chip rail', 'class="tezos-loop-chips"'],
    ['Tezos loop start-anywhere copy', 'Start from anything.'],
    ['Tezos loop accepted inputs', 'Paste a wallet address or .tez name, baker, KT1 contract, operation hash, block, protocol, or slash command'],
    ['hero command bar placeholder copy', 'Search every feature or paste any Tezos ID…'],
    ['timeline share fallback host', 'document.querySelector(\'.upgrade-badges\')'],
    ['timeline share protocol history chamber fallback', 'document.querySelector(\'#protocol-history-chamber-modal .protocol-history-chamber-header\')'],
    ['header protocol chip', 'id="header-protocol-chip" href="#protocol-history"'],
    ['command deck shell', 'class="upgrade-clock command-deck"'],
    ['hero command bar slot', 'class="hero-slot" id="hero-slot"'],
    ['hero command bar combobox', 'aria-controls="hero-search-panel"'],
    ['My Tezos recruit prompt', 'data-hero-query="my tezos"'],
    ['Price watcher recipe chip', 'data-loop-aura="price"'],
    ['Governance alert strip shell', 'class="stats-section governance-alert-section"'],
    ['History modal direct link copy button', 'id="history-copy-link" data-copy-hash="#history"'],
    ['Governance SEO nonblank voting fallback', 'data-live="voting-period">Checking TzKT', governanceLanding],
    ['Governance SEO source freshness note', 'data-live="governance-freshness"', governanceLanding],
    ['Governance SEO retry fallback', 'Live governance status is retrying', landingLiveData],
    ['Governance SEO checked-at freshness helper', 'function checkedAtLabel', landingLiveData]
  ];

  for (const [label, snippet, source] of requiredSnippets) {
    const text = source || `${index}\n${shareSnippetSource}`;
    if (!text.includes(snippet)) {
      fail(`missing selector contract: ${label}`);
    }
  }
  pass(`new UX selector contracts checked: ${requiredSnippets.length}`);

  const uptimeClusterStart = index.indexOf('<div class="top-uptime-cluster">');
  const milestoneMarkerIndex = index.indexOf('<a class="top-continuity-milestone-info"', uptimeClusterStart);
  const uptimeYearIndex = index.indexOf('<button class="top-continuity-history"', uptimeClusterStart);
  if (uptimeClusterStart < 0 || milestoneMarkerIndex < uptimeClusterStart || uptimeYearIndex < uptimeClusterStart || milestoneMarkerIndex < uptimeYearIndex) {
    fail('header milestone marker must follow the uptime/year counter inside the uptime cluster');
  }

  const chambersLauncherIndex = index.indexOf('id="chambers-toggle"');
  const ctezLauncherIndex = index.indexOf('id="ctez-feature-btn"');
  const legacyLauncherIndex = index.indexOf('feature-launcher-group feature-launcher-legacy');
  if (chambersLauncherIndex < 0 || ctezLauncherIndex < 0 || chambersLauncherIndex > ctezLauncherIndex) {
    fail('Explore launcher must keep Chambers ahead of ctez recovery tools');
  }
  if (legacyLauncherIndex < 0 || ctezLauncherIndex < 0 || legacyLauncherIndex > ctezLauncherIndex) {
    fail('Explore launcher ctez recovery tools must stay inside the legacy group');
  }
  pass('Explore launcher hierarchy checked');

  const retiredLauncherSnippets = [
    ['individual Chamber launcher', 'id="chamber-toggle"'],
    ['individual LB launcher', 'id="liquidity-baking-toggle"'],
    ['individual tz4 launcher', 'id="tz4-adoption-toggle"'],
    ['individual tz4 launcher copy link', 'feature-copy-link" type="button" data-copy-hash="#tz4"']
  ];
  for (const [label, snippet] of retiredLauncherSnippets) {
    if (index.includes(snippet)) fail(`retired launcher still present: ${label}`);
  }
  pass(`retired chamber launcher contracts checked: ${retiredLauncherSnippets.length}`);

  const app = await readText('js/core/app.js');
  const siteMap = await readText('js/core/site-map.js');
  const siteNav = await readText('js/landing/site-nav.js');
  const search = await readText('js/features/search.js');
  const heroSearchCss = await readText('css/hero-search.css');
  const shellExtrasCss = await readText('css/shell-extras.css');
  const loadingCss = await readText('css/loading.css');
  const henModeCss = await readText('css/hen-mode.css');
  const henMode = await readText('js/features/hen-mode.js');
  const henPage = await readText('hen/index.html');
  const objkt = await readText('js/features/objkt.js');
    const chamber = await readText('js/features/chamber.js');
    const lb = await readText('js/features/liquidity-baking.js');
    const api = await readText('js/core/api.js');
    const tezlink = await readText('js/features/tezlink.js');
  const etherlinkGovernance = await readText('js/features/etherlink-governance.js');
  const tz4 = await readText('js/features/tz4-adoption.js');
  const ctez = await readText('js/features/ctez.js');
  const ledgerFlow = await readText('js/features/ledger-flow.js');
  const tezosDomains = await readText('js/features/tezos-domains.js');
  const maxis = await readText('js/features/maxis.js');
  const chamberAccessibility = await readText('js/ui/chamber-accessibility.js');
  const wallet = await readText('js/core/wallet.js');
  const health = await readText('js/features/network-health.js');
  const networkPulse = await readText('js/features/network-pulse.js');
  const history = await readText('js/features/history.js');
  const share = await readText('js/ui/share.js');
  const moments = await readText('js/features/moments.js');
  const streak = await readText('js/features/streak.js');
  const toastQueue = await readText('js/ui/toast-queue.js');
  const governanceAlerts = await readText('js/features/governance-alerts.js');
  const leaderboard = await readText('js/features/leaderboard.js');
  const myTezos = await readText('js/features/my-tezos.js');
  const myBaker = await readText('js/features/my-baker.js');
  const comparison = await readText('js/features/comparison.js');
  const compareIndex = await readText('compare/index.html');
  const chamberRoutes = await readText('scripts/lib/chamber-routes.mjs');
  const chamberRouteGenerator = await readText('scripts/generate-chamber-routes.mjs');
  const themeUi = await readText('js/ui/theme.js');
  const styles = await readText('css/styles.css');
  const networkHealthCss = await readText('css/network-health.css');
  const healthStyles = `${styles}\n${networkHealthCss}`;
  const leaderboardCss = await readText('css/leaderboard.css');
  const networkPulseCss = await readText('css/network-pulse.css');
  const stakingChamber = await readText('js/features/staking-chamber.js');
  const stakingChamberCss = await readText('css/staking-chamber.css');
  const ledgerFlowCss = await readText('css/ledger-flow.css');
  const maxisCss = await readText('css/maxis.css');
  const tezosDomainsCss = await readText('css/tezos-domains.css');
  const deepLinkContracts = [
    ['Chamber hash route', "hash === 'chamber'", app],
    ['Chambers hash route', "hash === 'chambers'", app],
    ['Tezos X Governance hash route', "hash === 'l2chamber'", app],
    ['Tezos X hash route', "hash === 'tezosx'", app],
    ['Legacy Tezlink hash route', "hash === 'tezlink'", app],
    ['Network Pulse hash route', "hash === 'pulse'", app],
    ['Health hash route', "hash === 'health'", app],
    ['Ledger Flow hash route', "hash === 'ledger-flow'", app],
    ['Ledger Flow scoped hash route', "params.has('ledger-flow')", app],
    ['Ledger Flow modal cleanup', 'closeLedgerFlowChamber', app],
    ['Domains hash route', "hash === 'domains'", app],
    ['Domains legacy hash route', "hash === 'tezos-domains'", app],
    ['Domains modal cleanup', 'closeTezosDomainsChamber', app],
    ['Protocol history hash route', "params.has('protocol')", app],
    ['Protocol History Chamber hash route', "hash === 'protocol-history'", app],
    ['Protocol history global opener', 'window.openProtocolHistoryByName = openProtocolHistoryByName', app],
    ['Protocol History Chamber global opener', 'window.openProtocolHistoryChamber = openProtocolHistoryChamber', app],
    ['Protocol History header launcher', 'function initProtocolHistoryHeaderLauncher', app],
    ['Protocol History chamber current-first timeline', 'const displayProtocols = isHistoryChamber ? [...protocols].reverse() : protocols', app],
    ['Protocol History Chamber card', "card.id = 'protocol-history-entry-card'", app],
    ['Protocol Anthology card copy', 'Protocol Anthology', app],
    ['Protocol Anthology pretty route map', "href: '/anthology/'", siteMap],
    ['Protocol Anthology crawlable route source', "slug: 'anthology'", chamberRoutes],
    ['Protocol Anthology card anatomy', 'protocol-history-entry-anthology', app],
    ['Protocol Anthology recent spines', 'protocol-history-entry-spine-item', app],
    ['Protocol Anthology curator board', 'protocol-history-anthology-board', app],
    ['Protocol Anthology real-data renderer', 'function renderProtocolAnthologyBoard', app],
    ['Protocol Anthology protocol open chips', 'data-protocol-open', app],
    ['Protocol Anthology living archive strip', 'protocol-anthology-live', app],
    ['Protocol Anthology clash map renderer', 'protocol-anthology-clash-map', app],
    ['Protocol Anthology metrics styles', '.protocol-anthology-metrics', heroSearchCss],
    ['Protocol Anthology shelves styles', '.protocol-anthology-shelves', heroSearchCss],
    ['Protocol Anthology clash styles', '.protocol-anthology-clash', heroSearchCss],
    ['Protocol Anthology timeline crowd styles', '.contention-crowd', heroSearchCss],
    ['Protocol History Chamber modal', "overlay.id = 'protocol-history-chamber-modal'", app],
    ['Protocol History Chamber timeline launcher', 'data-protocol-history-jump="timeline"', app],
    ['Protocol History Chamber impact launcher', 'data-protocol-history-jump="impact"', app],
    ['Protocol History stable read button', 'history-expand-btn', app],
    ['Protocol History print button', 'history-modal-print', app],
    ['Protocol History print helper', 'function printProtocolHistory', app],
    ['Protocol History Chamber reveal helper', 'function revealProtocolHistorySection', app],
    ['shared Chamber launcher article semantics', "card.setAttribute('role', 'article')", chamberAccessibility],
    ['shared Chamber native Open action', "cue.tagName !== 'BUTTON'", chamberAccessibility],
    ['shared Chamber focus trap', "event.key !== 'Tab'", chamberAccessibility],
    ['shared Chamber Escape close', "event.key === 'Escape'", chamberAccessibility],
    ['shared Chamber opener restoration', 'state?.opener?.isConnected', chamberAccessibility],
    ['Protocol Anthology accessible launcher', 'wireChamberLauncher(card', app],
    ['Tezos X accessible launcher and dialog', 'activateChamberDialog(overlay', tezlink],
    ['Tezos X Governance accessible launcher and dialog', 'activateChamberDialog(overlay', etherlinkGovernance],
    ['tz4 accessible launcher and dialog', 'activateChamberDialog(overlay', tz4],
    ['Ledger Flow accessible launcher and dialog', 'activateChamberDialog(overlay', ledgerFlow],
    ['Tezos Domains accessible launcher and dialog', 'activateChamberDialog(overlay', tezosDomains],
    ['Network Health accessible launcher', 'wireChamberLauncher(card', health],
    ['Tezos Maxis accessible launcher', 'wireChamberLauncher(card', maxis],
    ['Protocol History Chamber timeline toggle target', 'protocol-timeline-toggle-btn', app],
    ['Protocol History Chamber action styles', '.protocol-history-chamber-action', heroSearchCss],
    ['Hero search mode body class', "document.body.classList.toggle('hero-search-mode'", search],
    ['Hero search dims background content', 'body.hero-search-mode .main-content', heroSearchCss],
    ['Hero search raises command deck', 'body.hero-search-mode .command-deck', heroSearchCss],
    ['Hero search empty-state guide', 'hero-search-guide', search],
    ['Hero search guide styles', '.hero-search-guide', heroSearchCss],
    ['Hero search imports ranked site map search', 'searchSiteMap', search],
    ['Hero search derives starter rows from site map', 'siteMapStarters', search],
    ['Hero search derives quick chips from site map', 'siteMapSearchChips', search],
    ['Hero search uses canonical site-map routes', 'siteMapRoute', search],
    ['Hero search root hash page normalization', 'const rootHashEntry', search],
    ['Site map manifest exports groups', 'SITE_MAP_NAV_GROUPS', siteMap],
    ['Site map manifest includes anthology route', "href: '/anthology/'", siteMap],
    ['Site map manifest includes Network Pulse route', "href: '/pulse/'", siteMap],
    ['Landing pages share site nav renderer', 'function renderFooter()', siteNav],
    ['Hero search runtime-only quick chips', 'RUNTIME_QUICK_CHIPS', search],
    ['Hero search runtime-only commands', 'RUNTIME_COMMANDS', search],
    ['Hero search complete browse index', 'siteMapBrowseEntries', search],
    ['Hero search complete nested view index', 'siteMapBrowseIntents', search],
    ['Hero search manifest subfeature intents', 'searchSiteMapIntents', search],
    ['Hero search explicit mobile close', 'id="hero-search-close"', index],
    ['Hero search runtime changelog command', "title: '/changelog'", search],
    ['Hero search runtime export command', "title: '/export'", search],
    ['Hero search mobile fixed command sheet', 'body.hero-search-mode .command-deck', heroSearchCss],
    ['Hero search mobile query shortcut collapse', '.hero-slot.has-query .hero-search-chips', heroSearchCss],
    ['Top continuity mobile explainer reserves flow', '.top-continuity-explain.is-visible', shellExtrasCss],
    ['Hero search .tez scoped Domains route', '#domains=${encodeURIComponent(domain)}', search],
    ['Hero search Ledger Flow command', 'Ledger Flow', search],
    ['Hero search Ledger Flow scoped account route', '#ledger-flow=${encodeURIComponent(q)}', search],
    ['Hero search KT1 starter route', "['kt1', 'KT1 Contracts']", search],
    ['Hero search grouped visual order normalization', 'groupOrderedResults', search],
    ['Hero search Maxi Passport intent route', '/maxis/?view=passport', siteMap],
    ['Hero search Maxis Season intent route', '/maxis/?view=season', siteMap],
    ['Hero search address-scoped Maxi Passport route', 'view=passport&address=${encodeURIComponent(target)}', search],
    ['Tezos loop console initializer', 'function initTezosLoopConsole()', app],
    ['Tezos loop aura persistence', 'TEZOS_LOOP_STORAGE_KEY', app],
    ['Tezos loop console styles', '.tezos-loop-console', heroSearchCss],
    ['Tezos loop active chip styles', '.tezos-loop-chip.active', heroSearchCss],
    ['Hero search explicit full-directory mode', 'data-hero-browse-all="true"', search],
    ['Standalone footer progressive disclosure', 'class="site-map-disclosure"', siteNav],
    ['Hero search manifest page result adapter', 'function siteMapResult', search],
    ['LB tile hash route', "hash === 'lb-tile'", app],
    ['tz4 hash route', "hash === 'tz4'", app],
    ['comparison summary renderer', 'function renderComparisonSummary', comparison],
    ['comparison summary standing copy', 'Self-upgrading baseline', comparison],
    ['comparison summary grid', 'comparison-standing-grid comparison-grid', comparison],
    ['comparison hub standing summary', 'Where the major proof-of-stake chains stand', compareIndex],
    ['comparison hub all peer links', '/compare/tezos-vs-algorand.html', compareIndex],
    ['Chambers launcher button', 'id="chambers-toggle"', index],
    ['Chambers launcher copy link', 'data-copy-hash="#chambers"', index],
    ['Network Pulse launcher copy link', 'data-copy-hash="#pulse"', index],
    ['Chambers section info button', 'id="chambers-info-btn"', index],
    ['Chambers info modal wiring', "setupModal('chambers-info-btn', 'chambers-modal', 'chambers-modal-close')", app],
    ['Collapsed header inline spacing reset', "header.style.marginBottom = '0'", app],
    ['Chambers visibility storage', 'tezos-systems-chambers-visible', app],
    ['Pretty chamber path route map', 'function getPrettyChamberPathRoute()', app],
    ['Pretty chamber route resolves through site map', 'findCurrentSiteMapEntry({', app],
    ['Pretty chamber route uses canonical hash identity', "entry.hash.replace(/^#/, '')", app],
    ['Dashboard footer uses site map renderer', 'function initSiteFooterMap', app],
    ['Dashboard footer map shell hook', 'data-site-footer-map', index],
    ['Dashboard footer map grid hook', 'data-site-map-grid', index],
    ['Pretty chamber route generator hydrates dashboard shell', "dashboardShell = await fs.readFile", chamberRouteGenerator],
    ['Network Pulse feature import', 'initNetworkPulseChamber', app],
    ['Network Pulse card copy link', 'data-copy-hash="#pulse"', networkPulse],
    ['Network Pulse modal', 'network-pulse-modal', networkPulse],
    ['Network Pulse lazy CSS loader', 'network-pulse-css', networkPulse],
    ['Network Pulse real cache timestamp', 'loadStatsTimestamp', networkPulse],
    ['Network Pulse history data fetch', 'fetchHistoricalData', networkPulse],
    ['Network Pulse chamber history data fetch', 'fetchChamberHistoricalData', networkPulse],
    ['Network Pulse Market category', "id: 'market'", networkPulse],
    ['Network Pulse Market source cards', "source: 'market'", networkPulse],
    ['Network Pulse sourced freshness label', 'network-pulse-source-age', networkPulse],
    ['Network Pulse card history modal', 'openCardHistoryModal', networkPulse],
    ['Network Pulse semantic room source', "siteMapRelated('pulse', 4)", networkPulse],
    ['Network Pulse nav buttons avoid hash pollution', 'data-pulse-target', networkPulse],
    ['Network Pulse scrollspy wiring', 'IntersectionObserver', networkPulse],
    ['Network Pulse delta chip markup', 'network-pulse-delta', networkPulse],
    ['Network Pulse entry delta chip', 'network-pulse-entry-delta', networkPulse],
    ['Network Pulse entry cell jumps', 'data-pulse-jump', networkPulse],
    ['Network Pulse entry semantic article', "document.createElement('article')", networkPulse],
    ['Network Pulse explicit open action', 'network-pulse-entry-open', networkPulse],
    ['Network Pulse entry header freshness', 'network-pulse-entry-freshness', networkPulse],
    ['Network Pulse entry history value fallback', 'latestMetricValue(lastEntryHistoryRows, metric.history)', networkPulse],
    ['Network Pulse partial hero merge', "event?.detail?.source === 'hero'", networkPulse],
    ['Network Pulse tiered top mover', "tier: 'structural'", networkPulse],
    ['Network Pulse quiet ballot guard', 'quietWhen: isGovernanceBallotQuiet', networkPulse],
    ['Network Pulse USD delta prefix', "deltaPrefix: '$'", networkPulse],
    ['Network Pulse sparkline markup', 'network-pulse-sparkline', networkPulse],
    ['Network Pulse history button markup', 'data-pulse-history', networkPulse],
    ['Network Pulse card grid CSS', '.network-pulse-card-grid', networkPulseCss],
    ['Network Pulse dense entry cells CSS', '.network-pulse-entry-metric', networkPulseCss],
    ['Network Pulse flex entry header CSS', '.network-pulse-entry-head', networkPulseCss],
    ['Network Pulse hover headline transform guard', 'network-pulse-entry-card:hover .network-pulse-entry-value', networkPulseCss],
    ['Network Pulse entry footer cue alignment', '.network-pulse-entry-card .chamber-entry-footer', networkPulseCss],
    ['Network Pulse explicit open action styles', '.network-pulse-entry-open', networkPulseCss],
    ['Network Pulse entry sparkline CSS', '.network-pulse-entry-sparkline', networkPulseCss],
    ['Network Pulse loading state CSS', '.network-pulse-field.is-loading', networkPulseCss],
    ['Network Pulse scroll-margin CSS', 'scroll-margin-top', networkPulseCss],
    ['Network Pulse active nav CSS', '.network-pulse-nav button.active', networkPulseCss],
    ['Network Pulse mobile nav wraps on phones', 'flex-wrap: wrap', networkPulseCss],
    ['Network Pulse direct footer link', 'Direct: /pulse/', networkPulse],
    ['Network Pulse pretty route', "slug: 'pulse'", chamberRoutes],
    ['Network Pulse chamber pair', "key: 'network-pulse'", app],
    ['Network Pulse share route', 'siteMapCanonicalRoute', share],
    ['Network Pulse hero stats spread', '...heroStats', app],
    ['Network Pulse hero stats fallback event', "source: 'hero'", app],
    ['Network Pulse delegated hero stat', 'delegatedRatio: staking.delegatedRatio', api],
    ['API request deadline', 'DEFAULT_FETCH_TIMEOUT_MS', api],
    ['API caller abort forwarding', "callerSignal.addEventListener('abort', forwardAbort", api],
    ['API Retry-After cap', 'MAX_RETRY_AFTER_MS', api],
    ['API aggregate quality receipt', 'qualityFromSettled', api],
    ['API failed category receipt', 'failedCategories', api],
    ['API unavailable APY receipt', "status: 'unavailable'", api],
    ['API service-worker stale receipt', "response.headers.get('X-Tezos-Systems-Cache') !== 'stale'", api],
    ['API stale memory-cache guard', "memoryCache && provenance?.status !== 'stale'", api],
    ['Network Pulse XTZ price card history', "'xtz-price'", history],
    ['Network Pulse market cap card history', "'market-cap'", history],
    ['Network Pulse L2 transactions card history', "'l2-transactions'", history],
    ['Staking Chamber feature import', 'initStakingChamber', app],
    ['Staking Chamber hash route', "hash === 'staking'", app],
    ['Staking Chamber legacy short hash route', "hash === 'stake'", app],
    ['Staking Chamber pretty route opens without hash redirect', "case 'staking':", app],
    ['Staking Chamber modal cleanup', 'closeStakingChamber', app],
    ['Staking Chamber card pair', "key: 'staking'", app],
    ['Staking Chamber card copy link', 'data-copy-hash="#staking"', stakingChamber],
    ['Staking Chamber card ratio', 'id="staking-entry-ratio"', stakingChamber],
    ['Staking Chamber two-action tape', "renderEntryMove('stake', data?.stake)}${renderEntryMove('unstake', data?.unstake)", stakingChamber],
    ['Staking Chamber modal', "overlay.id = 'staking-chamber-modal'", stakingChamber],
    ['Staking Chamber canonical current ratio', 'fetchStakingRatio()', stakingChamber],
    ['Staking Chamber 7-day ratio context', "fetchHistoricalData('7d')", stakingChamber],
    ['Staking Chamber strict actual-amount threshold', 'return amountMutez(row) > LARGE_MOVE_THRESHOLD_MUTEZ', stakingChamber],
    ['Staking Chamber applied-operation filter', "params.set('status', 'applied')", stakingChamber],
    ['Staking Chamber cursor archive scan', "params.set('offset.cr', String(cursor))", stakingChamber],
    ['Staking Chamber compact archive select', "'id,timestamp,amount'", stakingChamber],
    ['Staking Chamber visible receipt hydration', "params.set('id.in', ids.join(','))", stakingChamber],
    ['Staking Chamber 24-hour gross and net flow', 'data-staking-flow="net"', stakingChamber],
    ['Staking Chamber mover trail', 'id="staking-mover-panel"', stakingChamber],
    ['Staking Chamber Ledger Flow drilldown', 'href="#ledger-flow=${encodeURIComponent(moverTrail.address)}"', stakingChamber],
    ['Staking Chamber complete-history disclosure', 'All applied moves over 10,000 ꜩ', stakingChamber],
    ['Staking Chamber exact-10K exclusion disclosure', 'Exactly 10,000 ꜩ is excluded.', stakingChamber],
    ['Staking Chamber direct footer link', 'Direct: /stake/', stakingChamber],
    ['Staking Chamber crawlable route source', "slug: 'stake'", chamberRoutes],
    ['Staking Chamber site-map route', "href: '/stake/'", siteMap],
    ['Staking Chamber hero-search manifest source', 'siteMapSearchChips()', search],
    ['Staking Chamber share route', 'siteMapCanonicalRoute', share],
    ['Staking Chamber narrow desktop pair', 'grid-template-columns: minmax(0, 29rem)', stakingChamberCss],
    ['Staking Chamber narrow desktop cap', 'max-width: 29rem', stakingChamberCss],
    ['Staking Chamber mobile single-column pair', 'grid-template-columns: minmax(0, 1fr)', stakingChamberCss],
    ['Staking Chamber mobile operation rows', '.staking-operation-row {', stakingChamberCss],
    ['Chamber card copy link', 'data-copy-hash="#chamber"', chamber],
    ['Tezos L1 Governance card label', 'Tezos L1 Governance', chamber],
    ['Chamber current state panel', 'id="chamber-now-panel"', chamber],
    ['Chamber current state watch list', 'chamber-now-watch', chamber],
    ['Chamber current state styles', '.chamber-now-panel', styles],
    ['Chamber proposal intel panel', 'id="chamber-proposal-intel"', chamber],
    ['Chamber gap analysis panel', 'id="chamber-gap-analysis"', chamber],
    ['Chamber promotion delta uses epoch periods', '(epoch.periods || []).find', chamber],
    ['Chamber branded share capture helper', 'captureBrandedChamberShare', share],
    ['Chamber share direct link baked into image', 'tezos.systems/chamber/', chamber],
    ['Governance alerts reuse voting status', 'fetchVotingStatus', governanceAlerts],
    ['Governance alerts reuse My Tezos vote signal', 'fetchBakerVoteStatus', governanceAlerts],
    ['Governance alerts expose RSS action', 'href="/feed.xml"', governanceAlerts],
    ['Governance alerts browser reminder opt-in', 'Notification.requestPermission', governanceAlerts],
    ['My Tezos exports baker vote check', 'export async function fetchBakerVoteStatus', myTezos],
    ['My Tezos Morning Brief vote card', "title: 'Vote Check'", myTezos],
    ['Tezos X Governance card copy link', 'data-copy-hash="#l2chamber"', etherlinkGovernance],
    ['Tezos X Governance L2 dashboard note', 'L2 Governance · FAST', etherlinkGovernance],
    ['Tezos X Governance direct footer link', 'Direct: /l2chamber/', etherlinkGovernance],
    ['Tezos X Governance chamber wiring', 'openEtherlinkGovernanceChamber', etherlinkGovernance],
    ['Tezos X Governance TzKT discovery', 'discoverGovernanceTracks', etherlinkGovernance],
    ['Tezos X Governance originator guard', 'GOVERNANCE_CONTRACT_CREATOR', etherlinkGovernance],
    ['Tezos X Governance discovery failure copy', 'contract discovery unavailable', etherlinkGovernance],
    ['Tezos X Governance track rules panel', 'id="etherlink-gov-rules"', etherlinkGovernance],
    ['Tezos X Governance track memory panel', 'id="etherlink-gov-memory"', etherlinkGovernance],
    ['Tezos X Governance merged timeline panel', 'id="etherlink-gov-timeline"', etherlinkGovernance],
    ['Tezos X card copy link', 'data-copy-hash="#tezosx"', tezlink],
    ['Tezos X direct footer link', 'Direct: /tezosx/', tezlink],
    ['Tezos X 30d trend panel', 'id="tezlink-trend-panel"', tezlink],
    ['Tezos X 30d trend fallback copy', 'formatDirectionDelta', tezlink],
    ['Tezos X 30d trend metric helper', 'renderTrendMetric', tezlink],
    ['Tezos X L1 anchor panel', 'id="tezlink-anchor-panel"', tezlink],
    ['Tezos X gas oracle panel', 'id="tezlink-gas-oracle"', tezlink],
    ['Tezos X top tokens panel', 'id="tezlink-token-panel"', tezlink],
    ['LB chamber copy link', 'data-copy-hash="#lb"', lb],
    ['LB entry vote tape rows', 'id="lb-entry-vote-rows"', lb],
    ['LB entry vote tape limit', 'LB_ENTRY_VOTE_LIMIT', lb],
    ['LB EMA forecast panel', 'id="lb-ema-forecast"', lb],
    ['LB EMA history panel', 'id="lb-ema-history"', lb],
    ['LB vote change feed', 'id="lb-vote-change-feed"', lb],
    ['Ledger Flow feature import', 'initLedgerFlowChamber', app],
    ['Ledger Flow card copy link', 'data-copy-hash="#ledger-flow"', ledgerFlow],
    ['Ledger Flow card info copy', 'ledger-flow-entry-card', app],
    ['Ledger Flow direct footer link', 'Direct: /ledger-flow/', ledgerFlow],
    ['Ledger Flow pretty route', "slug: 'ledger-flow'", chamberRoutes],
    ['Ledger Flow lazy CSS loader', 'ledger-flow-css', ledgerFlow],
    ['Ledger Flow sent color class', '.ledger-flow-edge-sent', ledgerFlowCss],
    ['Ledger Flow received color class', '.ledger-flow-edge-received', ledgerFlowCss],
    ['Ledger Flow first-funding color class', '.ledger-flow-edge-first', ledgerFlowCss],
    ['Ledger Flow card sent metric color hook', 'data-ledger-flow-metric="sent"', ledgerFlow],
    ['Ledger Flow card first metric color hook', 'data-ledger-flow-metric="first"', ledgerFlow],
    ['Ledger Flow card metric color CSS', '.chamber-entry-metric[data-ledger-flow-metric] strong', ledgerFlowCss],
    ['Ledger Flow threshold slider', 'id="ledger-flow-threshold"', ledgerFlow],
    ['Ledger Flow amount-weighted edge width', 'function edgeWidth', ledgerFlow],
    ['Ledger Flow first inbound fetch', 'async function fetchFirstInbound', ledgerFlow],
    ['Ledger Flow TzKT sender query', 'params.sender = address', ledgerFlow],
    ['Ledger Flow TzKT target query', 'params.target = address', ledgerFlow],
    ['Ledger Flow My Tezos counterparty links', '#my-baker=${encodeURIComponent(address)}', ledgerFlow],
    ['Ledger Flow compact TzKT pills', 'ledger-flow-tzkt-pill', ledgerFlow],
    ['Ledger Flow SVG TzKT node pills', 'ledger-flow-node-tzkt-link', ledgerFlow],
    ['Ledger Flow label-aware node width', 'function nodeGeometry', ledgerFlow],
    ['Tezos Domains feature import', 'initTezosDomainsChamber', app],
    ['Tezos Domains card copy link', 'data-copy-hash="#domains"', tezosDomains],
    ['Tezos Domains direct footer link', 'Direct: /domains/', tezosDomains],
    ['Tezos Domains pretty route', "slug: 'domains'", chamberRoutes],
    ['Tezos Domains lazy CSS loader', 'tezos-domains-css', tezosDomains],
    ['Tezos Domains live GraphQL endpoint', 'https://api.tezos.domains/graphql', tezosDomains],
    ['Tezos Domains name lookup query', 'query TezosDomainsNameLookup', tezosDomains],
    ['Tezos Domains lookup form', 'tezos-domains-lookup-input', tezosDomains],
    ['Tezos Domains scoped deep link opener', 'openTezosDomainsChamber(initialName', tezosDomains],
    ['Tezos Domains premium threshold', "MIN_HIGH_VALUE_MUTEZ = '25000000'", tezosDomains],
    ['Tezos Domains event query', 'recentEvents: events', tezosDomains],
    ['Tezos Domains reverse-record metric', 'reverseRecords24h: events', tezosDomains],
    ['Tezos Domains auction query', 'liveAuctions: auctions', tezosDomains],
    ['Tezos Domains sell offer query', 'sellOffers: offers', tezosDomains],
    ['Tezos Domains buy offer query', 'buyOffers: buyOffers', tezosDomains],
    ['Tezos Domains expiring soon query', 'expiringSoon: domains', tezosDomains],
    ['Tezos Domains 30-day expiration window', 'lessThanOrEqualTo: $soon', tezosDomains],
    ['Tezos Domains chamber modal', 'tezos-domains-modal', tezosDomains],
    ['Tezos Domains full-row pair', "key: 'tezos-domains'", app],
    ['Tezos Domains lookup panel CSS', '.td-lookup-panel', tezosDomainsCss],
    ['Tezos Domains final strip CSS', '[data-chamber-pair="tezos-domains"]', tezosDomainsCss],
    ['Tezos Domains share route', 'siteMapCanonicalRoute', share],
    ['ctez hash route', "hash === 'ctez'", app],
    ['ctez feature copy link', 'data-copy-hash="#ctez"', index],
    ['ctez top-left launcher', 'id="ctez-launcher"', index],
    ['ctez feature launcher', 'id="ctez-feature-btn"', index],
    ['TzSafe top-left launcher', 'id="tzsafe-launcher"', index],
    ['TzSafe feature launcher', 'id="tzsafe-feature-link"', index],
    ['TzSafe canonical external link', 'href="https://tzsafe.tez.page/"', index],
    ['TzSafe feature copy', 'KT1 Multisig Recovery', index],
    ['TzSafe cleanup hint', 'External cleanup path for legacy TzSafe KT1 safes', index],
    ['TzSafe external action button', 'feature-external-link" href="https://tzsafe.tez.page/"', index],
    ['TzSafe feature row polish', '.tzsafe-feature-link', henModeCss],
    ['TzSafe tray icon style', '.tzsafe-launcher', henModeCss],
    ['TzSafe key mark style', '.tzsafe-logo-key', henModeCss],
    ['HEN source all tab', 'data-hen-mode="all"', index],
    ['HEN source Teia tab', 'data-hen-mode="teia"', index],
    ['HEN source OBJKT tab', 'data-hen-mode="objkt"', index],
    ['HEN standalone canonical URL', '<link rel="canonical" href="https://tezos.systems/hen/">', henPage],
    ['HEN standalone live overlay', 'id="hen-overlay"', henPage],
    ['HEN standalone auto activator', '/js/features/hen-mode.js?v=94', henPage],
    ['HEN CSS cache stamp', 'css/hen-mode.css?v=96', index],
    ['HEN JS cache stamp', 'js/features/hen-mode.js?v=94', index],
    ['HEN setup status strip', 'id="hen-status-strip"', index],
    ['HEN permanent now line', 'id="hen-now-line"', index],
    ['HEN mobile filter toggle', 'id="hen-mobile-filter-toggle"', index],
    ['HEN persistent filter bar', 'id="hen-filterbar"', index],
    ['HEN for-sale filter control', 'id="hen-filter-listed"', index],
    ['HEN visible search input', 'id="hen-search-input"', index],
    ['HEN saved filter control', 'id="hen-filter-saved"', index],
    ['HEN hide-owned filter control', 'id="hen-filter-hide-owned"', index],
    ['HEN minimal wallet connect', 'id="hen-wallet-connect"', index],
    ['HEN minimal wallet input', 'id="hen-wallet-input"', index],
    ['HEN collector profile panel', 'id="hen-profile-panel"', index],
    ['HEN default mixed source mode', "const DEFAULT_FEED_MODE = 'all'", henMode],
    ['HEN source preference key', "const HEN_SOURCE_KEY = 'tezos-systems-hen-source'", henMode],
    ['HEN sort preference key', "const HEN_SORT_KEY = 'tezos-systems-hen-sort'", henMode],
    ['HEN favorites key', "const HEN_FAVORITES_KEY = 'tezos-systems-hen-favorites'", henMode],
    ['HEN eager-loads first two desktop rows', 'const HEN_EAGER_CARD_LIMIT = 8', henMode],
    ['HEN eager card limit controls lazy loading', 'staggerIdx < HEN_EAGER_CARD_LIMIT && offset === 0', henMode],
    ['HEN stable grid shell', '.hen-overlay.active {\n    display: grid;', henModeCss],
    ['HEN viewport row edge guard', '.hen-overlay > .hen-header,\n.hen-overlay > .hen-status-strip,\n.hen-overlay > .hen-feed,\n.hen-overlay > .hen-cli', henModeCss],
    ['HEN rows clamp to viewport width', 'max-width: 100vw;', henModeCss],
    ['HEN fixed status strip height', 'height: 44px;', henModeCss],
    ['HEN visible status line', 'position: static;\n    flex: 0 1 clamp', henModeCss],
    ['HEN filter bar does not wrap vertically', 'flex-wrap: nowrap;', henModeCss],
    ['HEN CLI scrollback anchors to overlay', "output.className = 'hen-cli-output'", henMode],
    ['HEN CLI scrollback is appended off-flow', 'ov.appendChild(output)', henMode],
    ['HEN mint pulse is a floating button', "pulseEl.className = 'hen-mint-pulse'", henMode],
    ['HEN scroll compensation for off-top live prepends', 'previousScrollHeight', henMode],
    ['HEN idle resets only on actual fresh mints', 'if (fresh.length > 0) {\n                resetIdleIndicator();', henMode],
    ['HEN paged live poll avoids skipping busy windows', 'async function fetchFreshTokens', henMode],
    ['HEN modal suppresses live chrome', 'if (!expandedActive) {\n                    showMintPulse', henMode],
    ['HEN global keys stop behind expander', 'if (expandedActive) return;', henMode],
    ['HEN now-playing throttle', 'NOW_PLAYING_MIN_INTERVAL', henMode],
    ['HEN sticky mint count is cumulative', 'pendingMintCount += freshTokens.length;', henMode],
    ['HEN token cache is capped', 'trimMapCache(tokenCache, TOKEN_CACHE_LIMIT)', henMode],
    ['HEN timestamp timer starts only while active', 'function startCardTimeUpdates', henMode],
    ['HEN CLI dismissal clears retained scrollback', 'if (reset !== false) cliScrollback = [];', henMode],
    ['HEN artist command validates addresses', '> invalid artist address', henMode],
    ['HEN GraphQL escape strips control chars', "replace(/[\\u0000-\\u001F\\u007F]/g, ' ')", henMode],
    ['HEN live paused sort status', 'live paused (sorted by ', henMode],
    ['HEN source tab live pulse', 'source-live-pulse', henMode],
    ['HEN platform edge rule classes', "card.className = 'hen-card hen-card-platform-' + platformKey(token)", henMode],
    ['HEN hover video playback path', 'function activateCardVideo', henMode],
    ['HEN random keyboard ritual', "case 'random': case 'r':", henMode],
    ['HEN CRT vibe command', "case 'crt': case 'vibe':", henMode],
    ['HEN now-playing overlay', 'function showNowPlaying', henMode],
    ['HEN warm glow opacity variable', '--warm-start-opacity', henMode],
    ['HEN saved filter uses every favorite key', 'var keys = Array.from(favoriteKeys);', henMode],
    ['HEN first-run hint key', "const HEN_HINT_DISMISSED_KEY = 'tezos-systems-hen-loop-hint-dismissed'", henMode],
    ['HEN viewer wallet key', "const HEN_VIEWER_KEY = 'tezos-systems-hen-viewer-address'", henMode],
    ['HEN My Tezos address key', "const MY_TEZOS_ADDRESS_KEY = 'tezos-systems-my-baker-address'", henMode],
    ['HEN periodic image retry delays', 'const DEFAULT_IMAGE_RETRY_DELAYS = [3000, 10000, 30000, 120000, 300000]', henMode],
    ['HEN retryable image handler', 'function setupImageRetry', henMode],
    ['HEN OBJKT CDN media base', "const OBJKT_ASSETS_BASE = 'https://assets.objkt.media/file/assets-003/'", henMode],
    ['HEN OBJKT CDN media helper', 'function mediaCdnUrl', henMode],
    ['HEN share meta prefers OBJKT CDN image', "var image = mediaCdnUrl(token, 'thumb400') || resolveUri(token.display_uri || token.thumbnail_uri || '');", henMode],
    ['HEN primary live IPFS gateway', "const IPFS_GW = 'https://dweb.link/ipfs/'", henMode],
    ['HEN nftstorage fallback gateway', "'https://nftstorage.link/ipfs/'", henMode],
    ['HEN CSP allows dweb fallback images', 'dweb.link nftstorage.link ipfs.io gateway.pinata.cloud', index],
    ['HEN direct-load blackout cleanup', 'function clearInitialBlackout', henMode],
    ['HEN blackout style removal', "document.getElementById('hen-initial-blackout')", henMode],
    ['HEN wallet connect bridge', 'async function connectWalletFromHen', henMode],
    ['HEN My Tezos sync bridge', 'rememberMyTezosAddress(viewerAddress', henMode],
    ['HEN Objkt profile reuse', 'mod.fetchObjktProfile(address)', henMode],
    ['OBJKT profile preserves tzdomain for HEN identity labels', 'tzdomain: holder.tzdomain || null', objkt],
    ['OBJKT profile recent acquisitions ordered by latest held increment', 'order_by: {last_incremented_at: desc}', objkt],
    ['OBJKT profile carries collection logos for HEN rows', 'fa { name contract collection_id logo }', objkt],
    ['OBJKT profile carries recent acquisition token ids for CDN thumbnails', 'tokenId: h.token.token_id', objkt],
    ['HEN public activator', 'window.HenMode = HenMode', henMode],
    ['HEN site-map live route', "href: '/hen/'", siteMap],
    ['HEN site-map slash alias', "'/nfts'", siteMap],
    ['shared My Tezos address helper', 'export function rememberMyTezosAddress', wallet],
    ['shared My Tezos saved history key', "export const SAVED_ADDRESSES_KEY = 'tezos-systems-saved-addresses'", wallet],
    ['wallet connect syncs My Tezos', "source: 'octez-connect'", wallet],
    ['My Tezos listens for external identity updates', "window.addEventListener('my-baker-updated'", myBaker],
    ['HEN Teia contract constant', "const HEN_CONTRACT = 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton'", henMode],
    ['HEN Teia contract source filter', 'fa_contract: {_eq: "\' + HEN_CONTRACT + \'"', henMode],
    ['HEN OBJKT excludes HEN source filter', 'fa_contract: {_neq: "\' + HEN_CONTRACT + \'"', henMode],
    ['HEN saved source reader', 'function getSavedFeedMode', henMode],
    ['HEN saved source writer', 'persistFeedMode(mode)', henMode],
    ['HEN price filter state', 'let priceMaxMutez = null', henMode],
    ['HEN listed-only filter state', 'let listedOnly = false', henMode],
    ['HEN edition filter state', 'let editionMax = null', henMode],
    ['HEN hide-owned filter state', 'let hideOwned = false', henMode],
    ['HEN saved-only filter state', 'let savedOnly = false', henMode],
    ['HEN price GraphQL filter', 'lowest_ask: {_gt: "0", _lte:', henMode],
    ['HEN listed-only GraphQL filter', 'function listingWhereClause', henMode],
    ['HEN edition GraphQL filter', 'supply: {_lte:', henMode],
    ['HEN sort order GraphQL parameter', 'function orderByClause', henMode],
    ['HEN wallet holdings query', 'query HenViewerHoldings', henMode],
    ['HEN CLI Teia source command', "case 'teia': case 'hen': case 'hic':", henMode],
    ['HEN CLI OBJKT source command', "case 'objkt': case 'objkts':", henMode],
    ['HEN CLI price filter command', "case 'price': case 'under': case 'max':", henMode],
    ['HEN CLI for-sale filter command', "case 'forsale': case 'listed':", henMode],
    ['HEN CLI edition filter command', "case 'edition': case 'editions': case 'supply':", henMode],
    ['HEN CLI sort filter command', "case 'sort':", henMode],
    ['HEN CLI saved filter command', "case 'saved': case 'favorites': case 'watchlist':", henMode],
    ['HEN CLI hide-owned filter command', "case 'hideowned': case 'hide-owned':", henMode],
    ['HEN CLI wallet command', "case 'wallet':", henMode],
    ['HEN live mints prepend automatically', 'g.prepend(shell)', henMode],
    ['HEN fresh poll keeps near-top readers current', 'wasNearTop', henMode],
    ['HEN source tabs style', '.hen-source-tabs', henModeCss],
    ['HEN status strip style', '.hen-status-strip', henModeCss],
    ['HEN filter bar style', '.hen-filterbar', henModeCss],
    ['HEN desktop filter overflow fade', 'mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent);', henModeCss],
    ['HEN expanded modal stays above live chrome', 'z-index: 10010;', henModeCss],
    ['HEN mobile filter collapsed style', '.mobile-filters-open', henModeCss],
    ['HEN first-run loop hint style', '.hen-loop-hint', henModeCss],
    ['HEN wallet controls style', '.hen-wallet-controls', henModeCss],
    ['HEN profile panel style', '.hen-profile-panel', henModeCss],
    ['HEN price pill style', '.hen-card-price-pill', henModeCss],
    ['HEN favorite button style', '.hen-card-favorite', henModeCss],
    ['HEN image retry style', '.hen-image-retrying', henModeCss],
    ['HEN owned badge style', '.hen-card-owned-badge', henModeCss],
    ['HEN listing status style', '.hen-card-listing', henModeCss],
    ['ctez end of life chamber copy', 'ctez End of Life', ctez],
    ['ctez chamber wiring', 'openCtezChamber', ctez],
    ['ctez launcher wiring', 'wireCtezLauncher', ctez],
    ['ctez direct footer link', 'Direct: /ctez/', ctez],
    ['ctez contract address', 'KT1GWnsoFZVHGh7roXEER3qeCcgJgrXT3de2', ctez],
    ['ctez official-style console shell', 'ctez-console-shell', ctez],
    ['ctez sunset banner', 'ctez-sunset-banner', ctez],
    ['ctez oven summary strip', 'ctez-summary-strip', ctez],
    ['ctez oven detail cards', 'ctez-detail-card', ctez],
    ['ctez detected oven list', 'ctez-oven-list', ctez],
    ['ctez automatic oven lookup', 'fetchCtezOvens', ctez],
    ['ctez TzKT big-map lookup', '/bigmaps/${ovensPtr}/keys', ctez],
    ['ctez Octez.Connect controls', 'ctez-wallet-connect', ctez],
    ['ctez wallet refresh control', 'ctez-wallet-refresh', ctez],
    ['ctez close plan preview', 'ctez-close-plan', ctez],
    ['ctez one-batch close control', 'ctez-wallet-close', ctez],
    ['ctez batch close operation builder', 'buildCtezCloseOvenOperations', ctez],
    ['ctez community tool reference', 'https://purplematter.com/ctez-tool/', ctez],
    ['ctez community builder reference', 'https://x.com/webidente', ctez],
    ['ctez no manual raw fields copy', 'No manual contract pages or raw recovery fields are required', ctez],
    ['ctez mint_or_burn operation builder', 'buildCtezMintOrBurnOperation', ctez],
    ['ctez withdraw operation builder', 'buildCtezWithdrawOperation', ctez],
    ['ctez wallet request path', 'requestWalletOperation(operations)', ctez],
    ['Octez.Connect SDK pin', '@tezos-x/octez.connect-sdk@${OCTEZ_CONNECT_VERSION}', wallet],
    ['Octez.Connect ESM loader', 'https://esm.sh/@tezos-x/octez.connect-sdk@${OCTEZ_CONNECT_VERSION}?bundle', wallet],
    ['Octez.Connect lazy loader', 'loadOctezConnect', wallet],
    ['Octez.Connect preload helper', 'preloadOctezConnect', wallet],
    ['Octez.Connect SDK timeout', 'WALLET_SDK_TIMEOUT_MS', wallet],
    ['Octez.Connect permission timeout', 'WALLET_CONNECT_TIMEOUT_MS', wallet],
    ['Octez.Connect connect timeout override', '__TEZOS_WALLET_CONNECT_TIMEOUT_MS__', wallet],
    ['Octez.Connect My Tezos sync key', 'tezos-systems-my-baker-address', wallet],
    ['Octez.Connect wallet storage key', 'tezos-systems-octez-wallet-address', wallet],
    ['HEN wallet preconnect helper', 'function preloadWalletConnect()', henMode],
    ['HEN wallet preconnect on activate', 'preloadWalletConnect();', henMode],
    ['HEN wallet waiting status', 'wallet prompt waiting', henMode],
    ['HEN wallet timeout status', 'wallet prompt timed out', henMode],
    ['HEN allows Beacon modal roots', '[id*="beacon" i]', henModeCss],
    ['HEN allows WalletConnect modal roots', '[id*="walletconnect" i]', henModeCss],
    ['My Tezos wallet connect control', 'id="drawer-wallet-connect-btn"', index],
    ['My Tezos connected wallet control', 'id="my-tezos-wallet-connect"', index],
    ['My Tezos Ledger Flow link control', 'id="my-tezos-ledger-flow-link"', index],
    ['My Tezos Ledger Flow explain card', 'drawer-ledger-flow-card', index],
    ['My Tezos Ledger Flow explain copy', "Map this account's transfer paths", index],
    ['My Tezos Ledger Flow address route', '#ledger-flow=${encodeURIComponent(addr)}', myBaker],
    ['My Tezos Ledger Flow card display mode', "ledgerFlowLink.style.display = 'grid'", myBaker],
    ['My Tezos Octez operator fetch', '/delegates/${encodeURIComponent(bakerAddr)}', myTezos],
    ['My Tezos Octez version classifier', 'classifyOctezVersion', myTezos],
    ['My Tezos Octez operator tile', "renderOperatorTile(\n        'Octez'", myTezos],
    ['My Baker Octez version stat', 'Octez Version', myBaker],
    ['My Baker delegate Octez version stat', 'Bkr Octez', myBaker],
    ['My Baker Octez status class factory', 'my-baker-octez-${status.className}', myBaker],
    ['tz4 tile card copy link', 'data-copy-hash="#tz4"', index],
    ['tz4 tile expand cue', 'data-stat="tz4-adoption"', index],
    ['tz4 tile chamber wiring', 'openTz4AdoptionChamber', tz4],
    ['tz4 direct footer link', 'Direct: /tz4/', tz4],
    ['tz4 projection panel', 'id="tz4-projection-panel"', tz4],
    ['tz4 holdouts panel', 'id="tz4-holdouts-panel"', tz4],
    ['tz4 holdout baker-name wrapping', '.tz4-holdout-table .lb-baker-name-link', styles],
    ['tz4 monthly switch panel', 'id="tz4-switch-momentum"', tz4],
    ['tz4 power milestone panel', 'id="tz4-power-milestones"', tz4],
    ['404 address/domain redirect', '#my-baker=', await fs.readFile(path.join(ROOT, '404.html'), 'utf8')],
    ['app direct account path handler', 'function getMyTezosPathTarget()', app],
    ['app direct domain resolver', 'function resolveForwardTezDomain(name)', app],
    ['health tile card copy link', 'data-copy-hash="#health"', index],
    ['health tile expand cue', 'data-stat="network-health"', index],
    ['health tile chamber wiring', 'openNetworkHealthChamber', health],
    ['health direct footer link', 'Direct: /health/', health],
    ['health incident memory panel', 'id="health-incident-memory"', health],
    ['health cycle timing panel', 'id="health-cycle-timing"', health],
    ['health cycle timing TzKT source', '/statistics/cyclic', health],
    ['health Teztale consensus panel', 'id="health-teztale-consensus"', health],
    ['health Teztale exact quorum target', 'const TEZTALE_QUORUM_TARGET = 2 / 3', health],
    ['health Teztale propagation builder', 'function buildTeztaleReceptionHistogram', health],
    ['health Teztale propagation renderer', 'function renderTeztaleReceptionHistogram', health],
    ['health Teztale propagation panel', 'id="health-teztale-propagation"', health],
    ['health Teztale average pre-attestation 66 value', 'id="health-teztale-pre-66-avg"', health],
    ['health Teztale average pre-attestation 90 value', 'id="health-teztale-pre-90-avg"', health],
    ['health Teztale average attestation 66 value', 'id="health-teztale-att-66-avg"', health],
    ['health Teztale average attestation 90 value', 'id="health-teztale-att-90-avg"', health],
    ['health Teztale reception histogram bins', 'health-consensus-histogram-bin', health],
    ['health Teztale histogram bin width', 'const TEZTALE_RECEPTION_BIN_MS = 500', health],
    ['health Teztale earliest-observer disclosure', 'Earliest Teztale observer reception', health],
    ['health Teztale endorsing-power weighting disclosure', 'endorsing-power weighted', health],
    ['health Teztale validation-observed path label', 'Validation observed', health],
    ['health Teztale validation-to-pre-quorum path label', 'Validation → pre-quorum', health],
    ['health Teztale pre-quorum-to-quorum path label', 'Pre-quorum → quorum', health],
    ['health Teztale validation-to-quorum path label', 'Validation → quorum', health],
    ['health Teztale source URL', 'TEZTALE_REPORT_URL', health],
    ['health Teztale Nomadic Labs credit', 'Teztale by Nomadic Labs', health],
    ['health Teztale config endpoint', "teztale: 'https://teztale-server-mainnet-ro-prd.octez.tech'", await readText('js/core/config.js')],
    ['health Nakamoto coefficient panel', 'id="health-nakamoto-coefficient"', health],
    ['health Nakamoto one-third value', 'id="health-nc-33"', health],
    ['health Nakamoto two-thirds value', 'id="health-nc-66"', health],
    ['health Nakamoto print button', 'id="health-nc-print"', health],
    ['health Nakamoto share button', 'id="health-nc-share"', health],
    ['health Nakamoto print-document helper', 'function renderNakamotoPrintDocument', health],
    ['health Nakamoto print helper', 'function printNakamotoCoefficient', health],
    ['health Nakamoto share helper', 'function shareNakamotoCoefficient', health],
    ['health Nakamoto current-cycle RPC', 'baking_power_distribution_for_current_cycle', health],
    ['health Nakamoto explainer', 'Explain the Nakamoto Coefficient', health],
    ['health Nakamoto Chainspect disclosure', 'Chainspect', await readText('data/nakamoto-sources.json')],
    ['health Nakamoto Edinburgh disclosure', 'Edinburgh EDI', await readText('data/nakamoto-sources.json')],
    ['health Octez versions panel', 'id="health-octez-versions"', health],
    ['health Octez versions TzKT source', '/delegates?active=true', health],
    ['health Octez versions cache TTL', 'OCTEZ_VERSIONS_TTL', health],
    ['health period telemetry panel', 'id="health-period-telemetry"', health],
    ['health network load panel', 'id="health-network-load"', health],
    ['health chain proof panel', 'id="health-chain-proof"', health],
    ['health chain-age methodology label', 'chain age · upgrade history', health],
    ['health chain uptime counter', 'id="chain-uptime-counter"', health],
    ['top continuity stat panel', 'id="top-continuity-panel"', index],
    ['top continuity title-stack uptime launcher', 'id="top-continuity-history"', index],
    ['top continuity proof opens Protocol Anthology', 'aria-controls="protocol-history-chamber-modal"', index],
    ['header NFT feed nav action', 'class="glass-button header-nav-btn header-nft-feed-btn"', index],
    ['header NFT feed nav label visible on mobile', '.header-nft-feed-btn .nav-label', heroSearchCss],
    ['header NFT feed art-frame icon', '.nft-feed-icon::before', heroSearchCss],
    ['top continuity statement wrapper', 'class="top-continuity-statement"', index],
    ['top continuity mainnet-age statement claim', 'top-continuity-claim">mainnet age', index],
    ['top continuity statement subline', 'class="top-continuity-subline"', index],
    ['top continuity since-2018 marker', 'top-continuity-origin">since 2018', index],
    ['top continuity milestone runtime marker', 'class="top-continuity-primary-line"', index],
    ['top continuity milestone destination link', '<a class="top-continuity-milestone-info" href="#pulse" hidden>', index],
    ['top continuity proof baker metric', 'id="hero-chain-uptime-bakers"', index],
    ['top continuity baker all-time pill', 'data-card-history="total-bakers"', index],
    ['top continuity finality all-time pill', 'data-card-history="finality"', index],
    ['top continuity staked all-time pill', 'data-card-history="staking-ratio"', index],
    ['top continuity issuance all-time pill', 'data-card-history="issuance-rate"', index],
    ['live block ticker renderer', 'function updateBlockTicker', health],
    ['live block ticker fixed age formatter', 'function formatTickerAge', health],
    ['live block ticker transition count hook', 'blockTickerTransitionCount', health],
    ['live block ticker opts out of data-magic text reveals', 'id="block-ticker-strip" aria-label="Latest Tezos block" data-magic="off"', index],
    ['live block ticker Octez slot', 'block-ticker-octez', health],
    ['live block ticker health feed hook', 'updateBlockTicker(data)', health],
    ['price bar cycle health wiring', 'function wireCycleChipHealthLauncher', health],
    ['live block ticker styles', '.block-ticker-strip', styles],
    ['live block ticker Octez styles', '.block-ticker-octez', styles],
    ['network health continuity panel styles', '.health-continuity-panel', styles],
    ['network health continuity runtime styles', '.health-continuity-runtime', styles],
    ['chain uptime counter updater', "document.getElementById('chain-uptime-counter')", app],
    ['top continuity counter updater', 'setTopContinuityRuntime(years, days, hours, mins);', app],
    ['top continuity decrypt duration', 'TOP_CONTINUITY_SHUFFLE_MS = 1500', app],
    ['top continuity Protocol Anthology launcher wiring', 'openProtocolHistoryChamber();', app],
    ['top continuity Protocol Anthology hash wiring', "window.history.pushState(null, '', '#protocol-history');", app],
    ['top continuity all-time pill history wiring', "openCardHistoryModal(key, 'all')", app],
    ['top continuity finality history metric', "metric: 'finality_seconds'", await readText('js/features/history.js')],
    ['chain uptime baker updater', "setChainText('chain-uptime-bakers'", app],
    ['top continuity proof styles', '.top-continuity-panel', styles],
    ['header uptime badge title stack styles', '.header-brand-stack', styles],
    ['top continuity stat rail right aligned', 'justify-content: flex-end', styles],
    ['top continuity rail is borderless tape', 'border: 0;', styles],
    ['top continuity identity claim styles', '.top-continuity-claim', heroSearchCss],
    ['top continuity statement runtime scale', 'font-size: clamp(1.5rem, 2.15vw, 2rem);', heroSearchCss],
    ['top continuity dedicated runtime font role', 'font-family: var(--font-runtime);', heroSearchCss],
    ['recipe console display font role', 'font-family: var(--font-display, Orbitron', heroSearchCss],
    ['hot-today display font role', 'font-family: var(--font-display, Orbitron', shellExtrasCss],
    ['Maxis display font role', "font-family: var(--font-display, 'Orbitron'", maxisCss],
    ['top continuity runtime readability scale', 'font-size: 1.08em;', heroSearchCss],
    ['top continuity runtime real font weight', 'font-weight: 700;', heroSearchCss],
    ['top continuity statement caption scale', 'font-size: clamp(0.72rem, 0.92vw, 0.875rem);', heroSearchCss],
    ['top continuity statement separator scale', 'font-size: clamp(0.7rem, 0.85vw, 0.82rem);', heroSearchCss],
    ['top continuity mobile direct runtime scale', 'font-size: clamp(1.05rem, 4.1vw, 1.2rem);', heroSearchCss],
    ['top continuity mobile removes zoom offset', 'zoom: 1;', styles],
    ['mobile title and protocol stack independently', 'grid-template-columns: minmax(0, 1fr);', heroSearchCss],
    ['top continuity runtime natural segment gap', 'gap: 0.5ch;', heroSearchCss],
    ['top continuity hover affordance', '.top-continuity-history:is(:hover, :focus-visible) .top-continuity-arrow', heroSearchCss],
    ['top continuity segmented runtime renderer', 'renderTopContinuityRuntime(years, days, hours, mins)', app],
    ['top continuity hero settled promise', 'window.tezosSystemsHeroSettled = heroSettled', app],
    ['top continuity toast gate waits for hero', 'setToastGate(heroSettled)', app],
    ['toast queue waits for hero gate', 'await waitForGate();', toastQueue],
    ['first visit welcome watches live copy', 'Welcome 👋 — this dashboard is watching Tezos live. Press / to search anything.', streak],
    ['top continuity counter tween', 'tweenNumber(el, 0, totalMinutes', app],
    ['top continuity pill stagger', '}, index * 80);', app],
    ['top continuity arrival pending class', 'hero-arrival-pending', app],
    ['top continuity arrival completion class', 'hero-arrived', app],
    ['top continuity milestone event bridge', "window.addEventListener('hot-signal-rendered'", app],
    ['top continuity milestone active class', 'is-milestone-celebrating', app],
    ['top continuity milestone destination resolver', 'uptimeMilestoneDestination(signal)', app],
    ['top continuity milestone near state', "classList.toggle('is-milestone-near', near)", app],
    ['top continuity milestone crossed state', "classList.toggle('is-milestone-crossed', crossed)", app],
    ['top continuity milestone arrival state', "classList.add('is-milestone-arriving')", app],
    ['top continuity nullable milestone expiry guard', "if (value == null || value === '') return null;", app],
    ['top continuity milestone glow styles', '.top-uptime-cluster.has-milestone-signal :is(.top-continuity-primary-line, .top-continuity-milestone-info)', shellExtrasCss],
    ['top continuity milestone info styles', '.top-continuity-milestone-info', shellExtrasCss],
    ['top continuity mobile centered milestone stack', 'grid-template-columns: minmax(0, 1fr);', shellExtrasCss],
    ['top continuity mobile hidden marker collapse', '.top-continuity-milestone-info[hidden]', shellExtrasCss],
    ['milestone card DOM status styles', '.hot-today-milestone-status', shellExtrasCss],
    ['milestone card protocol trace styles', '.hot-today-milestone-trace', shellExtrasCss],
    ['milestone card active-only sustained trace', '.is-milestone-crossed.is-hot-active .hot-today-milestone-trace', shellExtrasCss],
    ['top continuity loading skeleton respects arrived pills', '.hero-arrival-pending .top-continuity-stat:not(.hero-arrived) strong', loadingCss],
    ['top continuity title theme token', '--header-title-color', styles],
    ['top continuity uptime statement transparent bg', 'background: transparent;', styles],
    ['top continuity uptime statement unboxed border', 'border: 0;', styles],
    ['top continuity uptime badge label token', 'color: var(--uptime-badge-label);', styles],
    ['top continuity uptime value token', 'color: var(--uptime-badge-value);', styles],
    ['top continuity value color tokens', 'var(--pill-color, var(--top-pill-bakers))', styles],
    ['top continuity baker color selector', '.top-continuity-stat[data-card-history="total-bakers"]', styles],
    ['top continuity finality color selector', '.top-continuity-stat[data-card-history="finality"]', styles],
    ['top continuity staked color selector', '.top-continuity-stat[data-card-history="staking-ratio"]', styles],
    ['top continuity issuance color selector', '.top-continuity-stat[data-card-history="issuance-rate"]', styles],
    ['top continuity mobile pill grid', 'grid-template-columns: repeat(2, minmax(0, 1fr))', styles],
    ['top continuity isolated decrypt styles', '.top-continuity-stat.is-shuffling', styles],
    ['top continuity stable finality slot', '.top-continuity-stat[data-card-history="finality"] strong', styles],
    ['top continuity arrival hides pending pills only', '.top-continuity-panel.hero-arrival-pending .top-continuity-stat:not(.hero-arrived)', heroSearchCss],
    ['top continuity arrival reveal class', '.top-continuity-stat.hero-arrived', heroSearchCss],
    ['health cycle timing styles', '.health-cycle-panel', styles],
    ['health Teztale consensus styles', '.health-consensus-panel', healthStyles],
    ['health Teztale propagation styles', '.health-consensus-propagation', healthStyles],
    ['health Teztale histogram styles', '.health-consensus-histogram', healthStyles],
    ['health Teztale histogram-bin styles', '.health-consensus-histogram-bin', healthStyles],
    ['health Clean-theme consensus contrast override', '[data-theme="clean"] .health-consensus-panel', networkHealthCss],
    ['health Nakamoto panel styles', '.health-nakamoto-panel', networkHealthCss],
    ['health Nakamoto source-row styles', '.health-nc-source-row', networkHealthCss],
    ['health Nakamoto action-group styles', '.health-nc-actions', healthStyles],
    ['health Nakamoto action-button styles', '.health-nc-action', healthStyles],
    ['health Octez versions styles', '.health-octez-panel', styles],
    ['My Tezos Octez warning styles', '.drawer-operator-watch', styles],
    ['My Baker Octez critical styles', '.my-baker-stat.my-baker-octez-critical', styles],
    ['canonical chamber expand cue factory', 'function createChamberExpandCue()', app],
    ['canonical chamber expand cue class', "cue.className = 'chamber-expand-cue'", app],
    ['shared chamber footer rail style', '.chamber-entry-footer', styles],
    ['shared chamber freshness text style', '.chamber-entry-freshness', styles],
    ['Network moments monotonic change guard', 'MONOTONIC_CHANGE_METRICS', moments],
    ['Network moments shared rule gate', 'function ruleFires', moments],
    ['Return greeting renderer', 'function updateReturnGreeting', app],
    ['Return greeting styles', '.return-greeting', styles],
    ['My Tezos era card button', 'tezos-era-share-btn', myTezos],
    ['My Tezos era card share helper', 'function shareEraCard', myTezos],
    ['Tezos Story action styles', '.tezos-story-actions', styles],
    ['Delegator fit finder questions', 'FIT_QUESTIONS', leaderboard],
    ['Delegator fit finder scorer', 'function scoreBakerFit', leaderboard],
    ['Delegator fit finder styles', '.baker-fit-finder', leaderboardCss],
    ['Delegator fit finder truth disclosure', 'not an uptime or performance grade', leaderboard],
    ['Leaderboard native sort controls', 'class="lb-sort-btn"', leaderboard],
    ['Leaderboard column sort state', 'aria-sort="${direction}"', leaderboard],
    ['Leaderboard explicit baker action', 'class="lb-baker-open"', leaderboard],
    ['Leaderboard sort focus styles', '.lb-sort-btn:focus-visible', leaderboardCss],
    ['Theme picker native radio controls', 'class="theme-radio" type="radio"', themeUi],
    ['Theme picker radio group label', 'role="radiogroup" aria-label="Choose a site theme"', themeUi],
    ['Clean dark Chamber surface token', '--chamber-surface-bg: #07101D', styles],
    ['Clean dark Chamber semantic exclusion', '.chamber-content:not(.maxis-content):not(.staking-chamber-content)', styles]
  ];
  for (const [label, snippet, text] of deepLinkContracts) {
    if (!text.includes(snippet)) fail(`missing deep-link contract: ${label}`);
  }
  if (leaderboard.includes('lb-share-btn') || leaderboard.includes('lb-share-col')) {
    fail('Baker Leaderboard must not restore one share control per row');
  }
  if (leaderboard.includes('computeBakerScores') || leaderboard.includes("value: 'reliability'") || leaderboard.includes('grade ${')) {
    fail('Delegator fit must not present synthetic participation defaults as reliability or performance grades');
  }
  if (/card\.setAttribute\(['"]role['"],\s*['"]button['"]\)/.test(networkPulse)) {
    fail('Network Pulse entry card must not wrap its inner controls in an outer button role');
  }
  if (/const\s+(?:CHAMBERS|COMMANDS|QUICK_CHIPS)\s*=/.test(search)) {
    fail('Hero search must not restore manual site-map destination catalogs');
  }
  if (search.includes("value: 'Ushuaia'") || search.includes('${result.value}${result.hash}')) {
    fail('Hero search must not hard-code the current protocol or append redundant hashes to pretty routes');
  }
  if (stakingChamber.includes('requestedAmount')) {
    fail('Staking Chamber must filter TzKT actual processed amount, never requestedAmount');
  }
  if (/amountMutez\(row\)\s*>=\s*LARGE_MOVE_THRESHOLD_MUTEZ/.test(stakingChamber)) {
    fail('Staking Chamber threshold must stay strictly greater than 10,000 tez');
  }
  if (!/@media\s*\(max-width:\s*759px\)[\s\S]*?\.staking-chamber-content\s*\{[\s\S]*?width:\s*calc\(100vw\s*-\s*0\.875rem\)/.test(stakingChamberCss)) {
    fail('Staking Chamber mobile modal must remain viewport-contained');
  }
  pass('Staking Chamber strict amount, archive, route, and responsive contracts checked');
  if (!/\.health-consensus-panel[^\{]*\{[^}]*grid-column:\s*1\s*\/\s*-1\s*;/s.test(healthStyles)) {
    fail('Network Health Consensus Lens must span the full dashboard width');
  }
  if (styles.includes('top-continuity-digits-') || app.includes('top-continuity-digits-')) {
    fail('top continuity runtime must use natural segment widths, not fixed digit slots');
  }
  if (index.includes('live-feed-pill')) {
    fail('header NFT feed should not keep the old live-feed-pill class');
  }
  const networkPulseMobileNavBlock = networkPulseCss.match(/@media\s*\(max-width:\s*759px\)\s*\{[\s\S]*?\.network-pulse-nav\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
  if (!networkPulseMobileNavBlock.includes('position: static') || !networkPulseMobileNavBlock.includes('flex-wrap: wrap')) {
    fail('Network Pulse mobile nav must wrap in normal flow instead of using an off-viewport scroll strip');
  }
  if (networkPulseMobileNavBlock.includes('overflow-x: auto') || networkPulseMobileNavBlock.includes('flex-wrap: nowrap')) {
    fail('Network Pulse mobile nav must not use horizontal overflow or nowrap pills');
  }
  const roomSelectorBlock = networkPulse.match(/const ROOM_VALUE_SELECTORS\s*=\s*\{([\s\S]*?)\n\};/)?.[1] || '';
  if (!roomSelectorBlock) {
    fail('Network Pulse room value selectors must stay explicit and checkable');
  } else {
    const selectorIds = Array.from(roomSelectorBlock.matchAll(/:\s*['"]#([^'"]+)['"]/g), (match) => match[1]);
    const selectorSurfaceFiles = await walk('.', (file) => /\.(?:html|js|mjs)$/.test(file) && !file.startsWith('node_modules/'));
    const selectorSurfaceText = (await Promise.all(selectorSurfaceFiles.map((file) => readText(file)))).join('\n');
    for (const id of selectorIds) {
      const hasId = selectorSurfaceText.includes(`id="${id}"`) || selectorSurfaceText.includes(`id='${id}'`);
      if (!hasId) fail(`Network Pulse room selector references missing DOM id: #${id}`);
    }
    pass(`Network Pulse room selectors checked: ${selectorIds.length}`);
  }
  const protocolEntryRailBlock = app.match(/function buildProtocolEntryRail[\s\S]*?function protocolDate/)?.[0] || '';
  if (!protocolEntryRailBlock.includes('PROTOCOL_ENTRY_RECENT_FALLBACK') || !protocolEntryRailBlock.includes('getProtocolEntryOrdinal(protocol, list)')) {
    fail('Protocol Anthology rail must use shared upgrade ordinals so Paris C stays a follow-up');
  }
  if (protocolEntryRailBlock.includes('chapterBase') || protocolEntryRailBlock.includes('list.length : 22')) {
    fail('Protocol Anthology rail must not derive chapter labels from raw protocol record length');
  }
  const protocolAnthologyBoardBlock = app.match(/function renderProtocolAnthologyBoard[\s\S]*?function updateProtocolHistoryEntryCard/)?.[0] || '';
  if (!protocolAnthologyBoardBlock.includes('const chapterCount = countProtocolUpgrades(enriched)')) {
    fail('Protocol Anthology board metric must use shared upgrade count convention');
  }
  const protocolEntryCardBlock = app.match(/function updateProtocolHistoryEntryCard[\s\S]*?function ensureProtocolHistoryEntryCard/)?.[0] || '';
  if (!protocolEntryCardBlock.includes('const count = Math.max(CANONICAL_UPGRADE_COUNT, countProtocolUpgrades(list, 0))')) {
    fail('Protocol Anthology entry card total must use shared upgrade count convention with canonical fallback');
  }
  if (protocolEntryCardBlock.includes('list.length || 22') || protocolEntryCardBlock.includes('id="protocol-history-entry-count">22')) {
    fail('Protocol Anthology entry card must not show raw 22-record protocol total');
  }
  if (styles.includes('.block-ticker-strip.is-updating .block-ticker-line') || styles.includes('blockTickerAperture')) {
    fail('live block ticker text changes must stay unanimated');
  }
  if (henMode.includes('feed.insertBefore(output, grid())')) {
    fail('HEN CLI output must stay off-flow instead of inserting before the grid');
  }
  if (henMode.includes('hen-listening') || henMode.includes('origPoll')) {
    fail('HEN idle state must use the header/status dot path, not the old injected listening row or dead poll stub');
  }
  if (index.includes('</html>\n>')) {
    fail('index.html must not leave stray text after the closing html tag');
  }
  if (henPage.includes('http-equiv="refresh"') || henPage.includes('location.replace')) {
    fail('/hen/ must render a crawlable entry page instead of an empty redirect stub');
  }
  if (chamberRouteGenerator.includes('location.replace') || chamberRouteGenerator.includes('http-equiv="refresh"')) {
    fail('pretty chamber routes must hydrate the dashboard shell instead of redirecting to hash routes');
  }
  if (henMode.includes('cloudflare-ipfs.com')) {
    fail('HEN mode must not retry through the retired Cloudflare public IPFS gateway');
  }
  if (index.includes('cloudflare-ipfs.com')) {
    fail('CSP must not allow the retired Cloudflare public IPFS gateway');
  }
  if (api.includes('delegateAPY: 3.1') || api.includes('stakeAPY: 9.2')) {
    fail('shared API must not present hardcoded APY fallback values as live measurements');
  }
  for (const retiredSearchCopy of ['Wallet/.tez', 'wallet/domain retrieval surface', 'TzKT boundary', 'No Tezos.Systems room']) {
    if (search.includes(retiredSearchCopy)) fail(`hero search should not retain confusing copy: ${retiredSearchCopy}`);
  }
  if (!/@media \(max-width: 768px\)[\s\S]*?\.hero-search-input\s*\{[\s\S]*?font-size:\s*16px;/.test(heroSearchCss)) {
    fail('mobile hero search input must keep 16px text to avoid iOS focus zoom');
  }
  if (index.includes('top-continuity-proof-item') || styles.includes('.top-continuity-proof-item')) {
    fail('top header uptime badge should not retain the old Zero Forks / Zero Outages proof stamps');
  }
  if (index.includes('continuity-proof') || styles.includes('continuity-proof') || heroSearchCss.includes('continuity-proof') || app.includes('continuity-proof')) {
    fail('homepage should not retain the retired continuity-proof panel');
  }
  for (const [sourceName, source] of [['index.html', index], ['app.js', app], ['hero-search.css', heroSearchCss], ['styles.css', styles]]) {
    if (source.includes('protocol-ribbon') || source.includes('protocolRibbon') || source.includes('protocol_ribbon') || source.includes('PROTOCOL_RIBBON')) {
      fail(`${sourceName} should not retain the retired homepage protocol ribbon`);
    }
  }
  if (/style=["'][^"']*--pill-color/.test(index)) {
    fail('top header stat pills should use theme palette tokens, not inline --pill-color styles');
  }
  const themeListMatch = themeUi.match(/export const THEMES\s*=\s*\[([\s\S]*?)\];/);
  const registeredThemes = themeListMatch ? Array.from(themeListMatch[1].matchAll(/'([^']+)'/g), (match) => match[1]) : [];
  if (!registeredThemes.length) {
    fail('theme registry should expose the active THEMES list');
  }
  const headerPaletteTokens = [
    '--font-ui',
    '--font-display',
    '--font-data',
    '--font-runtime',
    '--header-title-color',
    '--header-title-glow',
    '--uptime-badge-bg',
    '--uptime-badge-border',
    '--uptime-badge-label',
    '--uptime-badge-value',
    '--uptime-badge-note',
    '--top-pill-bg',
    '--top-pill-bakers',
    '--top-pill-finality',
    '--top-pill-staked',
    '--top-pill-issuance'
  ];
  const rootPaletteBlock = styles.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  for (const theme of registeredThemes) {
    const themeBlockMatch = styles.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
    if (!themeBlockMatch) {
      fail(`theme ${theme} should define a CSS variable block for header palette tokens`);
      continue;
    }
    const paletteScope = theme === 'aurora' ? `${rootPaletteBlock}\n${themeBlockMatch[1]}` : themeBlockMatch[1];
    for (const token of headerPaletteTokens) {
      if (!paletteScope.includes(`${token}:`)) {
        fail(`theme ${theme} should define ${token} for title, uptime, and pill colors`);
      }
    }
  }
  const auroraBlock = `${rootPaletteBlock}\n${styles.match(/\[data-theme="aurora"\]\s*\{([\s\S]*?)\n\}/)?.[1] || ''}`;
  for (const color of ['#07111F', '#0D102A', '#45E0C8', '#9B8CFF']) {
    if (!auroraBlock.includes(color)) {
      fail(`Aurora uptime palette should keep the recommended teal-to-violet token ${color}`);
    }
  }
  if (!/family=Nunito:wght@400;500;600;700;800;900/.test(index)) {
    fail('theme font request should load the rounded Nunito family used by Bubblegum and Moss');
  }
  const bubblegumTypography = styles.match(/\[data-theme="bubblegum"\]\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  if (!bubblegumTypography.includes("--font-ui: 'Nunito'") || !bubblegumTypography.includes("--font-runtime: 'Nunito'")) {
    fail('Bubblegum should use the rounded Nunito UI and runtime roles');
  }
  if (!styles.includes('[data-theme="nerv"] .title') || !styles.includes("--font-display: 'Archivo Black'")) {
    fail('NERV should pair its IBM console UI with the Archivo Black display role');
  }
  pass(`top header theme palette tokens checked: ${registeredThemes.length} themes`);
  const removedProtocolPromptContracts = [
    ['app banner renderer', 'updateGovernanceBanner', app],
    ['app banner selector', 'gov-countdown-banner', app],
    ['app banner slot', 'gov-countdown-banner-slot', app],
    ['index banner slot', 'gov-countdown-banner-slot', index],
    ['source banner styles', 'gov-countdown-banner', styles]
  ];
  for (const [label, snippet, text] of removedProtocolPromptContracts) {
    if (text.includes(snippet)) fail(`removed Current Protocol prompt resurfaced: ${label}`);
  }
  pass(`removed Current Protocol prompt guard checked: ${removedProtocolPromptContracts.length}`);

  const forbiddenCtezInterfaceStrings = [
    'better-call.dev',
    'ctez-wallet-oven-id',
    'ctez-wallet-withdraw-to',
    'ctez-tez-input',
    'ctez-outstanding-input',
    'CTEZ_STORAGE_URL',
    'decimalToMicroString',
    'Wallet flow',
    'chamber-entry-wide ctez-entry-card',
    'ctez-entry-card'
  ];
  for (const snippet of forbiddenCtezInterfaceStrings) {
    if (ctez.includes(snippet)) fail(`ctez chamber should not expose manual recovery UI: ${snippet}`);
  }
  if (wallet.includes('dist/octez.connect.min.js') || wallet.includes('loadScript(')) {
    fail('Octez.Connect wallet loader must avoid the CSP-hostile UMD script bundle');
  }
  const fixedEtherlinkContracts = [
    'KT19oUVQPnVLuUBYXrBVd46WJnNAMpqkKSwo',
    'KT1AXRU3wLc87WNhLhVGrgqDGubLACUMUgPb',
    'KT1VGyd2cRSHoDnxDnSuqGJD3mL8DzcVqX98'
  ];
  for (const address of fixedEtherlinkContracts) {
    if (etherlinkGovernance.includes(address)) fail(`Tezos X Governance chamber should discover active contract, not hardcode ${address}`);
  }
  pass(`deep-link selector contracts checked: ${deepLinkContracts.length}`);
  pass('Protocol Anthology chapter-count convention checked');

  const cardControlContracts = [
    ['Health card copy slot', '.health-entry-card .card-copy-link', styles],
    ['Health card camera slot', '.health-entry-card .card-share-btn', styles],
    ['Network Health pre-init camera slot', '.stat-card[data-stat="network-health"] .card-share-btn', styles],
    ['Chamber history/stat slot', '#chambers-grid .chamber-entry-card > .card-history-btn', styles],
    ['Chamber history/stat desktop bottom placement', 'top: calc(0.85rem + 102px);', styles],
    ['Chamber history/stat mobile bottom placement', 'top: calc(0.78rem + 108px);', styles],
    ['Chamber share helper export', 'export function ensureCardShareButton(card)', share],
    ['Chamber share sync call', 'ensureCardShareButton(card);', app],
    ['Chamber rich share capture helper', 'async function captureChamberCard(card)', share],
    ['Chamber rich share clones visible panel', 'cloneChamberPanel(card)', share],
    ['Chamber rich share html2canvas color sanitizer', 'sanitizeCaptureModernColorStyles(panelClone', share],
    ['Chamber rich share canonical route helper import', "import { siteMapCanonicalRoute } from '../core/site-map.js';", share],
    ['Chamber rich share canonical route resolver', "siteMapCanonicalRoute(hash || '#chambers')", share],
    ['Chamber rich share panel label', 'Visible Chamber Panel', share],
    ['Chamber generated info helper', 'function ensureChamberInfoButton(card)', app],
    ['Chamber generated info copy', 'CHAMBER_INFO_COPY', app],
    ['Chamber top control lane', '--chamber-control-lane', styles],
    ['Chamber content avoids top-right controls', 'padding-right: var(--chamber-control-lane);', styles],
    ['Chamber controls layer above card content', '#chambers-grid .chamber-entry-card > .card-copy-link', styles],
    ['Chamber footer rail exists in flow', '.chamber-entry-footer', styles],
    ['Chamber footer is absolute bottom rail', 'position: absolute;', styles],
    ['Chamber footer uses shared right edge', 'right: var(--chamber-card-inline-padding);', styles],
    ['Chamber footer uses shared left edge', 'left: var(--chamber-card-inline-padding);', styles],
    ['Chamber footer bottom placement is fixed', 'bottom: 0.75rem;', styles],
    ['Chamber open cue style is global', '.chamber-expand-cue {', styles],
    ['Chamber stale freshness uses footer text', '.chamber-entry-card.chamber-data-stale .chamber-entry-freshness', styles],
    ['Chamber pseudo freshness disabled', '.chamber-entry-card[data-updated-label]::after', styles]
  ];
  for (const [label, snippet, text] of cardControlContracts) {
    if (!text.includes(snippet)) fail(`missing card control spacing contract: ${label}`);
  }
  pass(`card control spacing contracts checked: ${cardControlContracts.length}`);

  const expandCueMarkupFiles = [
    'index.html',
    ...(await walk('js', (file) => file.endsWith('.js')
      && file !== 'js/core/app.js'
      && file !== 'js/ui/chamber-accessibility.js'))
  ];
  for (const file of expandCueMarkupFiles) {
    const text = file === 'index.html' ? index : await readText(file);
    if (text.includes('chamber-expand-cue')) {
      fail(`chamber expand cue must be created only by js/core/app.js, found in ${file}`);
    }
  }

  const scopedCueSelectors = [];
  for (const match of styles.matchAll(/([^{}]+)\{/g)) {
    const selectorBlock = match[1].trim();
    if (!selectorBlock.includes('.chamber-expand-cue')) continue;
    selectorBlock.split(',').map((selector) => selector.trim()).forEach((selector) => {
      if (!selector.startsWith('.chamber-expand-cue')) scopedCueSelectors.push(selector);
    });
  }
  if (scopedCueSelectors.length) {
    fail(`chamber expand cue styles must stay unscoped: ${scopedCueSelectors.join(', ')}`);
  }
  pass(`chamber expand cue canonical contracts checked: ${expandCueMarkupFiles.length} source files`);

  const chamberRendererStyleContracts = [
    ['Tezos X Governance timeline row style', '.etherlink-gov-table .etherlink-gov-timeline-row', styles],
    ['Tezos X Governance timeline row removes browser underline', 'a.etherlink-gov-timeline-row:hover', styles],
    ['tz4 monthly bar rail style', '.tz4-month-bars', styles],
    ['tz4 monthly bar column style', '.tz4-month-bar {', styles],
    ['tz4 monthly bar visible count style', '.tz4-month-count', styles],
    ['tz4 monthly bar fill style', '.tz4-month-fill', styles],
    ['tz4 first movers top 10 cap', '.slice(0, 10)', tz4],
    ['ctez console shell style', '.ctez-console-shell', styles],
    ['ctez summary strip style', '.ctez-summary-strip', styles],
    ['ctez oven panel style', '.ctez-oven-panel', styles],
    ['ctez oven card style', '.ctez-oven-card', styles],
    ['ctez utilization bar style', '.ctez-utilization-bar', styles],
    ['ctez detail card style', '.ctez-detail-card', styles],
    ['ctez action button grid style', '.ctez-action-buttons', styles]
  ];
  for (const [label, snippet, text] of chamberRendererStyleContracts) {
    if (!text.includes(snippet)) fail(`missing chamber renderer style contract: ${label}`);
  }
  pass(`chamber renderer style contracts checked: ${chamberRendererStyleContracts.length}`);

  const goatcounterInit = await readText('js/core/goatcounter-init.js');
  const shareTrackingContracts = [
    ['tracked Tezos URL helper', 'export function trackedTezosUrl', share],
    ['share text tracking rewrite', 'addShareTrackingToText', share],
    ['share modal event tracking', "trackShareEvent('modal_opened'", share],
    ['native share tracked URL', "'native_share'", share],
    ['X post event tracking', "trackShareEvent('post_x'", share],
    ['editable share tweet composer', 'tweet-compose-text', share],
    ['share handle storage', 'tezos-systems-share-handle', share],
    ['Network Moments share capture helper', 'captureNetworkMomentShare', share],
    ['Network Moments use share modal pipeline', 'captureNetworkMomentShare(moment)', moments],
    ['history share deep link', 'tezos.systems/#history', share],
    ['history copy hidden during capture', 'copyBtn.style.display', share],
    ['GoatCounter event helper', 'trackTezosSystemsEvent', goatcounterInit]
  ];
  for (const [label, snippet, text] of shareTrackingContracts) {
    if (!text.includes(snippet)) fail(`missing share/tracking contract: ${label}`);
  }
  pass(`share and loop tracking contracts checked: ${shareTrackingContracts.length}`);

  const rawWidgetLinks = [
    'href="/widgets/price.html"',
    'href="/widgets/baker-card.html"',
    'href="/widgets/staking-ratio.html"',
    'href="/widgets/governance.html"',
    'href="/widgets/combo.html"'
  ];
  for (const rawLink of rawWidgetLinks) {
    if (index.includes(rawLink)) fail(`dashboard should not link directly to raw widget endpoint: ${rawLink}`);
  }
  pass('dashboard widget utility avoids raw widget endpoint links');
}

async function checkUxAuditContracts() {
  const index = await readText('index.html');
  const siteMapCss = await readText('css/site-map.css');
  const landingCss = await readText('css/landing.css');
  const siteNav = await readText('js/landing/site-nav.js');
  const liveData = await readText('js/landing/live-data.js');
  const henCss = await readText('css/hen-mode.css');
  const henPage = await readText('hen/index.html');
  const changelog = await readText('js/features/changelog.js');
  const skipPages = [
    ['index.html', index],
    ['landing.html', await readText('landing.html')],
    ['staking/index.html', await readText('staking/index.html')],
    ['governance/index.html', await readText('governance/index.html')],
    ['bakers/index.html', await readText('bakers/index.html')],
    ['compare/index.html', await readText('compare/index.html')],
    ['hen/index.html', henPage],
    ['404.html', await readText('404.html')]
  ];

  for (const [file, html] of skipPages) {
    if (!html.includes('class="skip-link" href="#main-content"') || !html.includes('id="main-content"')) {
      fail(`${file} must expose a skip-to-content target`);
    }
  }
  for (const route of CHAMBER_ROUTES) {
    const html = await readText(`${route.slug}/index.html`);
    if (!html.includes('class="skip-link" href="#main-content"') || !html.includes('id="main-content"')) {
      fail(`${route.slug}/index.html must inherit the dashboard skip-to-content contract`);
    }
  }
  for (const file of ['compare/tezos-vs-ethereum.html', 'compare/tezos-vs-solana.html', 'compare/tezos-vs-cardano.html', 'compare/tezos-vs-algorand.html']) {
    const html = await readText(file);
    if (!html.includes('class="skip-link" href="#main-content"') || !html.includes('id="main-content"')) {
      fail(`${file} must inherit the comparison skip-to-content contract`);
    }
  }
  if (!siteMapCss.includes('.skip-link')
    || !siteMapCss.includes('button:not([disabled])')
    || !siteMapCss.includes('[tabindex]:not([tabindex="-1"])):focus-visible')) {
    fail('shared site-map CSS must provide skip-link and broad focus-visible coverage');
  }

  for (const [, html] of skipPages.filter(([file]) => /^(staking|governance|bakers)\//.test(file))) {
    if (!html.includes('class="landing-nav-menu"') || !html.includes('class="landing-nav-toggle"')) {
      fail('guide pages must retain a no-JS native mobile navigation disclosure');
    }
  }
  if (!siteNav.includes('<details class="landing-nav-menu" open>')
    || !siteNav.includes('<summary class="landing-nav-toggle">')
    || !siteNav.includes("window.matchMedia('(max-width: 640px)')")
    || !landingCss.includes('.landing-nav-menu:not([open]) > .landing-nav-links')) {
    fail('shared guide navigation must render and style the mobile Explore disclosure');
  }

  if (!liveData.includes("inject('voting-time-left', 'Still syncing')")
    || liveData.includes("inject('voting-time-left', 'RSS ready')")) {
    fail('governance retry copy must remain coherent with the Time Remaining label');
  }

  const staticDialogs = [...index.matchAll(/<div class="modal-overlay[^"]*" id="([^"]+)"[^>]*>\s*<div class="[^"]*\bmodal-content\b[^"]*"([^>]*)>/g)];
  if (staticDialogs.length < 18) fail(`expected at least 18 static modal dialogs, found ${staticDialogs.length}`);
  for (const [, modalId, attributes] of staticDialogs) {
    const labelId = attributes.match(/aria-labelledby="([^"]+)"/)?.[1] || '';
    if (!/role="dialog"/.test(attributes)
      || !/aria-modal="true"/.test(attributes)
      || !/tabindex="-1"/.test(attributes)
      || !labelId
      || !index.includes(`id="${labelId}"`)) {
      fail(`#${modalId} must ship complete static dialog semantics and an existing label`);
    }
  }
  if (!/class="changelog-modal-content"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="changelog-modal-title"/.test(index)) {
    fail('Changelog must ship complete static dialog semantics');
  }

  for (const label of ['source', 'price ꜩ', 'edition', 'sort']) {
    if (!index.includes(`>${label}</span>`) || !henPage.includes(`>${label}</span>`)) {
      fail(`dashboard and standalone HEN filters must expose the visible ${label} group label`);
    }
  }
  if (!henCss.includes('.hen-filter-group-label')) fail('HEN visible filter group labels must be styled');
  if (!index.includes('<a href="/landing.html">Start here</a>') || !siteNav.includes('<a href="/landing.html">Start here</a>')) {
    fail('dashboard and standalone footers must expose the non-forced Start here route');
  }
  if (!changelog.includes('Keyboard visitors now get a sitewide skip link')) {
    fail('changelog must disclose the July UI/UX audit implementation');
  }

  pass('July UI/UX audit quick-win contracts checked');
}

async function checkWidgetRuntimeContracts() {
  const runtimeSource = await readText('widgets/runtime.js');
  const builder = await readText('widgets/builder.html');
  const sw = await readText('sw.js');
  const config = await readText('js/core/config.js');
  const htmlFiles = await walk('widgets', (file) => file.endsWith('.html'));
  const rawWidgetFiles = htmlFiles.filter((file) => file !== 'widgets/builder.html');
  const catalog = Array.from(runtimeSource.matchAll(/type:\s*'([^']+)'[\s\S]*?path:\s*'([^']+)'/g))
    .map((match) => ({ type: match[1], path: match[2] }));
  const catalogPaths = new Set(catalog.map((widget) => `widgets/${widget.path}`));
  const comboStatKeys = Array.from(runtimeSource.matchAll(/key:\s*'([^']+)'/g)).map((match) => match[1]);

  if (!runtimeSource.includes("import '../js/core/tzkt-throttle.js';")) {
    fail('widgets/runtime.js must install the shared TzKT throttle');
  }
  if (!runtimeSource.includes("import { fetchWithRetry } from '../js/core/api.js';")) {
    fail('widgets/runtime.js must reuse the shared fetchWithRetry helper');
  }
  if (!runtimeSource.includes("import { API_URLS, FETCH_LIMITS, STAKING_TARGET } from '../js/core/config.js';")) {
    fail('widgets/runtime.js must read endpoint/fetch/staking constants from js/core/config.js');
  }
  if (!runtimeSource.includes("import { DEFAULT_THEME, THEME_COLORS, THEMES } from '../js/ui/theme.js';")) {
    fail('widgets/runtime.js must share dashboard theme metadata from js/ui/theme.js');
  }
  if (!config.includes("coingecko: 'https://api.coingecko.com/api/v3'")) {
    fail('js/core/config.js must expose the CoinGecko API base for widgets and price surfaces');
  }

  if (!runtimeSource.includes('export const DEFAULT_WIDGET_THEME = DEFAULT_THEME')) {
    fail('widget default theme should follow dashboard DEFAULT_THEME');
  }
  for (const snippet of ["WIDGET_THEME_ORDER = [...THEMES, 'transparent']", 'transparent: { bg:']) {
    if (!runtimeSource.includes(snippet)) fail(`widget theme runtime missing ${snippet}`);
  }
  for (const snippet of [
    'WIDGET_UTM_CAMPAIGN',
    'export function trackedDashboardUrl',
    "params.set('utm_medium', 'widget')",
    "trackWidgetEvent('impression'",
    'widget_attribution',
    'widget_markdown'
  ]) {
    if (!runtimeSource.includes(snippet)) fail(`widget attribution runtime missing ${snippet}`);
  }
  for (const key of ['health', 'tz4']) {
    if (!comboStatKeys.includes(key)) {
      fail(`combo widget options missing latest signal: ${key}`);
    }
  }

  for (const file of rawWidgetFiles) {
    const text = await readText(file);
    if (!catalogPaths.has(file)) fail(`widgets/runtime.js catalog missing raw widget page ${file}`);
    if (!text.includes("from './runtime.js'")) fail(`${file} must import widgets/runtime.js`);
    if (/https:\/\/api\.tzkt\.io\/v1|https:\/\/api\.coingecko\.com\/api\/v3/.test(text)) {
      fail(`${file} must not hardcode TzKT/CoinGecko API hosts; use widgets/runtime.js`);
    }
    if (text.includes("const THEMES") || text.includes('THEME_NAMES')) {
      fail(`${file} must not maintain a private theme list`);
    }
    if (!text.includes('utm_medium=widget_attribution')) {
      fail(`${file} footer must link back with widget attribution params`);
    }
    if (!text.includes('powered by tezos.systems ->')) {
      fail(`${file} footer must visibly credit tezos.systems`);
    }
    if (!text.includes('../js/core/goatcounter-init.js')) {
      fail(`${file} must load the shared GoatCounter initializer for widget impressions`);
    }
  }

  for (const widget of catalog) {
    const file = `widgets/${widget.path}`;
    if (!(await pathExists(file))) fail(`widgets/runtime.js catalog points at missing widget ${file}`);
  }
  if (catalog.length !== rawWidgetFiles.length) {
    fail(`widgets/runtime.js catalog count ${catalog.length} must match raw widget pages ${rawWidgetFiles.length}`);
  }

  for (const snippet of ['WIDGET_CATALOG', 'WIDGET_THEME_ORDER', 'COMBO_STAT_OPTIONS', "from './runtime.js'"]) {
    if (!builder.includes(snippet)) fail(`widgets/builder.html must derive ${snippet} from widgets/runtime.js`);
  }
  if (!builder.includes('max="3600"')) {
    fail('widgets/builder.html refresh slider must support the runtime one-hour upper bound');
  }
  if (!builder.includes('widget_builder_copy')) {
    fail('widgets/builder.html must track embed-code copy events');
  }

  if (!sw.includes('RUNTIME_CACHE_LIMIT') || !sw.includes('putBounded(RUNTIME_CACHE')) {
    fail('sw.js must cache optional widgets and feature assets on use in a bounded runtime cache');
  }
  for (const file of ['widgets/runtime.js', ...htmlFiles]) {
    if (sw.includes(`'/${file}'`) || sw.includes(`"/${file}"`)) {
      fail(`sw.js install shell must not eagerly precache optional widget asset /${file}`);
    }
  }

  pass(`widget runtime contracts checked: ${catalog.length} widgets, ${comboStatKeys.length} combo stat options`);
}

async function checkMainnetLaunchCopy() {
  const config = await readText('js/core/config.js');
  if (!config.includes("MAINNET_LAUNCH = '2018-09-17T00:00:00Z'")) {
    fail('js/core/config.js must keep MAINNET_LAUNCH at 2018-09-17T00:00:00Z');
  }

  const userFacingFiles = [
    'index.html',
    '.well-known/ai-plugin.json',
    'data/tweets.json',
    'js/core/app.js',
    'js/features/state-of-tezos.js',
    'js/landing/live-data.js'
  ];
  const stalePatterns = [
    /June 30, 2018/i,
    /mainnet launch in June 2018/i,
    /since June 2018/i,
    /Proof of Stake from genesis\s+—\s+June 2018/i,
    /already PoS since genesis\.\s+June 2018/i,
    /temporalCoverage["']?\s*:\s*["']2018-06-30\/\.\./i,
    /mainnet launched June 30, 2018/i,
    /refreshed every 2 minutes/i
  ];

  for (const file of userFacingFiles) {
    const text = await readText(file);
    for (const pattern of stalePatterns) {
      if (pattern.test(text)) {
        fail(`${file} contains stale June 2018 mainnet launch wording (${pattern})`);
      }
    }
  }

  const index = await readText('index.html');
  if (!index.includes('September 17, 2018')) {
    fail('index.html should spell out the canonical September 17, 2018 mainnet launch date');
  }

  const aiPlugin = await readText('.well-known/ai-plugin.json');
  if (!aiPlugin.includes('September 17, 2018')) {
    fail('.well-known/ai-plugin.json must use the canonical September 17, 2018 mainnet launch date');
  }
  if (!aiPlugin.includes('visible freshness markers')) {
    fail('.well-known/ai-plugin.json must describe freshness without stale two-minute claims');
  }

  pass('mainnet launch copy uses Sep 17, 2018 in user-facing surfaces');
}

async function checkModuleImportVersions() {
  const jsFiles = await walk('js', (file) => file.endsWith('.js'));
  const versionedImportPattern = /\b(?:import|export)\s+(?:[^'"]+\s+from\s+)?["']\.\.?\/[^"']+\?v=\d+["']/;
  const dynamicVersionedImportPattern = /\bimport\(["']\.\.?\/[^"']+\?v=\d+["']\)/;

  for (const file of jsFiles) {
    const source = await readText(file);
    if (versionedImportPattern.test(source) || dynamicVersionedImportPattern.test(source)) {
      fail(`${file} imports a local ES module with a ?v= query; use a single module specifier so shared state is not duplicated`);
    }
  }

  pass('local ES module imports avoid cache-busting query strings');
}

async function checkHistoricalPagination() {
  const api = await readText('js/core/api.js');
  const history = await readText('js/features/history.js');
  const index = await readText('index.html');
  const collector = await readText('.github/scripts/collect-data.js');
  const backfill = await readText('scripts/backfill-supabase-history.mjs');
  const freshness = await readText('scripts/check-supabase-history-freshness.mjs');
  const backfillWorkflow = await readText('.github/workflows/backfill-supabase-history.yml');
  const packageJson = await readText('package.json');
  const migration = await readText('supabase/migrations/20260618190000_expand_historical_capture.sql');
  if (!api.includes('HISTORICAL_PAGE_SIZE')) {
    fail('fetchHistoricalData must page Supabase history results; default REST responses are capped at 1,000 rows');
  }
  if (!api.includes('&limit=${HISTORICAL_PAGE_SIZE}&offset=${offset}')) {
    fail('fetchHistoricalData must request paged Supabase results so all-time charts include recent rows');
  }
  if (!api.includes('historicalDataCache') || !api.includes('cached.promise')) {
    fail('fetchHistoricalData must cache in-flight and recent history requests so range switches do not refetch the same rows');
  }

  if (/delay\s*:\s*\([^)]*\)\s*=>\s*[^,\n}]*dataIndex/.test(history)) {
    fail('history charts must not use per-point animation delays; long ranges should paint immediately');
  }
  if (!history.includes('FULL_CHART_POINT_LIMITS') || !history.includes('downsampleTimeSeries')) {
    fail('history charts must bound long-range render points before passing data to Chart.js');
  }
  if (!history.includes('getFullChartTimeScale') || !history.includes("case 'all':") || !history.includes("unit: 'month'")) {
    fail('history charts must use coarser time ticks for all-time ranges');
  }
  if (!history.includes('parsing: false') || !history.includes('animation: fastRender ? false')) {
    fail('history charts must use fast Chart.js options for 30d+ rendering');
  }

  const expandedColumns = [
    'new_accounts_24h',
    'active_contracts_24h',
    'total_staked',
    'total_delegated',
    'total_baking_power',
    'staking_apy_stake',
    'staking_apy_delegate',
    'protocol_issuance_rate',
    'lb_issuance_rate',
    'lb_ema',
    'lb_ema_pct',
    'lb_subsidy_disabled',
    'tz4_power_pct',
    'tz4_power_active',
    'tz4_power_total'
  ];

  for (const column of expandedColumns) {
    if (!collector.includes(column)) fail(`historical collector must write ${column}`);
    if (!migration.includes(column)) fail(`Supabase migration must add ${column}`);
  }
  if (/legacy payload|legacyDataPoint|retrying legacy/i.test(collector)) {
    fail('historical collector must fail on Supabase schema drift instead of silently retrying a legacy payload');
  }
  for (const table of ['market_history', 'network_health_history', 'governance_period_history', 'tezosx_history']) {
    if (!migration.includes(`create table if not exists public.${table}`)) {
      fail(`Supabase migration must create ${table}`);
    }
    if (!api.includes(table)) {
      fail(`frontend API must fetch ${table}`);
    }
    if (!freshness.includes(table)) {
      fail(`freshness checker must inspect ${table}`);
    }
  }
  for (const snippet of [
    'fetchChamberHistoricalData',
    'fetchSupabaseHistoryFreshness',
    'DOMAIN_HISTORY_TABLES',
    'history-freshness-strip',
    'history-digest',
    'renderHistoryDigest',
    'DOMAIN_HISTORY_CHARTS',
    'CORE_HISTORY_CHARTS',
    'chart-total-staked',
    'chart-staking-apy',
    'chart-tz4-power',
    'chart-lb-ema',
    'chart-tezosx-tvl',
    'chart-governance-participation',
    'market_cap_usd',
    'missed_attestation_slots',
    'tvl_share_pct',
    'voting_power_voted',
    'staking-apy-sparkline',
    'delegated-sparkline',
    'total-burned-sparkline',
    'baking-power-sparkline'
  ]) {
    if (!api.includes(snippet) && !history.includes(snippet) && !index.includes(snippet)) {
      fail(`frontend historical surfaces must include ${snippet}`);
    }
  }
  for (const snippet of [
    "selector: '#lb-entry-card'",
    "selector: '#tezlink-entry-card'",
    "selector: '#chamber-entry-card'",
    "source: 'networkHealth'",
    "source: 'governance'",
    "source: 'tezosx'",
    "metric: 'lb_ema_pct'",
    "metric: 'tz4_power_pct'",
    "'staking-apy': { metric: 'staking_apy_stake'",
    "'delegated': { metric: 'delegated_ratio'",
    "'total-burned': { metric: 'total_burned'",
    "'baking-power': { metric: 'total_baking_power'"
  ]) {
    if (!history.includes(snippet)) {
      fail(`card history buttons must wire chamber stats via ${snippet}`);
    }
  }
  for (const snippet of [
    'statistics?timestamp.le=',
    'context/issuance/current_yearly_rate',
    'lbToggleEma',
    'totalOwnStaked',
    'BACKFILL_DRY_RUN',
    "method: 'PATCH'"
  ]) {
    if (!backfill.includes(snippet)) {
      fail(`Supabase backfill script must include ${snippet}`);
    }
  }
  if (!packageJson.includes('"backfill:supabase": "node scripts/backfill-supabase-history.mjs"')) {
    fail('package scripts must expose backfill:supabase');
  }
  if (!packageJson.includes('"check:supabase:freshness": "node scripts/check-supabase-history-freshness.mjs"')) {
    fail('package scripts must expose check:supabase:freshness');
  }
  for (const snippet of ['workflow_dispatch:', 'SUPABASE_KEY', 'BACKFILL_DRY_RUN', "node-version: '24'", 'actions/checkout@v7', 'actions/setup-node@v6']) {
    if (!backfillWorkflow.includes(snippet)) {
      fail(`Supabase backfill workflow must include ${snippet}`);
    }
  }
  const workflowFiles = [
    '.github/workflows/backfill-supabase-history.yml',
    '.github/workflows/ci.yml',
    '.github/workflows/collect-chamber-history.yml',
    '.github/workflows/collect-data.yml',
    '.github/workflows/refresh-governance-surfaces.yml'
  ];
  for (const file of workflowFiles) {
    const workflow = await readText(file);
    if (workflow.includes('actions/checkout@v4') || workflow.includes('actions/setup-node@v4') || workflow.includes("node-version: '20'")) {
      fail(`${file} must use Node 24-era action pins`);
    }
  }
  const ciWorkflow = await readText('.github/workflows/ci.yml');
  for (const snippet of ['pull_request:', 'branches: [main]', 'npm run test:static', 'playwright install --with-deps chromium', '--only app-shell,hen-mode,route-crawl']) {
    if (!ciWorkflow.includes(snippet)) fail(`site validation workflow must include ${snippet}`);
  }

  pass('historical data fetch paginates and long-range charts use fast render settings');
}

async function checkLiquidityBakingIssuanceState() {
  const surfaces = [
    ['dashboard API', 'js/core/api.js'],
    ['landing live data', 'js/landing/live-data.js'],
    ['historical collector', '.github/scripts/collect-data.js'],
    ['compare page', 'js/features/compare-page.js']
  ];

  for (const [label, file] of surfaces) {
    const text = await readText(file);
    if (!text.includes('lbToggleEma') || !text.includes('LB_EMA_DISABLE_THRESHOLD')) {
      fail(`${label} must use live Liquidity Baking EMA state for issuance calculations`);
    }
  }

  const landing = await readText('staking/index.html');
  if (/data-live="issuance-rate">~\d/.test(landing)) {
    fail('staking page should not hardcode a numeric issuance fallback; live data must provide LB-aware issuance');
  }

  const tweets = JSON.parse(await readText('data/tweets.json'));
  const issuanceTemplates = (tweets.TWEET_OPTIONS?.['issuance-rate'] || []).map((item) => item.text).join('\n');
  if (/~3\.[56]/.test(issuanceTemplates) || /adaptive issuance at \{value\}/i.test(issuanceTemplates)) {
    fail('issuance share templates must not hardcode stale rates or describe total issuance as protocol-only adaptive issuance');
  }
  if (!/Liquidity Baking|LB/.test(issuanceTemplates)) {
    fail('issuance share templates should mention that the displayed rate reflects Liquidity Baking state');
  }

  pass('issuance surfaces account for Liquidity Baking active/disabled state');
}

async function checkTruthSurfaceContracts() {
  const rewardsTracker = await readText('js/features/rewards-tracker.js');
  const myTezos = await readText('js/features/my-tezos.js');
  const myBaker = await readText('js/features/my-baker.js');
  const leaderboard = await readText('js/features/leaderboard.js');
  const bakerReportCard = await readText('js/features/baker-report-card.js');
  const calculator = await readText('js/features/calculator.js');
  const api = await readText('js/core/api.js');
  const landingLive = await readText('js/landing/live-data.js');
  const comparison = await readText('js/features/comparison.js');
  const comparePage = await readText('js/features/compare-page.js');
  const comparisonConfig = await readText('js/core/config.js');
  const compareIndex = await readText('compare/index.html');
  const stakingGuide = await readText('staking/index.html');
  const bakersGuide = await readText('bakers/index.html');
  const tweetTemplates = await readText('data/tweets.json');
  const protocolData = await readText('data/protocol-data.json');
  const siteMapCopy = await readText('js/core/site-map.js');
  const dailyBriefingCopy = await readText('js/features/daily-briefing.js');
  const changelogCopy = await readText('js/features/changelog.js');

  for (const required of [
    "status: 'no-current-record'",
    'Latest historical record: cycle',
    'Not currently baking, staking, or delegating.',
    'No baker-efficiency score applies to a staker reward.',
    'Estimate from baker rewards; payout policies vary.'
  ]) {
    if (!rewardsTracker.includes(required)) fail(`rewards tracker truth state missing: ${required}`);
  }
  if (rewardsTracker.includes('baker efficiency') || rewardsTracker.includes('📈 This Cycle')) {
    fail('rewards tracker must not apply universal baker-efficiency or historical This Cycle copy');
  }
  if (/recent\s*=\s*rewards\.find[\s\S]*?\|\|\s*rewards\[0\]/.test(rewardsTracker)) {
    fail('rewards tracker must not fall back from the current cycle to a historical row');
  }
  const bakerEarnedBlock = rewardsTracker.match(/function sumBakerEarned\(row\) \{([\s\S]*?)\n\}/)?.[1] || '';
  if (/StakedShared/.test(bakerEarnedBlock)
      || !rewardsTracker.includes('Gross on-chain baker receipts before delegator payouts; external-staker shared rewards excluded')) {
    fail('rewards tracker baker-owned totals must exclude external-staker shared rewards and disclose gross pre-payout scope');
  }

  for (const [label, source] of [
    ['My Tezos', myTezos],
    ['My Baker', myBaker],
    ['calculator', calculator]
  ]) {
    if (/delegateAPY:\s*3\.1|stakeAPY:\s*9\.2/.test(source)) {
      fail(`${label} must not restore hard-coded APY fallbacks`);
    }
  }
  if (!myTezos.includes('No active reward estimate') || !calculator.includes('APY unavailable — retry shortly') || !myBaker.includes("'Reward Status'")) {
    fail('personal reward surfaces must render explicit inactive or unavailable states');
  }
  const missedRightsBlock = myBaker.match(/async function fetchMissedRights[\s\S]*?\n\}/)?.[0] || '';
  if (/return 0;/.test(missedRightsBlock)
      || !missedRightsBlock.includes('Number.isSafeInteger(count)')
      || !myBaker.includes("element.dataset.quality = blocksKnown && attestKnown ? 'live' : 'partial'")) {
    fail('My Baker missed-rights failures must render unavailable or partial coverage, never a fabricated zero');
  }
  if (!api.includes('gross * (1 - edge)')
      || !api.includes('edge_of_staking_over_delegation')
      || !myTezos.includes('activeRewardEstimate')
      || !myBaker.includes('Gross APY (Delegation)')) {
    fail('personal reward surfaces must use the live delegation divisor, apply the external-staker edge as gross times one minus edge, and withhold gross delegation projections');
  }
  if (!api.includes('parsedProtocolRate > 0')
      || !api.includes("rawLbEma !== null")
      || /Number\.isFinite\(Number\(lbState\?\.ema\)\)/.test(api)) {
    fail('issuance aggregation must reject zero protocol rates and must not coerce an unknown LB EMA to zero');
  }
  if (!api.includes("failedInputs.push('calculatedRate')")
      || !api.includes('const rawBurned = stats?.totalBurned')
      || !landingLive.includes("throw new Error('Live staking estimate values are invalid')")
      || !landingLive.includes('rawEma !== null')) {
    fail('APY, Liquidity Baking, and burned-supply surfaces must reject malformed or semantically empty 200 responses');
  }
  if (!calculator.includes('calc-delegate-payout-assumption')
      || !calculator.includes('calc-stake-edge-assumption')
      || /parseFloat\([^\n]*calc-staking-fee[^\n]*\)\s*\|\|\s*5/.test(calculator)) {
    fail('calculator must require explicit delegation/staking assumptions and preserve valid zero-percent endpoints');
  }
  if (!calculator.includes('const updateId = ++updateSequence')
      || !calculator.includes("if (updateId !== updateSequence || currentMode !== 'baker') return;")) {
    fail('calculator async renders must discard superseded assumption requests');
  }

  if (leaderboard.includes("value: 'edge'") || leaderboard.includes('bakerStakingEdgePercent')) {
    fail('delegator fit must not rank the direct-staking edge as if it were a delegation fee');
  }
  if (!leaderboard.includes('Delegation fees and payout policy are off-chain')
      || !leaderboard.includes('external-staker edge is not a delegation fee')) {
    fail('delegator fit must disclose that off-chain payout terms and the on-chain external-staker edge are different');
  }
  if (bakerReportCard.includes("buildScoreBar('Fee Score'")
      || bakerReportCard.includes("buildStatCell('Fee'")
      || !bakerReportCard.includes('External-staker edge')
      || !bakerReportCard.includes('Delegation payout policy is off-chain and is not scored here.')) {
    fail('Baker Report Card must show the external-staker edge separately from its operational grade and delegation terms');
  }
  if (!bakerReportCard.includes('Number(cycle?.cycle) < currentCycle')
      || !bakerReportCard.includes('Number(b.bakingPower || 0) - Number(a.bakingPower || 0)')
      || !bakerReportCard.includes('Current baking-power rank')) {
    fail('Baker Report Card must score a completed participation cycle and rank the field it labels as baking power');
  }

  if (comparison.includes("tezosLive: () => '4'") || comparePage.includes("validators: '6'")) {
    fail('comparison surfaces must not restore unreceipted hard-coded Tezos Nakamoto values');
  }
  const tezosStaticBlock = comparisonConfig.match(/tezosStatic:\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
  if (!tezosStaticBlock.includes("validators: 'See /health'") || /validators:\s*['"](?:4|6)['"]/.test(tezosStaticBlock)) {
    fail('comparison config must defer Tezos concentration to Network Health');
  }
  if (/\b(?:stakingPct|annualIssuance):\s*['"]Live['"]/.test(tezosStaticBlock)) {
    fail('comparison no-JS fallbacks must say unavailable rather than rendering a bare Live placeholder');
  }
  if (!comparison.includes('Concentration and slashing rows are contextual') || comparison.includes("key: 'slashing',\n        label: 'Slashing',\n        icon: '🔪',\n        tezosLive: () => CHAIN_COMPARISON.tezosStatic.slashing,\n        tezosNote: () => CHAIN_COMPARISON.tezosStatic.slashingNote,\n        winner: 'tezos'")) {
    fail('comparison summary must treat slashing and concentration as context, not categorical winners');
  }
  for (const key of ['stakingPct', 'annualIssuance', 'energyPerTx', 'avgTxFee']) {
    const metric = comparison.match(new RegExp(`key:\\s*'${key}',[\\s\\S]*?\\n\\s*},`))?.[0] || '';
    if (!metric.includes('winner: null')) {
      fail(`comparison ${key} must not assign a hard-coded winner to dynamic or method-dependent values`);
    }
  }
  const governanceRecordMetric = comparison.match(/key:\s*'selfAmendments',[\s\S]*?\n\s*},/)?.[0] || '';
  if (!governanceRecordMetric.includes("label: 'Governance Upgrade Record'")
      || !governanceRecordMetric.includes('winner: null')
      || /selfAmendments:\s*[01]\s*,/.test(comparisonConfig)) {
    fail('comparison must describe unlike governance upgrade mechanisms as context instead of an invented numeric self-amendment scoreboard');
  }
  if (!comparison.includes('Dynamic or method-dependent staking, issuance, energy, fee, concentration, and slashing rows have no categorical winner.')
      || /Lowest gross issuance in this tracked set|high staking participation|lowest fees, and the smallest energy footprint/i.test(comparison)) {
    fail('comparison chain profiles must keep dynamic and methodology-dependent metrics neutral');
  }
  if (/Solana wins cost|Highest participation|Tezos uses less energy per tx|~0\.00051 kWh|~\$0\.005/.test(comparison)) {
    fail('comparison share copy must not restore undated fee, energy, or staking winner claims');
  }
  if (/5 chains\. 1 comparison\. Live data|Cardano:\s*~12 min|created Lido|billions in exploits|forks every upgrade/i.test(comparison)) {
    fail('comparison share copy must distinguish live Tezos data from dated peers and avoid obsolete or unreceipted claims');
  }
  const hardForkMetric = comparison.match(/key:\s*'hardForks',[\s\S]*?\n\s*\},/)?.[0] || '';
  if (!hardForkMetric.includes("label: 'Upgrade Path'") || !hardForkMetric.includes('winner: null')) {
    fail('comparison must treat unlike hard-fork and upgrade mechanisms as contextual');
  }
  if (/of 10|Nakamoto coefficient/i.test(compareIndex)) {
    fail('comparison index must not present an editorial aggregate score or unlike Nakamoto bases as one ranking');
  }
  const peerReferences = {
    ethereum: 'https://ethereum.org/developers/docs/consensus-mechanisms/pos/',
    solana: 'https://solana.com/solana-whitepaper.pdf',
    cardano: 'https://docs.cardano.org/about-cardano/governance-overview',
    algorand: 'https://developer.algorand.org/solutions/avm-evm-instant-finality/'
  };
  for (const chain of ['ethereum', 'solana', 'cardano', 'algorand']) {
    const page = await readText(`compare/tezos-vs-${chain}.html`);
    if (!page.includes('See /health') || !page.includes('No composite score is assigned.')) {
      fail(`Tezos vs ${chain} must defer concentration and omit a composite winner`);
    }
    if (/<div class="cp-scoreboard"/.test(page)) {
      fail(`Tezos vs ${chain} must not restore the baked aggregate scoreboard`);
    }
    if (!page.includes(peerReferences[chain]) || !page.includes('Peer values are a static snapshot') || !page.includes('they are not all live')) {
      fail(`Tezos vs ${chain} must disclose its static peer snapshot and primary reference`);
    }
  }

  if (/250\+|~250/.test(stakingGuide + bakersGuide)) {
    fail('staking and baker guides must not hard-code a stale baker population');
  }
  if (/below 67% attestation rate get deactivated/i.test(bakersGuide)) {
    fail('baker guide must separate reward participation thresholds from inactivity deactivation');
  }
  if (!stakingGuide.includes('direct staking freezes XTZ')
      || !stakingGuide.includes('protocol unstaking and finalization process')
      || !bakersGuide.includes('deactivation is a separate consequence of sustained inactivity')) {
    fail('staking and baker guides must preserve lockup and deactivation semantics');
  }
  if (stakingGuide.includes('<td>Baker fee</td>')
      || !stakingGuide.includes('Off-chain baker payout policy')
      || !stakingGuide.includes('0–100% external-staker edge')
      || !stakingGuide.includes('It is not a delegation fee.')) {
    fail('staking guide must distinguish off-chain delegation terms from the on-chain direct-staking edge');
  }

  const publicCopy = `${tweetTemplates}\n${protocolData}\n${comparison}\n${siteMapCopy}\n${dailyBriefingCopy}\n${changelogCopy}`;
  const forbiddenClaims = [
    [/\{value\}\s+independent\s+(?:bakers|operators|validators)/i, 'active baker addresses must not be presented as independently controlled operators'],
    [/every single one run by an independent operator/i, 'the baker count must not imply one independent operator per address'],
    [/risk[- ]?free|zero additional risk|no slashing risk|no smart contract risk/i, 'delegation copy must not erase payout, wallet, market, or operational risks'],
    [/Tezos is the only L1 with real on-chain democracy|stake IS governance|your stake IS your vote|every staker is also a voter/i, 'governance copy must distinguish assigned voting power from baker ballots'],
    [/Ethereum[^\n]{0,120}probabilistic finality|probabilistic finality[^\n]{0,120}Ethereum/i, 'Ethereum PoS must be described with checkpoint finality, not Nakamoto-style probabilistic finality'],
    [/zero hard forks|zero chain splits|zero reorganizations|no reorgs|100% uptime|zero downtime|perfect uptime|not a single outage|days fork-free|zero-fork (?:history|streak|upgrades)/i, 'public copy must not make unreceipted absolute continuity claims'],
    [/every (?:single )?block is final|guaranteed finality|mathematically final/i, 'Tenderbake finality must retain its BFT, quorum, and network assumptions'],
    [/no admin keys|zero external trust assumptions|no bridge risk|same guarantees|actually work as intended|verified first|no other (?:L1|chain)|every use case|won't drain user funds|formally verified contracts|near-zero exploits|formal verification would have caught|bugs (?:aren't found|are made impossible)/i, 'public share copy must not turn framework capabilities into universal application or cross-chain guarantees'],
    [/single Tezos transaction uses|Raspberry Pis drawing \d+ watts|\b\d[\d,.]*x more efficient|certified carbon neutral/i, 'public energy copy must retain a dated measurement boundary and methodology'],
    [/staking is voting|funded (?:accounts|addresses)[^\n]{0,80}(?:are|represent|counts?) (?:real )?(?:people|users|humans)|every[^\n]{0,60}can[^\n]{0,40}vote/i, 'funded addresses must not be presented as unique people or direct governance voters'],
    [/trilemma solved|every new baker adds another operator|no slashing for downtime/i, 'baker-address copy must not imply independent control or erase protocol risk'],
    [/only one lets stakeholders vote/i, 'cross-chain governance copy must not use an unreceipted categorical winner'],
    [/no VC unlocks|no hidden wallets|mysterious foundation wallet|team tokens unlocking/i, 'supply telemetry must not infer wallet control or future market behavior'],
    [/zero fragmentation|approve\/transferFrom footguns|built-in contract upgrade mechanism/i, 'token and contract tooling copy must not turn design options into universal guarantees'],
    [/first time a blockchain upgraded itself|foundation of every zk-rollup/i, 'protocol history must avoid unsupported cross-chain firsts and universal ZK claims'],
    [/sub-cent|fractions?[- ]of[- ](?:a[- ])?cent|near-zero fees|costs? almost nothing|for pennies/i, 'fee copy must use current comparable receipts instead of timeless dollar-cost claims'],
    [/stake: run your own baker|earn: either way|your XTZ, your choice of baker, your rewards|accounts earning through staking or delegation|reward-earning/i, 'staking copy must distinguish direct staking, baking, and discretionary delegation payouts'],
    [/daily cycles mean daily rewards|earn every single day|without a single halt|hasn['’]t missed one since genesis/i, 'cycle copy must not turn nominal timing into guaranteed rewards or availability'],
    [/all of them actually finalized|deterministic finality[^\n]{0,100}what are you waiting for/i, 'transaction counts must not imply unconditional finality'],
    [/active smart rollups|active examples|rollups live|enshrined L2 security|inter-rollup messaging without the trust assumptions/i, 'unfiltered originated-rollup counts and L1 verification must not erase activity or deployment assumptions'],
    [/unbiasable randomness|ETH validators still can['’]t separate|any VM[^\n]{0,80}verified by the L1|\{total\} on-chain votes|most contested (?:Tezos )?upgrade/i, 'protocol-history copy must not restore false universal, superlative, or one-upgrade-one-vote claims'],
    [/how many people (?:are )?(?:actually )?securing|merge to deflationary|went deflationary with the merge|respond(?:s|ing)? to actual (?:network )?usage(?: patterns)?/i, 'issuance copy must use direct-staking conditions and dated net-supply outcomes']
  ];
  for (const [pattern, message] of forbiddenClaims) {
    if (pattern.test(publicCopy)) fail(message);
  }
  for (const required of [
    'baker payout/default, wallet, market, and operational risks remain',
    'Delegators assign voting power to their baker',
    'quorum and normal network conditions',
    'Ethereum proof of stake uses checkpoint finality'
  ]) {
    if (!publicCopy.includes(required)) fail(`public truth copy must retain: ${required}`);
  }

  pass('reward, APY, concentration, and staking guide truth contracts checked');
}

async function checkStylesheetFreshness() {
  const source = await statOrNull('css/styles.css');
  const minified = await statOrNull('css/styles.min.css');
  if (!source || !minified) return;

  if (source.mtimeMs > minified.mtimeMs + 1000) {
    warn('css/styles.css is newer than css/styles.min.css; regenerate the served minified CSS before deploy');
  } else {
    pass('served minified CSS is not older than source CSS');
  }

  const themeFiles = await walk('css/themes', (file) => file.endsWith('.min.css')).catch(() => []);
  const themeSource = await readText('js/ui/theme.js');
  const themeMatch = themeSource.match(/export const THEMES\s*=\s*\[([\s\S]*?)\];/);
  const expectedThemes = themeMatch ? Array.from(themeMatch[1].matchAll(/['"]([^'"]+)['"]/g), (match) => match[1]) : [];
  if (!expectedThemes.length) {
    fail('js/ui/theme.js theme list could not be parsed for lazy theme CSS checks');
  }
  const baseCss = await readText('css/styles.min.css');
  const leakedThemes = expectedThemes.filter((theme) => new RegExp(`data-theme\\s*=\\s*["']?${theme}["']?`, 'i').test(baseCss));
  if (leakedThemes.length) {
    fail(`css/styles.min.css should not carry lazy theme selectors: ${leakedThemes.join(', ')}`);
  }
  if (minified.size > 300 * 1024) {
    fail(`css/styles.min.css is ${Math.round(minified.size / 1024)}KB; lazy theme split should keep the render-blocking base under 300KB`);
  }
  for (const theme of expectedThemes) {
    const file = `css/themes/${theme}.min.css`;
    if (!themeFiles.includes(file)) fail(`missing lazy theme bundle: ${file}`);
    const themeStat = await statOrNull(file);
    if (themeStat && source.mtimeMs > themeStat.mtimeMs + 1000) {
      warn(`${file} is older than css/styles.css; run npm run build:css`);
    }
  }
  if (themeFiles.length >= expectedThemes.length) {
    pass(`lazy theme CSS bundles checked: ${themeFiles.length}`);
  }

  const sourceCss = await readText('css/styles.css');
  const henCss = await readText('css/hen-mode.css');
  const parseVariables = (block = '') => Object.fromEntries(
    Array.from(block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi), (match) => [match[1], match[2].trim()])
  );
  const rootVariables = parseVariables(sourceCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1]);
  const henVariables = parseVariables(henCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1]);
  const resolveVariable = (value, variables, depth = 0) => {
    const variable = String(value || '').match(/^var\((--[a-z0-9-]+)\)$/i)?.[1];
    if (!variable || depth > 4) return value;
    return resolveVariable(variables[variable], variables, depth + 1);
  };
  const normalizeHex = (value) => /^#[0-9a-f]{3}$/i.test(value || '')
    ? `#${value.slice(1).split('').map((character) => character.repeat(2)).join('')}`
    : value;
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  };
  const contrastRatio = (left, right) => {
    const light = Math.max(luminance(left), luminance(right));
    const dark = Math.min(luminance(left), luminance(right));
    return (light + 0.05) / (dark + 0.05);
  };
  for (const theme of expectedThemes) {
    const themeBlock = sourceCss.match(new RegExp(`\\[data-theme=["']${theme}["']\\]\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] || '';
    const variables = { ...rootVariables, ...henVariables, ...parseVariables(themeBlock) };
    for (const textToken of ['--text-tertiary', '--text-muted']) {
      const textColor = normalizeHex(resolveVariable(variables[textToken], variables));
      for (const backgroundToken of ['--bg-primary', '--bg-secondary', '--bg-tertiary']) {
        const backgroundColor = normalizeHex(resolveVariable(variables[backgroundToken], variables));
        if (!/^#[0-9a-f]{6}$/i.test(textColor || '') || !/^#[0-9a-f]{6}$/i.test(backgroundColor || '')) {
          fail(`theme ${theme} contrast contract could not resolve ${textToken} on ${backgroundToken}`);
          continue;
        }
        const ratio = contrastRatio(textColor, backgroundColor);
        if (ratio < 4.5) {
          fail(`theme ${theme} ${textToken} contrast is ${ratio.toFixed(2)}:1 on ${backgroundToken}; small text needs at least 4.5:1`);
        }
      }
    }
    if (theme === 'clean') {
      const linkColor = normalizeHex(resolveVariable(variables['--surface-link-color'], variables));
      for (const backgroundToken of ['--bg-primary', '--bg-secondary', '--bg-tertiary']) {
        const backgroundColor = normalizeHex(resolveVariable(variables[backgroundToken], variables));
        const ratio = contrastRatio(linkColor, backgroundColor);
        if (ratio < 4.5) {
          fail(`theme clean link contrast is ${ratio.toFixed(2)}:1 on ${backgroundToken}; ordinary links need at least 4.5:1`);
        }
      }
    }
  }
  pass(`theme small-text contrast checked across ${expectedThemes.length} themes`);
}

async function checkAuroraDesktopTitleTreatment() {
  const css = await readText('css/styles.css');
  const matrixEffects = await readText('js/effects/matrix-effects.js');
  const backgroundEffects = await readText('js/effects/bg-effects.js');
  const titleStart = css.indexOf('[data-theme="aurora"] .title');
  const keyframesStart = css.indexOf('@keyframes auroraTitleShift', titleStart);
  const sharedBlock = titleStart >= 0 && keyframesStart >= 0
    ? css.slice(titleStart, keyframesStart)
    : '';

  if (!sharedBlock.includes('[data-theme="aurora"] .title')) {
    fail('aurora title needs a shared mobile/desktop multicolor treatment');
    return;
  }

  for (const token of ['#45E0C8', '#5BA8FF', '#9B8CFF', '#F49AD1']) {
    if (!sharedBlock.includes(token)) fail(`shared aurora title gradient missing ${token}`);
  }

  if (!sharedBlock.includes('background-size: 220% auto')) {
    fail('aurora title must keep the mobile-style wide gradient field on desktop');
  }
  if (!sharedBlock.includes('animation: auroraTitleShift 9s linear infinite')) {
    fail('aurora title must use the same shifting animation on desktop and mobile');
  }
  if (css.includes('auroraTitleSweep')) {
    fail('desktop aurora title should not use a separate sweep animation from mobile');
  }
  const accessibilityStart = css.indexOf('Accessibility');
  const reducedMotionStart = css.indexOf('@media (prefers-reduced-motion: reduce)', accessibilityStart);
  const reducedMotionEnd = css.indexOf('.glass-button:focus', reducedMotionStart);
  const reducedMotionBlock = reducedMotionStart >= 0 && reducedMotionEnd > reducedMotionStart
    ? css.slice(reducedMotionStart, reducedMotionEnd)
    : '';
  if (!reducedMotionBlock.includes('animation: none !important')) {
    fail('reduced-motion mode must disable decorative animations');
  }
  if (!reducedMotionBlock.includes('*::before') || !reducedMotionBlock.includes('*::after')) {
    fail('reduced-motion mode must also disable animations on pseudo-elements');
  }
  if (reducedMotionBlock.includes('auroraTitleShift') || /animation:[^;]*infinite/i.test(reducedMotionBlock)) {
    fail('Aurora and other theme animations must not be re-enabled in reduced-motion mode');
  }
  for (const [label, source] of [['Matrix canvas', matrixEffects], ['theme background canvas', backgroundEffects]]) {
    if (!source.includes("matchMedia('(prefers-reduced-motion: reduce)')")
        || !source.includes('!reducedMotionQuery.matches')
        || !source.includes("addEventListener('change', handleThemeChange)")) {
      fail(`${label} must avoid animation under reduced motion and react when the preference changes`);
    }
  }

  pass('desktop aurora title shares the multicolor treatment while respecting reduced motion');
}

async function checkPortableTooling() {
  const packageJson = JSON.parse(await readText('package.json'));
  const gitignore = await readText('.gitignore');
  const hook = await readText('.githooks/pre-commit').catch(() => '');
  const hookStat = await statOrNull('.githooks/pre-commit');

  if (!(await pathExists('package-lock.json'))) {
    fail('package-lock.json must be tracked so fresh clones can use npm ci');
  }
  if (/^package-lock\.json$/m.test(gitignore)) {
    fail('.gitignore must not ignore package-lock.json; reproducible test tooling depends on it');
  }

  const expectedScripts = {
    'install-hooks': 'git config core.hooksPath .githooks',
    'guard:readme': 'node scripts/guard-readme-sync.mjs',
    'check:readme': 'node tests/static-checks.mjs --readme-only',
    'refresh:generated': 'node scripts/refresh-generated-surfaces.mjs --all',
    'refresh:generated:commit': 'node scripts/refresh-generated-surfaces.mjs --mode precommit',
    'refresh:generated:scheduled': 'node scripts/refresh-generated-surfaces.mjs --mode scheduled',
    'refresh:milestones': 'node scripts/generate-milestone-catalog.mjs --force',
    'refresh:nakamoto': 'node scripts/refresh-nakamoto-sources.mjs',
    test: 'npm run test:static && npm run test:smoke',
    'test:static': 'node tests/static-checks.mjs',
    'test:smoke': 'node tests/smoke.mjs',
    'test:smoke:list': 'node tests/smoke.mjs --list',
    'test:smoke:headed': 'node tests/smoke.mjs --headed',
    'test:smoke:strict': 'node tests/smoke.mjs --strict-external',
    'test:smoke:live': 'node tests/smoke.mjs --base-url https://tezos.systems'
  };

  for (const [name, command] of Object.entries(expectedScripts)) {
    if (packageJson.scripts?.[name] !== command) {
      fail(`package.json script ${name} should be "${command}"`);
    }
  }

  if (!hookStat) {
    fail('.githooks/pre-commit must exist as the shared hook wrapper');
  } else if ((hookStat.mode & 0o111) === 0) {
    fail('.githooks/pre-commit must keep executable mode');
  }
  if (!(await pathExists('scripts/guard-readme-sync.mjs'))) {
    fail('scripts/guard-readme-sync.mjs must exist for the README pre-commit guard');
  }
  if (!(await pathExists('scripts/refresh-generated-surfaces.mjs'))) {
    fail('scripts/refresh-generated-surfaces.mjs must exist for generated-surface refreshes');
  }
  if (!hook.includes('refresh-generated-surfaces.mjs') || !hook.includes('stamp-version.sh')) {
    fail('.githooks/pre-commit must refresh generated surfaces and stamp version metadata');
  }
  if (!hook.includes('guard-readme-sync.mjs') || !hook.includes('static-checks.mjs') || !hook.includes('--readme-only')) {
    fail('.githooks/pre-commit must guard README sync and run focused README contract checks');
  }
  const generatedRefresh = await readText('scripts/refresh-generated-surfaces.mjs');
  for (const expected of ['refresh-governance-data.mjs', 'generate-milestone-catalog.mjs', 'data/milestone-catalog.json', 'refresh-nakamoto-sources.mjs', 'data/nakamoto-sources.json', 'build-css.mjs', 'generate-chamber-routes.mjs', 'generate-chamber-og-images.mjs', 'generate-og-image.js', 'bake-compare-pages.mjs', 'sitemap.xml', 'og-image.png']) {
    if (!generatedRefresh.includes(expected)) {
      fail(`scripts/refresh-generated-surfaces.mjs must coordinate ${expected}`);
    }
  }
  const rootOgGenerator = await readText('scripts/generate-og-image.js');
  if (rootOgGenerator.includes('Math.random')) {
    fail('scripts/generate-og-image.js must be deterministic when commit hooks regenerate og-image.png');
  }

  if (!(await pathExists('scripts/lib/playwright-browser.cjs'))) {
    fail('scripts/lib/playwright-browser.cjs must exist as the shared Playwright browser launcher');
  } else {
    const launcher = await readText('scripts/lib/playwright-browser.cjs');
    if (!launcher.includes('SYSTEM_BROWSER_CANDIDATES') || !launcher.includes('BROWSER_EXECUTABLE_PATH')) {
      fail('shared Playwright browser launcher must preserve system-browser fallback and explicit executable support');
    }
  }

  const playwrightCallers = [
    ['tests/smoke.mjs', '../scripts/lib/playwright-browser.cjs'],
    ['scripts/generate-og-image.js', './lib/playwright-browser.cjs'],
    ['scripts/generate-chamber-og-images.mjs', './lib/playwright-browser.cjs']
  ];
  for (const [file, importPath] of playwrightCallers) {
    const source = await readText(file);
    if (!source.includes(importPath)) {
      fail(`${file} must use scripts/lib/playwright-browser.cjs for Chromium fallback`);
    }
    if (/chromium\.launch\s*\(/.test(source)) {
      fail(`${file} must not launch Chromium directly; use the shared Playwright browser launcher`);
    }
    if (/systemBrowserCandidates|SYSTEM_BROWSER_CANDIDATES|function findSystemBrowser/.test(source)) {
      fail(`${file} must not carry a copied system-browser candidate list`);
    }
  }

  pass('portable npm scripts, lockfile, and shared git hook checked');
}

async function checkRepositoryLicense() {
  const license = await readText('LICENSE');
  const notice = await readText('NOTICE');
  const readme = await readText('README.md');
  const agentMap = await readText('AGENTS.md');
  const index = await readText('index.html');
  const changelog = await readText('js/features/changelog.js');
  const landing = await readText('landing.html');
  const landingNav = await readText('js/landing/site-nav.js');
  const share = await readText('js/ui/share.js');
  const stateOfTezos = await readText('js/features/state-of-tezos.js');
  const aiPlugin = JSON.parse(await readText('.well-known/ai-plugin.json'));
  const packageJson = JSON.parse(await readText('package.json'));
  const packageLock = JSON.parse(await readText('package-lock.json'));
  const normalizedLicense = license
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
  const officialMplHash = '1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5';
  const actualMplHash = createHash('sha256').update(normalizedLicense).digest('hex');

  if (actualMplHash !== officialMplHash) {
    fail('LICENSE must remain the unmodified Mozilla Public License 2.0 text');
  }
  if (packageJson.license !== 'MPL-2.0' || packageLock?.packages?.['']?.license !== 'MPL-2.0') {
    fail('package.json and the root package-lock entry must declare MPL-2.0');
  }
  if (packageJson.author !== 'Primate411') {
    fail('package.json must preserve the Primate411 project authorship');
  }

  const noticeSnippets = [
    'Tezos Systems',
    'Copyright (c) 2026 Primate411',
    'https://github.com/Primate411/tezos.systems',
    'developed by Primate411',
    'Mozilla Public License, v. 2.0',
    'https://mozilla.org/MPL/2.0/',
    'Third-party software',
    'separately offered under CC BY 4.0',
    'extent Primate411 owns those rights',
    'co-founding member of',
    'Tez Capital name and brand are',
    "repository's current copyright holder",
    'earlier revisions carried MIT or ISC declarations'
  ];
  for (const snippet of noticeSnippets) {
    if (!notice.includes(snippet)) fail(`NOTICE missing license contract text: ${snippet}`);
  }

  const readmeSnippets = [
    '## License',
    'Mozilla Public License 2.0',
    '`MPL-2.0`',
    '[NOTICE](NOTICE)',
    'file-level copyleft',
    'modified covered files must remain available under MPL-2.0',
    'Third-party software',
    '[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)',
    'Primate411 owns those rights',
    'co-founding member of',
    'Tez Capital brand is represented',
    'RPC infrastructure: [Tez Capital](https://tez.capital)',
    'Built by: [Primate411](https://github.com/Primate411)',
    'copyright notice in [NOTICE](NOTICE)',
    'current copyright holder',
    'earlier revisions carried MIT or ISC declarations'
  ];
  for (const snippet of readmeSnippets) {
    if (!readme.includes(snippet)) fail(`README missing license contract text: ${snippet}`);
  }

  const agentMapSnippets = [
    'License: Mozilla Public License 2.0 (`MPL-2.0`)',
    '`LICENSE`: unmodified Mozilla Public License 2.0 terms',
    '`NOTICE`: Tezos Systems / Primate411 attribution',
    'Tezos Systems is built by Primate411, a co-founding member',
    'represent Tez Capital as the affiliated brand and RPC',
    "keep Primate411 as the repository's current copyright holder",
    'and site/schema creator, and as publisher where publisher metadata is present',
    'live footer and document metadata must retain public Source and MPL-2.0'
  ];
  for (const snippet of agentMapSnippets) {
    if (!agentMap.includes(snippet)) fail(`AGENTS.md missing license handoff text: ${snippet}`);
  }

  const deployedNoticeSnippets = [
    '<link rel="license" href="/LICENSE">',
    '<meta name="author" content="Primate411">',
    'href="https://github.com/Primate411/tezos.systems" target="_blank" rel="noopener">Source</a>',
    'href="/LICENSE" rel="license">MPL-2.0</a>',
    'Built by <a href="https://github.com/Primate411" target="_blank" rel="noopener">Primate411</a>, a co-founding member of <a href="https://tez.capital" target="_blank" rel="noopener">Tez Capital</a>',
    'RPC by <a href="https://eu.rpc.tez.capital" target="_blank" rel="noopener">Tez Capital</a>',
    '"license": "https://creativecommons.org/licenses/by/4.0/"'
  ];
  for (const snippet of deployedNoticeSnippets) {
    if (!index.includes(snippet)) fail(`index.html missing deployed license text: ${snippet}`);
  }
  if ((index.match(/"name": "Primate411"/g) || []).length < 2) {
    fail('index.html must credit Primate411 as both WebApplication and Dataset creator');
  }
  if ((index.match(/"affiliation": \{/g) || []).length < 2
    || (index.match(/"name": "Tez Capital"/g) || []).length < 2) {
    fail('index.html must represent Tez Capital as Primate411\'s WebApplication and Dataset affiliation');
  }
  if (index.includes('Powered by <a href="https://tez.capital"') || index.includes('"sourceOrganization"')) {
    fail('index.html must not present Tez Capital as the product owner or source organization');
  }
  for (const route of CHAMBER_ROUTES) {
    const routeShell = await readText(`${route.slug}/index.html`);
    for (const snippet of deployedNoticeSnippets.filter((item) => !item.includes('creativecommons.org'))) {
      if (!routeShell.includes(snippet)) fail(`${route.slug}/index.html missing deployed license text: ${snippet}`);
    }
    if ((routeShell.match(/"name": "Primate411"/g) || []).length < 1
      || (routeShell.match(/"affiliation": \{/g) || []).length < 1
      || (routeShell.match(/"name": "Tez Capital"/g) || []).length < 1
      || !routeShell.includes('"@type": "WebPage"')
      || !routeShell.includes('"@type": "BreadcrumbList"')
      || routeShell.includes('Powered by <a href="https://tez.capital"')
      || routeShell.includes('"sourceOrganization"')) {
      fail(`${route.slug}/index.html has stale product ownership attribution`);
    }
  }
  if (!changelog.includes('Primate411 project authorship, Tez Capital co-founding affiliation and RPC credit')) {
    fail('changelog must disclose the public MPL-2.0 source-license change');
  }

  const standalonePages = ['staking/index.html', 'governance/index.html', 'bakers/index.html'];
  for (const file of standalonePages) {
    const page = await readText(file);
    if (!/"publisher":\s*\{\s*"@type": "Person",\s*"name": "Primate411",\s*"url": "https:\/\/github\.com\/Primate411",\s*"affiliation":\s*\{\s*"@type": "Organization",\s*"name": "Tez Capital",\s*"url": "https:\/\/tez\.capital"\s*\}\s*\}/s.test(page)) {
      fail(`${file} must identify Primate411 as its publisher with Tez Capital affiliation`);
    }
    if (!page.includes('Built by <a href="https://github.com/Primate411">Primate411</a>, a co-founding member of <a href="https://tez.capital">Tez Capital</a>')
      || !page.includes('<a href="https://tez.capital">RPC by Tez Capital</a>')
      || page.includes('Powered by Tez Capital')) {
      fail(`${file} must show Primate411 authorship, Tez Capital affiliation, and Tez Capital RPC credit`);
    }
  }
  if (!landing.includes('Built by <a href="https://github.com/Primate411"')
    || !landing.includes('a co-founding member of <a href="https://tez.capital"')
    || !landing.includes('RPC by <a href="https://tez.capital"')
    || landing.includes('Powered by <a href="https://tez.capital"')) {
    fail('landing.html must show Primate411 authorship, Tez Capital affiliation, and Tez Capital RPC credit');
  }
  if (!landingNav.includes('Built by <a href="https://github.com/Primate411">Primate411</a>, a co-founding member of <a href="https://tez.capital">Tez Capital</a>')
    || !landingNav.includes('RPC by <a href="https://tez.capital">Tez Capital</a>')) {
    fail('landing footer runtime must show Primate411 authorship, Tez Capital affiliation, and Tez Capital RPC credit');
  }
  if (!share.includes('Built by <span style="color:${brandColor};font-weight:600;">Primate411</span> · RPC by')) {
    fail('share cards must credit Primate411 and retain the Tez Capital RPC brand credit');
  }
  if (!stateOfTezos.includes("'PRIMATE411 · RPC BY TEZ CAPITAL'")) {
    fail('State of Tezos cards must credit Primate411 and retain the Tez Capital RPC brand credit');
  }
  if (!aiPlugin.description_for_model.includes('co-founding member of Tez Capital')
    || !aiPlugin.description_for_model.includes('Tez Capital RPC infrastructure')
    || aiPlugin.legal_info_url !== 'https://tezos.systems/LICENSE') {
    fail('AI plugin metadata must show Tez Capital affiliation and RPC infrastructure and link the repository license');
  }

  pass('MPL-2.0 text, package metadata, attribution, and repository docs agree');
}

async function checkSmokeSuiteCatalogContracts() {
  const smoke = await readText('tests/smoke.mjs');

  if (smoke.includes('const suiteNames = [')) {
    fail('tests/smoke.mjs --list must not maintain a separate hard-coded suite list');
  }
  if (!/if \(cli\.list\) \{\s*for \(const \{ name, description \} of getSuiteCatalog\(null, ''\)\)/.test(smoke)) {
    fail('tests/smoke.mjs --list must derive from getSuiteCatalog so every runnable suite is discoverable');
  }

  pass('smoke suite list derives from the executable catalog');
}

async function checkTourAndShareCaptureContracts() {
  const themeSource = await readText('js/ui/theme.js');
  const tour = await readText('js/features/tooltip-tour.js');
  const app = await readText('js/core/app.js');
  const styles = await readText('css/styles.css');
  const themeMatch = themeSource.match(/const THEMES = \[([^\]]+)\]/);
  const themes = themeMatch ? Array.from(themeMatch[1].matchAll(/['"]([^'"]+)['"]/g)).map((match) => match[1]) : [];
  if (!themes.length) {
    fail('js/ui/theme.js theme list could not be parsed for tour copy checks');
  }

  if (/12 themes/i.test(tour)) {
    fail('tooltip tour must not retain stale 12 themes copy');
  }
  if (!tour.includes(`${themes.length} themes`)) {
    fail(`tooltip tour theme count must agree with theme.js (${themes.length} themes)`);
  }
  for (const snippet of [
    'Find anything',
    'Need a hand?',
    'Start with mainnet history',
    'Read the latest head',
    'Protocol Anthology',
    'Network Context',
    'Explore opens the Command Center',
    'Help is available when you want it',
    'Show help',
    'Not now'
  ]) {
    if (!tour.includes(snippet)) fail(`tooltip tour must retain passive search-help copy: ${snippet}`);
  }
  for (const selector of [
    '#top-continuity-history',
    '#block-ticker-button',
    '#hero-search-form',
    '#chambers-section .section-header',
    '#my-tezos-btn',
    '#tezos-loop-chips',
    '#features-gear',
    '#settings-gear'
  ]) {
    if (!tour.includes(`target: '${selector}'`)) fail(`tooltip tour must cover current help target ${selector}`);
  }
  if (!tour.includes('window.innerWidth - (VIEWPORT_PAD * 2)')) {
    fail('tooltip tour must size its tooltip from the viewport so mobile help never starts off-screen');
  }
  for (const snippet of [
    'Focus command bar',
    'Open selected command result',
    'Open Historical Data'
  ]) {
    if (!app.includes(snippet)) fail(`keyboard help overlay must include current command shortcut copy: ${snippet}`);
  }

  const upgradeNumberBlock = styles.match(/\.upgrade-number\s*\{[^}]*\}/)?.[0] || '';
  if (!upgradeNumberBlock) {
    fail('css/styles.css missing .upgrade-number block for share capture guard');
  } else if (/color-mix|oklch|(?<!-)lch\(|lab\(/i.test(upgradeNumberBlock)) {
    fail('.upgrade-number must avoid html2canvas-unsupported color functions because protocol timeline sharing captures this live DOM');
  } else {
    pass('tour theme copy and protocol timeline share CSS contracts checked');
  }
}

async function checkDailyBriefingPriceContracts() {
  const briefing = await readText('js/features/daily-briefing.js');
  const requiredSnippets = [
    "import { fetchXTZPrice } from './price.js';",
    'resolvePriceContext',
    'priceChange24h: currentChange24h',
    'cached.priceChange24h',
    'BRIEFING_SCHEMA_VERSION',
    'activityNarrative',
    'ACTIVITY_MEANINGFUL_PCT',
    'baselineText',
    'cached.schema !== BRIEFING_SCHEMA_VERSION'
  ];

  for (const snippet of requiredSnippets) {
    if (!briefing.includes(snippet)) fail(`daily briefing price contract missing: ${snippet}`);
  }
  if (briefing.includes('if (cached?.cycle === stats.cycle)')) {
    fail('daily briefing update must not reuse same-cycle cache without price-movement stale checks');
  }
  if (!/absPct24h\s*<\s*0\.4\s*\?\s*TEMPLATES\.price\[2\]/.test(briefing)) {
    fail('daily briefing steady-price template must stay gated behind sub-0.4% 24h movement');
  }
  if (/dir\s*===\s*['"]above['"]\s*\?\s*['"]busy['"]/.test(briefing)) {
    fail('daily briefing activity copy must not label every above-baseline move as busy');
  }
  if (briefing.includes('the 7-day average')) {
    fail('daily briefing activity copy must not claim a 7-day average when using the saved activity baseline');
  }

  pass('daily briefing price and activity movement cache contracts checked');
}

async function checkNetworkContextNavigationContracts() {
  const briefing = await readText('js/features/daily-briefing.js');
  const requiredSiteMapRoutes = {
    staking: 'staking-chamber',
    governance: 'chamber',
    collector: 'hen',
    creator: 'hen',
    nft: 'hen',
    domains: 'domains',
    lb: 'liquidity-baking',
    tz4: 'tz4',
    etherlink: 'tezosx',
    ledger: 'ledger-flow',
    network: 'pulse'
  };

  for (const [key, siteMapId] of Object.entries(requiredSiteMapRoutes)) {
    const pattern = new RegExp(`${key}:\\s*['"]${siteMapId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
    if (!pattern.test(briefing)) {
      fail(`Network Context site-map route missing ${key} -> ${siteMapId}`);
    }
  }

  const requiredSnippets = [
    "import { findSiteMapEntry } from '../core/site-map.js';",
    'NETWORK_FEATURE_SITE_MAP_IDS',
    'routeFromSiteMapEntry',
    'window.addEventListener(\'hot-signal\', receiveHotSignal)',
    'window.addEventListener(\'governance-alert-state\'',
    'hotPoolSignals()',
    'LS_DAILY_SNAPSHOT',
    'HOT_SIGNAL_RENDER_CAP = 12',
    'HOT_SIGNAL_CATEGORY_BUDGET = 2',
    'HOT_SIGNAL_EVENT_DECAY_PER_HOUR = 8',
    "if (value == null || value === '') return null;",
    'MILESTONE_MOMENT_TTL_MS = 72 * HOUR_MS',
    'advanceMilestoneTrack(momentStore',
    "milestoneStatus: 'crossed'",
    "milestoneStatus: 'near'",
    'shortLabel: milestoneShortLabel',
    'claimMilestoneArrival(seenMilestoneArrivals',
    "signal?.tone === 'milestone' && signal?.milestoneStatus === 'crossed'",
    'data-milestone-status=',
    'hot-today-milestone-status',
    'scheduleHotSignalExpiryRefresh(hotTodaySignals)',
    'milestone: hotSignalPayload(milestoneSignal)',
    'dailySnapshotReference',
    'captureDailySnapshot(stats)',
    'const kind = normalizeSignalKind',
    'scoreBoostFor(category, profile)',
    'fetchNftPulse',
    'maybeDispatchProtocolLoreSignal',
    'delta: normalizeDelta',
    'BRIEFING_SCHEMA_VERSION = 10',
    'MILESTONE_NEAR_MAX_DAYS = 30',
    'MILESTONE_CATALOG_URL',
    'generatedMilestoneThresholds',
    'data-hot-milestone-share',
    'captureNetworkMomentShare',
    '<a class="network-focus-chip"',
    '<a class="network-signal',
    'data-network-route',
    'wireNetworkContextNavigation(container)',
    'closeDrawerForNetworkRoute(route)',
    'window.location.assign(route)',
    "window.dispatchEvent(new Event('hashchange'))"
  ];
  for (const snippet of requiredSnippets) {
    if (!briefing.includes(snippet)) fail(`Network Context clickable contract missing snippet: ${snippet}`);
  }

  pass('Network Context feature routes stay clickable');
}

function checkMilestoneLifecycleBehavior() {
  try {
    const now = 1_700_000_000_000;
    const ttlMs = 72 * 60 * 60 * 1000;
    const thresholds = [100, 200];
    const legacyStore = normalizeMilestoneStore({
      'blocks:100': { track: 'blocks', target: '100', createdAt: now - 1000 }
    });
    const baseline = advanceMilestoneTrack(legacyStore, {
      trackId: 'blocks',
      currentValue: 105,
      thresholds,
      now,
      ttlMs
    });
    assert.equal(baseline.baseline, true);
    assert.equal(baseline.activeMoments.length, 0);
    assert.equal(legacyStore.tracks.blocks.celebratedTargets['100'].baseline, true);

    const store = normalizeMilestoneStore(null);
    const first = advanceMilestoneTrack(store, {
      trackId: 'blocks',
      currentValue: 95,
      thresholds,
      now,
      ttlMs
    });
    assert.equal(first.activeMoments.length, 0);
    const crossing = advanceMilestoneTrack(store, {
      trackId: 'blocks',
      currentValue: 101,
      thresholds,
      now: now + 1000,
      ttlMs
    });
    assert.equal(crossing.newlyCrossed.length, 1);
    assert.equal(crossing.activeMoments[0].expiresAt, now + 1000 + ttlMs);

    const movedAway = advanceMilestoneTrack(store, {
      trackId: 'blocks',
      currentValue: 150,
      thresholds,
      now: now + ttlMs - 1000,
      ttlMs
    });
    assert.equal(movedAway.activeMoments.length, 1);
    const expired = advanceMilestoneTrack(store, {
      trackId: 'blocks',
      currentValue: 99,
      thresholds,
      now: now + ttlMs + 1001,
      ttlMs
    });
    assert.equal(expired.activeMoments.length, 0);
    assert.ok(store.tracks.blocks.celebratedTargets['100']);
    const noRearm = advanceMilestoneTrack(store, {
      trackId: 'blocks',
      currentValue: 101,
      thresholds,
      now: now + ttlMs + 2000,
      ttlMs
    });
    assert.equal(noRearm.newlyCrossed.length, 0);
    assert.equal(noRearm.activeMoments.length, 0);

    const arrivals = new Set();
    assert.equal(claimMilestoneArrival(arrivals, 'blocks|100|event'), true);
    assert.equal(claimMilestoneArrival(arrivals, 'blocks|100|event'), false);
    assert.equal(claimMilestoneArrival(arrivals, 'blocks|200|event'), true);

    const tooEarly = qualifyMilestoneNearState({
      currentValue: 2852,
      thresholds: [3000],
      nearWindow: 180,
      dailyRate: 1,
      maxLeadDays: 14,
      absoluteMaxDays: 30
    });
    assert.equal(tooEarly, null);
    const withinTwoWeeks = qualifyMilestoneNearState({
      currentValue: 2988,
      thresholds: [3000],
      nearWindow: 180,
      dailyRate: 1,
      maxLeadDays: 14,
      absoluteMaxDays: 30
    });
    assert.equal(Math.ceil(withinTwoWeeks.etaDays), 12);
    const beyondAbsoluteCap = qualifyMilestoneNearState({
      currentValue: 2969,
      thresholds: [3000],
      nearWindow: 180,
      dailyRate: 1,
      maxLeadDays: 45,
      absoluteMaxDays: 30
    });
    assert.equal(beyondAbsoluteCap, null);
    const insideAbsoluteCap = qualifyMilestoneNearState({
      currentValue: 2971,
      thresholds: [3000],
      nearWindow: 180,
      dailyRate: 1,
      maxLeadDays: 45,
      absoluteMaxDays: 30
    });
    assert.equal(Math.ceil(insideAbsoluteCap.etaDays), 29);
    pass('milestone lifecycle behavior covers baseline, crossing, TTL, tombstones, one-time arrival, and the 30-day near cap');
  } catch (error) {
    fail(`milestone lifecycle behavior failed: ${error.message}`);
  }
}

async function checkMilestoneCatalogContracts() {
  try {
    const catalog = JSON.parse(await readText('data/milestone-catalog.json'));
    assert.equal(catalog.schema, MILESTONE_CATALOG_SCHEMA);
    assert.equal(catalog.cadence?.days, MILESTONE_REFRESH_DAYS);
    assert.equal(catalog.cadence?.commits, MILESTONE_REFRESH_COMMITS);
    assert.ok(Number.isFinite(Number(catalog.generatedAtCommitCount)));
    assert.ok(Number.isFinite(Date.parse(catalog.generatedAt)));

    for (const trackId of Object.keys(MILESTONE_BASE_THRESHOLDS)) {
      const generated = generatedMilestoneThresholds(catalog, trackId);
      const base = MILESTONE_BASE_THRESHOLDS[trackId];
      assert.ok(generated.length >= base.length, `${trackId} generated thresholds should preserve the base catalog`);
      assert.deepEqual(generated.slice(0, base.length), [...base]);
      assert.ok(catalog.tracks?.[trackId]?.nextTarget == null || generated.includes(catalog.tracks[trackId].nextTarget));
    }

    const extendedBlocks = extendMilestoneThresholds('blocks', 31_200_000);
    assert.ok(extendedBlocks.at(-1) > 31_200_000);
    const cadenceBase = Date.parse('2026-07-01T00:00:00Z');
    assert.equal(milestoneCatalogCadence({ generatedAt: new Date(cadenceBase).toISOString(), generatedAtCommitCount: 700, now: cadenceBase + (13 * 86400000), commitCount: 799 }).due, false);
    assert.equal(milestoneCatalogCadence({ generatedAt: new Date(cadenceBase).toISOString(), generatedAtCommitCount: 700, now: cadenceBase + (14 * 86400000), commitCount: 799 }).due, true);
    assert.equal(milestoneCatalogCadence({ generatedAt: new Date(cadenceBase).toISOString(), generatedAtCommitCount: 700, now: cadenceBase + (13 * 86400000), commitCount: 800 }).due, true);
    const generator = await readText('scripts/generate-milestone-catalog.mjs');
    const orchestrator = await readText('scripts/refresh-generated-surfaces.mjs');
    for (const snippet of ['MILESTONE_REFRESH_DAYS', 'MILESTONE_REFRESH_COMMITS', '--project-next-commit']) {
      assert.ok(generator.includes(snippet) || orchestrator.includes(snippet), `milestone cadence missing ${snippet}`);
    }
    assert.ok(orchestrator.includes("MILESTONE_TARGETS = ['data/milestone-catalog.json']"));
    pass('milestone catalog preserves curated thresholds and regenerates after 14 days or 100 commits');
  } catch (error) {
    fail(`milestone catalog contracts failed: ${error.message}`);
  }
}

async function checkVisitStreakBehavior() {
  const originalGlobals = new Map();
  const rememberGlobal = (key) => {
    originalGlobals.set(key, {
      exists: Object.prototype.hasOwnProperty.call(globalThis, key),
      value: globalThis[key]
    });
  };
  const restoreGlobals = () => {
    for (const [key, original] of originalGlobals) {
      if (original.exists) globalThis[key] = original.value;
      else delete globalThis[key];
    }
  };
  const createStorage = (seed = {}) => {
    const values = new Map(Object.entries(seed).map(([key, value]) => [key, String(value)]));
    return {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value))
    };
  };

  for (const key of ['__visitStreakEnqueue', 'document', 'localStorage', 'requestAnimationFrame', 'setTimeout']) {
    rememberGlobal(key);
  }

  try {
    const source = await readText('js/features/streak.js');
    const queueImport = "import { enqueueToast } from '../ui/toast-queue.js';";
    assert.ok(source.includes(queueImport), 'visit streak must keep using the shared toast queue');
    const testSource = source.replace(
      queueImport,
      'const enqueueToast = (item) => globalThis.__visitStreakEnqueue(item);'
    );
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(testSource).toString('base64')}`;
    const { initStreak } = await import(moduleUrl);
    const now = new Date(2026, 6, 10, 12, 0, 0);
    const today = '2026-07-10';
    const yesterday = '2026-07-09';

    const runVisit = (seed = {}) => {
      const queued = [];
      const current = { textContent: '' };
      globalThis.localStorage = createStorage(seed);
      globalThis.__visitStreakEnqueue = (item) => queued.push(item);
      globalThis.document = {
        getElementById: (id) => id === 'visit-streak-current' ? current : null
      };
      initStreak(now);
      return { current, queued, storage: globalThis.localStorage };
    };

    const renderToast = (item) => {
      const appended = [];
      class FakeElement {
        constructor(tagName) {
          this.tagName = tagName;
          this.children = [];
          this.listeners = new Map();
          this.classNames = new Set();
          this.classList = {
            add: (...names) => names.forEach((name) => this.classNames.add(name)),
            remove: (...names) => names.forEach((name) => this.classNames.delete(name))
          };
          this.textContent = '';
          this.isConnected = false;
        }
        setAttribute(name, value) { this[name] = String(value); }
        addEventListener(name, listener) { this.listeners.set(name, listener); }
        append(...children) { this.children.push(...children); }
        remove() { this.isConnected = false; }
      }
      globalThis.document = {
        createElement: (tagName) => new FakeElement(tagName),
        body: {
          appendChild: (node) => {
            node.isConnected = true;
            appended.push(node);
          }
        }
      };
      globalThis.requestAnimationFrame = (callback) => callback();
      globalThis.setTimeout = (callback) => {
        callback();
        return 0;
      };
      item.show(() => {}, item.duration);
      return appended[0];
    };

    const firstVisit = runVisit();
    assert.deepEqual(firstVisit.queued.map((item) => item.priority), [1]);
    assert.equal(firstVisit.current.textContent, 'Current streak: 1 day');
    assert.equal(firstVisit.storage.getItem('tezos_streak_count'), '1');
    assert.equal(firstVisit.storage.getItem('tezos_streak_last_visit'), today);

    const sameDayReload = runVisit({
      tezos_streak_count: 2,
      tezos_streak_last_visit: today
    });
    assert.equal(sameDayReload.queued.length, 0, 'same-day reload must not replay the streak toast');
    assert.equal(sameDayReload.current.textContent, 'Current streak: 2 days');

    const nextDayVisit = runVisit({
      tezos_streak_count: 1,
      tezos_streak_last_visit: yesterday
    });
    assert.equal(nextDayVisit.queued.length, 1);
    assert.equal(nextDayVisit.storage.getItem('tezos_streak_count'), '2');
    const nextDayToast = renderToast(nextDayVisit.queued[0]);
    assert.match(nextDayToast.textContent, /2-day visit streak/i);
    assert.match(nextDayToast.textContent, /Browser-local/i);
    assert.match(nextDayToast.textContent, /Settings → Visit streak/i);

    const resetVisit = runVisit({
      tezos_streak_count: 8,
      tezos_streak_last_visit: '2026-07-01'
    });
    assert.equal(resetVisit.storage.getItem('tezos_streak_count'), '1');
    assert.match(renderToast(resetVisit.queued[0]).textContent, /Day 1[\s\S]*Come back tomorrow to start a streak/i);

    const milestoneVisit = runVisit({
      tezos_streak_count: 6,
      tezos_streak_last_visit: yesterday
    });
    const milestoneToast = renderToast(milestoneVisit.queued[0]);
    assert.ok(milestoneToast.classNames.has('milestone'));
    assert.match(milestoneToast.children[0]?.textContent || '', /One week in the bakery[\s\S]*Settings → Visit streak/i);
    assert.equal(milestoneToast.children[1]?.textContent, 'Share');

    pass('visit streak starts after day one, advances once per local calendar day, updates persistent help, and preserves milestone sharing');
  } catch (error) {
    fail(`visit streak behavior failed: ${error.message}`);
  } finally {
    restoreGlobals();
  }
}

async function checkReadmeContracts() {
  const readme = await readText('README.md');
  const themeSource = await readText('js/ui/theme.js');
  const index = await readText('index.html');
  const themeMatch = themeSource.match(/const THEMES = \[([^\]]+)\]/);
  const themes = themeMatch ? Array.from(themeMatch[1].matchAll(/['"]([^'"]+)['"]/g)).map((match) => match[1]) : [];

  if (!themes.length) {
    fail('js/ui/theme.js theme list could not be parsed for README contract checks');
  }

  const stalePatterns = [
    [/Zero dependencies/i, 'README must not claim zero dependencies'],
    [/every 2 minutes/i, 'README must not claim the main refresh runs every 2 minutes'],
    [/60s refresh/i, 'README must not claim price refresh is 60s'],
    [/localhost:8888|http\.server 8888/i, 'README must not mention the old local dev port 8888'],
    [/12 visual themes/i, 'README must not claim 12 visual themes while theme.js defines a different count']
  ];
  for (const [pattern, message] of stalePatterns) {
    if (pattern.test(readme)) fail(message);
  }

  const requiredSnippets = [
    `${themes.length} visual themes`,
    'npm ci',
    'npm run install-hooks',
    'npm run serve',
    'http://localhost:9000',
    'npm run build:css',
    'npm run refresh:generated',
    'npm run refresh:milestones',
    'npm run refresh:maxis',
    'npm run check:maxis',
    'npm run routes:chambers',
    'npm run og:chambers',
    'npm run bake:compare',
    'npm run refresh:governance',
    'npm run guard:readme',
    'npm run check:readme',
    'npm run test:smoke:list',
    'SKIP_README_GUARD=1',
    'Main dashboard refresh: 2 hours',
    'Sparkline refresh: 10 minutes',
    'Price refresh: 30 minutes',
    'Memory cache TTL: 1 minute',
    'Storage cache TTL: 4 hours',
    'css/styles.min.css',
    'scripts/lib/playwright-browser.cjs',
    'BROWSER_EXECUTABLE_PATH',
    'CACHE_NAME',
    'version.json',
    'September 17, 2018'
  ];
  for (const snippet of requiredSnippets) {
    if (!readme.includes(snippet)) fail(`README missing current contract text: ${snippet}`);
  }

  for (const theme of themes) {
    if (!readme.includes(`\`${theme}\``)) fail(`README theme table missing ${theme}`);
  }

  if (!index.includes(`${themes.length} visual themes`)) {
    fail(`index.html schema featureList must agree with theme.js count (${themes.length} visual themes)`);
  }

  pass(`README contracts checked against package/config/theme reality (${themes.length} themes)`);
}

async function checkMaxisContracts() {
  const config = JSON.parse(await readText('data/maxis-contracts.json'));
  const careerArtifact = JSON.parse(await readText('data/maxis-careers.json'));
  const snapshot = JSON.parse(await readText('data/maxis-leaders.json'));
  const maxis = await readText('js/features/maxis.js');
  const maxisCss = await readText('css/maxis.css');
  const shellExtrasCss = await readText('css/shell-extras.css');
  const app = await readText('js/core/app.js');
  const siteMap = await readText('js/core/site-map.js');
  const sw = await readText('sw.js');
  const tezosDomainsCore = await readText('js/core/tezos-domains.js');
  const myTezos = await readText('js/features/my-baker.js');
  const maxisGenerator = await readText('scripts/refresh-maxis-data.mjs');
  const generatedSurfaces = await readText('scripts/refresh-generated-surfaces.mjs');
  const packageJson = JSON.parse(await readText('package.json'));

  const careerErrors = validateGovernanceCareerArtifact(careerArtifact);
  if (careerErrors.length) fail(`maxis Governance career artifact invalid: ${careerErrors.join('; ')}`);
  if (hoursSince(careerArtifact.generatedAt) > 72) fail('maxis Governance career artifact is older than 72 hours; run npm run refresh:maxis-careers');
  if (careerArtifact?.coverage?.absenceMeansZero !== true || careerArtifact?.recordCount < 1) {
    fail('maxis Governance career coverage must be complete enough for an absent address to mean zero');
  }
  const careerRecords = Object.values(careerArtifact?.records || {});
  const reconstructedCareerBallots = careerRecords.reduce((sum, record) => sum + Number(record?.lifetimeBallots || 0), 0);
  const reconstructedCareerProposals = careerRecords.reduce((sum, record) => sum + Number(record?.lifetimeProposals || 0), 0);
  if (reconstructedCareerBallots !== Number(careerArtifact?.sourceReceipts?.ballots?.rows)
    || reconstructedCareerProposals !== Number(careerArtifact?.sourceReceipts?.proposals?.rows)) {
    fail('maxis Governance career record totals must reconcile to the exact source receipts');
  }
  if (careerRecords.some((record) => record?.activeDelegateCounters?.operationRowCountsMatch === false)) {
    fail('maxis Governance career active-delegate counters disagree with reconstructed operation history');
  }
  const canonicalGovernanceRows = snapshot?.rankings?.governance || [];
  const careerGovernanceRows = careerRecords
    .filter((record) => Number(record?.activeDelegateGovernanceRank) > 0
      && Number(record.activeDelegateGovernanceRank) <= canonicalGovernanceRows.length)
    .sort((left, right) => Number(left.activeDelegateGovernanceRank) - Number(right.activeDelegateGovernanceRank));
  if (careerGovernanceRows.length !== canonicalGovernanceRows.length
    || canonicalGovernanceRows.some((row, index) => row.address !== careerGovernanceRows[index]?.address
      || Number(row.score) !== Number(careerGovernanceRows[index]?.lifetimeActions))) {
    fail('maxis canonical Governance board and exact active-delegate career ranks have drifted; refresh both artifacts together');
  }

  const configErrors = validateMaxisConfig(config);
  if (configErrors.length) fail(`maxis contract taxonomy invalid: ${configErrors.join('; ')}`);
  if (snapshot.schema !== 2) fail('maxis snapshot schema must be 2');
  if (snapshot.rankingLimit !== 10) fail('maxis snapshot ranking limit must be 10');
  if (hoursSince(snapshot.generatedAt) > 72) fail('maxis snapshot is older than 72 hours; run npm run refresh:maxis');
  if (snapshot.truncation?.mints || snapshot.truncation?.appTransactions) {
    fail(`maxis snapshot must not publish truncated rankings: ${JSON.stringify(snapshot.truncation)}`);
  }

  const expectedCategories = ['transaction', 'collector', 'artist', 'minter', 'defi', 'gaming', 'governance', 'staking', 'unicorn'];
  const categories = (snapshot.leaders || []).map((leader) => leader.category);
  if (new Set(categories).size !== categories.length) fail('maxis snapshot categories must be unique');
  for (const category of expectedCategories) {
    if (!categories.includes(category)) fail(`maxis snapshot missing ${category} leader`);
    const ranking = snapshot.rankings?.[category];
    if (!Array.isArray(ranking) || ranking.length !== 10) fail(`maxis snapshot ${category} ranking must contain ten accounts`);
    const addresses = new Set();
    for (const [index, ranked] of (ranking || []).entries()) {
      if (ranked.rank !== index + 1) fail(`maxis snapshot ${category} rank order is invalid at ${index + 1}`);
      if (!/^tz[1-4][1-9A-HJ-NP-Za-km-z]{33}$/.test(ranked.address || '')) fail(`maxis snapshot ${category} rank ${index + 1} has invalid address`);
      if (addresses.has(ranked.address)) fail(`maxis snapshot ${category} repeats ${ranked.address}`);
      addresses.add(ranked.address);
    }
    const leader = (snapshot.leaders || []).find((item) => item.category === category);
    if (leader?.address !== ranking?.[0]?.address) fail(`maxis snapshot ${category} winner must match rank 1`);
  }
  for (const leader of snapshot.leaders || []) {
    if (!['ready', 'empty'].includes(leader.status)) fail(`maxis leader ${leader.category} has invalid status ${leader.status}`);
    if (leader.status === 'ready') {
      if (!/^tz[1-4][1-9A-HJ-NP-Za-km-z]{33}$/.test(leader.address || '')) fail(`maxis leader ${leader.category} has invalid address`);
      if (!leader.scoreLabel || !leader.method || !/^https:\/\//.test(leader.sourceUrl || '')) fail(`maxis leader ${leader.category} is missing score, method, or source`);
    }
  }
  const canonicalClockByCategory = {
    transaction: 'all-time',
    collector: 'rolling-30d',
    artist: 'rolling-30d',
    minter: 'rolling-30d',
    defi: 'rolling-30d',
    gaming: 'rolling-90d',
    governance: 'all-time-active',
    staking: 'live',
    unicorn: 'mixed'
  };
  for (const [category, windowKind] of Object.entries(canonicalClockByCategory)) {
    const leader = (snapshot.leaders || []).find((item) => item.category === category);
    if (leader?.windowKind !== windowKind) {
      fail(`maxis canonical ${category} crown must keep its lane-native ${windowKind} clock, got ${leader?.windowKind || 'missing'}`);
    }
  }
  const canonicalGovernance = (snapshot.leaders || []).find((leader) => leader.category === 'governance');
  if (canonicalGovernance?.status !== 'ready' || !/all-time ballots plus proposals among currently active/i.test(canonicalGovernance?.method || '')) {
    fail('maxis canonical Governance crown must remain an all-time-active record independent of quiet protocol seasons');
  }
  if (!snapshot.coverage?.caveat?.includes('Unknown or unlabeled contracts')) fail('maxis coverage must state the unknown-contract limitation');

  const addressA = 'tz1X568Wdkb1ZUs8qfVYcsZD31YQ4UV3sdY4';
  const addressB = 'tz1gBXG9fg8RMDH69KfKqwoTH5sFDmzt5yzm';
  const addressC = 'tz1Yw8SgnsAmbQcJyaBbQokoYGxeeoX5AKYw';
  const completeCareerSource = (rows) => ({
    rows,
    receipt: { complete: true, truncated: false, rows: rows.length, expectedRows: rows.length }
  });
  const careerPeriods = [
    { index: 0, epoch: 0, kind: 'proposal', firstLevel: 100, lastLevel: 199 },
    { index: 1, epoch: 0, kind: 'exploration', firstLevel: 200, lastLevel: 299 },
    { index: 2, epoch: 0, kind: 'promotion', firstLevel: 300, lastLevel: 399 },
    { index: 3, epoch: 0, kind: 'cooldown', firstLevel: 400, lastLevel: 499 },
    { index: 4, epoch: 1, kind: 'proposal', firstLevel: 500, lastLevel: 599 },
    { index: 5, epoch: 1, kind: 'exploration', firstLevel: 600, lastLevel: 699 },
    { index: 6, epoch: 1, kind: 'promotion', firstLevel: 700, lastLevel: 799 },
    { index: 7, epoch: 1, kind: 'adoption', firstLevel: 800, lastLevel: 899 },
    { index: 8, epoch: 2, kind: 'proposal', firstLevel: 900, lastLevel: 999 }
  ];
  const careerBallots = [1, 2, 5, 6].map((period, index) => ({
    id: String(1000 + index),
    timestamp: `2026-01-0${index + 1}T00:00:00Z`,
    delegate: { address: addressA, alias: 'Alpha' },
    period: { index: period }
  })).concat([1, 5].map((period, index) => ({
    id: String(2000 + index),
    timestamp: `2026-02-0${index + 1}T00:00:00Z`,
    delegate: { address: addressB, alias: 'Beta' },
    period: { index: period }
  })));
  const careerProposals = [{
    id: '3000',
    timestamp: '2026-01-01T12:00:00Z',
    delegate: { address: addressA, alias: 'Alpha' },
    period: { index: 0 }
  }];
  const careerDelegates = [
    { address: addressA, alias: 'Alpha', numBallots: 4, numProposals: 1, lastActivityTime: '2026-03-01T00:00:00Z' },
    { address: addressB, alias: 'Beta', numBallots: 2, numProposals: 0, lastActivityTime: '2026-02-01T00:00:00Z' },
    { address: addressC, alias: 'Gamma', numBallots: 0, numProposals: 0, lastActivityTime: '2026-01-01T00:00:00Z' }
  ];
  const careerFixtureInput = {
    generatedAt: '2026-07-10T00:00:00Z',
    head: {
      row: { level: 900, timestamp: '2026-07-10T00:00:00Z' },
      receipt: { complete: true, level: 900, timestamp: '2026-07-10T00:00:00.000Z' }
    },
    ballots: completeCareerSource(careerBallots),
    proposals: completeCareerSource(careerProposals),
    votingPeriods: completeCareerSource(careerPeriods),
    activeDelegates: completeCareerSource(careerDelegates),
    season: { id: 'fixture-season', protocolName: 'Fixture', activationLevel: 900, activatedAt: '2026-01-01T00:00:00Z' },
    seasonGovernanceReceipt: {
      complete: true,
      ballots: 0,
      proposals: 0,
      votingPeriods: [{ index: 8, epoch: 2, kind: 'proposal', firstLevel: 900, lastLevel: 999 }]
    }
  };
  const careerFixture = buildGovernanceCareerArtifact(careerFixtureInput);
  const shuffledCareerFixture = buildGovernanceCareerArtifact({
    ...careerFixtureInput,
    ballots: completeCareerSource([...careerBallots].reverse()),
    proposals: completeCareerSource([...careerProposals].reverse()),
    votingPeriods: completeCareerSource([...careerPeriods].reverse()),
    activeDelegates: completeCareerSource([...careerDelegates].reverse())
  });
  const fixtureA = careerFixture.records[addressA];
  const fixtureB = careerFixture.records[addressB];
  if (fixtureA?.lifetimeActions !== 5 || fixtureA?.actionablePeriodsParticipated !== 5
    || fixtureA?.longestBallotPeriodStreak !== 4 || fixtureA?.currentBallotPeriodStreak !== 4) {
    fail(`maxis Governance career streak/action fixture is wrong: ${JSON.stringify(fixtureA)}`);
  }
  if (fixtureB?.longestBallotPeriodStreak !== 1 || fixtureB?.currentBallotPeriodStreak !== 0) {
    fail(`maxis Governance career gap fixture is wrong: ${JSON.stringify(fixtureB)}`);
  }
  if (careerFixture.integrity.contentHash !== shuffledCareerFixture.integrity.contentHash) {
    fail('maxis Governance career artifact must be deterministic under source-row reordering');
  }
  if (careerFixture.currentProtocolContext?.state !== 'no-actionable-governance-occurred') {
    fail(`maxis Governance career current protocol context is ambiguous: ${JSON.stringify(careerFixture.currentProtocolContext)}`);
  }
  const tamperedCareerFixture = structuredClone(careerFixture);
  tamperedCareerFixture.records[addressA].lifetimeActions += 1;
  if (!validateGovernanceCareerArtifact(tamperedCareerFixture).length) fail('maxis Governance career validation must reject content tampering');
  const rehashedStreakTamper = structuredClone(careerFixture);
  rehashedStreakTamper.records[addressA].currentBallotPeriodStreak = 0;
  {
    const { integrity, ...unsigned } = rehashedStreakTamper;
    rehashedStreakTamper.integrity.contentHash = stableJsonHash(unsigned);
  }
  if (!validateGovernanceCareerArtifact(rehashedStreakTamper).some((error) => /current ballot-period streak/i.test(error))) {
    fail('maxis Governance career validation must semantically reject a rehashed false streak');
  }
  const rehashedPeriodOmission = structuredClone(careerFixture);
  rehashedPeriodOmission.periodLedger.periods = rehashedPeriodOmission.periodLedger.periods
    .filter((period) => period.index !== 3);
  rehashedPeriodOmission.periodLedger.count = rehashedPeriodOmission.periodLedger.periods.length;
  {
    const { integrity, ...unsigned } = rehashedPeriodOmission;
    rehashedPeriodOmission.integrity.contentHash = stableJsonHash(unsigned);
  }
  if (!validateGovernanceCareerArtifact(rehashedPeriodOmission).some((error) => /voting-period source receipt|voting-period index sequence/i.test(error))) {
    fail('maxis Governance career validation must reject a rehashed omitted voting period');
  }
  const openPeriodFixture = buildGovernanceCareerArtifact({
    ...careerFixtureInput,
    season: null,
    seasonGovernanceReceipt: null,
    head: {
      row: { level: 750, timestamp: '2026-06-10T00:00:00Z' },
      receipt: { complete: true, level: 750, timestamp: '2026-06-10T00:00:00.000Z' }
    }
  });
  if (openPeriodFixture.records[addressA]?.currentBallotPeriodStreak !== 3
    || openPeriodFixture.records[addressA]?.longestBallotPeriodStreak !== 3) {
    fail(`maxis Governance career streak must exclude an open ballot period: ${JSON.stringify(openPeriodFixture.records[addressA])}`);
  }
  let wrongPeriodRejected = false;
  try {
    const wrongPeriodBallots = [...careerBallots, { ...careerBallots[0], id: '4999', period: { index: 0 } }];
    buildGovernanceCareerArtifact({
      ...careerFixtureInput,
      ballots: completeCareerSource(wrongPeriodBallots),
      activeDelegates: completeCareerSource(careerDelegates.map((delegate) => delegate.address === addressA
        ? { ...delegate, numBallots: 5 }
        : delegate))
    });
  } catch {
    wrongPeriodRejected = true;
  }
  if (!wrongPeriodRejected) fail('maxis Governance career build must reject ballots outside exploration/promotion periods');
  let counterMismatchRejected = false;
  try {
    buildGovernanceCareerArtifact({
      ...careerFixtureInput,
      activeDelegates: completeCareerSource(careerDelegates.map((delegate) => delegate.address === addressA
        ? { ...delegate, numBallots: 3 }
        : delegate))
    });
  } catch {
    counterMismatchRejected = true;
  }
  if (!counterMismatchRejected) fail('maxis Governance career build must reject active-delegate counter mismatches');
  let incompleteCareerRejected = false;
  try {
    buildGovernanceCareerArtifact({
      ...careerFixtureInput,
      ballots: { rows: careerBallots, receipt: { complete: false, truncated: true, rows: careerBallots.length, expectedRows: careerBallots.length + 1 } }
    });
  } catch {
    incompleteCareerRejected = true;
  }
  if (!incompleteCareerRejected) fail('maxis Governance career build must refuse incomplete source receipts');
  const coverage = compileContractCoverage([
    { address: 'KT1V5XKmeypanMS9pR65REpqmVejWBZURuuT', alias: '3Route v4', lastActivityTime: '2026-07-09T00:00:00Z' },
    { address: 'KT1R5dHqnpeKVFow9mErfN763RFfe51vmiB8', alias: 'Tezotopia Resource Collector', lastActivityTime: '2026-07-09T00:00:00Z' }
  ], config.apps, '2026-07-01T00:00:00Z');
  if (coverage.length !== 2) fail(`maxis taxonomy fixture should classify two contracts, got ${coverage.length}`);

  const appLookup = new Map(coverage.map((item) => [item.address, item.app]));
  const appRank = rankAppActivity([
    { id: 1, hash: 'o1', counter: 1, nonce: null, timestamp: '2026-07-09T01:00:00Z', sender: { address: addressA }, target: { address: coverage[0]?.address } },
    { id: 2, hash: 'o2', counter: 2, nonce: null, timestamp: '2026-07-09T02:00:00Z', sender: { address: addressA }, target: { address: coverage[1]?.address } },
    { id: 3, hash: 'o3', counter: 3, nonce: null, timestamp: '2026-07-09T03:00:00Z', sender: { address: addressB }, target: { address: coverage[0]?.address } },
    { id: 4, hash: 'o4', counter: 4, nonce: 1, timestamp: '2026-07-09T04:00:00Z', sender: { address: addressC }, target: { address: coverage[1]?.address } }
  ], appLookup);
  if (appRank[0]?.address !== addressA || appRank[0]?.appCount !== 2 || appRank.some((row) => row.address === addressC)) {
    fail('maxis app ranking must prefer breadth and exclude internal transactions');
  }

  const mintRank = rankMints([
    { creator_address: addressA, token_pk: 1, amount: 1, ophash: 'm1', timestamp: '2026-07-08T00:00:00Z', creator: { flag: 'none' } },
    { creator_address: addressA, token_pk: 1, amount: 2, ophash: 'm1', timestamp: '2026-07-08T00:00:00Z', creator: { flag: 'none' } },
    { creator_address: addressB, token_pk: 2, amount: 1, ophash: 'm2', timestamp: '2026-07-09T00:00:00Z', creator: { flag: 'none' } }
  ]);
  if (mintRank.find((row) => row.address === addressA)?.tokens !== 1) fail('maxis mint ranking must deduplicate token ids');

  const salesRank = rankSalesStats([
    { type: 'buyer', subject_address: addressA, volume: 10, rank: 2, interval_days: 30, subject: { flag: 'none' } },
    { type: 'buyer', subject_address: addressA, volume: 12, rank: 1, interval_days: 30, subject: { flag: 'none' } },
    { type: 'buyer', subject_address: addressB, volume: 11, rank: 1, interval_days: 30, subject: { flag: 'none' } }
  ], 'buyer');
  if (salesRank[0]?.address !== addressA || salesRank.length !== 2) fail('maxis sales ranking must deduplicate subjects by strongest volume row');

  const unicornRank = rankUnicorn({
    collector: [{ address: addressA, score: 4 }, { address: addressB, score: 3 }],
    minter: [{ address: addressB, score: 3 }, { address: addressA, score: 2 }],
    defi: [{ address: addressA, score: 2 }]
  }, 3);
  if (unicornRank[0]?.address !== addressA || unicornRank[0]?.breadth !== 3) fail('maxis unicorn ranking must prefer qualifying breadth');

  const paginationOffsets = [];
  const pagedFixture = await fetchOffsetPages(async ({ offset, limit }) => {
    paginationOffsets.push({ offset, limit });
    if (offset === 0 || offset === 500) return Array.from({ length: 500 }, (_, index) => offset + index);
    if (offset === 1000) return Array.from({ length: 42 }, (_, index) => offset + index);
    return [];
  }, { pageSize: 500, maxPages: 10 });
  if (pagedFixture.rows.length !== 1042 || pagedFixture.pages !== 3 || pagedFixture.truncated || pagedFixture.nextOffset !== 1042) {
    fail(`maxis offset pagination must consume 500 + 500 + 42 rows, got ${JSON.stringify({ rows: pagedFixture.rows.length, pages: pagedFixture.pages, truncated: pagedFixture.truncated, nextOffset: pagedFixture.nextOffset })}`);
  }
  if (paginationOffsets.map((page) => `${page.offset}:${page.limit}`).join(',') !== '0:500,500:500,1000:500') {
    fail(`maxis offset pagination advanced incorrectly: ${JSON.stringify(paginationOffsets)}`);
  }

  const keysetCursors = [];
  const keysetFixture = await fetchKeysetPages(async ({ after, limit }) => {
    keysetCursors.push(`${after}:${limit}`);
    const start = Number(after) + 1;
    const length = after === '0' || after === '500' ? 500 : after === '1000' ? 42 : 0;
    return Array.from({ length }, (_, index) => ({ id: start + index }));
  }, { pageSize: 500, maxPages: 10 });
  if (
    keysetFixture.rows.length !== 1042
    || keysetFixture.pages !== 3
    || keysetFixture.truncated
    || keysetFixture.firstCursor !== '1'
    || keysetFixture.lastCursor !== '1042'
    || keysetFixture.cursorOrderVerified !== true
    || keysetCursors.join(',') !== '0:500,500:500,1000:500'
  ) {
    fail(`maxis keyset pagination must consume unique 500 + 500 + 42 rows: ${JSON.stringify({ keysetFixture, keysetCursors })}`);
  }
  let duplicateCursorRejected = false;
  try {
    await fetchKeysetPages(async () => [{ id: 1 }, { id: 1 }], { pageSize: 2, maxPages: 1 });
  } catch {
    duplicateCursorRejected = true;
  }
  if (!duplicateCursorRejected) fail('maxis keyset pagination must reject duplicate or non-increasing source ids');

  const seasonStart = '2026-07-01T00:00:00.000Z';
  const nftSales = rankSeasonNftSales([
    {
      id: 101,
      timestamp: '2026-07-08T00:00:00Z',
      price_xtz: 10_000_000,
      amount: 1,
      buyer_address: addressA,
      buyer: { flag: 'none' },
      token_pk: 1,
      token: {
        fa_contract: 'KT1V5XKmeypanMS9pR65REpqmVejWBZURuuT',
        creators: [
          { creator_address: addressA, holder: { flag: 'none' } },
          { creator_address: addressB, holder: { flag: 'none' } }
        ]
      }
    },
    {
      id: 101,
      timestamp: '2026-07-08T00:00:00Z',
      price_xtz: 10_000_000,
      amount: 1,
      buyer_address: addressA,
      buyer: { flag: 'none' },
      token_pk: 1,
      token: {
        fa_contract: 'KT1V5XKmeypanMS9pR65REpqmVejWBZURuuT',
        creators: [
          { creator_address: addressA, holder: { flag: 'none' } },
          { creator_address: addressB, holder: { flag: 'none' } }
        ]
      }
    },
    {
      id: 102,
      timestamp: '2026-07-09T00:00:00Z',
      price_xtz: 20_000_000,
      amount: 1,
      buyer_address: addressC,
      buyer: { flag: 'none' },
      token_pk: 2,
      token: {
        fa_contract: 'KT1V5XKmeypanMS9pR65REpqmVejWBZURuuT',
        creators: [
          { creator_address: addressA, holder: { flag: 'none' } },
          { creator_address: addressB, holder: { flag: 'none' } }
        ]
      }
    }
  ], seasonStart);
  const collectorA = nftSales.collector.find((row) => row.address === addressA);
  const collectorC = nftSales.collector.find((row) => row.address === addressC);
  const artistA = nftSales.artist.find((row) => row.address === addressA);
  const artistB = nftSales.artist.find((row) => row.address === addressB);
  if (
    collectorA?.artistCount !== 1 || collectorA?.purchases !== 1 || collectorA?.volume !== 5_000_000
    || collectorC?.artistCount !== 2 || collectorC?.purchases !== 1 || collectorC?.volume !== 20_000_000
    || artistA?.collectorCount !== 1 || artistA?.sales !== 1 || artistA?.volume !== 10_000_000
    || artistB?.collectorCount !== 2 || artistB?.sales !== 2 || artistB?.volume !== 15_000_000
  ) {
    fail(`maxis NFT scoring must dedupe listing ids and exclude only self-creator legs: ${JSON.stringify({ collectorA, collectorC, artistA, artistB })}`);
  }

  const mintSeason = rankSeasonMints([
    {
      id: 1,
      creator_address: addressA,
      creator: { flag: 'none' },
      token_pk: 11,
      fa_contract: 'KT1V5XKmeypanMS9pR65REpqmVejWBZURuuT',
      amount: 1,
      ophash: 'old-remint',
      timestamp: '2026-07-08T00:00:00Z',
      token: { timestamp: '2025-01-01T00:00:00Z' }
    },
    {
      id: 2,
      creator_address: addressB,
      creator: { flag: 'none' },
      token_pk: 12,
      fa_contract: 'KT1V5XKmeypanMS9pR65REpqmVejWBZURuuT',
      amount: 5,
      ophash: 'new-mint',
      timestamp: '2026-07-08T01:00:00Z',
      token: { timestamp: '2026-07-08T01:00:00Z' }
    }
  ], [
    { id: 201, token_pk: 12, token: { fa_contract: 'KT1V5XKmeypanMS9pR65REpqmVejWBZURuuT' }, timestamp: '2026-07-08T02:00:00Z', buyer_address: addressC, buyer: { flag: 'none' }, seller_address: addressB, price_xtz: 2_000_000, amount: 2 },
    { id: 201, token_pk: 12, token: { fa_contract: 'KT1V5XKmeypanMS9pR65REpqmVejWBZURuuT' }, timestamp: '2026-07-08T02:00:00Z', buyer_address: addressC, buyer: { flag: 'none' }, seller_address: addressB, price_xtz: 2_000_000, amount: 2 },
    { id: 202, token_pk: 12, token: { fa_contract: 'KT1V5XKmeypanMS9pR65REpqmVejWBZURuuT' }, timestamp: '2026-07-08T03:00:00Z', buyer_address: addressA, buyer: { flag: 'none' }, seller_address: addressC, price_xtz: 3_000_000, amount: 1 },
    { id: 203, token_pk: 12, token: { fa_contract: 'KT1V5XKmeypanMS9pR65REpqmVejWBZURuuT' }, timestamp: '2026-07-08T04:00:00Z', buyer_address: addressB, buyer: { flag: 'none' }, seller_address: addressB, price_xtz: 4_000_000, amount: 1 }
  ], seasonStart);
  if (
    mintSeason.length !== 1
    || mintSeason[0]?.address !== addressB
    || mintSeason[0]?.tokens !== 1
    || mintSeason[0]?.successfulDrops !== 1
    || mintSeason[0]?.independentCollectors !== 1
    || mintSeason[0]?.editionsSold !== 2
  ) {
    fail(`maxis Mint must exclude old-token remints, secondary sales, self-sales, and duplicate sale ids: ${JSON.stringify(mintSeason)}`);
  }

  const governanceSeason = rankSeasonGovernance([
    { id: 301, hash: 'ballot-testing', counter: 1, nonce: null, timestamp: '2026-07-08T00:00:00Z', delegate: { address: addressA }, period: { index: 2 } },
    { id: 302, hash: 'ballot-promotion', counter: 2, nonce: null, timestamp: '2026-07-09T00:00:00Z', delegate: { address: addressA }, period: { index: 3 } }
  ], [
    { id: 303, hash: 'proposal', counter: 3, nonce: null, timestamp: '2026-07-07T00:00:00Z', delegate: { address: addressA }, period: { index: 1 } }
  ], seasonStart, [
    { index: 1, kind: 'proposal', firstLevel: 1 },
    { index: 2, kind: 'testing', firstLevel: 2 },
    { index: 3, kind: 'promotion', firstLevel: 3 }
  ]);
  if (governanceSeason[0]?.periods !== 2 || governanceSeason[0]?.governanceActions !== 2 || governanceSeason[0]?.participationStreak !== 2) {
    fail(`maxis Governance must score only the ordered actionable period sequence: ${JSON.stringify(governanceSeason[0])}`);
  }

  const delegationSeason = rankSeasonDelegation([
    { id: 401, timestamp: '2026-07-08T00:00:00Z', sender: { address: addressA }, prevDelegate: { address: addressC }, newDelegate: { address: addressB } }
  ], [
    { address: addressA, delegate: { address: addressB }, balance: 100, stakedBalance: 999 }
  ], seasonStart);
  if (delegationSeason[0]?.address !== addressB || delegationSeason[0]?.retainedAssignments !== 1 || delegationSeason[0]?.retainedBalance !== 100) {
    fail(`maxis Delegation must use the same positive liquid-balance basis live and at exact close: ${JSON.stringify(delegationSeason[0])}`);
  }

  const liquidityContract = 'KT1R5dHqnpeKVFow9mErfN763RFfe51vmiB8';
  const liquidityApp = { id: 'fixture-liquidity', category: 'defi' };
  const liquiditySeason = rankSeasonLiquidity([
    { id: 501, hash: 'liquidity-add', counter: 1, nonce: null, timestamp: '2026-07-08T00:00:00Z', sender: { address: addressA }, target: { address: liquidityContract }, parameter: { entrypoint: 'addLiquidity' } },
    { id: 502, hash: 'ambiguous-position', counter: 2, nonce: null, timestamp: '2026-07-09T00:00:00Z', sender: { address: addressA }, target: { address: liquidityContract }, parameter: { entrypoint: 'setPosition' } }
  ], new Map([[liquidityContract, liquidityApp]]), [{ ...liquidityApp, liquidityEntrypoints: ['addLiquidity'] }], seasonStart);
  if (liquiditySeason[0]?.venueCount !== 1 || liquiditySeason[0]?.appCount !== 1 || liquiditySeason[0]?.calls !== 1 || liquiditySeason[0]?.entrypoints?.join(',') !== 'addLiquidity') {
    fail(`maxis Liquidity must count only frozen positive-supply entrypoints: ${JSON.stringify(liquiditySeason[0])}`);
  }

  const directContract = 'KT1V5XKmeypanMS9pR65REpqmVejWBZURuuT';
  const internalContract = 'KT1R5dHqnpeKVFow9mErfN763RFfe51vmiB8';
  const builderSeason = rankSeasonBuilders([
    { id: 601, nonce: null, timestamp: '2026-07-08T00:00:00Z', sender: { address: addressB }, originatedContract: { address: directContract } },
    { id: 602, nonce: 1, timestamp: '2026-07-08T00:00:00Z', sender: { address: addressA }, originatedContract: { address: internalContract } }
  ], [
    { id: 603, hash: 'direct-use', counter: 1, nonce: null, timestamp: '2026-07-09T00:00:00Z', sender: { address: addressC }, initiator: { address: addressC }, target: { address: directContract } },
    { id: 604, hash: 'internal-use', counter: 2, nonce: null, timestamp: '2026-07-09T00:00:00Z', sender: { address: addressC }, initiator: { address: addressC }, target: { address: internalContract } }
  ], seasonStart);
  if (builderSeason.length !== 1 || builderSeason[0]?.address !== addressB || builderSeason[0]?.activeDeployments !== 1 || builderSeason[0]?.independentUsers !== 1) {
    fail(`maxis Builder must exclude factory/internal originations and require independent use: ${JSON.stringify(builderSeason)}`);
  }

  const protocolHash = 'PsUshuai9QapM5TGj1JpuVGkdxz5GykdnEvS6Rh8SUVrARvZLCY';
  const protocolSeason = resolveProtocolSeason({
    meta: { currentProtocol: 'Ushuaia' },
    protocols: [{ number: 25, name: 'Ushuaia', hash: protocolHash, date: '2026-06-30', block: 13857889 }]
  }, {
    currentProtocol: { code: 25, name: 'Ushuaia', hash: protocolHash, firstLevel: 13857889, startTime: '2026-06-30T00:31:52Z' },
    currentGovernance: { startTime: '2026-07-08T09:00:00Z' }
  }, new Date('2026-07-09T12:00:00Z'));
  if (protocolSeason.protocolNumber !== 25 || protocolSeason.activationLevel !== 13857889 || protocolSeason.activatedAt !== '2026-06-30T00:31:52.000Z') {
    fail(`maxis protocol season must use the current protocol activation receipt, never the current voting-period start: ${JSON.stringify(protocolSeason)}`);
  }
  if (protocolSeason.endsAt !== null || !/next Tezos protocol activation/i.test(protocolSeason.endsWhen || '')) {
    fail('maxis active protocol season must stay honestly open-ended before the next activation is known');
  }
  let maliciousProtocolHashRejected = false;
  try {
    resolveProtocolSeason({
      protocols: [{ number: 25, name: 'Ushuaia', hash: protocolHash, date: '2026-06-30', block: 13857889 }]
    }, {
      currentProtocol: {
        code: 25,
        name: 'Ushuaia',
        hash: `${protocolHash}/../../../../escape`,
        firstLevel: 13857889,
        startTime: '2026-06-30T00:31:52Z'
      }
    }, new Date('2026-07-09T12:00:00Z'));
  } catch {
    maliciousProtocolHashRejected = true;
  }
  if (!maliciousProtocolHashRejected) fail('maxis protocol identity must reject path-bearing or non-canonical protocol hashes');

  const seasonFixture = {
    ...protocolSeason,
    id: `protocol-25-${protocolHash}`,
    seasonOrdinal: 1,
    phase: 'season',
    displayLabel: 'Ushuaia Season',
    status: 'active'
  };
  const previousSeasonFixture = {
    schema: 1,
    generatedAt: '2026-07-10T00:00:00.000Z',
    season: seasonFixture,
    rankings: {
      transaction: [
        { address: addressB, rank: 1 },
        { address: addressA, rank: 2 }
      ],
      collector: [{ address: addressA, rank: 1 }],
      defi: [{ address: addressA, rank: 1 }]
    },
    history: {
      snapshotCount: 1,
      topTenByLane: {
        transaction: [addressA, addressB],
        collector: [addressA],
        defi: [addressA]
      }
    },
    passportIndex: {
      byAddress: {
        [addressA]: {
          address: addressA,
          alias: 'Alpha',
          activeWeeks: [1],
          badges: [{ id: 'top-10-governance', label: 'Governance Maxi top 10', earnedSeasonId: seasonFixture.id, earnedAt: '2026-07-10T00:00:00.000Z' }],
          lanes: { transaction: { rank: 2, personalBestRank: 2 } }
        }
      }
    }
  };
  const seasonCompetition = buildSeasonCompetition({
    season: seasonFixture,
    generatedAt: '2026-07-22T00:00:00.000Z',
    previousSnapshot: previousSeasonFixture,
    rawRankings: {
      transaction: [
        { address: addressA, alias: 'Alpha', transactions: 12, activeDays: 4, activeWeeks: [1, 2], lastActivity: '2026-07-14T00:00:00.000Z' },
        { address: addressB, alias: 'Beta', transactions: 10, activeDays: 3, activeWeeks: [1, 2], lastActivity: '2026-07-13T00:00:00.000Z' },
        { address: addressC, alias: 'Debut', transactions: 9, activeDays: 3, activeWeeks: [2], lastActivity: '2026-07-12T00:00:00.000Z' }
      ],
      collector: [
        { address: addressA, alias: 'Alpha', artistCount: 4, volume: 8_000_000, purchases: 6, activeWeeks: [1, 2], lastActivity: '2026-07-14T00:00:00.000Z' }
      ],
      defi: [
        { address: addressA, alias: 'Alpha', appCount: 3, calls: 7, contractCount: 4, activeWeeks: [1, 2], lastActivity: '2026-07-15T00:00:00.000Z' }
      ]
    }
  });
  const alphaTransaction = seasonCompetition.rankings.transaction.find((row) => row.address === addressA);
  const betaTransaction = seasonCompetition.rankings.transaction.find((row) => row.address === addressB);
  const debutTransaction = seasonCompetition.rankings.transaction.find((row) => row.address === addressC);
  const alphaPassport = seasonCompetition.passportIndex.byAddress[addressA];
  if (alphaTransaction?.rank !== 1 || alphaTransaction?.delta !== 1 || betaTransaction?.delta !== -1 || debutTransaction?.delta !== null) {
    fail('maxis season deltas must compare only wallets present in a prior snapshot from the same protocol season');
  }
  if (betaTransaction?.passGap?.next?.guaranteedPrimary?.amount !== 3) {
    fail(`maxis pass gap must strictly exceed the leader's primary metric, got ${JSON.stringify(betaTransaction?.passGap?.next)}`);
  }
  if (seasonCompetition.honors.rankClimb?.winner?.address !== addressA || seasonCompetition.honors.rankClimb?.candidates?.some((candidate) => candidate.address === addressC)) {
    fail('maxis Climber honor must not turn a first appearance into invented rank movement');
  }
  if (!seasonCompetition.honors.topTenDebut?.winners?.some((winner) => winner.address === addressC)) {
    fail('maxis first recorded top-ten entry must be represented as a debut');
  }
  if (seasonCompetition.rankings.unicorn[0]?.address !== addressA || seasonCompetition.rankings.unicorn[0]?.breadth !== 3) {
    fail('maxis Season Unicorn must use breadth from the same protocol-season rankings only');
  }
  if (!alphaPassport?.badges?.some((badge) => badge.id === 'top-10-governance') || alphaPassport?.lanes?.transaction?.personalBestRank !== 1) {
    fail('maxis Passport must preserve earned badges while advancing personal bests');
  }
  if (alphaPassport?.badges?.some((badge) => String(badge.id || '').startsWith('champion-'))) {
    fail('maxis active-season rank one must remain provisional and cannot mint a permanent champion badge');
  }
  if (alphaPassport?.activeWeekStreak !== 2 || alphaPassport?.unicorn?.progressPercent !== 100) {
    fail('maxis Passport must derive supported completed-week streaks and same-season Unicorn progress');
  }

  const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const fixtureAddress = (index) => {
    let cursor = index + 1;
    let suffix = '';
    while (cursor > 0) {
      suffix = base58Alphabet[cursor % base58Alphabet.length] + suffix;
      cursor = Math.floor(cursor / base58Alphabet.length);
    }
    return `tz1${suffix.padStart(33, '1')}`;
  };
  const deepCompetition = buildSeasonCompetition({
    season: seasonFixture,
    generatedAt: '2026-07-22T00:00:00.000Z',
    rawRankings: {
      transaction: Array.from({ length: 600 }, (_, index) => ({
        address: fixtureAddress(index),
        transactions: 10_000 - index,
        activeDays: 8,
        activeWeeks: [1, 2],
        lastActivity: '2026-07-21T00:00:00.000Z'
      }))
    }
  });
  const deepAddress = fixtureAddress(599);
  const deepLane = expandPassportRecord(deepCompetition.passportIndex.byAddress[deepAddress])?.lanes?.transaction;
  if (
    deepCompetition.passportIndex.indexedAddresses !== 600
    || deepCompetition.rankings.transaction.length !== DEEP_RANKING_LIMIT
    || deepCompetition.laneStatus.transaction.eligibleCount !== 600
    || deepLane?.rank !== 600
    || deepLane?.outsidePublishedDepth !== true
    || !deepLane?.passGap?.topTen
    || deepLane?.passGap?.next !== null
  ) {
    fail(`maxis Passports must cover every eligible wallet beyond the 500-row public standings depth: ${JSON.stringify({ indexed: deepCompetition.passportIndex.indexedAddresses, published: deepCompetition.rankings.transaction.length, eligible: deepCompetition.laneStatus.transaction.eligibleCount, deepLane })}`);
  }

  const compactTopHundred = expandPassportRecord({
    format: 'transaction-only-v1',
    address: addressA,
    transaction: { rank: 17, scoreVector: [{ metric: 'transactions', value: 42 }] },
    badges: [],
    activeWeeks: [1, 2],
    activeWeekStreak: 2
  });
  const compactOutsideHundred = expandPassportRecord({
    format: 'transaction-only-v1',
    address: addressB,
    transaction: { rank: 117, scoreVector: [{ metric: 'transactions', value: 12 }] },
    badges: []
  });
  if (
    compactTopHundred?.unicorn?.breadth !== 1
    || compactTopHundred?.unicorn?.qualifyingLanes?.[0]?.category !== 'transaction'
    || compactTopHundred?.unicorn?.progressPercent !== 33
    || compactOutsideHundred?.unicorn?.breadth !== 0
    || compactOutsideHundred?.unicorn?.progressPercent !== 0
  ) {
    fail(`maxis compact Transaction Passport must preserve top-100 Unicorn breadth without inflating deeper ranks: ${JSON.stringify({ compactTopHundred, compactOutsideHundred })}`);
  }

  const shardA = addressShard(addressA);
  if (!/^[0-3][0-9a-f]$/.test(shardA) || shardA !== addressShard(addressA) || PASSPORT_SHARD_COUNT !== 64 || PASSPORT_SHARD_ALGORITHM !== 'sha256-first-byte-mask-3f-v1') {
    fail('maxis Passport sharding must be deterministic across 64 two-digit hexadecimal buckets');
  }

  const v2EvaluatorBefore = getMaxisEvaluator(SEASON_EVALUATOR_VERSION);
  const v2SourceBefore = getMaxisSource(SEASON_EVALUATOR_VERSION);
  const v2HashBeforeMockV3 = await maxisImplementationHash(SEASON_EVALUATOR_VERSION);
  const v2RulesBeforeMockV3 = v2EvaluatorBefore.buildRuleDefinition(v2HashBeforeMockV3);
  const mockV3Version = 'maxis-evaluator-v3-static-fixture';
  const mockV3Evaluator = {
    SEASON_EVALUATOR_VERSION: mockV3Version,
    buildRuleDefinition: (implementationHash) => ({ evaluator: { version: mockV3Version, implementationHash } }),
    buildSeasonCompetition: () => ({ mock: 'v3-evaluator' }),
    validateSeasonSnapshot: () => []
  };
  const mockV3Source = {
    EVALUATOR_VERSION: mockV3Version,
    MAXIS_SOURCE_VERSION: 'maxis-source-v3-static-fixture',
    IMMUTABLE_IMPLEMENTATION_FILES: ['fixture-only'],
    buildFullSeasonSnapshot: async () => ({ mock: 'v3-source' }),
    rebuildWithoutTransactionLane: () => ({ mock: 'v3-fallback' })
  };
  registerMaxisEvaluator(mockV3Version, mockV3Evaluator);
  registerMaxisSource(mockV3Version, mockV3Source);
  const mockV3Selection = await getMaxisSource(mockV3Version).buildFullSeasonSnapshot();
  const v2HashAfterMockV3 = await maxisImplementationHash(SEASON_EVALUATOR_VERSION);
  const v2RulesAfterMockV3 = getMaxisEvaluator(SEASON_EVALUATOR_VERSION).buildRuleDefinition(v2HashAfterMockV3);
  let mismatchedRegistryRejected = false;
  let duplicateRegistryRejected = false;
  try {
    registerMaxisEvaluator('maxis-evaluator-v3-mismatch', { SEASON_EVALUATOR_VERSION: 'wrong-version' });
  } catch {
    mismatchedRegistryRejected = true;
  }
  try {
    registerMaxisSource(mockV3Version, mockV3Source);
  } catch {
    duplicateRegistryRejected = true;
  }
  if (
    CURRENT_MAXIS_EVALUATOR_VERSION !== SEASON_EVALUATOR_VERSION
    || !maxisEvaluatorVersions().includes(mockV3Version)
    || !maxisSourceVersions().includes(mockV3Version)
    || mockV3Selection?.mock !== 'v3-source'
    || getMaxisEvaluator(SEASON_EVALUATOR_VERSION) !== v2EvaluatorBefore
    || getMaxisSource(SEASON_EVALUATOR_VERSION) !== v2SourceBefore
    || v2HashAfterMockV3 !== v2HashBeforeMockV3
    || JSON.stringify(v2RulesAfterMockV3) !== JSON.stringify(v2RulesBeforeMockV3)
    || !mismatchedRegistryRejected
    || !duplicateRegistryRejected
  ) {
    fail(`maxis v3 registration must coexist without changing frozen v2 execution/hash: ${JSON.stringify({
      current: CURRENT_MAXIS_EVALUATOR_VERSION,
      evaluatorVersions: maxisEvaluatorVersions(),
      sourceVersions: maxisSourceVersions(),
      mockV3Selection,
      hashStable: v2HashAfterMockV3 === v2HashBeforeMockV3,
      rulesStable: JSON.stringify(v2RulesAfterMockV3) === JSON.stringify(v2RulesBeforeMockV3),
      mismatchedRegistryRejected,
      duplicateRegistryRejected
    })}`);
  }

  const buildingTransactionStates = await walk(
    'data/maxis/seasons',
    (file) => file.endsWith('/transaction-state.building.json')
  ).catch(() => []);
  for (const statePath of buildingTransactionStates) {
    const state = JSON.parse(await readText(statePath));
    const { integrity, ...unsigned } = state;
    const stateErrors = validateTransactionAccumulator(state, { allowBuilding: true });
    if (
      state?.status !== 'building'
      || integrity?.algorithm !== 'sha256-stable-json-v1'
      || integrity?.contentHash !== stableJsonHash(unsigned)
      || stateErrors.length
    ) {
      fail(`maxis deferred Transaction sidecar is not a valid signed building state: ${statePath} ${stateErrors.join('; ')}`);
    }
  }

  const manifest = JSON.parse(await readText('data/maxis/manifest.json'));
  const manifestErrors = validateSeasonCatalog(manifest);
  if (manifestErrors.length) fail(`maxis season manifest invalid: ${manifestErrors.join('; ')}`);
  const activeEntry = (manifest.seasons || []).find((entry) => entry.id === manifest.activeSeasonId);
  if (!activeEntry) fail('maxis season manifest has no matching active entry');
  const localArtifactPath = (value) => String(value || '').replace(/^\/+/, '');
  const activeSummaryPath = localArtifactPath(activeEntry?.summaryPath);
  const activeRulesPath = localArtifactPath(activeEntry?.rulesPath);
  const seasonSummary = activeSummaryPath ? JSON.parse(await readText(activeSummaryPath)) : null;
  const seasonRules = activeRulesPath ? JSON.parse(await readText(activeRulesPath)) : null;
  const careerSeasonContext = careerArtifact?.currentProtocolContext;
  const seasonGovernanceReceipt = seasonSummary?.sourceReceipts?.governance;
  if (careerSeasonContext?.seasonId !== activeEntry?.id
    || Number(careerSeasonContext?.ballots) !== Number(seasonGovernanceReceipt?.ballots || 0)
    || Number(careerSeasonContext?.proposals) !== Number(seasonGovernanceReceipt?.proposals || 0)
    || Number(careerSeasonContext?.actions) !== Number(seasonGovernanceReceipt?.ballots || 0) + Number(seasonGovernanceReceipt?.proposals || 0)) {
    fail('maxis Governance career current-protocol context does not cross-link to the active season receipt');
  }
  if (seasonRules?.version !== SEASON_RULES_VERSION || seasonRules?.evaluatorVersion !== SEASON_EVALUATOR_VERSION || seasonRules?.definition?.deepRankingLimit !== DEEP_RANKING_LIMIT) {
    fail('maxis active season rules do not match the frozen scorer version and deep ranking contract');
  }
  if (seasonRules?.seasonId !== activeEntry?.id || seasonRules?.protocolHash !== activeEntry?.protocolHash || seasonRules?.rulesHash !== activeEntry?.rulesHash || seasonRules?.taxonomyHash !== activeEntry?.taxonomyHash) {
    fail('maxis manifest and active frozen rules identity are out of sync');
  }
  const frozenConfigErrors = validateMaxisConfig(seasonRules?.taxonomySnapshot || {});
  if (frozenConfigErrors.length) fail(`maxis frozen season taxonomy invalid: ${frozenConfigErrors.join('; ')}`);
  if (seasonSummary?.season?.id !== activeEntry?.id || seasonSummary?.season?.protocolHash !== activeEntry?.protocolHash || seasonSummary?.rules?.rulesHash !== activeEntry?.rulesHash) {
    fail('maxis active summary identity or rules receipt does not match the manifest');
  }
  if (seasonSummary?.season?.status !== 'active' || seasonSummary?.season?.endsAt != null || !/next Tezos protocol activation/i.test(seasonSummary?.season?.endsWhen || '')) {
    fail('maxis active summary must declare an open protocol-season end until the next activation exists');
  }
  if (!seasonSummary?.sourceReceipts?.activation?.tzktBlock) fail('maxis active summary must carry an exact activation receipt');
  const transactionStatePath = localArtifactPath(
    activeEntry?.transactionStatePath || seasonSummary?.sourceReceipts?.transaction?.statePath
  );
  let transactionState = null;
  if (transactionStatePath) {
    transactionState = JSON.parse(await readText(transactionStatePath));
    const { integrity, ...unsigned } = transactionState;
    const transactionStateErrors = validateTransactionAccumulator(transactionState);
    if (
      integrity?.algorithm !== 'sha256-stable-json-v1'
      || integrity?.contentHash !== stableJsonHash(unsigned)
      || transactionStateErrors.length
    ) {
      fail(`maxis complete Transaction state is invalid: ${transactionStateErrors.join('; ')}`);
    }
    if (
      transactionState?.season?.id !== activeEntry?.id
      || transactionState?.rules?.evaluatorVersion !== seasonRules?.evaluatorVersion
      || transactionState?.rules?.rulesHash !== seasonRules?.rulesHash
      || integrity?.contentHash !== activeEntry?.transactionStateHash
      || integrity?.contentHash !== seasonSummary?.sourceReceipts?.transaction?.stateHash
    ) {
      fail('maxis complete Transaction state receipts do not cross-link to manifest, rules, and summary');
    }
  } else if (seasonSummary?.artifactBudget) {
    fail('maxis budgeted season summary is missing its complete Transaction state path');
  }
  const summaryTruncationErrors = truncationCoverageErrors(seasonSummary);
  if (summaryTruncationErrors.length) fail(`maxis source truncation is not isolated to unavailable dependent lanes: ${summaryTruncationErrors.join('; ')}`);
  if (Number(seasonSummary?.deepRankingLimit) !== DEEP_RANKING_LIMIT || Number(seasonSummary?.passports?.shardCount) !== PASSPORT_SHARD_COUNT || seasonSummary?.passports?.shardAlgorithm !== PASSPORT_SHARD_ALGORITHM) {
    fail('maxis active summary deep-rank or Passport shard metadata is invalid');
  }

  const summaryCategories = Object.keys(seasonSummary?.laneStatus || {});
  if (summaryCategories.slice().sort().join(',') !== SEASON_CATEGORY_ORDER.slice().sort().join(',')) {
    fail(`maxis active summary lane catalog mismatch: ${summaryCategories.join(',')}`);
  }
  for (const category of SEASON_CATEGORY_ORDER) {
    const status = seasonSummary?.laneStatus?.[category];
    const ranking = seasonSummary?.rankings?.[category];
    const cutoff = seasonSummary?.cutoffs?.[category];
    if (!status || !['ready', 'empty', 'unavailable'].includes(status.status)) fail(`maxis season ${category} has an invalid status`);
    if (!Array.isArray(ranking) || ranking.length > 10) fail(`maxis season ${category} summary ranking is invalid`);
    if (status?.status === 'ready' && !ranking?.length) fail(`maxis season ${category} is ready without published standings`);
    if (status?.status === 'unavailable' && (ranking?.length || !status.reason)) fail(`maxis unavailable ${category} must publish no winner and explain why`);
    for (const [index, row] of (ranking || []).entries()) {
      if (row.rank !== index + 1 || !Array.isArray(row.scoreVector) || !row.scoreVector.length || !Object.hasOwn(row, 'delta')) {
        fail(`maxis season ${category} rank ${index + 1} lacks deterministic score/movement data`);
      }
    }
    if (ranking?.[0]?.address !== cutoff?.leader?.address) fail(`maxis season ${category} leader and cutoff receipt disagree`);
    if (ranking?.length >= 2 && ranking[1].address !== cutoff?.nearestChallenger?.address) fail(`maxis season ${category} nearest challenger receipt disagrees`);
    if (ranking?.length >= 10 && ranking[9].address !== cutoff?.topTen?.address) fail(`maxis season ${category} top-ten cutoff receipt disagrees`);
  }

  const summaryShards = seasonSummary?.passports?.nonemptyShards || [];
  const manifestShards = activeEntry?.availableShards || [];
  if (summaryShards.join(',') !== manifestShards.join(',')) fail('maxis summary and manifest disagree on non-empty Passport shards');
  const seenPassportAddresses = new Set();
  const passportLaneCounts = Object.fromEntries(SEASON_CATEGORY_ORDER.map((category) => [category, 0]));
  const verifiedShardHashes = {};
  const passportShardPayloads = new Map();
  for (const shard of manifestShards) {
    if (!/^[0-3][0-9a-f]$/.test(shard)) {
      fail(`maxis manifest contains invalid Passport shard ${shard}`);
      continue;
    }
    const shardPath = localArtifactPath(activeEntry.passportPathTemplate?.replace('{shard}', shard));
    const rawShard = await readText(shardPath);
    const expectedShardHash = seasonSummary?.passports?.shardHashes?.[shard];
    const actualShardHash = createHash('sha256').update(rawShard).digest('hex');
    if (!/^[0-9a-f]{64}$/.test(expectedShardHash || '') || actualShardHash !== expectedShardHash) {
      fail(`maxis Passport shard ${shard} does not match its SHA-256 receipt`);
    }
    verifiedShardHashes[shard] = actualShardHash;
    const payload = JSON.parse(rawShard);
    if (seasonSummary?.passports?.algorithm === 'sha256-compact-json-v1' && rawShard !== `${JSON.stringify(payload)}\n`) {
      fail(`maxis Passport shard ${shard} is not canonical compact JSON`);
    }
    passportShardPayloads.set(shard, payload);
    const expectedShardSchema = seasonSummary?.artifactBudget ? 2 : Number(payload.schema);
    if (![1, 2].includes(Number(payload.schema)) || expectedShardSchema !== Number(payload.schema) || payload.seasonId !== activeEntry.id || payload.shard !== shard || payload.shardAlgorithm !== PASSPORT_SHARD_ALGORITHM) {
      fail(`maxis Passport shard ${shard} metadata is incompatible`);
    }
    for (const [address, storedPassport] of Object.entries(payload.passports || {})) {
      const passport = expandPassportRecord(storedPassport);
      if (addressShard(address) !== shard || passport?.address !== address || seenPassportAddresses.has(address)) {
        fail(`maxis Passport ${address} is duplicated, misidentified, or in the wrong shard`);
      }
      seenPassportAddresses.add(address);
      const badgeIds = (passport?.badges || []).map((badge) => badge.id);
      if (badgeIds.length !== new Set(badgeIds).size) fail(`maxis Passport ${address} repeats an earned badge`);
      for (const [category, lane] of Object.entries(passport?.lanes || {})) {
        if (!SEASON_CATEGORY_ORDER.includes(category) || (lane.rank != null && Number(lane.rank) < 1) || Number(lane.personalBestRank) < 1) {
          fail(`maxis Passport ${address} has an invalid ${category} lane record`);
        }
        if (SEASON_CATEGORY_ORDER.includes(category)) passportLaneCounts[category] += 1;
        const milestone = seasonRules?.definition?.lanes?.[category]?.passportMilestone;
        const progress = lane?.badgeProgress;
        const scoreValue = (lane?.scoreVector || []).find((metric) => metric.metric === milestone?.metric)?.value;
        const expectedPercent = milestone?.target > 0 ? Math.min(100, Math.round((Number(scoreValue || 0) / Number(milestone.target)) * 100)) : null;
        if (
          !milestone
          || progress?.version !== milestone.version
          || progress?.metric !== milestone.metric
          || Number(progress?.target) !== Number(milestone.target)
          || Number(progress?.value) !== Number(scoreValue || 0)
          || Number(progress?.percent) !== expectedPercent
          || Boolean(progress?.earned) !== (Number(scoreValue || 0) >= Number(milestone.target))
        ) {
          fail(`maxis Passport ${address} ${category} badge progress is not derived from its frozen milestone`);
        }
      }
      const qualifyingLanes = passport?.unicorn?.qualifyingLanes || [];
      if (passport?.unicorn?.rank != null) passportLaneCounts.unicorn += 1;
      const unicornMilestone = seasonRules?.definition?.lanes?.unicorn?.passportMilestone;
      const unicornProgress = passport?.unicorn?.badgeProgress;
      const expectedUnicornPercent = unicornMilestone?.target > 0
        ? Math.min(100, Math.round((qualifyingLanes.length / Number(unicornMilestone.target)) * 100))
        : null;
      if (
        !unicornMilestone
        || unicornProgress?.version !== unicornMilestone.version
        || unicornProgress?.metric !== unicornMilestone.metric
        || Number(unicornProgress?.target) !== Number(unicornMilestone.target)
        || Number(unicornProgress?.value) !== qualifyingLanes.length
        || Number(unicornProgress?.percent) !== expectedUnicornPercent
        || Boolean(unicornProgress?.earned) !== (qualifyingLanes.length >= Number(unicornMilestone.target))
      ) {
        fail(`maxis Passport ${address} Unicorn progress is not derived from its frozen milestone`);
      }
      if (Number(passport?.unicorn?.breadth || 0) !== qualifyingLanes.length) fail(`maxis Passport ${address} Unicorn breadth disagrees with its lane receipts`);
      for (const lane of qualifyingLanes) {
        if (seasonSummary?.laneStatus?.[lane.category]?.status !== 'ready' || Number(lane.rank) > 100) {
          fail(`maxis Passport ${address} receives Unicorn credit from an unavailable or non-qualifying lane`);
        }
      }
    }
  }
  if (seenPassportAddresses.size !== Number(seasonSummary?.passports?.indexedAddresses || 0)) {
    fail(`maxis Passport shard index count mismatch: ${seenPassportAddresses.size}/${seasonSummary?.passports?.indexedAddresses}`);
  }
  const verifiedContentRootInput = Object.entries(verifiedShardHashes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([shard, hash]) => `${shard}:${hash}`)
    .join('\n');
  const verifiedContentRoot = createHash('sha256').update(verifiedContentRootInput).digest('hex');
  if (verifiedContentRoot !== seasonSummary?.passports?.contentRoot) {
    fail('maxis Passport shard catalog does not match its season content root');
  }
  if (seasonSummary?.artifactBudget && transactionState) {
    const measuredBudget = measureSeasonArtifactBudget({
      rules: seasonRules,
      summary: seasonSummary,
      transactionState,
      shardPayloads: passportShardPayloads,
      limits: seasonSummary.artifactBudget.limits
    });
    const budgetErrors = artifactBudgetErrors(measuredBudget);
    if (JSON.stringify(measuredBudget) !== JSON.stringify(seasonSummary.artifactBudget) || budgetErrors.length) {
      fail(`maxis active artifact budget receipt does not match committed bytes: ${budgetErrors.join('; ')}`);
    }
  }
  for (const category of SEASON_CATEGORY_ORDER) {
    const eligibleCount = Number(seasonSummary?.laneStatus?.[category]?.eligibleCount || 0);
    if (passportLaneCounts[category] !== eligibleCount) {
      fail(`maxis Passport ${category} coverage count mismatch: ${passportLaneCounts[category]}/${eligibleCount}`);
    }
  }
  for (const archivedEntry of (manifest.seasons || []).filter((entry) => entry.status === 'finalized')) {
    const archivedSummary = JSON.parse(await readText(localArtifactPath(archivedEntry.summaryPath)));
    if (!archivedEntry.archiveUrl || archivedSummary?.season?.status !== 'finalized' || !archivedSummary?.integrity?.contentHash || !archivedSummary?.finalization) {
      fail(`maxis finalized season ${archivedEntry.id} lacks an immutable archive receipt`);
    }
  }

  const contracts = [
    ['maxis app import', 'initMaxisChamber', app],
    ['maxis pretty path map', "case 'maxis':", app],
    ['maxis hash route', "hash === 'maxis'", app],
    ['maxis site map', "id: 'maxis'", siteMap],
    ['maxis entry card', 'id = \'maxis-entry-card\'', maxis],
    ['maxis stable focus restoration fallback', "findChamberLauncher('#maxis-entry-card')", maxis],
    ['maxis Ledger Flow address action', '/#ledger-flow=${address}', maxis],
    ['maxis rank tweet action', 'https://twitter.com/intent/tweet?text=${tweetText}', maxis],
    ['maxis route-scoped rank shares', 'function rankShareUrl(category)', maxis],
    ['maxis unique row action ids', 'function rowActionId(entry, category)', maxis],
    ['maxis row toggle action ownership', 'aria-controls="${escapeHtml(actionsId)}"', maxis],
    ['maxis protocol-season selector', 'class="maxis-season-orb"', maxis],
    ['maxis shared corner trays', 'maxis-corner-tray', maxis],
    ['maxis four-room tab set', "const VIEW_KEYS = ['maxis', 'season', 'passport', 'champions']", maxis],
    ['maxis default canonical room', "view: 'maxis'", maxis],
    ['maxis legacy Crown Hall route alias', "crown: 'maxis'", maxis],
    ['maxis room-aware season selector', "seasonContext ? renderSeasonSelector() : ''", maxis],
    ['maxis neutral canonical hero', 'maxis-context-hero maxis-maxis-hero', maxis],
    ['maxis neutral Champions hero', 'maxis-context-hero maxis-champions-hero', maxis],
    ['maxis all-lane canonical overview', 'data-maxis-overview-lane=', maxis],
    ['maxis canonical detailed board', 'id="maxis-maxis-detail"', maxis],
    ['maxis single selected lane board', 'data-maxis-board=', maxis],
    ['maxis conservative pass-gap normalization', 'conservativeVectorPath', maxis],
    ['maxis archived pass-gap compatibility', ': gap.minimalKnownPath', maxis],
    ['maxis pass-gap certainty disclosure', 'conservative static-vector path:', maxis],
    ['maxis frozen archive lane catalog', 'archiveLaneCatalog', maxis],
    ['maxis frozen archive lane title', 'frozenLaneTitle', maxis],
    ['maxis frozen archive lane order', 'frozenLaneOrder', maxis],
    ['maxis final champion identity receipt', 'maxis-champion-record', maxis],
    ['maxis final champion on-chain trails', 'maxis-champion-actions', maxis],
    ['maxis final archive summary receipt', 'maxis-archive-summary-action', maxis],
    ['maxis frozen archive rules receipt', 'maxis-archive-rules-action', maxis],
    ['maxis compact transaction Passport adapter', "profile?.format === 'transaction-only-v1'", maxis],
    ['maxis compact transaction top-ten adapter', 'record?.topTenGap', maxis],
    ['maxis compact Unicorn progress adapter', 'profile?.unicornProgress?.breadth', maxis],
    ['maxis compact transaction near-miss adapter', 'function profileNearMisses', maxis],
    ['maxis Passport SHA-256 shard routing', "crypto.subtle.digest('SHA-256'", maxis],
    ['maxis Passport in-flight shard deduplication', 'shardRequestCache.has(key)', maxis],
    ['maxis Passport explicit-address form', 'data-maxis-passport-form', maxis],
    ['maxis Passport Tezos Domains resolver import', 'resolveTezDomainAddress', maxis],
    ['maxis Passport .tez input affordance', 'Tezos address or .tez name for Maxi Passport', maxis],
    ['shared Tezos Domains GraphQL endpoint', 'https://api.tezos.domains/graphql', tezosDomainsCore],
    ['shared Tezos Domains owner fallback', '[domain.address, domain.owner].find', tezosDomainsCore],
    ['maxis Passport Career section', 'maxis-passport-career', maxis],
    ['maxis Passport This Season section', 'maxis-passport-season', maxis],
    ['maxis cross-season Passport loader', 'function loadPassportCareer', maxis],
    ['maxis cross-season badge aggregation', 'function careerBadgeRecords', maxis],
    ['maxis cross-season personal best aggregation', 'function careerPersonalBestRecords', maxis],
    ['maxis cross-season breadth receipt', 'Cross-season breadth', maxis],
    ['maxis phase-aware selected-season badge separation', '${escapeHtml(scope.passportScope)} stamps', maxis],
    ['maxis scoped season summary failure', 'Selected season is scoped unavailable', maxis],
    ['maxis scoped season retry', 'data-maxis-season-retry', maxis],
    ['maxis scoped final archive retry', 'data-maxis-archives-retry', maxis],
    ['maxis explicit season phase', 'data-maxis-season-phase=', maxis],
    ['maxis stale summary request guard', 'refreshSerial !== summaryRequestSerial', maxis],
    ['maxis independent Governance career artifact', "const CAREER_DATA_URL = '/data/maxis-careers.json'", maxis],
    ['maxis Governance career integrity check', 'The Governance career artifact failed its SHA-256 integrity receipt.', maxis],
    ['maxis Passport exact Governance career record', 'maxis-governance-career', maxis],
    ['maxis current protocol Governance context', 'maxis-governance-context', maxis],
    ['maxis quiet Governance season truth', 'No actionable Governance window occurred in this protocol season, so no season crown is declared.', maxis],
    ['maxis quiet Governance no-ballot truth', 'no qualifying ballot or proposal activity was recorded, so no season crown is declared.', maxis],
    ['maxis quiet Governance enduring-record handoff', 'data-maxis-handoff-lane=', maxis],
    ['maxis objective crown disclosure', 'Crowns are objective activity metrics, not endorsements.', maxis],
    ['maxis opeculiar idea credit', 'Chamber idea by <strong>opeculiar</strong>', maxis],
    ['maxis footer idea credit', '<span class="maxis-idea-credit">', maxis],
    ['maxis centered footer idea credit styles', '.maxis-footer > .maxis-idea-credit', maxisCss],
    ['maxis protocol-season stage', '.maxis-season-stage', maxisCss],
    ['maxis mirrored corner inset', '--maxis-corner-inset', maxisCss],
    ['maxis HEN circular corner exception', '[data-theme="hen"] #maxis-modal .maxis-season-orb', maxisCss],
    ['maxis NERV circular corner exception', '[data-theme="nerv"] #maxis-modal .maxis-season-orb', maxisCss],
    ['maxis four-room tabs', '.maxis-room-tabs', maxisCss],
    ['maxis podium', '.maxis-podium', maxisCss],
    ['maxis compact ranks four through ten', '.maxis-compact-ranking', maxisCss],
    ['maxis Passport progress track', '.maxis-progress-track', maxisCss],
    ['maxis Champions archive cards', '.maxis-champion-card', maxisCss],
    ['My Tezos Passport link', 'my-tezos-maxi-passport-link', myTezos]
  ];
  for (const [label, snippet, source] of contracts) {
    if (!source.includes(snippet)) fail(`missing ${label}`);
  }
  if (!/domain\(name:\s*\$name\)\s*\{\s*address\s+owner\s*\}/s.test(tezosDomainsCore)) {
    fail('shared Tezos Domains resolver must request both address and owner');
  }
  if (!/#chambers-grid\s+#maxis-entry-card\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s.test(maxisCss)) {
    fail('maxis single-card launcher pair must span its full grid at every viewport');
  }
  if (!/\.maxis-entry-front\s*>\s*\.maxis-entry-season-front\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s.test(maxisCss)) {
    fail('maxis launcher composition must span the full card content grid');
  }
  const maxisRoute = CHAMBER_ROUTES.find((route) => route.slug === 'maxis');
  if (!/On-Chain Crowns/.test(maxisRoute?.title || '') || maxisRoute?.eyebrow !== 'On-Chain Crowns' || !/honest natural clocks/i.test(maxisRoute?.description || '')) {
    fail(`maxis route metadata must lead with canonical crowns rather than season-only framing: ${JSON.stringify(maxisRoute)}`);
  }
  if (/on the known tie path/i.test(maxis)) fail('maxis UI must not present a frozen score-vector path as a known dynamic minimum');
  const governanceRefreshIndex = generatedSurfaces.indexOf("nodeScript('scripts/refresh-governance-data.mjs'");
  const maxisRefreshIndex = generatedSurfaces.indexOf("nodeScript('scripts/refresh-maxis-data.mjs'");
  const maxisCareerRefreshIndex = generatedSurfaces.indexOf("nodeScript('scripts/refresh-maxis-careers.mjs'");
  if (governanceRefreshIndex < 0 || maxisRefreshIndex < 0 || maxisCareerRefreshIndex < 0
    || governanceRefreshIndex > maxisRefreshIndex || maxisRefreshIndex > maxisCareerRefreshIndex) {
    fail('generated surfaces must refresh governance, frozen-season Maxis data, and mutable career context in dependency order');
  }
  if (!/const activeSeasonGeneratedAt = new Date\(\)\.toISOString\(\);\s*const buildOptions = \{\s*season,\s*rules,\s*generatedAt: activeSeasonGeneratedAt,[\s\S]*?\};\s*const fullSeasonSnapshot = await buildFullSeasonSnapshot\(buildOptions\);/.test(maxisGenerator)) {
    fail('Maxis active-season builds must capture a fresh timestamp immediately before resolving their live Transaction boundary');
  }
  if (packageJson?.scripts?.['refresh:maxis-careers'] !== 'node scripts/refresh-maxis-careers.mjs'
    || packageJson?.scripts?.['check:maxis-careers'] !== 'node scripts/refresh-maxis-careers.mjs --check') {
    fail('package scripts must expose Maxis Governance career refresh and offline validation');
  }
  if (!/\.hot-today-progress\s*\{[^}]*margin:\s*0\.7rem auto 0;/s.test(shellExtrasCss)) {
    fail('What is hot today progress controls must stay centered');
  }
  pass('Tezos Maxis taxonomy, snapshot, scoring, route, and Ledger Flow contracts checked');
}

async function main() {
  if (process.argv.includes('--readme-only')) {
    await checkPortableTooling();
    await checkRepositoryLicense();
    await checkReadmeContracts();

    for (const message of passes) console.log(`ok - ${message}`);
    for (const message of warnings) console.warn(`warn - ${message}`);
    for (const message of failures) console.error(`fail - ${message}`);

    console.log(`\nREADME checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failed`);
    if (failures.length) process.exit(1);
    return;
  }

  await checkRequiredFiles();
  await checkJsonFiles();
  await checkGovernanceVotes();
  await checkLocalReferences();
  await checkSiteMapGraphContracts();
  await checkCacheBustAlignment();
  await checkCsp();
  await checkSitemapCoverage();
  await checkSelectorContracts();
  await checkUxAuditContracts();
  await checkWidgetRuntimeContracts();
  await checkMainnetLaunchCopy();
  await checkModuleImportVersions();
  await checkHistoricalPagination();
  await checkLiquidityBakingIssuanceState();
  await checkTruthSurfaceContracts();
  await checkStylesheetFreshness();
  await checkAuroraDesktopTitleTreatment();
  await checkPortableTooling();
  await checkRepositoryLicense();
  await checkSmokeSuiteCatalogContracts();
  await checkTourAndShareCaptureContracts();
  await checkDailyBriefingPriceContracts();
  await checkNetworkContextNavigationContracts();
  checkMilestoneLifecycleBehavior();
  await checkMilestoneCatalogContracts();
  await checkVisitStreakBehavior();
  await checkMaxisContracts();
  await checkReadmeContracts();

  for (const message of passes) console.log(`ok - ${message}`);
  for (const message of warnings) console.warn(`warn - ${message}`);
  for (const message of failures) console.error(`fail - ${message}`);

  console.log(`\nStatic checks: ${passes.length} passed, ${warnings.length} warnings, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
