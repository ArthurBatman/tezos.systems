/**
 * Daily Tezos Briefing — auto-generated narrative summary per cycle
 * Pure JS, no AI. ~50 sentence templates, data-driven selection.
 */

import { API_URLS } from '../core/config.js';
import { escapeHtml } from '../core/utils.js';
import { findSiteMapEntry } from '../core/site-map.js';
import { fetchXTZPrice } from './price.js';

const LS_BASELINE  = 'tezos-systems-briefing-baseline';
const LS_BRIEFING  = 'tezos-systems-briefing-cache';
const LS_LAST_SEEN = 'tezos-systems-briefing-last-seen';
const LS_HOT_HISTORY = 'tezos-systems-hot-history';
const LS_DAILY_SNAPSHOT = 'tezos-systems-daily-snapshot';
const LS_PROTOCOL_LORE_DAY = 'tezos-systems-protocol-lore-hot-day';
const BRIEFING_SCHEMA_VERSION = 3;
const PRICE_FETCH_TIMEOUT_MS = 2500;
const NFT_FETCH_TIMEOUT_MS = 2500;
const HOT_TODAY_LIVE_TICK_MS = 1000;
const HOT_TODAY_ROTATE_MS = 8000;
const HOT_SIGNAL_RENDER_THROTTLE_MS = 1000;
const HOT_SIGNAL_RENDER_CAP = 12;
const HOT_SIGNAL_CATEGORY_BUDGET = 2;
const HOT_SIGNAL_EVENT_DECAY_PER_HOUR = 8;
const HOT_HISTORY_DAYS = 7;
const ACTIVITY_NEUTRAL_PCT = 1;
const ACTIVITY_MEANINGFUL_PCT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const OBJKT_GRAPHQL_ENDPOINT = 'https://data.objkt.com/v3/graphql';
const OBJKT_SALES_SAMPLE_LIMIT = 500;

const CATEGORY_META = {
  baker: { label: 'Baker', icon: '🍞', tone: 'operator', detail: 'Personal operator signal' },
  price: { label: 'Market', icon: '💸', tone: 'market', detail: 'XTZ price movement' },
  staking: { label: 'Staking', icon: '🥩', tone: 'staking', detail: 'Security and yield' },
  volume: { label: 'Activity', icon: '⚡', tone: 'activity', detail: 'Transaction flow' },
  contracts: { label: 'Contracts', icon: '🧩', tone: 'activity', detail: 'App and DeFi pulse' },
  whales: { label: 'Whales', icon: '🐋', tone: 'capital', detail: 'Large value movement' },
  governance: { label: 'Governance', icon: '🏛️', tone: 'governance', detail: 'Protocol decision lane' },
  ecosystem: { label: 'Growth', icon: '🌱', tone: 'growth', detail: 'New account flow' },
  cycle: { label: 'Cycle', icon: '⏱️', tone: 'cycle', detail: 'Cycle runway' },
  security: { label: 'Security', icon: '🛡️', tone: 'security', detail: 'Bakers, stake, and finality' },
  domains: { label: 'Domains', icon: '.tez', tone: 'activity', detail: 'Tezos Domains lane' },
  nft: { label: 'NFTs', icon: '◈', tone: 'activity', detail: 'HEN live culture' },
  lb: { label: 'Liquidity Baking', icon: 'LB', tone: 'governance', detail: 'LB vote and liquidity lane' },
  tz4: { label: 'tz4', icon: 'tz4', tone: 'security', detail: 'BLS consensus key adoption' },
  etherlink: { label: 'Etherlink', icon: 'L2', tone: 'activity', detail: 'Tezos X activity lane' },
  ledger: { label: 'Ledger Flow', icon: '↔', tone: 'network', detail: 'Account transfer paths' },
  moment: { label: 'Milestone', icon: '✦', tone: 'growth', detail: 'Network milestone' },
  network: { label: 'Network', icon: '🌐', tone: 'network', detail: 'Daily Tezos pulse' }
};

const NETWORK_FEATURE_SITE_MAP_IDS = {
  staking: 'calculator',
  governance: 'chamber',
  collector: 'hen',
  creator: 'hen',
  nft: 'hen',
  cycle: 'health',
  security: 'health',
  network: 'health',
  domains: 'domains',
  lb: 'liquidity-baking',
  tz4: 'tz4',
  etherlink: 'tezosx',
  ledger: 'ledger-flow'
};

const NETWORK_FEATURE_FALLBACK_ROUTES = {
  baker: '#my-baker',
  portfolio: '#price',
  staking: '#calculator',
  governance: '#chamber',
  collector: '?hen=1',
  creator: '?hen=1',
  price: '#price',
  whales: '#whales',
  volume: '#section=network',
  contracts: '#section=ecosystem',
  ecosystem: '#section=ecosystem',
  cycle: '#health',
  security: '#health',
  network: '#health'
};

const NETWORK_FEATURE_FALLBACK_LABELS = {
  baker: 'Open My Tezos baker stats',
  portfolio: 'Open price intelligence',
  staking: 'Open rewards calculator',
  governance: 'Enter The Chamber',
  collector: 'Open HEN profile',
  creator: 'Open NFT profile',
  price: 'Open price intelligence',
  whales: 'Open whale tracker',
  volume: 'Open network activity stats',
  contracts: 'Open ecosystem stats',
  ecosystem: 'Open ecosystem stats',
  domains: 'Open Tezos Domains',
  nft: 'Open HEN live feed',
  lb: 'Open Liquidity Baking',
  tz4: 'Open tz4 Adoption',
  etherlink: 'Open Tezos X',
  ledger: 'Open Ledger Flow',
  moment: 'Open live Tezos pulse',
  cycle: 'Open live cycle health',
  security: 'Open Network Health',
  network: 'Open Network Health'
};

let lastStats = null;
let lastXtzPrice = null;
let personalizationWired = false;
let hotTodayWired = false;
let hotTodayRealtimeWired = false;
let hotTodayLiveTimer = null;
let hotTodayRotateTimer = null;
let hotTodayPulseTimer = null;
let hotTodaySignals = [];
let hotTodayBriefingSentences = [];
let hotTodayActiveIndex = 0;
let hotTodayRotationPaused = false;
let hotTodayHasRendered = false;
let hotSignalRenderTimer = null;
let lastHotSignalRenderAt = 0;
let hotSignalListenerWired = false;
let protocolLoreSignalInFlight = false;
const hotSignalPool = new Map();

// ─── Template Library ────────────────────────────────────────────────────────

const TEMPLATES = {
  price: [
    ({ pct, dir, price })       => `XTZ moved ${dir} ${pct}% in the last 24h, trading around $${price}.`,
    ({ pct, dir })              => `Price ${dir === 'up' ? 'climbed' : 'slid'} ${pct}% since yesterday — ${parseFloat(pct) > 3 ? 'notable move.' : 'modest drift.'}`,
    ({ price })                 => `XTZ is holding steady near $${price} with minimal 24h movement.`,
    ({ pct, dir, price })       => `Markets: XTZ ${dir === 'up' ? '▲' : '▼'} ${pct}% to $${price}.`,
    ({ pct, dir })              => `XTZ ${dir === 'up' ? 'gained' : 'lost'} ${pct}% in 24h — ${parseFloat(pct) >= 4 ? 'sharp move.' : 'routine volatility.'}`,
  ],
  staking: [
    ({ ratio, delta })          => `Staked ratio ${delta >= 0 ? 'rose' : 'fell'} to ${ratio}% — network security is ${parseFloat(ratio) > 30 ? 'strong' : parseFloat(ratio) > 20 ? 'solid' : 'tightening'}.`,
    ({ ratio })                 => `${ratio}% of XTZ supply is staked and securing the network.`,
    ({ ratio, delta })          => `Staking ${Math.abs(delta) < 0.1 ? 'is flat' : delta > 0 ? 'picked up' : 'dipped'} — ${ratio}% of supply locked.`,
    ({ ratio })                 => `Network security: ${ratio}% staked. ${parseFloat(ratio) < 25 ? 'Participation could be higher.' : 'Looking healthy.'}`,
    ({ ratio, delta })          => `${Math.abs(delta) > 0.3 ? `Staking shifted ${delta > 0 ? '+' : ''}${delta.toFixed(2)}pp to` : 'Staking stable at'} ${ratio}%.`,
  ],
  volume: [
    ({ baselineText, activityState }) => `Transaction volume is ${baselineText} — chain is ${activityState}.`,
    ({ vol })                   => `${vol.toLocaleString()} on-chain transactions in the last 24h.`,
    ({ normalText })            => `On-chain activity is ${normalText} this cycle.`,
    ({ vol, paceText })         => `${vol.toLocaleString()} txns recorded — ${paceText}.`,
    ({ vol, trendText })        => `Chain throughput: ${vol.toLocaleString()} transactions, trending ${trendText}.`,
  ],
  contracts: [
    ({ count })                 => `Smart contract calls: ${count.toLocaleString()} in the last 24h.`,
    ({ count, delta })          => `Contract interactions ${delta >= 0 ? 'up' : 'down'} to ${count.toLocaleString()} — DeFi pulse is ${delta >= 0 ? 'rising' : 'cooling'}.`,
    ({ count })                 => `${count.toLocaleString()} contract calls — ${count > 100000 ? 'DeFi is humming' : 'steady baseline activity'}.`,
    ({ count, delta })          => `${count.toLocaleString()} entrypoint invocations this cycle${Math.abs(delta) > 1000 ? ` (${delta > 0 ? '+' : ''}${delta.toLocaleString()} vs last)` : ''}.`,
  ],
  whales: [
    ({ count })                 => `${count} large movements (>10K ꜩ) detected in the last 24h.`,
    ({ count })                 => `Whale tracker: ${count} transactions over 10,000 ꜩ spotted this cycle.`,
    ({ count })                 => `${count > 5 ? 'Heavy' : count > 2 ? 'Moderate' : 'Light'} whale activity — ${count} big transfers recorded.`,
    ({ top, count })            => `Largest detected move: ${top.toLocaleString()} ꜩ. ${count} total whale txns.`,
    ({ count })                 => `${count === 0 ? 'No whale transactions over 10K ꜩ detected.' : `${count} whales surfaced — large capital on the move.`}`,
  ],
  governance: [
    ({ proposal, period, pct }) => `Governance: "${proposal}" is ${pct}% through the ${period} period.`,
    ({ proposal, period })      => `Active vote — "${proposal}" is in the ${period} phase.`,
    ({ name })                  => `No active governance proposal — last upgrade was ${name}.`,
    ({ participation })         => `Governance participation sitting at ${participation}% this period.`,
    ({ proposal })              => `On-chain governance active: "${proposal}" proposal under deliberation.`,
  ],
  ecosystem: [
    ({ n })                     => `${n.toLocaleString()} new funded accounts appeared on-chain this cycle.`,
    ({ n })                     => `Ecosystem growth: ${n.toLocaleString()} fresh wallet activations.`,
    ({ bakers })                => `${bakers} active bakers securing Tezos blocks right now.`,
    ({ n, bakers })             => `${n.toLocaleString()} new accounts, ${bakers} bakers — network growing.`,
    ({ n })                     => `${n > 500 ? 'Strong' : n > 100 ? 'Steady' : 'Slow'} onboarding: ${n.toLocaleString()} new accounts funded this cycle.`,
  ],
  baker: [
    ({ pct })                   => `Your baker attested ${pct}% of slots this cycle. ${parseFloat(pct) >= 99 ? '💚 Flawless.' : parseFloat(pct) >= 95 ? '✅ Solid.' : '⚠️ Some misses.'}`,
    ({ missed })                => `Your baker missed ${missed} attestation slot${missed !== 1 ? 's' : ''} this cycle. ⚠️`,
    ({ pct })                   => `Baker performance: ${pct}% attestation rate this cycle.`,
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(p)    { return p < 1 ? p.toFixed(4) : p.toFixed(2); }
function fmtPct(p)      { return Math.abs(p).toFixed(1); }
function signedPct(a,b) { return b ? ((a - b) / b) * 100 : 0; }
function pick(arr)      { return arr[Math.floor(Math.random() * arr.length)]; }

function activityNarrative(deltaPct) {
  const abs = Math.abs(deltaPct);
  const pct = fmtPct(deltaPct);

  if (abs < ACTIVITY_NEUTRAL_PCT) {
    return {
      pct,
      dir: 'near',
      baselineText: 'in line with the activity baseline',
      normalText: 'in line with normal levels',
      paceText: 'holding a typical pace',
      trendText: 'steady',
      activityState: 'steady',
      isMeaningful: false,
      tone: 'quiet'
    };
  }

  const dir = deltaPct > 0 ? 'above' : 'below';
  const isMeaningful = abs > ACTIVITY_MEANINGFUL_PCT;
  return {
    pct,
    dir,
    baselineText: `${pct}% ${dir} the activity baseline`,
    normalText: `${pct}% ${dir} normal levels`,
    paceText: isMeaningful ? `${pct}% ${dir} typical pace` : `near typical pace (${pct}% ${dir})`,
    trendText: isMeaningful ? `${dir} (${pct}%)` : `steady (${pct}% ${dir})`,
    activityState: isMeaningful ? (deltaPct > 0 ? 'busy' : 'quiet') : 'steady',
    isMeaningful,
    tone: isMeaningful ? (deltaPct > 0 ? 'activity' : 'quiet') : 'quiet'
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeLocalStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeLocalStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage full */ }
}

function utcDayKey(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dayDiff(fromDay, toDay = utcDayKey()) {
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / DAY_MS);
}

function compactStatsSnapshot(stats = {}) {
  const fields = [
    'tz4Bakers',
    'tz4Percentage',
    'totalBakers',
    'totalDelegators',
    'totalStakers',
    'totalBurned',
    'smartContracts',
    'stakeAPY',
    'lbEmaPct',
    'cycleProgress',
    'cycle'
  ];
  const snapshot = {};
  fields.forEach((field) => {
    const value = finiteNumber(stats?.[field]);
    if (value != null) snapshot[field] = value;
  });
  if (typeof stats?.lbSubsidyDisabled === 'boolean') {
    snapshot.lbSubsidyDisabled = stats.lbSubsidyDisabled;
  }
  return snapshot;
}

function hasDailySnapshotCore(stats = {}) {
  return finiteNumber(stats.tz4Bakers) != null
    && finiteNumber(stats.totalBakers) != null
    && finiteNumber(stats.totalBurned) != null
    && finiteNumber(stats.smartContracts) != null;
}

function readDailySnapshot() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_DAILY_SNAPSHOT) || 'null');
    if (!parsed || typeof parsed !== 'object' || !parsed.day || typeof parsed.stats !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDailySnapshot(snapshot) {
  safeLocalStorageSet(LS_DAILY_SNAPSHOT, JSON.stringify(snapshot));
}

function dailySnapshotReference(snapshot = readDailySnapshot()) {
  if (!snapshot) return null;
  const today = utcDayKey();
  if (snapshot.day === today) return snapshot.previous || null;
  return snapshot;
}

function captureDailySnapshot(stats) {
  if (!stats || !stats.cycle) return;
  const today = utcDayKey();
  const compact = compactStatsSnapshot(stats);
  if (!hasDailySnapshotCore(compact)) return;
  const current = readDailySnapshot();
  if (current?.day === today && hasDailySnapshotCore(current.stats)) return;
  const previous = current?.day === today
    ? current.previous || null
    : current?.day && current?.stats
    ? { day: current.day, capturedAt: current.capturedAt || Date.now(), stats: current.stats }
    : null;
  writeDailySnapshot({
    day: today,
    capturedAt: Date.now(),
    stats: compact,
    ...(previous ? { previous } : {})
  });
}

function snapshotSinceLabel(snapshot) {
  if (!snapshot?.day) return 'since the last daily snapshot';
  const diff = dayDiff(snapshot.day);
  if (diff === 1) return 'since yesterday';
  const date = new Date(`${snapshot.day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return 'since the last daily snapshot';
  return `since ${date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}`;
}

function snapshotDelta(stats, previous, field) {
  const current = finiteNumber(stats?.[field]);
  const prior = finiteNumber(previous?.[field]);
  if (current == null || prior == null) return null;
  return current - prior;
}

function formatCount(value) {
  return Math.round(Number(value) || 0).toLocaleString('en-US');
}

function formatTez(value, precision = 0) {
  const number = finiteNumber(value);
  if (number == null) return '0';
  return number.toLocaleString('en-US', {
    maximumFractionDigits: precision,
    minimumFractionDigits: precision
  });
}

function normalizeSignalKind(value) {
  return value === 'event' ? 'event' : 'state';
}

function categoryMeta(category) {
  return CATEGORY_META[category] || CATEGORY_META.network;
}

function isDashboardShell() {
  if (typeof window === 'undefined') return true;
  const path = window.location.pathname.replace(/\/index\.html$/i, '/') || '/';
  return path === '/';
}

function routeFromSiteMapEntry(entry) {
  if (!entry) return '';
  if (isDashboardShell() && entry.hash) return entry.hash;
  return entry.href || entry.hash || '';
}

function siteMapEntryForCategory(key) {
  const siteMapId = NETWORK_FEATURE_SITE_MAP_IDS[safeCssToken(key)];
  return siteMapId ? findSiteMapEntry(siteMapId) : null;
}

function normalizeRoute(value) {
  const route = String(value || '').trim();
  if (!route) return '';
  if (/^(https?:)?\/\//i.test(route)) return route;
  if (route.startsWith('#') || route.startsWith('/') || route.startsWith('?')) return route;
  return `#${route.replace(/^#+/, '')}`;
}

function normalizeDelta(delta) {
  if (!delta || typeof delta !== 'object') return null;
  const value = String(delta.value || '').trim().slice(0, 24);
  if (!value) return null;
  const dir = safeCssToken(delta.dir || 'flat');
  return {
    value,
    dir: ['up', 'down', 'flat'].includes(dir) ? dir : 'flat'
  };
}

function signedDelta(value, unit = '', precision = 1) {
  const number = finiteNumber(value);
  if (number == null) return null;
  const abs = Math.abs(number);
  const formatted = unit === 'count'
    ? Math.round(abs).toLocaleString('en-US')
    : abs.toFixed(precision);
  const suffix = unit && unit !== 'count' ? unit : '';
  return {
    value: `${number > 0 ? '+' : number < 0 ? '-' : ''}${formatted}${suffix}`,
    dir: number > 0 ? 'up' : number < 0 ? 'down' : 'flat'
  };
}

function hasActiveProposalLabel(value) {
  const text = String(value || '').trim();
  return Boolean(text) && !/^(none|null|n\/a|no active proposal)$/i.test(text);
}

function getCurrentMyTezosProfile() {
  const data = typeof window !== 'undefined' ? window._myTezosData : null;
  const story = data?.story || null;
  const address = data?.fullAddress || safeLocalStorageGet('tezos-systems-my-baker-address') || '';
  const interests = [];
  const add = (key, label) => {
    if (!interests.some(item => item.key === key)) interests.push({ key, label });
  };

  if (data?.isBaker) add('baker', 'Baker ops');
  else if (data?.bakerAddr || address) add('baker', 'Baker health');
  if ((Number(data?.totalXTZ) || 0) > 0) add('portfolio', 'Portfolio');
  if (data?.isStaker || (Number(data?.staked) || 0) > 0) add('staking', 'Staking');
  if (story?.proposalsInjected > 0 || story?.bakerProposalsInjected > 0 || data?.bakerVote) add('governance', 'Governance');
  if ((Number(story?.nftAssetsCollected) || 0) > 0) add('collector', 'Collector');
  if ((Number(story?.creatorStats?.totalCreated) || 0) > 0) add('creator', 'Creator');
  if (story?.domainAlias) add('domains', '.tez identity');
  if (!interests.length) add('network', 'Network pulse');

  const keys = interests.map(item => item.key);
  const key = [
    address ? 'address' : 'global',
    data?.isBaker ? 'baker' : data?.bakerAddr ? 'delegator' : 'observer',
    ...keys
  ].join('|');

  return {
    address,
    isReady: Boolean(data?.fullAddress),
    isBaker: data?.isBaker === true,
    hasBaker: Boolean(data?.bakerAddr || address),
    hasDomain: Boolean(story?.domainAlias),
    interests,
    interestKeys: new Set(keys),
    key
  };
}

function scoreBoostFor(category, profile) {
  const keys = profile?.interestKeys || new Set();
  if (category === 'baker' && profile?.hasBaker) return 30;
  if (category === 'tz4' && profile?.hasBaker) return 20;
  if (category === 'governance' && keys.has('governance')) return 22;
  if (category === 'staking' && keys.has('staking')) return 18;
  if (category === 'price' && keys.has('portfolio')) return 16;
  if (category === 'nft' && (keys.has('creator') || keys.has('collector'))) return 18;
  if (category === 'domains' && profile?.hasDomain) return 18;
  if (category === 'contracts' && (keys.has('creator') || keys.has('collector'))) return 12;
  if (category === 'etherlink' && keys.has('portfolio')) return 8;
  if (category === 'ecosystem' && (keys.has('creator') || keys.has('collector'))) return 8;
  if (category === 'whales' && keys.has('portfolio')) return 8;
  return 0;
}

function makeSignal(category, score, text, options = {}) {
  const meta = categoryMeta(category);
  const kind = normalizeSignalKind(options.kind || (options.breaking ? 'event' : 'state'));
  return {
    id: safeCssToken(options.id || category),
    category,
    kind,
    score,
    text,
    title: options.title || meta.label,
    icon: options.icon || meta.icon,
    detail: options.detail || meta.detail,
    tone: options.tone || meta.tone,
    route: normalizeRoute(options.route),
    delta: normalizeDelta(options.delta),
    breaking: options.breaking === true || kind === 'event',
    createdAt: finiteNumber(options.createdAt) || Date.now(),
    expiresAt: finiteNumber(options.expiresAt),
    share: options.share || null,
    live: options.live === true
  };
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(null), timeoutMs))
  ]);
}

function hotHistoryDay(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function readHotHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_HOT_HISTORY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHotHistory(entries) {
  try {
    localStorage.setItem(LS_HOT_HISTORY, JSON.stringify(entries));
  } catch { /* storage full */ }
}

function appendHotHistory(sentences) {
  if (!Array.isArray(sentences) || !sentences.length) return;
  const now = Date.now();
  const cutoff = now - (HOT_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const normalized = sentences.map(normalizeSignal).filter(signal => signal.text);
  const top = normalized[0];
  if (!top) return;
  const nextEntry = {
    day: hotHistoryDay(now),
    timestamp: now,
    topCategory: top.category,
    topScore: Math.round(Number(top.score) || 0),
    signals: normalized.slice(0, HOT_SIGNAL_RENDER_CAP).map(signal => ({
      category: signal.category,
      score: Math.round(Number(signal.score) || 0)
    }))
  };
  const entries = readHotHistory()
    .filter(entry => Number(entry?.timestamp) >= cutoff)
    .concat(nextEntry)
    .slice(-48);
  writeHotHistory(entries);
}

function hotHistorySummary(currentTop) {
  if (!currentTop) return null;
  const history = readHotHistory();
  if (!history.length) return null;
  const today = hotHistoryDay();
  const yesterday = hotHistoryDay(Date.now() - 24 * 60 * 60 * 1000);
  const yesterdayEntries = history.filter(entry => entry?.day === yesterday);
  const yesterdayTop = yesterdayEntries.sort((a, b) => (b.topScore || 0) - (a.topScore || 0))[0] || null;
  const todayTrail = history
    .filter(entry => entry?.day === today && entry.topCategory && entry.topCategory !== currentTop.category)
    .map(entry => entry.topCategory);
  const earlier = Array.from(new Set(todayTrail)).slice(-3);

  let chip = '';
  if (yesterdayTop) {
    const yesterdayMeta = categoryMeta(yesterdayTop.topCategory);
    if ((Number(currentTop.score) || 0) > (Number(yesterdayTop.topScore) || 0) + 4) {
      chip = 'hotter than yesterday';
    } else if (yesterdayTop.topCategory !== currentTop.category) {
      chip = `yesterday: ${yesterdayMeta.label}`;
    } else {
      chip = 'steady vs yesterday';
    }
  }

  return {
    chip,
    earlier: earlier.map(category => categoryMeta(category).label)
  };
}

async function resolvePriceContext(stats, xtzPrice) {
  const nextStats = { ...(stats || {}) };
  let price = finiteNumber(xtzPrice) || 0;

  try {
    const data = await withTimeout(fetchXTZPrice(), PRICE_FETCH_TIMEOUT_MS);
    if (data) {
      const livePrice = finiteNumber(data.usd);
      const liveChange = finiteNumber(data.usd_24h_change);
      if (livePrice && livePrice > 0) price = livePrice;
      if (liveChange != null) nextStats.priceChange24h = liveChange;
    }
  } catch { /* keep DOM price and local baseline fallback */ }

  return {
    stats: nextStats,
    xtzPrice: price,
    priceChange24h: finiteNumber(nextStats.priceChange24h),
  };
}

async function fetchWhaleCount() {
  try {
    const ago = new Date(Date.now() - 86400000).toISOString();
    const url = `${API_URLS.tzkt}/operations/transactions?amount.gt=10000000000&sort.desc=id&limit=20&timestamp.gt=${ago}`;
    const res = await fetch(url);
    if (!res.ok) return { count: 0, top: 0 };
    const data = await res.json();
    const count = data.length;
    const top   = data.reduce((m, t) => Math.max(m, (t.amount || 0) / 1e6), 0);
    return { count, top: Math.round(top) };
  } catch { return { count: 0, top: 0 }; }
}

async function fetchNftPulse() {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const query = `
    query LivePulseObjktSales($since: timestamptz!, $limit: Int!) {
      recent: listing_sale(where: { timestamp: { _gte: $since } }, order_by: { timestamp: desc }, limit: $limit) {
        id
      }
      top: listing_sale(where: { timestamp: { _gte: $since } }, order_by: { price_xtz: desc }, limit: 1) {
        id
        timestamp
        price_xtz
        amount
        ophash
        token {
          name
          fa_contract
          token_id
        }
      }
    }
  `;
  const response = await fetch(OBJKT_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { since, limit: OBJKT_SALES_SAMPLE_LIMIT } })
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (payload.errors?.length) return null;
  const recent = Array.isArray(payload.data?.recent) ? payload.data.recent : [];
  const top = Array.isArray(payload.data?.top) ? payload.data.top[0] : null;
  return {
    count: recent.length,
    capped: recent.length >= OBJKT_SALES_SAMPLE_LIMIT,
    top: top ? {
      id: top.id,
      timestamp: top.timestamp,
      priceXtz: (finiteNumber(top.price_xtz) || 0) / 1e6,
      amount: finiteNumber(top.amount) || 1,
      name: top.token?.name || 'OBJKT piece',
      contract: top.token?.fa_contract || '',
      tokenId: top.token?.token_id || '',
      ophash: top.ophash || ''
    } : null
  };
}

function dispatchHotSignal(detail) {
  if (typeof window === 'undefined' || typeof window.CustomEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('hot-signal', { detail }));
}

function dispatchNftHotSignals(pulse) {
  if (!pulse || !pulse.count) return;
  const top = pulse.top;
  const countLabel = `${formatCount(pulse.count)}${pulse.capped ? '+' : ''}`;
  if (pulse.count >= 50) {
    const topText = top?.priceXtz > 0 ? ` - top sale ${formatTez(top.priceXtz)} XTZ.` : '.';
    dispatchHotSignal({
      id: 'nft-market-pulse',
      category: 'nft',
      kind: 'state',
      score: 86,
      title: 'NFT pulse',
      detail: 'OBJKT indexed sales',
      text: `${countLabel} OBJKT indexed sales in 24h${topText}`,
      route: '/hen/',
      ttlMs: 4 * HOUR_MS
    });
  }

  const soldAt = top?.timestamp ? new Date(top.timestamp).getTime() : 0;
  const ageMs = Date.now() - soldAt;
  if (top?.priceXtz >= 500 && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 12 * HOUR_MS) {
    dispatchHotSignal({
      id: `nft-big-sale-${top.id}`,
      category: 'nft',
      kind: 'event',
      score: 108,
      title: 'Big NFT sale',
      detail: `${formatTez(top.priceXtz)} XTZ`,
      text: `${top.name || 'An OBJKT piece'} sold for ${formatTez(top.priceXtz)} XTZ.`,
      route: '/hen/',
      createdAt: soldAt,
      ttlMs: (12 * HOUR_MS) - ageMs
    });
  }
}

async function maybeDispatchProtocolLoreSignal() {
  if (typeof window === 'undefined' || protocolLoreSignalInFlight) return;
  const today = utcDayKey();
  const stamp = safeLocalStorageGet(LS_PROTOCOL_LORE_DAY);
  if (stamp === today || stamp === `${today}:none`) return;
  protocolLoreSignalInFlight = true;
  try {
    const response = await fetch('/data/protocol-data.json', { cache: 'force-cache' });
    if (!response.ok) return;
    const data = await response.json();
    const protocols = Array.isArray(data?.protocols) ? data.protocols : [];
    const monthDay = today.slice(5);
    const protocol = protocols.find((item) => String(item?.date || '').slice(5) === monthDay);
    if (!protocol) {
      safeLocalStorageSet(LS_PROTOCOL_LORE_DAY, `${today}:none`);
      return;
    }
    const year = Number(String(protocol.date).slice(0, 4));
    const currentYear = new Date(`${today}T00:00:00Z`).getUTCFullYear();
    const age = Number.isFinite(year) ? currentYear - year : 0;
    const ageText = age > 0 ? `${age} year${age === 1 ? '' : 's'} since ` : '';
    const endOfDay = Date.parse(`${today}T23:59:59Z`);
    dispatchHotSignal({
      id: `protocol-lore-${monthDay}`,
      category: 'network',
      kind: 'state',
      score: 58,
      title: 'Protocol lore day',
      detail: protocol.headline || 'Self-amendment history',
      text: `${ageText}${protocol.name} activated. The zero-fork streak holds.`,
      route: '/anthology/',
      expiresAt: Number.isFinite(endOfDay) ? endOfDay : Date.now() + DAY_MS
    });
    safeLocalStorageSet(LS_PROTOCOL_LORE_DAY, today);
  } catch {
    /* Local protocol lore is nice-to-have. */
  } finally {
    protocolLoreSignalInFlight = false;
  }
}

async function fetchBakerStats(address, cycle) {
  if (!address) return null;
  try {
    const url = `${API_URLS.tzkt}/rights?baker=${address}&cycle=${cycle}&limit=10000`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.length) return null;
    const attestations = data.filter(r => r.type === 'attestation');
    const total   = attestations.length;
    if (!total) return null;
    const missed  = attestations.filter(r => r.status === 'missed').length;
    const attestPct = (((total - missed) / total) * 100).toFixed(1);
    return { attestPct, missed };
  } catch { return null; }
}

// ─── Sentence Selection ───────────────────────────────────────────────────────

function buildSentences(stats, xtzPrice, baseline, whales, bakerStats, profile = getCurrentMyTezosProfile()) {
  const candidates = [];
  const addSignal = (category, score, text, options = {}) => {
    candidates.push(makeSignal(category, score + scoreBoostFor(category, profile), text, options));
  };

  // PRICE
  if (xtzPrice) {
    const prevPrice = baseline?.xtzPrice || xtzPrice;
    const livePct24h = finiteNumber(stats.priceChange24h);
    const pct24h    = livePct24h ?? signedPct(xtzPrice, prevPrice);
    const absPct24h = Math.abs(pct24h);
    const dir       = pct24h >= 0 ? 'up' : 'down';
    const score     = absPct24h > 2 ? 90 : absPct24h > 0.5 ? 60 : 30;
    const vars      = { pct: fmtPct(pct24h), dir, price: fmtPrice(xtzPrice) };
    const tmpl      = absPct24h < 0.4 ? TEMPLATES.price[2] : pick(TEMPLATES.price.filter((_,i) => i !== 2));
    addSignal('price', score, tmpl(vars), {
      detail: absPct24h >= 2 ? 'Portfolio-sized move' : 'Market temperature',
      tone: pct24h >= 0 ? 'market-up' : 'market-down',
      delta: signedDelta(pct24h, '%', 1)
    });
  }

  // STAKING
  if (stats.stakingRatio != null) {
    const prev  = baseline?.stakingRatio ?? stats.stakingRatio;
    const delta = stats.stakingRatio - prev;
    const score = Math.abs(delta) > 0.5 ? 80 : Math.abs(delta) > 0.1 ? 50 : 35;
    addSignal('staking', score, pick(TEMPLATES.staking)({ ratio: stats.stakingRatio.toFixed(1), delta }), {
      detail: Math.abs(delta) > 0.1 ? `${delta > 0 ? '+' : ''}${delta.toFixed(2)} percentage points vs baseline` : 'Staking share is steady',
      tone: delta >= 0 ? 'staking' : 'watch',
      delta: signedDelta(delta, 'pp', 2)
    });
  }

  // VOLUME
  if (stats.transactionVolume24h != null) {
    const prev  = baseline?.transactionVolume24h ?? stats.transactionVolume24h;
    const sp    = signedPct(stats.transactionVolume24h, prev);
    const narrative = activityNarrative(sp);
    const score = Math.abs(sp) > 20 ? 85 : Math.abs(sp) > 10 ? 60 : 30;
    addSignal('volume', score, pick(TEMPLATES.volume)({ vol: stats.transactionVolume24h, ...narrative }), {
      detail: narrative.isMeaningful ? 'Activity changed meaningfully' : 'Activity baseline',
      tone: narrative.tone,
      delta: signedDelta(sp, '%', 1)
    });
  }

  // CONTRACTS
  if (stats.contractCalls24h != null) {
    const prev  = baseline?.contractCalls24h ?? stats.contractCalls24h;
    const delta = stats.contractCalls24h - prev;
    const score = Math.abs(delta) > 5000 ? 70 : 40;
    addSignal('contracts', score, pick(TEMPLATES.contracts)({ count: stats.contractCalls24h, delta }), {
      detail: Math.abs(delta) > 1000 ? `${delta > 0 ? '+' : ''}${delta.toLocaleString()} calls vs baseline` : 'App usage baseline',
      tone: delta >= 0 ? 'activity' : 'quiet',
      delta: signedDelta(delta, 'count')
    });
  }

  // WHALES
  {
    const score = whales.count > 10 ? 88 : whales.count > 5 ? 70 : whales.count > 0 ? 50 : 20;
    const tmpl  = whales.count > 0 && whales.top > 0 ? pick(TEMPLATES.whales) : TEMPLATES.whales[0];
    addSignal('whales', score, tmpl({ count: whales.count, top: whales.top }), {
      detail: whales.top > 0 ? `Largest move ${whales.top.toLocaleString()} XTZ` : 'No major transfer spike',
      tone: whales.count > 10 ? 'capital-hot' : whales.count > 0 ? 'capital' : 'quiet'
    });
  }

  // GOVERNANCE
  if (hasActiveProposalLabel(stats.proposal)) {
    const pct = stats.participation != null ? stats.participation.toFixed(1) : '?';
    addSignal('governance', 75, pick(TEMPLATES.governance.slice(0, 2).concat([TEMPLATES.governance[3], TEMPLATES.governance[4]]))(
      { proposal: stats.proposal, period: stats.votingPeriod || 'current', pct, participation: pct }), {
      detail: 'Live governance period',
      tone: 'governance-hot'
    });
  } else {
    addSignal('governance', 30, TEMPLATES.governance[2]({ name: stats.lastUpgradeName || 'Ushuaia' }), {
      detail: 'No active protocol vote',
      tone: 'quiet'
    });
  }

  // ECOSYSTEM
  if (stats.fundedAccounts != null) {
    const prev  = baseline?.fundedAccounts ?? stats.fundedAccounts;
    const delta = stats.fundedAccounts - prev;
    const n     = Math.max(delta, stats.newAccounts24h || 0);
    const score = delta > 1000 ? 65 : delta > 200 ? 45 : 25;
    addSignal('ecosystem', score, pick(TEMPLATES.ecosystem)({ n, bakers: stats.totalBakers || '?' }), {
      detail: n > 200 ? 'New accounts worth noticing' : 'Onboarding baseline',
      tone: n > 200 ? 'growth' : 'quiet'
    });
  }

  // BAKER (personal)
  if (bakerStats) {
    const score = bakerStats.missed > 0 ? 95 : 55;
    const tmpl  = bakerStats.missed > 0 ? TEMPLATES.baker[1] : pick([TEMPLATES.baker[0], TEMPLATES.baker[2]]);
    addSignal('baker', score, tmpl({ pct: bakerStats.attestPct, missed: bakerStats.missed }), {
      detail: bakerStats.missed > 0 ? 'Personal baker watch item' : 'Personal baker check',
      tone: bakerStats.missed > 0 ? 'watch' : 'operator'
    });
  }

  // Sort by score, dedupe categories, pick 4–6
  candidates.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const chosen = [];
  for (const c of candidates) {
    if (!seen.has(c.category)) {
      seen.add(c.category);
      chosen.push(c);
    }
    if (chosen.length >= 6) break;
  }
  // Pad to 4 minimum
  if (chosen.length < 4) {
    for (const c of candidates) {
      if (!chosen.some(signal => signal.text === c.text)) { chosen.push(c); }
      if (chosen.length >= 4) break;
    }
  }
  return chosen;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

// Legacy standalone card rendering removed — drawer handles presentation.

// ─── Core Generate ────────────────────────────────────────────────────────────

async function generate(stats, xtzPrice) {
  const sourceStats = stats || {};
  const cycle = sourceStats.cycle ?? 0;
  const profile = getCurrentMyTezosProfile();
  const priceContext = await resolvePriceContext(sourceStats, xtzPrice);
  const nextStats = priceContext.stats;
  const currentPrice = priceContext.xtzPrice;
  const currentChange24h = priceContext.priceChange24h;

  // Return cached briefing if it's recent and data hasn't changed much
  try {
    const cached = JSON.parse(localStorage.getItem(LS_BRIEFING) || 'null');
    if (cached?.cycle === cycle && cached.generatedAt) {
      const ageMs = Date.now() - cached.generatedAt;
      const ageHrs = ageMs / 3600000;
      const priceDrift = cached.priceAt && currentPrice ? Math.abs(currentPrice - cached.priceAt) / cached.priceAt : 0;
      const cachedChange24h = finiteNumber(cached.priceChange24h);
      const changeDrift = currentChange24h != null && cachedChange24h != null
        ? Math.abs(currentChange24h - cachedChange24h)
        : 0;
      const profileChanged = cached.profileKey !== profile.key;
      const missingLiveMove = currentChange24h != null && cachedChange24h == null;
      const crossedSteadyBoundary = currentChange24h != null && cachedChange24h != null
        && (Math.abs(currentChange24h) < 0.4) !== (Math.abs(cachedChange24h) < 0.4);
      const schemaChanged = cached.schema !== BRIEFING_SCHEMA_VERSION;
      // Regenerate if: >4 hours old, price shifted >2%, or the real 24h move changed enough to affect narrative.
      const isStale = schemaChanged || ageHrs > 4 || priceDrift > 0.02 || profileChanged || missingLiveMove || changeDrift > 0.75 || crossedSteadyBoundary;
      if (!isStale) return cached;
    }
  } catch { /* ignore */ }

  const baseline = (() => { try { return JSON.parse(localStorage.getItem(LS_BASELINE) || 'null'); } catch { return null; } })();

  const [whales, bakerStats, nftPulse] = await Promise.all([
    fetchWhaleCount(),
    fetchBakerStats(localStorage.getItem('tezos-systems-my-baker-address'), cycle),
    withTimeout(fetchNftPulse(), NFT_FETCH_TIMEOUT_MS),
  ]);
  dispatchNftHotSignals(nftPulse);

  const sentences = buildSentences(nextStats, currentPrice, baseline, whales, bakerStats, profile);
  const briefing  = { schema: BRIEFING_SCHEMA_VERSION, cycle, sentences, generatedAt: Date.now(), priceAt: currentPrice, priceChange24h: currentChange24h, profileKey: profile.key };

  try {
    localStorage.setItem(LS_BRIEFING,  JSON.stringify(briefing));
    localStorage.setItem(LS_BASELINE,  JSON.stringify({ ...nextStats, xtzPrice: currentPrice }));
    appendHotHistory(sentences);
  } catch { /* storage full */ }

  return briefing;
}

// ─── Public API ───────────────────────────────────────────────────────────────

function safeCssToken(value) {
  return String(value || 'network').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'network';
}

function networkFeatureRoute(key) {
  const category = safeCssToken(key);
  const entryRoute = routeFromSiteMapEntry(siteMapEntryForCategory(category));
  return entryRoute || NETWORK_FEATURE_FALLBACK_ROUTES[category] || NETWORK_FEATURE_FALLBACK_ROUTES.network;
}

function networkFeatureLabel(key) {
  const category = safeCssToken(key);
  const entry = siteMapEntryForCategory(category);
  if (entry?.title) return `Open ${entry.title}`;
  return NETWORK_FEATURE_FALLBACK_LABELS[category] || NETWORK_FEATURE_FALLBACK_LABELS.network;
}

function routeForSignal(signal) {
  return normalizeRoute(signal?.route) || networkFeatureRoute(signal?.category);
}

function labelForSignal(signal) {
  return signal?.route ? String(signal.title || 'Open live signal') : networkFeatureLabel(signal?.category);
}

function normalizeSignal(signal, index = 0) {
  if (typeof signal === 'string') {
    return makeSignal('network', 20 - index, signal);
  }
  const category = safeCssToken(signal?.category || 'network');
  const meta = categoryMeta(category);
  const kind = normalizeSignalKind(signal?.kind || (signal?.breaking ? 'event' : 'state'));
  return {
    id: safeCssToken(signal?.id || category),
    category,
    kind,
    score: finiteNumber(signal?.score) ?? (20 - index),
    text: String(signal?.text || ''),
    title: String(signal?.title || meta.label),
    icon: String(signal?.icon || meta.icon),
    detail: String(signal?.detail || meta.detail),
    tone: safeCssToken(signal?.tone || meta.tone),
    route: normalizeRoute(signal?.route),
    delta: normalizeDelta(signal?.delta),
    breaking: signal?.breaking === true || kind === 'event',
    createdAt: finiteNumber(signal?.createdAt) || Date.now(),
    expiresAt: finiteNumber(signal?.expiresAt),
    share: signal?.share || null,
    live: signal?.live === true
  };
}

function currentUtcTick() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  });
}

function governanceAlertStripVisible() {
  const strip = typeof document !== 'undefined' ? document.getElementById('governance-alert-strip') : null;
  return Boolean(strip && !strip.hidden && strip.textContent.trim());
}

function addDailyDeltaSignals(signals, stats = {}) {
  const snapshot = dailySnapshotReference();
  const previous = snapshot?.stats;
  if (!previous) return;
  const since = snapshotSinceLabel(snapshot);
  const tz4Delta = snapshotDelta(stats, previous, 'tz4Bakers');
  const bakerDelta = snapshotDelta(stats, previous, 'totalBakers');
  const delegatorDelta = snapshotDelta(stats, previous, 'totalDelegators');
  const stakerDelta = snapshotDelta(stats, previous, 'totalStakers');
  const burnDelta = snapshotDelta(stats, previous, 'totalBurned');
  const contractDelta = snapshotDelta(stats, previous, 'smartContracts');
  const stakeApyDelta = snapshotDelta(stats, previous, 'stakeAPY');
  const lbEmaDelta = snapshotDelta(stats, previous, 'lbEmaPct');
  const lbEma = finiteNumber(stats?.lbEmaPct);
  const tz4Pct = finiteNumber(stats?.tz4Percentage);

  if (tz4Delta != null && tz4Delta >= 1) {
    signals.push(makeSignal('tz4', 108, `${formatCount(tz4Delta)} baker${Math.round(tz4Delta) === 1 ? '' : 's'} switched to tz4 consensus keys ${since} - adoption at ${tz4Pct == null ? '--' : tz4Pct.toFixed(1)}%.`, {
      id: 'daily-tz4-switches',
      kind: 'event',
      title: 'tz4 switches',
      detail: 'BLS consensus keys',
      route: '/tz4/',
      delta: signedDelta(tz4Delta, 'count'),
      live: true
    }));
  }

  if (bakerDelta != null && Math.abs(bakerDelta) >= 1) {
    const abs = Math.abs(Math.round(bakerDelta));
    signals.push(makeSignal('security', 104, bakerDelta > 0
      ? `${formatCount(abs)} new baker${abs === 1 ? '' : 's'} registered ${since}.`
      : `${formatCount(abs)} baker${abs === 1 ? '' : 's'} retired ${since}.`, {
      id: 'daily-baker-registrations',
      kind: 'event',
      title: bakerDelta > 0 ? 'Baker registrations' : 'Baker exits',
      detail: 'Active baker set',
      route: '#leaderboard',
      delta: signedDelta(bakerDelta, 'count'),
      live: true
    }));
  }

  if (delegatorDelta != null && Math.abs(delegatorDelta) >= 50) {
    const abs = Math.abs(Math.round(delegatorDelta));
    signals.push(makeSignal('staking', 86, delegatorDelta > 0
      ? `${formatCount(abs)} accounts started delegating ${since}.`
      : `${formatCount(abs)} fewer accounts are delegating ${since}.`, {
      id: 'daily-delegator-flow',
      title: 'Delegator flow',
      detail: 'Delegation movement',
      route: '#calculator',
      delta: signedDelta(delegatorDelta, 'count'),
      live: true
    }));
  }

  if (stakerDelta != null && Math.abs(stakerDelta) >= 20) {
    const abs = Math.abs(Math.round(stakerDelta));
    signals.push(makeSignal('staking', 85, stakerDelta > 0
      ? `${formatCount(abs)} new staker${abs === 1 ? '' : 's'} locked tez ${since}.`
      : `${formatCount(abs)} fewer staker${abs === 1 ? '' : 's'} are locked ${since}.`, {
      id: 'daily-staker-flow',
      title: 'Staker flow',
      detail: 'Staking movement',
      route: '#calculator',
      delta: signedDelta(stakerDelta, 'count'),
      live: true
    }));
  }

  if (burnDelta != null && burnDelta >= 5000) {
    signals.push(makeSignal('network', 84, `${formatTez(burnDelta)} XTZ burned ${since}.`, {
      id: 'daily-burn-tracker',
      title: 'Burn tracker',
      detail: 'Protocol burn flow',
      route: '#section=economy',
      delta: signedDelta(burnDelta, 'count'),
      live: true
    }));
  }

  if (contractDelta != null && contractDelta >= 5) {
    signals.push(makeSignal('contracts', 82, `${formatCount(contractDelta)} new smart contract${Math.round(contractDelta) === 1 ? '' : 's'} deployed ${since}.`, {
      id: 'daily-contract-deployments',
      title: 'Contract deployments',
      detail: 'App surface growth',
      route: '#section=ecosystem',
      delta: signedDelta(contractDelta, 'count'),
      live: true
    }));
  }

  const stakeApy = finiteNumber(stats?.stakeAPY);
  if (stakeApy != null && stakeApyDelta != null && Math.abs(stakeApyDelta) >= 0.1) {
    signals.push(makeSignal('staking', 80, `Staking APY moved to ${stakeApy.toFixed(2)}% (${stakeApyDelta >= 0 ? '+' : ''}${stakeApyDelta.toFixed(2)}pp ${since}).`, {
      id: 'daily-staking-apy-shift',
      title: 'APY shift',
      detail: 'Reward estimate',
      route: '#calculator',
      delta: signedDelta(stakeApyDelta, 'pp', 2),
      live: true
    }));
  }

  if (typeof stats?.lbSubsidyDisabled === 'boolean' && typeof previous.lbSubsidyDisabled === 'boolean' && stats.lbSubsidyDisabled !== previous.lbSubsidyDisabled) {
    signals.push(makeSignal('lb', 122, `Liquidity Baking subsidy just switched ${stats.lbSubsidyDisabled ? 'OFF' : 'ON'} - EMA crossed the threshold.`, {
      id: 'daily-lb-subsidy-flip',
      kind: 'event',
      title: 'LB subsidy flip',
      detail: stats.lbSubsidyDisabled ? 'Subsidy disabled' : 'Subsidy active',
      route: '/lb/',
      live: true
    }));
  }

  if (lbEma != null && lbEmaDelta != null && Math.abs(lbEmaDelta) >= 1) {
    signals.push(makeSignal('lb', 78, `LB toggle EMA at ${lbEma.toFixed(1)}% (${lbEmaDelta >= 0 ? '+' : ''}${lbEmaDelta.toFixed(1)}pp ${since}) - subsidy ${stats?.lbSubsidyDisabled ? 'off' : 'active'}.`, {
      id: 'daily-lb-ema-drift',
      title: 'LB EMA drift',
      detail: 'Toggle vote pressure',
      route: '/lb/',
      delta: signedDelta(lbEmaDelta, 'pp', 1),
      live: true
    }));
  }

  const cycleProgress = finiteNumber(stats?.cycleProgress);
  if (cycleProgress != null && cycleProgress >= 95) {
    const cycle = finiteNumber(stats?.cycle);
    const runway = String(stats?.cycleTimeRemaining || '').trim() || 'rewards settle at the boundary';
    signals.push(makeSignal('cycle', 96, `Cycle ${cycle ? formatCount(cycle) : 'current'} wraps soon - ${runway}.`, {
      id: `cycle-boundary-${cycle || 'current'}`,
      kind: 'event',
      title: 'Cycle boundary',
      detail: `${cycleProgress.toFixed(1)}% complete`,
      route: '#health',
      live: true
    }));
  }
}

function buildLiveHotSignals(stats = lastStats || {}) {
  const priceChange = finiteNumber(stats?.priceChange24h);
  const newAccounts = finiteNumber(stats?.newAccounts24h);
  const fundedAccounts = finiteNumber(stats?.fundedAccounts);
  const signals = [];

  addDailyDeltaSignals(signals, stats);

  if (hasActiveProposalLabel(stats?.proposal) && !governanceAlertStripVisible()) {
    signals.push(makeSignal('governance', 118, `"${stats.proposal}" is in ${stats.votingPeriod || 'the active'} period.`, {
      id: 'live-governance',
      title: 'Governance',
      detail: stats.participation != null ? `${Number(stats.participation).toFixed(1)}% participation` : 'Protocol decision lane',
      tone: 'governance-hot',
      live: true
    }));
  }

  if (stats?.contractCalls24h != null) {
    signals.push(makeSignal('contracts', 106, `${Number(stats.contractCalls24h).toLocaleString('en-US')} contract calls in the last 24h.`, {
      id: 'live-contracts',
      title: 'Contract calls',
      detail: 'App and DeFi pulse',
      tone: 'activity',
      live: true
    }));
  }

  if (stats?.transactionVolume24h != null) {
    signals.push(makeSignal('volume', 102, `${Number(stats.transactionVolume24h).toLocaleString('en-US')} transactions moved through Tezos in the last 24h.`, {
      id: 'live-volume',
      title: 'Chain activity',
      detail: 'Transaction flow',
      tone: 'activity',
      live: true
    }));
  }

  if (newAccounts != null && newAccounts > 0) {
    signals.push(makeSignal('ecosystem', 98, `${Math.round(newAccounts).toLocaleString('en-US')} new funded accounts appeared in the current read.`, {
      id: 'live-accounts',
      title: 'Fresh accounts',
      detail: 'Onboarding signal',
      tone: newAccounts > 200 ? 'growth' : 'quiet',
      live: true
    }));
  } else if (fundedAccounts != null && fundedAccounts > 0) {
    signals.push(makeSignal('ecosystem', 92, `${Math.round(fundedAccounts).toLocaleString('en-US')} funded accounts are visible on-chain.`, {
      id: 'live-accounts',
      title: 'Funded accounts',
      detail: 'Network reach',
      tone: 'growth',
      live: true
    }));
  }

  if (lastXtzPrice && lastXtzPrice > 0 && priceChange != null && Math.abs(priceChange) >= 1) {
    signals.push(makeSignal('price', 94, `XTZ moved ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(1)}% over 24h.`, {
      id: 'live-market',
      detail: `Trading around $${fmtPrice(lastXtzPrice)}`,
      tone: priceChange >= 0 ? 'market-up' : 'market-down',
      delta: signedDelta(priceChange, '%', 1),
      live: true
    }));
  }
  return signals.filter(signal => signal.text);
}

function pruneExpiredHotSignals(now = Date.now()) {
  let pruned = false;
  hotSignalPool.forEach((signal, id) => {
    if (signal.expiresAt && signal.expiresAt <= now) {
      hotSignalPool.delete(id);
      pruned = true;
    }
  });
  return pruned;
}

function hotPoolSignals() {
  pruneExpiredHotSignals();
  return Array.from(hotSignalPool.values())
    .map(normalizeSignal)
    .filter(signal => signal.text);
}

function receiveHotSignal(event) {
  const detail = event?.detail;
  if (!detail || typeof detail !== 'object') return;
  const ttlMs = finiteNumber(detail.ttlMs);
  const createdAt = finiteNumber(detail.createdAt) || Date.now();
  const signal = normalizeSignal({
    ...detail,
    createdAt,
    expiresAt: ttlMs && ttlMs > 0 ? createdAt + ttlMs : finiteNumber(detail.expiresAt),
    kind: detail.kind || (detail.breaking ? 'event' : 'state'),
    breaking: detail.breaking === true,
    live: detail.live !== false
  });
  if (!signal.text) return;
  hotSignalPool.set(signal.id || `${signal.category}-${createdAt}`, signal);
  const timeoutMs = signal.expiresAt ? signal.expiresAt - Date.now() : ttlMs;
  if (timeoutMs && timeoutMs > 0) {
    window.setTimeout(() => {
      if (pruneExpiredHotSignals()) scheduleHotSignalRender();
    }, timeoutMs + 50);
  }
  scheduleHotSignalRender();
}

function scheduleHotSignalRender() {
  if (typeof window === 'undefined') return;
  if (hotSignalRenderTimer) return;
  const elapsed = Date.now() - lastHotSignalRenderAt;
  const wait = Math.max(0, HOT_SIGNAL_RENDER_THROTTLE_MS - elapsed);
  hotSignalRenderTimer = window.setTimeout(() => {
    hotSignalRenderTimer = null;
    lastHotSignalRenderAt = Date.now();
    if (lastStats?.cycle) {
      renderToHotIsland(lastStats.cycle, hotTodayBriefingSentences, lastStats);
    }
  }, wait);
}

function wireHotSignalListeners() {
  if (typeof window === 'undefined' || hotSignalListenerWired) return;
  hotSignalListenerWired = true;
  window.addEventListener('hot-signal', receiveHotSignal);
  window.addEventListener('governance-alert-state', () => scheduleHotSignalRender());
}

wireHotSignalListeners();

function effectiveHotScore(signal, now = Date.now()) {
  const score = finiteNumber(signal?.score) || 0;
  if (signal?.kind !== 'event') return score;
  const ageHours = Math.max(0, (now - (finiteNumber(signal.createdAt) || now)) / HOUR_MS);
  return score - (ageHours * HOT_SIGNAL_EVENT_DECAY_PER_HOUR);
}

function mergeHotSignals(liveSignals, poolSignals, briefingSignals) {
  const merged = [];
  const seenEvents = new Set();
  const seenStateCategories = new Set();
  const categoryCounts = new Map();
  const now = Date.now();
  const sorted = [...liveSignals, ...poolSignals, ...briefingSignals]
    .map(normalizeSignal)
    .filter(signal => signal.text)
    .sort((a, b) => {
      const scoreDiff = effectiveHotScore(b, now) - effectiveHotScore(a, now);
      if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
      if (a.kind !== b.kind) return a.kind === 'event' ? -1 : 1;
      return (finiteNumber(b.createdAt) || 0) - (finiteNumber(a.createdAt) || 0);
    });
  for (const signal of sorted) {
    const category = signal.category || 'network';
    const currentCount = categoryCounts.get(category) || 0;
    if (currentCount >= HOT_SIGNAL_CATEGORY_BUDGET) continue;
    if (signal.kind === 'event') {
      const eventKey = signal.id || `${category}-${signal.title}-${signal.createdAt}`;
      if (seenEvents.has(eventKey)) continue;
      seenEvents.add(eventKey);
    } else {
      if (seenStateCategories.has(category)) continue;
      seenStateCategories.add(category);
    }
    categoryCounts.set(category, currentCount + 1);
    merged.push(signal);
  }
  return merged;
}

function isHeaderDuplicateSignal(signal) {
  if (!signal) return true;
  if (signal.category === 'cycle' || signal.category === 'security' || signal.category === 'network') return true;
  if (signal.category === 'staking') return true;
  if (signal.category === 'ecosystem' && /\bactive bakers?\b/i.test(signal.text)) return true;
  return false;
}

function setHotTodayLiveText(key, value) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll(`[data-hot-live="${key}"]`).forEach((element) => {
    const text = String(value || '--');
    if (element.textContent !== text) element.textContent = text;
  });
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function refreshHotTodayLiveMetrics() {
  const island = document.getElementById('hot-today-island');
  if (!island || island.hidden) return;
  setHotTodayLiveText('clock', `${currentUtcTick()} UTC`);
}

function getBriefingLead(profile, signals) {
  const top = signals[0];
  if (!top) return 'A compact read on the network signals most likely to matter today.';
  if (profile.isBaker) return `Your baker lane leads today: ${top.detail.toLowerCase()}.`;
  if (profile.interestKeys?.has('creator') || profile.interestKeys?.has('collector')) {
    return `Your collector and creator lens is active; contract, account, and market pulses get extra weight.`;
  }
  if (profile.interestKeys?.has('governance')) {
    return `Governance-aware context is active, with protocol decisions weighted ahead of routine noise.`;
  }
  if (profile.interestKeys?.has('portfolio')) {
    return `Portfolio-aware context is active, so price, staking, and capital movement get priority.`;
  }
  return 'A compact read on the network signals most likely to matter today.';
}

function renderFocusChips(profile) {
  return profile.interests.slice(0, 5).map(item => {
    const key = safeCssToken(item.key);
    const route = networkFeatureRoute(key);
    const label = networkFeatureLabel(key);
    return `<a class="network-focus-chip" href="${escapeHtml(route)}" data-focus="${escapeHtml(key)}" data-network-route="${escapeHtml(route)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${escapeHtml(item.label)}</a>`;
  }).join('');
}

function renderDeltaChip(delta, className) {
  if (!delta) return '';
  const arrow = delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : '→';
  return `<span class="${className} ${className}-${escapeHtml(delta.dir)}"><span aria-hidden="true">${arrow}</span>${escapeHtml(delta.value)}</span>`;
}

function renderSignalCard(signal, index) {
  const label = `${signal.icon} ${signal.title}`;
  const route = routeForSignal(signal);
  const routeLabel = labelForSignal(signal);
  return `
    <a class="network-signal network-signal-${signal.tone}" href="${escapeHtml(route)}" data-category="${escapeHtml(signal.category)}" data-network-route="${escapeHtml(route)}" aria-label="${escapeHtml(`${routeLabel}: ${signal.detail}`)}">
      <div class="network-signal-rank">${index + 1}</div>
      <div class="network-signal-main">
        <div class="network-signal-head">
          <span class="network-signal-label">${escapeHtml(label)}</span>
          <span class="network-signal-detail">${escapeHtml(signal.detail)}${renderDeltaChip(signal.delta, 'network-signal-delta')}</span>
        </div>
        <p>${escapeHtml(signal.text)}</p>
      </div>
    </a>
  `;
}

function renderHotSignal(signal, index) {
  const route = routeForSignal(signal);
  const routeLabel = labelForSignal(signal);
  const activeIndex = hotTodaySignals.length ? hotTodayActiveIndex % hotTodaySignals.length : 0;
  const activeClass = index === activeIndex ? ' is-hot-active' : '';
  const breakingClass = signal.breaking ? ' is-hot-breaking' : '';
  return `
    <a class="hot-today-card hot-today-card-${signal.tone}${activeClass}${breakingClass}" href="${escapeHtml(route)}" data-hot-signal-index="${index}" data-network-route="${escapeHtml(route)}" aria-label="${escapeHtml(`${routeLabel}: ${signal.detail}`)}">
      <span class="hot-today-rank">${escapeHtml(signal.icon)}</span>
      <span class="hot-today-copy">
        <strong>${escapeHtml(signal.title)}</strong>
        <span>${escapeHtml(signal.text)}</span>
      </span>
      <em><span>${escapeHtml(signal.detail)}</span>${renderDeltaChip(signal.delta, 'hot-today-delta')}</em>
    </a>
  `;
}

function applyHotTodayActive(index = hotTodayActiveIndex, { scroll = true } = {}) {
  if (!hotTodaySignals.length) return;
  const nextIndex = ((index % hotTodaySignals.length) + hotTodaySignals.length) % hotTodaySignals.length;
  hotTodayActiveIndex = nextIndex;
  let activeCard = null;
  document.querySelectorAll('#hot-today-island [data-hot-signal-index]').forEach((card) => {
    const isActive = Number(card.dataset.hotSignalIndex) === nextIndex;
    card.classList.toggle('is-hot-active', isActive);
    if (isActive) activeCard = card;
  });
  if (scroll && activeCard) {
    const strip = activeCard.closest('.hot-today-strip');
    const rect = strip?.getBoundingClientRect();
    const visibleHeight = rect ? Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)) : 0;
    const stripIsVisible = rect && visibleHeight >= Math.min(rect.height || 0, 80) * 0.75;
    if (strip && stripIsVisible) {
      const targetLeft = activeCard.offsetLeft - ((strip.clientWidth - activeCard.clientWidth) / 2);
      strip.scrollTo({ left: Math.max(0, targetLeft), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }
  refreshHotTodayLiveMetrics();
}

function advanceHotTodayLead() {
  if (!hotTodaySignals.length) return;
  applyHotTodayActive(hotTodayActiveIndex + 1);
}

function pulseHotTodayIsland() {
  if (prefersReducedMotion()) return;
  const island = document.getElementById('hot-today-island');
  if (!island) return;
  island.classList.remove('is-live-pulsing');
  void island.offsetWidth;
  island.classList.add('is-live-pulsing');
  if (hotTodayPulseTimer) window.clearTimeout(hotTodayPulseTimer);
  hotTodayPulseTimer = window.setTimeout(() => {
    island.classList.remove('is-live-pulsing');
    hotTodayPulseTimer = null;
  }, 680);
}

function wireHotTodayRealtime() {
  if (typeof window === 'undefined') return;
  wireHotSignalListeners();
  if (!hotTodayRealtimeWired) {
    hotTodayRealtimeWired = true;
    window.addEventListener('block-pulse', () => {
      refreshHotTodayLiveMetrics();
      pulseHotTodayIsland();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshHotTodayLiveMetrics();
    });
  }
  if (!hotTodayLiveTimer) {
    hotTodayLiveTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refreshHotTodayLiveMetrics();
    }, HOT_TODAY_LIVE_TICK_MS);
  }
  if (!hotTodayRotateTimer) {
    hotTodayRotateTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (prefersReducedMotion() || hotTodayRotationPaused) return;
      if (pruneExpiredHotSignals()) {
        scheduleHotSignalRender();
        return;
      }
      advanceHotTodayLead();
    }, HOT_TODAY_ROTATE_MS);
  }
}

function wireHotTodayStripPauses(island) {
  const strip = island?.querySelector('.hot-today-strip');
  if (!strip) return;
  strip.addEventListener('pointerenter', () => { hotTodayRotationPaused = true; });
  strip.addEventListener('pointerleave', () => { hotTodayRotationPaused = false; });
  strip.addEventListener('focusin', () => { hotTodayRotationPaused = true; });
  strip.addEventListener('focusout', () => { hotTodayRotationPaused = strip.contains(document.activeElement); });
}

function renderToHotIsland(cycle, sentences, stats = lastStats || {}) {
  const island = document.getElementById('hot-today-island');
  if (!island) return;
  hotTodayBriefingSentences = Array.isArray(sentences) ? sentences : [];
  const briefingSignals = (Array.isArray(sentences) ? sentences : [])
    .map(normalizeSignal)
    .filter(signal => signal.text);
  const stripHasGovernance = governanceAlertStripVisible();
  const nonRedundantBriefing = briefingSignals
    .filter(signal => !isHeaderDuplicateSignal(signal))
    .filter(signal => !(stripHasGovernance && signal.category === 'governance'));
  const fallbackBriefing = briefingSignals
    .filter(signal => !['cycle', 'security', 'network', 'staking'].includes(signal.category))
    .filter(signal => !(stripHasGovernance && signal.category === 'governance'));
  const signals = mergeHotSignals(buildLiveHotSignals(stats), hotPoolSignals(), [...nonRedundantBriefing, ...fallbackBriefing])
    .slice(0, HOT_SIGNAL_RENDER_CAP);
  if (!signals.length) {
    captureDailySnapshot(stats);
    return;
  }
  hotTodaySignals = signals;
  hotTodayActiveIndex %= hotTodaySignals.length;
  const history = hotHistorySummary(signals[0]);
  const memoryChip = history?.chip
    ? `<span class="hot-today-memory-chip">${escapeHtml(history.chip)}</span>`
    : '';
  const earlierRow = history?.earlier?.length
    ? `<div class="hot-today-earlier"><span>Earlier today</span>${history.earlier.map(label => `<b>${escapeHtml(label)}</b>`).join('')}</div>`
    : '';
  island.hidden = false;
  island.setAttribute('aria-live', hotTodayHasRendered ? 'off' : 'polite');
  island.innerHTML = `
    <div class="hot-today-head">
      <div>
        <div class="hot-today-titleline">
          <span class="feature-kicker">Live pulse</span>
        </div>
        <h2>What's hot today</h2>
      </div>
      <div class="hot-today-head-meta">
        ${memoryChip}
        <a class="hot-today-clock" href="#health" data-network-route="#health"><span class="hot-today-clock-dot" aria-hidden="true"></span><span data-hot-live="clock">${escapeHtml(currentUtcTick())} UTC</span></a>
      </div>
    </div>
    <div class="hot-today-strip" aria-label="Scrollable live pulse">
      ${signals.map(renderHotSignal).join('')}
    </div>
    ${earlierRow}
  `;
  hotTodayHasRendered = true;
  wireHotTodayStripPauses(island);
  wireNetworkContextNavigation(island);
  wireHotTodayRealtime();
  refreshHotTodayLiveMetrics();
  applyHotTodayActive(hotTodayActiveIndex, { scroll: false });
  window.dispatchEvent(new CustomEvent('hot-signal-rendered', {
    detail: { top: getTopHotSignal(), count: hotTodaySignals.length }
  }));
  captureDailySnapshot(stats);
}

function rerenderCachedBriefing() {
  try {
    const cached = JSON.parse(localStorage.getItem(LS_BRIEFING) || 'null');
    if (cached?.cycle && cached?.sentences) renderToDrawer(cached.cycle, cached.sentences);
  } catch { /* ignore */ }
}

function wirePersonalizationRefresh() {
  if (personalizationWired || typeof window === 'undefined') return;
  personalizationWired = true;
  window.addEventListener('my-tezos-data-ready', () => {
    if (lastStats?.cycle) {
      updateDailyBriefing(lastStats, lastXtzPrice).catch(() => rerenderCachedBriefing());
    } else {
      rerenderCachedBriefing();
    }
  });
}

function closeDrawerForNetworkRoute(route) {
  if (route === '#my-baker') return;
  document.getElementById('my-tezos-drawer')?.classList.remove('open');
  document.getElementById('my-tezos-drawer-scrim')?.classList.remove('open');
  document.body.style.overflow = '';
}

function scrollDrawerToBakerStats() {
  const target = document.getElementById('drawer-baker') || document.getElementById('drawer-operator-status');
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function wireNetworkContextNavigation(container) {
  if (!container || container.dataset.networkNavigationWired === 'true') return;
  container.dataset.networkNavigationWired = 'true';
  container.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('[data-network-route]');
    if (!link || !container.contains(link)) return;
    const route = link.getAttribute('data-network-route') || '';
    if (!route) return;

    event.preventDefault();
    closeDrawerForNetworkRoute(route);

    if (!route.startsWith('#')) {
      window.location.assign(route);
      return;
    }

    if (window.location.hash === route) {
      window.dispatchEvent(new Event('hashchange'));
    } else {
      window.location.hash = route;
    }

    if (route === '#my-baker') {
      setTimeout(scrollDrawerToBakerStats, 120);
    }
  });
}

function renderToDrawer(cycle, sentences) {
  const container = document.getElementById('drawer-network');
  if (!container) return;
  const profile = getCurrentMyTezosProfile();
  const signals = (Array.isArray(sentences) ? sentences : [])
    .map(normalizeSignal)
    .filter(signal => signal.text)
    .slice(0, 6);
  const lead = getBriefingLead(profile, signals);
  container.innerHTML = `
    <section class="network-context-panel">
      <div class="network-context-header">
        <a class="network-context-title" href="#health" data-network-route="#health" aria-label="Open Network Health" style="color:inherit;">🌐 Network Context</a>
        <a class="network-context-cycle" href="#history" data-network-route="#history" aria-label="${escapeHtml(`Open protocol history for cycle ${cycle}`)}">Cycle ${escapeHtml(String(cycle))}</a>
      </div>
      <p class="network-context-lede" data-magic-text>${escapeHtml(lead)}</p>
      <div class="network-context-focus" aria-label="Context focus">
        ${renderFocusChips(profile)}
      </div>
      <div class="network-context-signals">
        ${signals.map(renderSignalCard).join('')}
      </div>
    </section>
  `;
  wireNetworkContextNavigation(container);
}

export async function initDailyBriefing(stats, xtzPrice) {
  wirePersonalizationRefresh();
  if (!stats?.cycle) return;
  lastStats = stats;
  lastXtzPrice = xtzPrice;
  const briefing = await generate(stats, xtzPrice);
  renderToDrawer(briefing.cycle, briefing.sentences);
  try { localStorage.setItem(LS_LAST_SEEN, String(briefing.cycle)); } catch {}
}

export async function updateDailyBriefing(stats, xtzPrice) {
  wirePersonalizationRefresh();
  if (!stats?.cycle) return;
  lastStats = stats;
  lastXtzPrice = xtzPrice;
  const briefing = await generate(stats, xtzPrice);
  renderToDrawer(briefing.cycle, briefing.sentences);
  try { localStorage.setItem(LS_LAST_SEEN, String(briefing.cycle)); } catch {}
}

export async function initHotTodayIsland(stats, xtzPrice) {
  if (hotTodayWired) return;
  hotTodayWired = true;
  lastStats = stats || lastStats;
  lastXtzPrice = xtzPrice ?? lastXtzPrice;
  const island = document.getElementById('hot-today-island');
  if (!island) return;
  island.innerHTML = `
    <div class="hot-today-head">
      <div>
        <div class="hot-today-titleline">
          <span class="feature-kicker">Live pulse</span>
        </div>
        <h2>What's hot today</h2>
      </div>
      <span>Syncing</span>
    </div>
    <div class="hot-today-grid hot-today-grid-loading">
      <span></span><span></span><span></span><span></span>
    </div>
  `;
  wireNetworkContextNavigation(island);
  wireHotTodayRealtime();
  maybeDispatchProtocolLoreSignal();
  if (stats?.cycle) await updateHotTodayIsland(stats, xtzPrice);
}

export async function updateHotTodayIsland(stats, xtzPrice) {
  if (!stats?.cycle) return;
  lastStats = stats;
  lastXtzPrice = xtzPrice;
  maybeDispatchProtocolLoreSignal();
  const briefing = await generate(stats, xtzPrice);
  renderToHotIsland(briefing.cycle, briefing.sentences, stats);
}

export function getTopHotSignal() {
  const signal = hotTodaySignals[0];
  if (!signal) return null;
  return {
    ...signal,
    route: routeForSignal(signal),
    routeLabel: labelForSignal(signal)
  };
}

export function activateHotTodaySignal(categoryOrIndex) {
  if (!hotTodaySignals.length) return false;
  const raw = String(categoryOrIndex || '').trim();
  const index = /^\d+$/.test(raw)
    ? Number(raw)
    : hotTodaySignals.findIndex(signal => signal.category === safeCssToken(raw) || signal.id === safeCssToken(raw));
  if (index < 0) return false;
  applyHotTodayActive(index, { scroll: true });
  return true;
}
