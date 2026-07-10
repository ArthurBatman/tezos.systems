/**
 * Tezos Maxis Chamber
 * Protocol seasons, address passports, immutable champions, and the legacy Crown Hall.
 */

import { escapeHtml } from '../core/utils.js';

const LEGACY_DATA_URL = '/data/maxis-leaders.json';
const MANIFEST_URL = '/data/maxis/manifest.json';
const MAXIS_CSS_URL = '/css/maxis.css?v=405';
const MAXIS_SHARE_URL = 'https://tezos.systems/maxis/';
const MY_TEZOS_ADDRESS_KEY = 'tezos-systems-my-baker-address';
const SHARE_STORAGE_KEY = 'tezos-systems-maxis-shares-v1';
const VIEW_KEYS = ['season', 'passport', 'crown', 'champions'];
const CATEGORY_ORDER = [
    'unicorn',
    'staking',
    'delegation',
    'governance',
    'collector',
    'artist',
    'minter',
    'defi',
    'liquidity',
    'bridge',
    'builder',
    'transaction',
    'gaming'
];
const CATEGORY_ALIASES = {
    art: 'artist',
    artists: 'artist',
    mint: 'minter',
    minting: 'minter',
    transactions: 'transaction',
    governance_maxi: 'governance',
    collector_maxi: 'collector',
    unicorn_maxi: 'unicorn'
};
const CATEGORY_ICONS = {
    transaction: '↻',
    collector: '◈',
    artist: '✦',
    minter: '◆',
    defi: '⇄',
    gaming: '▲',
    governance: '✓',
    staking: '⬡',
    delegation: '⌁',
    liquidity: '≈',
    bridge: '↔',
    builder: '⌘',
    unicorn: '✺'
};
const CATEGORY_LABELS = {
    transaction: 'Transactions',
    collector: 'Collector',
    artist: 'Art',
    minter: 'Mint',
    defi: 'DeFi',
    gaming: 'Gaming',
    governance: 'Governance',
    staking: 'Staking',
    delegation: 'Delegation',
    liquidity: 'Liquidity',
    bridge: 'Bridge',
    builder: 'Builder',
    unicorn: 'Unicorn'
};
const VIEW_META = {
    season: { icon: '◉', label: 'Season' },
    passport: { icon: '✺', label: 'Passport' },
    crown: { icon: '♛', label: 'Crown Hall' },
    champions: { icon: '◇', label: 'Champions' }
};

let legacyPromise = null;
let manifestPromise = null;
let lastLegacy = null;
let lastManifest = null;
const summaryCache = new Map();
const shardCache = new Map();
let savedBodyOverflow = null;
let savedHtmlOverflow = null;
let focusedBeforeOpen = null;
let initComplete = false;
let requestSerial = 0;
let archiveRequestSerial = 0;

const chamberState = {
    view: 'season',
    seasonId: null,
    lane: null,
    laneByView: { season: null, crown: null },
    legacy: null,
    manifest: null,
    summary: null,
    summaryLoading: false,
    selectorOpen: false,
    selectorFocusReturn: false,
    selectorWasOpenAtPointerDown: false,
    lastSelectorPointerType: '',
    rowDetail: null,
    passportAddress: '',
    passportInput: '',
    passportUsesSaved: false,
    passportProfile: null,
    passportLoading: false,
    passportError: '',
    passportNote: '',
    archives: null,
    archivesLoading: false
};

function ensureMaxisStyles() {
    if (document.getElementById('maxis-css')) return;
    const link = document.createElement('link');
    link.id = 'maxis-css';
    link.rel = 'stylesheet';
    link.href = MAXIS_CSS_URL;
    document.head.appendChild(link);
}

function validDate(value) {
    const date = new Date(value || '');
    return Number.isFinite(date.getTime()) ? date : null;
}

function freshness(data) {
    const generatedAt = validDate(data?.generatedAt || data?.updatedAt || data?.asOf);
    const staleAfterMs = Number(data?.staleAfterHours || 48) * 60 * 60 * 1000;
    const stale = !generatedAt || Date.now() - generatedAt.getTime() > staleAfterMs;
    const label = generatedAt
        ? generatedAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : 'time unknown';
    return { stale, label, generatedAt };
}

function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return [];
    return [value];
}

function textValue(...values) {
    const value = values.find((candidate) => candidate !== undefined && candidate !== null && String(candidate).trim() !== '');
    return value === undefined ? '' : String(value);
}

function numberValue(...values) {
    const value = values.find((candidate) => candidate !== null && candidate !== undefined && String(candidate).trim() !== '' && Number.isFinite(Number(candidate)));
    return value === undefined ? null : Number(value);
}

function canonicalCategory(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return CATEGORY_ALIASES[normalized] || normalized.replace(/_maxi$/, '');
}

function categoryLabel(category) {
    const key = canonicalCategory(category);
    return CATEGORY_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Maxi';
}

function shortAddress(address) {
    const value = String(address || '');
    return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function leaderName(leader) {
    return textValue(leader?.alias, leader?.name, leader?.displayName, shortAddress(leader?.address), 'No qualifier');
}

function windowLabel(kind) {
    const labels = {
        'rolling-30d': '30d',
        'rolling-90d': '90d',
        'all-time': 'all time',
        'all-time-active': 'all time · active',
        'protocol-season': 'protocol season',
        protocol: 'protocol season',
        season: 'protocol season',
        live: 'live',
        mixed: 'cross-lane'
    };
    return labels[String(kind || '').toLowerCase()] || textValue(kind, 'season snapshot');
}

function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : textValue(value, '—');
}

function formatMetricAmount(value, unit) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return textValue(value, '—');
    if (String(unit).toLowerCase() === 'mutez') {
        return `${(amount / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} ꜩ`;
    }
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: 12 })} ${textValue(unit, 'activity')}`;
}

function scoreLabel(entry) {
    if (!entry) return 'No score recorded';
    if (typeof entry.score === 'object') {
        return textValue(entry.scoreLabel, entry.displayScore, entry.score.label, entry.score.display, entry.metricLabel, entry.valueLabel, entry.score.value);
    }
    return textValue(entry.scoreLabel, entry.displayScore, entry.metricLabel, entry.valueLabel, Number.isFinite(Number(entry.score)) ? formatNumber(entry.score) : entry.score, 'Qualified');
}

function safeLocalStorageGet(key) {
    try {
        return localStorage.getItem(key) || '';
    } catch {
        return '';
    }
}

function readShareLedger() {
    try {
        const parsed = JSON.parse(localStorage.getItem(SHARE_STORAGE_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function recordRankShare(entry, category) {
    const address = String(entry?.address || '');
    if (!address) return;
    const ledger = readShareLedger();
    const addressKey = address.toLowerCase();
    const previous = ledger[addressKey] && typeof ledger[addressKey] === 'object' ? ledger[addressKey] : {};
    const count = Number(previous.count || 0) + 1;
    ledger[addressKey] = {
        count,
        lastSharedAt: new Date().toISOString(),
        lane: canonicalCategory(category),
        seasonId: chamberState.seasonId || 'crown-hall'
    };
    try {
        localStorage.setItem(SHARE_STORAGE_KEY, JSON.stringify(ledger));
    } catch {
        // A blocked storage write must never block the outbound share action.
    }
    window.dispatchEvent(new CustomEvent('maxis-rank-shared', {
        detail: { address, count, lane: canonicalCategory(category), seasonId: chamberState.seasonId }
    }));
}

async function fetchJson(url, { force = false, quiet = false } = {}) {
    try {
        const response = await fetch(url, {
            cache: force ? 'reload' : 'no-store',
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        if (quiet) {
            console.debug('Optional Maxis data unavailable', url, error);
            return null;
        }
        throw error;
    }
}

async function sha256Text(value) {
    if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
        throw new Error('This browser cannot verify Passport integrity because Web Crypto is unavailable.');
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyPassportShardText(raw, expectedHash, shard) {
    if (!expectedHash) return;
    const actualHash = await sha256Text(raw);
    if (actualHash.toLowerCase() !== String(expectedHash).toLowerCase()) {
        throw new Error(`Passport shard ${shard} failed its SHA-256 integrity receipt. Retry after the season artifacts finish publishing.`);
    }
}

async function loadLegacy({ force = false } = {}) {
    if (lastLegacy && !force) return lastLegacy;
    if (legacyPromise && !force) return legacyPromise;
    legacyPromise = fetchJson(LEGACY_DATA_URL, { force })
        .then((snapshot) => {
            if (!Array.isArray(snapshot?.leaders)) throw new Error('The Maxis Crown Hall snapshot has an unsupported schema.');
            lastLegacy = snapshot;
            chamberState.legacy = snapshot;
            updateEntryCard(snapshot, chamberState.manifest, chamberState.summary);
            return snapshot;
        })
        .finally(() => { legacyPromise = null; });
    return legacyPromise;
}

async function loadManifest({ force = false } = {}) {
    if (lastManifest && !force) return lastManifest;
    if (manifestPromise && !force) return manifestPromise;
    manifestPromise = fetchJson(MANIFEST_URL, { force, quiet: true })
        .then((manifest) => {
            if (!manifest || typeof manifest !== 'object') return null;
            if (lastManifest?.generatedAt && manifest.generatedAt && lastManifest.generatedAt !== manifest.generatedAt) {
                archiveRequestSerial += 1;
                summaryCache.clear();
                shardCache.clear();
                chamberState.archives = null;
                chamberState.archivesLoading = false;
            }
            lastManifest = manifest;
            chamberState.manifest = manifest;
            return manifest;
        })
        .finally(() => { manifestPromise = null; });
    return manifestPromise;
}

function resolveDataUrl(value, base = MANIFEST_URL) {
    if (!value) return '';
    try {
        return new URL(String(value), new URL(base, window.location.origin)).href;
    } catch {
        return String(value);
    }
}

function seasonIdFrom(raw, fallback = '') {
    if (typeof raw === 'string' || typeof raw === 'number') return String(raw);
    return textValue(raw?.id, raw?.seasonId, raw?.slug, raw?.key, raw?.protocolHash, raw?.protocol?.hash, fallback);
}

function currentSeasonId(manifest) {
    return textValue(
        manifest?.currentSeasonId,
        manifest?.activeSeasonId,
        seasonIdFrom(manifest?.currentSeason),
        seasonIdFrom(manifest?.current),
        manifest?.summary?.season?.id,
        manifest?.summary?.seasonId
    );
}

function normalizeSeason(raw, index, manifest) {
    const currentId = currentSeasonId(manifest);
    const id = seasonIdFrom(raw, `season-${index + 1}`);
    const protocolObject = raw?.protocol && typeof raw.protocol === 'object' ? raw.protocol : null;
    const protocol = textValue(protocolObject?.name, raw?.protocolName, typeof raw?.protocol === 'string' ? raw.protocol : '', raw?.name, raw?.title, 'Protocol season');
    const number = textValue(raw?.number, raw?.seasonNumber, raw?.seasonOrdinal, raw?.index, index + 1);
    const status = textValue(raw?.status, id === currentId ? 'active' : '', raw?.finalized ? 'final' : '', 'archive').toLowerCase();
    const summaryCandidate = raw?.summaryUrl || raw?.summaryPath || raw?.archiveUrl || raw?.url || raw?.path || (typeof raw?.summary === 'string' ? raw.summary : '');
    return {
        ...raw,
        id,
        protocol,
        displayLabel: textValue(raw?.displayLabel, raw?.seasonLabel, raw?.title, `${protocol} Season`),
        number,
        status,
        summaryUrl: resolveDataUrl(summaryCandidate),
        startsAt: textValue(raw?.startsAt, raw?.startAt, raw?.activatedAt, raw?.activationDate, protocolObject?.activatedAt),
        endsAt: textValue(raw?.endsAt, raw?.endAt, raw?.deactivatedAt, raw?.nextActivationAt),
        estimatedEnd: textValue(raw?.estimatedEnd, raw?.expectedEnd),
        isCurrent: currentId ? id === currentId : ['active', 'current', 'live'].includes(status)
    };
}

function normalizedSeasons(manifest, summary = null) {
    const source = Array.isArray(manifest?.seasons) ? [...manifest.seasons] : [];
    if (manifest?.current && typeof manifest.current === 'object') source.unshift(manifest.current);
    if (manifest?.currentSeason && typeof manifest.currentSeason === 'object') source.unshift(manifest.currentSeason);
    if (summary?.season && typeof summary.season === 'object') source.unshift(summary.season);
    const unique = new Map();
    source.forEach((raw, index) => {
        const season = normalizeSeason(raw, index, manifest);
        const previous = unique.get(season.id) || {};
        unique.set(season.id, { ...previous, ...season });
    });
    if (!unique.size) {
        unique.set('live', {
            id: 'live',
            protocol: 'Protocol seasons',
            number: '—',
            status: 'preparing',
            summaryUrl: '',
            startsAt: '',
            endsAt: '',
            estimatedEnd: '',
            isCurrent: true
        });
    }
    return [...unique.values()].sort((left, right) => {
        if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
        const leftDate = validDate(left.startsAt)?.getTime() || 0;
        const rightDate = validDate(right.startsAt)?.getTime() || 0;
        return rightDate - leftDate;
    });
}

function seasonById(id = chamberState.seasonId) {
    const seasons = normalizedSeasons(chamberState.manifest, chamberState.summary);
    return seasons.find((season) => season.id === id) || seasons[0];
}

function summaryUrlFor(manifest, season) {
    if (season?.summaryUrl) return season.summaryUrl;
    const currentId = currentSeasonId(manifest);
    if (season?.id === currentId) {
        const value = manifest?.currentSummaryUrl || manifest?.summaryUrl || manifest?.current?.summaryUrl || manifest?.current?.summaryPath || manifest?.currentSeason?.summaryUrl || manifest?.currentSeason?.summaryPath;
        if (value) return resolveDataUrl(value);
    }
    if (season?.id && season.id !== 'live') return resolveDataUrl(`/data/maxis/seasons/${encodeURIComponent(season.id)}/summary.json`);
    return '';
}

function inlineSummaryFor(manifest, season) {
    const candidates = [season?.summary, manifest?.summary, manifest?.current?.summary, manifest?.currentSeason?.summary];
    return candidates.find((candidate) => candidate && typeof candidate === 'object' && (
        candidate.season || candidate.rankings || candidate.leaders || candidate.honors || candidate.coverage
    )) || null;
}

function assertSeasonSummaryIdentity(summary, season) {
    if (!summary || typeof summary !== 'object') return summary;
    const receipts = [
        ['season id', season?.id, summary?.season?.id],
        ['protocol hash', season?.protocolHash, summary?.season?.protocolHash],
        ['evaluator version', season?.evaluatorVersion, summary?.rules?.evaluatorVersion],
        ['evaluator implementation hash', season?.evaluatorImplementationHash, summary?.rules?.evaluatorImplementationHash],
        ['rules hash', season?.rulesHash, summary?.rules?.rulesHash]
    ];
    const mismatch = receipts.find(([, expected, actual]) => expected !== undefined && expected !== null && String(expected) !== String(actual || ''));
    if (mismatch) {
        throw new Error(`The selected Maxis season failed its identity receipt: ${mismatch[0]} does not match the manifest. Retry after the season artifacts finish publishing.`);
    }
    return summary;
}

async function loadSeasonSummary(seasonId, { force = false } = {}) {
    if (!seasonId) return null;
    const season = seasonById(seasonId);
    if (!force && summaryCache.has(seasonId)) return assertSeasonSummaryIdentity(summaryCache.get(seasonId), season);
    const inline = inlineSummaryFor(chamberState.manifest, season);
    if (inline) {
        const verified = assertSeasonSummaryIdentity(inline, season);
        summaryCache.set(seasonId, verified);
        return verified;
    }
    const url = summaryUrlFor(chamberState.manifest, season);
    if (!url) return null;
    const summary = await fetchJson(url, { force, quiet: true });
    if (!summary || typeof summary !== 'object') return summary;
    const verified = assertSeasonSummaryIdentity(summary, season);
    summaryCache.set(seasonId, verified);
    return verified;
}

function rankingArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    return asArray(value.entries || value.rows || value.ranking || value.rankings || value.accounts || value.leaders).filter(Boolean);
}

function rankingForCategory(data, category) {
    const key = canonicalCategory(category);
    const rankings = data?.rankings;
    if (Array.isArray(rankings)) {
        const lane = rankings.find((item) => canonicalCategory(item?.category || item?.lane || item?.id) === key);
        const rows = rankingArray(lane);
        if (rows.length) return rows;
    } else if (rankings && typeof rankings === 'object') {
        const directKey = Object.keys(rankings).find((candidate) => canonicalCategory(candidate) === key);
        const rows = rankingArray(directKey ? rankings[directKey] : null);
        if (rows.length) return rows;
    }
    const lane = asArray(data?.lanes).find((item) => canonicalCategory(item?.category || item?.lane || item?.id) === key);
    const laneRows = rankingArray(lane);
    if (laneRows.length) return laneRows;
    const fallback = asArray(data?.leaders).find((leader) => canonicalCategory(leader?.category || leader?.lane) === key);
    return fallback?.status === 'ready' || fallback?.address ? [{ ...fallback, rank: fallback.rank || 1 }] : [];
}

function leaderForCategory(data, category) {
    const key = canonicalCategory(category);
    const leader = asArray(data?.leaders).find((candidate) => canonicalCategory(candidate?.category || candidate?.lane) === key);
    const lane = asArray(data?.lanes).find((candidate) => canonicalCategory(candidate?.category || candidate?.lane || candidate?.id) === key);
    const laneStatus = data?.laneStatus && typeof data.laneStatus === 'object'
        ? data.laneStatus[Object.keys(data.laneStatus).find((candidate) => canonicalCategory(candidate) === key)]
        : null;
    const ranking = rankingForCategory(data, key);
    return { ...(laneStatus || {}), ...(lane || {}), ...(leader || {}), ...(ranking[0] || {}), category: key };
}

function categoriesFor(data) {
    const found = new Set();
    if (Array.isArray(data?.rankings)) {
        data.rankings.forEach((item) => found.add(canonicalCategory(item?.category || item?.lane || item?.id)));
    } else if (data?.rankings && typeof data.rankings === 'object') {
        Object.keys(data.rankings).forEach((key) => found.add(canonicalCategory(key)));
    }
    asArray(data?.leaders).forEach((leader) => found.add(canonicalCategory(leader?.category || leader?.lane)));
    asArray(data?.lanes).forEach((lane) => found.add(canonicalCategory(lane?.category || lane?.lane || lane?.id)));
    const order = new Map(CATEGORY_ORDER.map((category, index) => [category, index]));
    return [...found].filter(Boolean).sort((left, right) => (order.get(left) ?? 99) - (order.get(right) ?? 99));
}

function normalizePassGap(gap) {
    if (!gap || typeof gap !== 'object') return gap || null;
    const rawConservativePath = Object.hasOwn(gap, 'conservativeVectorPath')
        ? gap.conservativeVectorPath
        : gap.minimalKnownPath;
    return {
        ...gap,
        conservativeVectorPath: asArray(rawConservativePath).filter((step) => step && typeof step === 'object')
    };
}

function normalizePassGapSet(passGap) {
    if (!passGap || typeof passGap !== 'object') return passGap || null;
    const directGap = ['targetRank', 'targetAddress', 'guaranteedPrimary', 'conservativeVectorPath', 'minimalKnownPath', 'caveat']
        .some((key) => Object.hasOwn(passGap, key));
    if (directGap) return normalizePassGap(passGap);
    const normalized = { ...passGap };
    ['next', 'topTen', 'leader'].forEach((target) => {
        if (Object.hasOwn(passGap, target)) normalized[target] = normalizePassGap(passGap[target]);
    });
    return normalized;
}

function normalizedEntry(entry, index, category, data) {
    const lane = leaderForCategory(data, category);
    const rawPassGap = Object.hasOwn(entry || {}, 'passGap') ? entry.passGap : lane?.passGap;
    return {
        ...lane,
        ...entry,
        category: canonicalCategory(category),
        rank: numberValue(entry?.rank, entry?.position, index + 1) || index + 1,
        address: textValue(entry?.address, entry?.account, entry?.wallet),
        title: textValue(entry?.title, lane?.title, `${categoryLabel(category)} Maxi`),
        method: textValue(entry?.method, lane?.method),
        windowKind: textValue(entry?.windowKind, entry?.window, lane?.windowKind, lane?.window, 'season'),
        sourceUrl: textValue(entry?.sourceUrl, entry?.source, lane?.sourceUrl),
        passGap: normalizePassGapSet(rawPassGap)
    };
}

function normalizedRanking(data, category) {
    return rankingForCategory(data, category).map((entry, index) => normalizedEntry(entry, index, category, data));
}

function uniqueRankedWallets(data) {
    const addresses = new Set();
    categoriesFor(data).forEach((category) => {
        normalizedRanking(data, category).forEach((entry) => {
            if (entry.address) addresses.add(entry.address.toLowerCase());
        });
    });
    return addresses.size;
}

function formatDate(value, { includeYear = true } = {}) {
    const date = validDate(value);
    if (!date) return '';
    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
        ...(includeYear ? { year: 'numeric' } : {})
    });
}

function seasonEndCopy(season, { compact = false } = {}) {
    const end = validDate(season?.endsAt);
    if (end) {
        if (season?.status === 'settling') return `Closed ${formatDate(end, { includeYear: !compact })} · settling`;
        const prefix = ['final', 'finalized', 'complete', 'archived'].includes(season.status) ? 'Ended' : 'Scheduled activation';
        return `${prefix} ${formatDate(end, { includeYear: !compact })}`;
    }
    const estimate = validDate(season?.estimatedEnd);
    if (estimate) return `Estimate ${formatDate(estimate, { includeYear: !compact })} · not scheduled`;
    if (season?.status === 'settling') return compact ? 'Closed · settling' : 'Season closed · source settlement in progress';
    if (['final', 'finalized', 'complete', 'archived'].includes(season?.status)) return 'Season complete';
    return compact ? 'Ends at next protocol' : 'Ends at the next protocol activation · date not scheduled';
}

function seasonNumberLabel(season) {
    const numeric = Number(season?.number);
    return Number.isFinite(numeric) ? String(numeric).padStart(2, '0') : textValue(season?.number, '—');
}

function activeDataForSeason() {
    return chamberState.summary || null;
}

function ensureValidLane(data) {
    const categories = categoriesFor(data);
    if (!categories.length) return '';
    const laneRoom = chamberState.view === 'crown' ? 'crown' : 'season';
    const remembered = chamberState.laneByView[laneRoom];
    if (categories.includes(remembered)) chamberState.lane = remembered;
    else if (!categories.includes(chamberState.lane)) chamberState.lane = categories[0];
    chamberState.laneByView[laneRoom] = chamberState.lane;
    return chamberState.lane;
}

function readRouteState() {
    const pretty = window.location.pathname.replace(/^\/+|\/+$/g, '') === 'maxis';
    const search = new URLSearchParams(window.location.search);
    const hash = window.location.hash.replace(/^#/, '');
    const hashParams = new URLSearchParams(hash.includes('=') ? hash : '');
    const requestedView = pretty ? search.get('view') : (hashParams.get('maxis') || hashParams.get('maxis-view'));
    return {
        view: VIEW_KEYS.includes(requestedView) ? requestedView : 'season',
        seasonId: textValue(pretty ? search.get('season') : hashParams.get('season')),
        lane: canonicalCategory(pretty ? search.get('lane') : hashParams.get('lane')),
        address: textValue(pretty ? search.get('address') : (hashParams.get('address') || hashParams.get('maxis-address')))
    };
}

function syncRouteState() {
    const pretty = window.location.pathname.replace(/^\/+|\/+$/g, '') === 'maxis';
    const url = new URL(window.location.href);
    if (pretty) {
        if (chamberState.view === 'season') url.searchParams.delete('view');
        else url.searchParams.set('view', chamberState.view);
        if (chamberState.seasonId && chamberState.seasonId !== currentSeasonId(chamberState.manifest)) url.searchParams.set('season', chamberState.seasonId);
        else url.searchParams.delete('season');
        if (chamberState.lane) url.searchParams.set('lane', chamberState.lane);
        else url.searchParams.delete('lane');
        if (chamberState.view === 'passport' && chamberState.passportAddress) url.searchParams.set('address', chamberState.passportAddress);
        else url.searchParams.delete('address');
    } else {
        const params = new URLSearchParams();
        params.set('maxis', chamberState.view);
        if (chamberState.seasonId) params.set('season', chamberState.seasonId);
        if (chamberState.lane) params.set('lane', chamberState.lane);
        if (chamberState.view === 'passport' && chamberState.passportAddress) params.set('address', chamberState.passportAddress);
        url.hash = params.toString();
    }
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function renderSeasonSelector() {
    const seasons = normalizedSeasons(chamberState.manifest, chamberState.summary);
    const selected = seasonById();
    return `
        <div class="maxis-season-tray${chamberState.selectorOpen ? ' is-open' : ''}">
            <button class="maxis-season-orb" type="button" aria-haspopup="menu" aria-controls="maxis-season-menu" aria-expanded="${chamberState.selectorOpen ? 'true' : 'false'}" aria-label="Choose protocol season">
                <span class="maxis-season-orb-mark">S${escapeHtml(seasonNumberLabel(selected))}<small>${escapeHtml(String(selected?.protocol || 'TZ').slice(0, 3).toUpperCase())}</small></span>
            </button>
            <div class="maxis-season-menu" id="maxis-season-menu" role="menu" aria-label="Protocol seasons">
                <div class="maxis-season-menu-head"><span>Protocol seasons</span><strong>${seasons.length}</strong></div>
                ${seasons.map((season) => `
                    <button class="maxis-season-option" type="button" role="menuitemradio" tabindex="${season.id === selected?.id ? '0' : '-1'}" aria-checked="${season.id === selected?.id ? 'true' : 'false'}" data-maxis-season="${escapeHtml(season.id)}">
                        <span class="maxis-season-seal">${escapeHtml(seasonNumberLabel(season))}</span>
                        <span class="maxis-season-option-copy"><strong>${escapeHtml(season.protocol)}</strong><small>${escapeHtml(seasonEndCopy(season, { compact: true }))}</small></span>
                        <span class="maxis-season-option-state">${escapeHtml(season.isCurrent ? 'live' : season.status)}</span>
                    </button>
                `).join('')}
            </div>
        </div>
    `;
}

function renderProtocolHero() {
    const season = seasonById();
    const data = activeDataForSeason();
    const fresh = freshness(data || chamberState.legacy);
    const settling = season?.status === 'settling';
    const final = ['final', 'finalized', 'complete', 'archived'].includes(season?.status);
    const sheetState = settling
        ? 'closed · source settlement in progress · champions pending'
        : (final ? 'permanent champion sheet' : (data ? (fresh.stale ? 'previous valid sheet' : 'current sheet') : 'season sheet preparing'));
    const categories = data ? categoriesFor(data) : [];
    const passportRecords = data ? numberValue(data?.passports?.indexedAddresses, data?.coverage?.indexedAddresses) : null;
    const wallets = data ? (passportRecords ?? uniqueRankedWallets(data)) : 0;
    const starts = formatDate(season?.startsAt);
    return `
        <header class="maxis-protocol-hero chamber-anim-fade">
            <div class="maxis-protocol-kicker"><span>Season ${escapeHtml(seasonNumberLabel(season))}</span> Tezos protocol arena · ${escapeHtml(sheetState)}</div>
            <h2 id="maxis-title" class="maxis-protocol-title">${escapeHtml(season?.displayLabel || `${season?.protocol || 'Tezos'} Season`)}</h2>
            <p class="maxis-protocol-lead">${settling ? 'This season is closed. Its provisional standings remain inspectable while the declared sources settle; champions are not permanent yet.' : 'Every protocol opens a new arena. Crowns stay objective; movement, breadth, and season honors give every wallet a path forward.'} ${escapeHtml(seasonEndCopy(season))}.</p>
            <p class="maxis-idea-credit"><span aria-hidden="true">✦</span> Chamber idea by <strong>opeculiar</strong></p>
            <div class="maxis-season-telemetry" aria-label="Protocol season status">
                <span><strong>${escapeHtml(starts || (season?.isCurrent ? 'Live now' : 'Date unavailable'))}</strong>season activation</span>
                <span><strong>${escapeHtml(seasonEndCopy(season, { compact: true }))}</strong>season boundary</span>
                <span><strong>${escapeHtml(String(wallets || '—'))}</strong>${passportRecords !== null ? 'wallet Passports indexed' : 'wallets on loaded ranks'}</span>
                <span><strong>${escapeHtml(fresh.label)}</strong>${categories.length ? `${categories.length} lanes` : 'season data preparing'}</span>
            </div>
        </header>
    `;
}

function renderRoomTabs() {
    return `
        <nav class="maxis-room-tabs" role="tablist" aria-label="Maxis rooms">
            ${VIEW_KEYS.map((view) => `
                <button class="maxis-room-tab" id="maxis-tab-${view}" type="button" role="tab" aria-selected="${chamberState.view === view ? 'true' : 'false'}" aria-controls="maxis-panel-${view}" tabindex="${chamberState.view === view ? '0' : '-1'}" data-maxis-view="${view}">
                    <span aria-hidden="true">${VIEW_META[view].icon}</span>${VIEW_META[view].label}
                </button>
            `).join('')}
        </nav>
    `;
}

function renderRoomIntro(kicker, title, copy, side = '') {
    return `
        <div class="maxis-room-intro">
            <div class="maxis-room-intro-copy"><span class="maxis-room-kicker">${escapeHtml(kicker)}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(copy)}</p></div>
            ${side}
        </div>
    `;
}

function renderLaneRail(data, selected, label) {
    return `
        <div class="maxis-lane-rail" role="toolbar" aria-label="${escapeHtml(label)}">
            ${categoriesFor(data).map((category) => `
                <button class="maxis-lane-chip" type="button" aria-pressed="${category === selected ? 'true' : 'false'}" data-maxis-lane="${escapeHtml(category)}">
                    <span aria-hidden="true">${CATEGORY_ICONS[category] || '•'}</span>${escapeHtml(categoryLabel(category))}
                </button>
            `).join('')}
        </div>
    `;
}

function rankDeltaValue(entry) {
    const direct = entry?.rankDelta ?? entry?.delta ?? entry?.movement;
    if (Number.isFinite(Number(direct))) return Number(direct);
    const previous = numberValue(entry?.previousRank, entry?.rankBefore, entry?.lastRank);
    const current = numberValue(entry?.rank, entry?.position);
    return previous !== null && current !== null ? previous - current : null;
}

function renderRankDelta(entry) {
    const delta = rankDeltaValue(entry);
    if (delta === null) return '<span class="maxis-rank-delta flat" title="No prior checkpoint">new</span>';
    if (delta > 0) return `<span class="maxis-rank-delta" title="Up ${delta} since the prior checkpoint">↑${delta}</span>`;
    if (delta < 0) return `<span class="maxis-rank-delta down" title="Down ${Math.abs(delta)} since the prior checkpoint">↓${Math.abs(delta)}</span>`;
    return '<span class="maxis-rank-delta flat" title="No rank change">—</span>';
}

function rowKey(entry, category) {
    return `${canonicalCategory(category)}:${String(entry?.address || entry?.rank || '').toLowerCase()}`;
}

function rankTweetText(entry, category) {
    const season = seasonById();
    const place = entry?.rank || 1;
    const room = chamberState.view === 'crown' ? `${windowLabel(entry?.windowKind)} Crown Hall` : `${season?.protocol || 'Tezos'} season`;
    return `🏆 ${leaderName(entry)} is #${place} in ${categoryLabel(category)} — ${scoreLabel(entry)} (${room}). Inspect the race: ${MAXIS_SHARE_URL} #Tezos`;
}

function renderRowMenuToggle(entry, category) {
    const key = rowKey(entry, category);
    const open = chamberState.rowDetail === key;
    return `
        <span class="maxis-row-menu-wrap">
            <button class="maxis-row-menu-toggle" type="button" aria-expanded="${open ? 'true' : 'false'}" aria-controls="maxis-row-actions" aria-label="Open score receipt and trails for rank ${escapeHtml(String(entry.rank))} ${escapeHtml(leaderName(entry))}" data-maxis-row-menu="${escapeHtml(key)}">•••</button>
        </span>
    `;
}

function selectedRow(data, category) {
    return normalizedRanking(data, category).find((entry) => rowKey(entry, category) === chamberState.rowDetail) || null;
}

function renderScoreReceipt(entry) {
    const vector = asArray(entry?.scoreVector).filter((metric) => metric && typeof metric === 'object');
    const currentRank = numberValue(entry?.rank, entry?.position);
    const previousRank = numberValue(entry?.previousRank, entry?.rankBefore, entry?.lastRank);
    const delta = rankDeltaValue(entry);
    const movement = previousRank === null
        ? 'first comparable checkpoint'
        : `previous #${previousRank}${delta === 0 ? ' · held rank' : delta !== null ? ` · ${delta > 0 ? '↑' : '↓'}${Math.abs(delta)}` : ''}`;
    const gaps = [
        ['Next', entry?.passGap?.next],
        ['Top 10', entry?.passGap?.topTen],
        ['Leader', entry?.passGap?.leader]
    ].map(([label, gap]) => {
        const normalized = normalizePassGap(gap);
        return {
            label,
            guarantee: guaranteedPassGapLabel({ passGap: normalized }),
            conservative: conservativePassGapLabel({ passGap: normalized })
        };
    }).filter((gap) => gap.guarantee || gap.conservative);
    return `
        <div class="maxis-cutline-card" style="flex:1 0 100%;margin:0" aria-label="Frozen score receipt">
            <strong>Frozen score receipt · ${currentRank ? `rank #${escapeHtml(String(currentRank))}` : 'qualified'}</strong>
            ${vector.length ? vector.map((metric) => {
                const unit = textValue(metric?.unit, 'score');
                const human = formatMetricAmount(metric?.value, unit);
                const exact = unit === 'mutez' ? ` · ${formatNumber(metric?.value)} mutez` : '';
                return `<span><b>${escapeHtml(textValue(metric?.label, metric?.metric, 'metric'))}:</b> ${escapeHtml(human)}${escapeHtml(exact)}</span>`;
            }).join(' · ') : `<span>${escapeHtml(scoreLabel(entry))}</span>`}
            <span> · ${escapeHtml(movement)}</span>
            ${gaps.map((gap) => `
                ${gap.guarantee ? `<span> · <b>${escapeHtml(gap.label)} actionable guarantee:</b> ${escapeHtml(gap.guarantee)}</span>` : ''}
                ${gap.conservative ? `<span> · <b>${escapeHtml(gap.label)} conservative static-vector path:</b> ${escapeHtml(gap.conservative)} · frozen snapshot only, not a live minimum</span>` : ''}
            `).join('')}
        </div>
    `;
}

function renderRowActions(entry, category) {
    if (!entry?.address) return '';
    const address = encodeURIComponent(entry.address);
    const tweetText = encodeURIComponent(rankTweetText(entry, category));
    return `
        <div class="maxis-row-actions" id="maxis-row-actions" role="group" aria-label="Score receipt and on-chain trails for ${escapeHtml(leaderName(entry))}">
            ${renderScoreReceipt(entry)}
            <span role="menu" aria-label="On-chain trails" style="display:contents">
                <a class="maxis-rank-action maxis-ledger-action" role="menuitem" href="/#ledger-flow=${address}">Ledger Flow</a>
                <a class="maxis-rank-action" role="menuitem" href="/#my-baker=${address}">My Tezos</a>
                ${entry.sourceUrl ? `<a class="maxis-rank-action maxis-source-action" role="menuitem" href="${escapeHtml(entry.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>` : ''}
                <a class="maxis-rank-action maxis-tweet-action" role="menuitem" data-maxis-share="${escapeHtml(entry.address)}" data-maxis-share-lane="${escapeHtml(category)}" href="https://twitter.com/intent/tweet?text=${tweetText}" target="_blank" rel="noopener">Share rank #${escapeHtml(String(entry.rank))}</a>
            </span>
        </div>
    `;
}

function renderPodiumPlace(entry, place, category) {
    if (!entry) {
        return `<div class="maxis-podium-place" data-place="${place}"><span class="maxis-podium-number">#${place}</span><strong>Open place</strong><code>Season in progress</code><small>No qualifier yet</small></div>`;
    }
    return `
        <div class="maxis-podium-place" data-place="${place}">
            <span class="maxis-podium-number">${place === 1 ? '♛ ' : ''}#${place}</span>
            <strong title="${escapeHtml(leaderName(entry))}">${escapeHtml(leaderName(entry))}</strong>
            <code title="${escapeHtml(entry.address)}">${escapeHtml(shortAddress(entry.address))}</code>
            <small>${escapeHtml(scoreLabel(entry))} · ${renderRankDelta(entry)}</small>
            ${renderRowMenuToggle(entry, category)}
        </div>
    `;
}

function renderLaneBoard(data, category) {
    const ranking = normalizedRanking(data, category).slice(0, 10);
    const lane = leaderForCategory(data, category);
    if (!ranking.length) {
        return `
            <article class="maxis-lane-board">
                <div class="maxis-lane-board-head"><span class="maxis-lane-mark">${CATEGORY_ICONS[category] || '•'}</span><span class="maxis-lane-title"><small>${escapeHtml(categoryLabel(category))} lane</small><strong>${escapeHtml(lane?.status === 'unavailable' ? 'No winner published' : 'No qualifying wallets yet')}</strong></span><span class="maxis-lane-window">${escapeHtml(windowLabel(lane?.windowKind))}</span></div>
                <div class="maxis-empty-stage"><div><span class="maxis-empty-stage-mark">${CATEGORY_ICONS[category] || '•'}</span><strong>${escapeHtml(lane?.status === 'unavailable' ? 'Winner withheld' : 'This crown is still open')}</strong><p>${escapeHtml(textValue(lane?.reason, lane?.method, 'No trustworthy season ranking was published for this lane.'))}</p></div></div>
            </article>
        `;
    }
    const selected = selectedRow(data, category);
    return `
        <article class="maxis-lane-board" data-maxis-board="${escapeHtml(category)}">
            <div class="maxis-lane-board-head">
                <span class="maxis-lane-mark">${CATEGORY_ICONS[category] || '•'}</span>
                <span class="maxis-lane-title"><small>${escapeHtml(categoryLabel(category))} lane</small><strong>${escapeHtml(textValue(lane?.title, `${categoryLabel(category)} Maxi`))}</strong></span>
                <span class="maxis-lane-window">${escapeHtml(windowLabel(lane?.windowKind || lane?.window))}</span>
            </div>
            <p class="maxis-lane-method">${escapeHtml(textValue(lane?.method, 'Objective score over the declared season window. Ties follow the published lane rules.'))}</p>
            <div class="maxis-podium" aria-label="${escapeHtml(categoryLabel(category))} top three">
                ${[1, 2, 3].map((place) => renderPodiumPlace(ranking[place - 1], place, category)).join('')}
            </div>
            ${selected && Number(selected.rank) <= 3 ? renderRowActions(selected, category) : ''}
            <ol class="maxis-compact-ranking" start="4" aria-label="${escapeHtml(categoryLabel(category))} ranks four through ten">
                ${ranking.slice(3).map((entry) => `
                    <li class="maxis-compact-row">
                        <span class="maxis-compact-rank">#${escapeHtml(String(entry.rank))}</span>
                        <span class="maxis-compact-identity"><strong title="${escapeHtml(leaderName(entry))}">${escapeHtml(leaderName(entry))}</strong><code title="${escapeHtml(entry.address)}">${escapeHtml(shortAddress(entry.address))}</code></span>
                        <span class="maxis-compact-score">${escapeHtml(scoreLabel(entry))} ${renderRankDelta(entry)}</span>
                        ${renderRowMenuToggle(entry, category)}
                    </li>
                `).join('')}
            </ol>
            ${selected && Number(selected.rank) > 3 ? renderRowActions(selected, category) : ''}
        </article>
    `;
}

function raceForCategory(data, category) {
    const races = data?.races || data?.raceTelemetry || data?.telemetry?.races;
    if (Array.isArray(races)) return races.find((race) => canonicalCategory(race?.category || race?.lane || race?.id) === category) || {};
    if (races && typeof races === 'object') {
        const key = Object.keys(races).find((candidate) => canonicalCategory(candidate) === category);
        return key ? races[key] : {};
    }
    const cutoffs = data?.cutoffs;
    if (cutoffs && typeof cutoffs === 'object') {
        const key = Object.keys(cutoffs).find((candidate) => canonicalCategory(candidate) === category);
        if (key) return cutoffs[key] || {};
    }
    return {};
}

function honorsForCategory(data, category) {
    const source = data?.honors || data?.seasonHonors || [];
    let values = [];
    if (Array.isArray(source)) {
        values = source.filter((honor) => !honor?.category && !honor?.lane || canonicalCategory(honor?.category || honor?.lane) === category);
    } else if (source && typeof source === 'object') {
        const key = Object.keys(source).find((candidate) => canonicalCategory(candidate) === category);
        values = [...asArray(key ? source[key] : null), ...asArray(source.global || source.season)];
        if (!values.length) {
            values = Object.entries(source).map(([title, honor]) => ({
                ...(honor && typeof honor === 'object' ? honor : { detail: honor }),
                title: textValue(honor?.title, title.replace(/([a-z])([A-Z])/g, '$1 $2'))
            }));
        }
    }
    return values;
}

function honorRecipient(honor) {
    return honor?.winner || asArray(honor?.winners)[0] || honor?.leader || honor;
}

function honorDetail(honor) {
    const recipient = honorRecipient(honor);
    const movement = numberValue(recipient?.delta);
    const rank = numberValue(recipient?.rank);
    const category = canonicalCategory(recipient?.category || recipient?.lane);
    return textValue(
        honor?.scoreLabel,
        honor?.detail,
        honor?.description,
        movement !== null && movement !== 0 ? `${movement > 0 ? '↑' : '↓'}${Math.abs(movement)} ranks${rank ? ` · now #${rank}` : ''}` : '',
        rank ? `${category ? `${categoryLabel(category)} · ` : ''}#${rank}` : '',
        honor?.reason,
        'Earned this season'
    );
}

function renderHonorsPanel(data, category, { crownHall = false } = {}) {
    const ranking = normalizedRanking(data, category);
    const lane = leaderForCategory(data, category);
    const leader = ranking[0];
    const challenger = ranking[1];
    const cutoff = ranking[Math.min(9, ranking.length - 1)];
    const race = raceForCategory(data, category);
    const honors = honorsForCategory(data, category);
    const raceChallenger = race?.nearestChallenger || challenger;
    const raceCutoff = race?.topTen || cutoff;
    const fullLeaderGap = challenger?.passGap?.leader || challenger?.passGap?.next;
    const exactLeaderGap = passGapLabel(fullLeaderGap ? { passGap: fullLeaderGap } : challenger);
    const closestGap = textValue(race?.gapToLeaderLabel, race?.leaderGapLabel, race?.gap, exactLeaderGap, raceChallenger ? `${scoreLabel(raceChallenger)} at #2` : 'No challenger yet');
    const cutoffCopy = textValue(race?.cutoffLabel, race?.topTenCutoffLabel, raceCutoff ? scoreLabel(raceCutoff) : 'Cut line not established');
    if (lane?.status === 'unavailable') {
        return `
            <aside class="maxis-honors-panel" aria-label="${escapeHtml(categoryLabel(category))} publication status">
                <div class="maxis-side-heading"><strong>Publication withheld</strong><span>no inferred winner</span></div>
                <div class="maxis-honor-list">
                    <div class="maxis-honor-card"><span class="maxis-honor-mark">!</span><span class="maxis-honor-copy"><span>Coverage receipt</span><strong>${escapeHtml(textValue(lane?.coverageState, 'incomplete source'))}</strong><small>${escapeHtml(textValue(lane?.reason, 'The exhaustive result could not be proven.'))}</small></span></div>
                </div>
                <div class="maxis-cutline-card"><strong>No crown or cut line</strong>${escapeHtml(textValue(lane?.coverage, 'Partial data is intentionally not ranked.'))}</div>
            </aside>
        `;
    }
    if (!ranking.length) {
        return `
            <aside class="maxis-honors-panel" aria-label="${escapeHtml(categoryLabel(category))} empty lane status">
                <div class="maxis-side-heading"><strong>No qualifiers</strong><span>complete empty lane</span></div>
                <div class="maxis-honor-list"><div class="maxis-honor-card"><span class="maxis-honor-mark">◇</span><span class="maxis-honor-copy"><span>Season result</span><strong>Open crown</strong><small>${escapeHtml(textValue(lane?.reason, 'No qualifying activity was found.'))}</small></span></div></div>
                <div class="maxis-cutline-card"><strong>Coverage</strong>${escapeHtml(textValue(lane?.coverage, lane?.coverageState, 'No cut line exists until a wallet qualifies.'))}</div>
            </aside>
        `;
    }
    return `
        <aside class="maxis-honors-panel" aria-label="${crownHall ? 'Crown Hall facts' : 'Season honors'}">
            <div class="maxis-side-heading"><strong>${crownHall ? 'Objective crown' : 'Race telemetry'}</strong><span>${escapeHtml(categoryLabel(category))}</span></div>
            <div class="maxis-honor-list">
                <div class="maxis-honor-card"><span class="maxis-honor-mark">♛</span><span class="maxis-honor-copy"><span>Current leader</span><strong>${escapeHtml(leaderName(leader))}</strong><small>${escapeHtml(scoreLabel(leader))}</small></span></div>
                <div class="maxis-honor-card"><span class="maxis-honor-mark">↟</span><span class="maxis-honor-copy"><span>Nearest challenger</span><strong>${escapeHtml(leaderName(raceChallenger))}</strong><small>${escapeHtml(closestGap)}</small></span></div>
                ${honors.map((honor) => `
                    <div class="maxis-honor-card"><span class="maxis-honor-mark">${escapeHtml(textValue(honor?.icon, honor?.status === 'ready' ? '✦' : '◇'))}</span><span class="maxis-honor-copy"><span>${escapeHtml(textValue(honor?.title, honor?.type, honor?.label, 'Season honor').replace(/\b\w/g, (letter) => letter.toUpperCase()))}</span><strong>${escapeHtml(honor?.status === 'ready' ? leaderName(honorRecipient(honor)) : textValue(honor?.status, 'pending'))}</strong><small>${escapeHtml(honorDetail(honor))}</small></span></div>
                `).join('')}
            </div>
            <div class="maxis-cutline-card"><strong>Top 10 cut line</strong>${escapeHtml(cutoffCopy)}${crownHall ? ` · ${escapeHtml(windowLabel(leader?.windowKind))}` : ' · the line moves with every snapshot.'}</div>
        </aside>
    `;
}

function renderSeasonPanel() {
    const data = activeDataForSeason();
    if (!data) {
        const loading = chamberState.summaryLoading;
        return `
            ${renderRoomIntro('Protocol arena', loading ? 'Opening the season sheet…' : 'Season rankings are not published yet', 'The legacy mixed-window crowns remain available in Crown Hall; they are never relabeled as protocol-season results.')}
            <div class="maxis-empty-stage"><div><span class="maxis-empty-stage-mark">◉</span><strong>${loading ? 'Loading protocol-bounded scores' : 'The first season is forming'}</strong><p>${loading ? 'Fetching the selected season summary while the Crown Hall stays usable.' : 'A season only appears here when its activation boundary, score window, and source coverage can be stated honestly.'}</p></div></div>
        `;
    }
    const category = ensureValidLane(data);
    const settling = seasonById()?.status === 'settling';
    return `
        ${renderRoomIntro(settling ? 'Closed season · provisional' : 'Live protocol season', settling ? 'Source settlement in progress' : 'Movement makes the chamber', settling ? 'These standings are inspectable but not final. Champions publish only after the declared source-settlement rebuild completes.' : 'One lane at a time: current crown, closest chase, rank movement, cut line, and human-playable honors without diluting the objective metric.')}
        ${renderLaneRail(data, category, 'Choose a protocol-season lane')}
        <div class="maxis-season-stage">
            ${renderLaneBoard(data, category)}
            ${renderHonorsPanel(data, category)}
        </div>
    `;
}

function renderCrownHallPanel() {
    const data = chamberState.legacy;
    if (!data) return `<div class="maxis-empty-stage"><div><span class="maxis-empty-stage-mark">♛</span><strong>Crown Hall is unavailable</strong><p>The last valid mixed-window snapshot did not load.</p></div></div>`;
    const category = ensureValidLane(data);
    return `
        ${renderRoomIntro('Legacy objective records', 'Crown Hall', 'The original live, rolling, and all-time boards remain intact and inspectable. Their unlike windows are declared, not blended into a protocol season.')}
        ${renderLaneRail(data, category, 'Choose a Crown Hall lane')}
        <div class="maxis-season-stage">
            ${renderLaneBoard(data, category)}
            ${renderHonorsPanel(data, category, { crownHall: true })}
        </div>
    `;
}

function implicitAddressStatus(raw) {
    const address = String(raw || '').trim();
    if (/^KT1[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
        return { address, error: 'KT1 contract passports are not supported. A contract can have many operators, so assigning its activity to one person would be misleading.' };
    }
    if (!/^tz[1-4][1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
        return { address, error: 'Enter one implicit Tezos address beginning tz1, tz2, tz3, or tz4.' };
    }
    return { address, error: '' };
}

function findProfile(container, address) {
    if (!container || !address) return null;
    const target = address.toLowerCase();
    if (Array.isArray(container)) return container.find((profile) => String(profile?.address || profile?.wallet || '').toLowerCase() === target) || null;
    if (typeof container !== 'object') return null;
    const directKey = Object.keys(container).find((key) => key.toLowerCase() === target);
    if (directKey && container[directKey] && typeof container[directKey] === 'object') return { address, ...container[directKey] };
    for (const key of ['profiles', 'passports', 'records', 'wallets', 'entries']) {
        const result = findProfile(container[key], address);
        if (result) return result;
    }
    return null;
}

function inlinePassport(address) {
    const season = seasonById();
    const sources = [
        chamberState.summary?.passports,
        chamberState.summary?.profiles,
        season?.passports,
        chamberState.manifest?.inlinePassports,
        chamberState.manifest?.passports?.profiles
    ];
    return sources.map((source) => findProfile(source, address)).find(Boolean) || null;
}

function passportConfig() {
    const season = seasonById();
    const manifest = chamberState.manifest || {};
    const config = manifest.passportShards || manifest.passportSharding || manifest.passports || manifest.shards || {};
    const summaryConfig = chamberState.summary?.passportShards || chamberState.summary?.passports || {};
    const seasonConfig = season?.passportShards || season?.passports || {};
    return {
        ...config,
        ...summaryConfig,
        ...seasonConfig,
        algorithm: textValue(seasonConfig.shardAlgorithm, summaryConfig.shardAlgorithm, config.shardAlgorithm, config.algorithm, manifest.passportShardAlgorithm, 'sha256-first-byte-mask-3f-v1'),
        integrityAlgorithm: textValue(seasonConfig.integrityAlgorithm, summaryConfig.integrityAlgorithm, summaryConfig.algorithm, config.integrityAlgorithm),
        count: numberValue(seasonConfig.count, seasonConfig.shardCount, summaryConfig.count, summaryConfig.shardCount, config.count, config.shardCount, manifest.passportShardCount, 64) || 64,
        template: textValue(
            seasonConfig.template,
            seasonConfig.urlTemplate,
            seasonConfig.shardUrlTemplate,
            seasonConfig.passportPathTemplate,
            summaryConfig.template,
            summaryConfig.pathTemplate,
            summaryConfig.urlTemplate,
            summaryConfig.shardUrlTemplate,
            config.template,
            config.pathTemplate,
            config.urlTemplate,
            config.shardUrlTemplate,
            manifest.passportShardUrlTemplate,
            season?.passportShardUrlTemplate,
            season?.passportPathTemplate,
            manifest?.current?.passportPathTemplate
        ),
        shardMap: seasonConfig.shardMap || summaryConfig.shardMap || config.shardMap || manifest.passportShardMap || {},
        shardHashes: seasonConfig.shardHashes || summaryConfig.shardHashes || config.shardHashes || manifest.passportShardHashes || {},
        contentRoot: textValue(seasonConfig.contentRoot, summaryConfig.contentRoot, config.contentRoot, manifest.passportContentRoot),
        availableShards: seasonConfig.availableShards
            || season?.availableShards
            || summaryConfig.availableShards
            || summaryConfig.nonemptyShards
            || config.availableShards
            || config.nonemptyShards
            || null
    };
}

function fnv1a32(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

async function addressShard(address, config) {
    const direct = config.shardMap?.[address] || config.shardMap?.[address.toLowerCase()];
    if (direct !== undefined && direct !== null) return String(direct).padStart(2, '0');
    const algorithm = String(config.algorithm || '').toLowerCase();
    const count = Math.max(1, Number(config.count || 64));
    let shardNumber;
    if (algorithm.includes('sha256')) {
        if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
            throw new Error('This browser cannot calculate the season passport shard because Web Crypto is unavailable. The loaded leaderboard can still be scanned locally.');
        }
        const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(address.trim()));
        const firstByte = new Uint8Array(digest)[0];
        shardNumber = algorithm.includes('mask-3f') && count === 64 ? firstByte & 0x3f : firstByte % count;
    } else if (algorithm.includes('fnv1a32')) {
        shardNumber = fnv1a32(address.trim()) % count;
    } else {
        throw new Error(`Unsupported passport shard algorithm: ${config.algorithm || 'unknown'}.`);
    }
    const width = count <= 256 ? 2 : Math.max(2, Math.ceil(Math.log(count) / Math.log(16)));
    return shardNumber.toString(16).padStart(width, '0');
}

async function loadPassportShard(address) {
    const config = passportConfig();
    const shard = await addressShard(address, config);
    if (Array.isArray(config.availableShards) && !config.availableShards.map(String).includes(shard)) {
        return { passports: {}, shard, empty: true };
    }
    const seasonId = chamberState.seasonId || currentSeasonId(chamberState.manifest) || 'live';
    const direct = config.shardMap?.[address] || config.shardMap?.[address.toLowerCase()];
    let url = typeof direct === 'string' && direct.includes('/') ? direct : config.template;
    if (!url) url = `/data/maxis/seasons/${encodeURIComponent(seasonId)}/passports/{shard}.json`;
    url = String(url)
        .replaceAll('{shard}', shard)
        .replaceAll(':shard', shard)
        .replaceAll('{seasonId}', encodeURIComponent(seasonId))
        .replaceAll('{season}', encodeURIComponent(seasonId));
    url = resolveDataUrl(url);
    const key = `${seasonId}:${shard}:${url}`;
    if (shardCache.has(key)) return shardCache.get(key);
    const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    const raw = await response.text();
    const expectedHash = config.shardHashes?.[shard];
    await verifyPassportShardText(raw, expectedHash, shard);
    if (expectedHash && config.contentRoot) {
        const rootInput = Object.entries(config.shardHashes)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([keyName, hash]) => `${keyName}:${hash}`)
            .join('\n');
        const actualRoot = await sha256Text(rootInput);
        if (actualRoot.toLowerCase() !== String(config.contentRoot).toLowerCase()) {
            throw new Error('The Passport shard hash catalog does not match its season content root. Retry after the season artifacts finish publishing.');
        }
    }
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch {
        throw new Error(`Passport shard ${shard} is not valid JSON. Retry after the season artifacts finish publishing.`);
    }
    const shardIdentityMatches = Number(payload?.schema) === 2
        && String(payload?.seasonId || '') === String(seasonId)
        && String(payload?.shard || '') === String(shard)
        && String(payload?.shardAlgorithm || '') === String(config.algorithm || '');
    if (!shardIdentityMatches) {
        throw new Error(`Passport shard ${shard} does not match the selected season identity or sharding contract. Retry after the season artifacts finish publishing.`);
    }
    if (payload) shardCache.set(key, payload);
    return payload;
}

function normalizeProfileLane(lane, category) {
    const record = lane && typeof lane === 'object' ? lane : { scoreLabel: lane };
    const rawPassGap = record?.passGap || (record?.topTenGap ? { next: null, topTen: record.topTenGap, leader: null } : null);
    return {
        ...record,
        category: canonicalCategory(record?.category || record?.lane || record?.id || category),
        passGap: normalizePassGapSet(rawPassGap)
    };
}

function profileLanes(profile) {
    if (profile?.format === 'transaction-only-v1' && profile?.transaction) {
        return [normalizeProfileLane(profile.transaction, 'transaction')];
    }
    const source = profile?.lanes || profile?.currentLanes || profile?.rankings || profile?.laneProgress || [];
    if (Array.isArray(source)) return source.map((lane) => normalizeProfileLane(lane));
    if (source && typeof source === 'object') {
        return Object.entries(source).map(([category, lane]) => normalizeProfileLane(lane, category));
    }
    return [];
}

function profilePersonalBests(profile) {
    if (profile?.personalBests || profile?.bests) return normalizeNamedRecords(profile.personalBests || profile.bests, 'Personal best');
    if (profile?.format === 'transaction-only-v1' && profile?.personalBest) {
        return [{ ...profile.personalBest, category: 'transaction', title: 'Transaction' }];
    }
    return [];
}

function normalizeNamedRecords(source, fallbackLabel) {
    if (Array.isArray(source)) return source;
    if (source && typeof source === 'object') {
        return Object.entries(source).map(([name, record]) => ({
            ...(record && typeof record === 'object' ? record : { detail: record }),
            title: textValue(record?.title, record?.label, name, fallbackLabel)
        }));
    }
    return [];
}

function passGapRecord(record) {
    return normalizePassGap(record?.passGap?.topTen || record?.passGap);
}

function guaranteedPassGapLabel(record) {
    const gap = passGapRecord(record);
    const guaranteed = gap?.guaranteedPrimary;
    if (!guaranteed) return '';
    return `+${formatMetricAmount(guaranteed.amount, textValue(guaranteed.unit, guaranteed.label, 'activity'))} to guarantee #${gap.targetRank || 10}`;
}

function conservativePassGapLabel(record) {
    const gap = passGapRecord(record);
    const path = asArray(gap?.conservativeVectorPath);
    if (!path.length) return '';
    const vector = path.map((step) => `+${formatMetricAmount(step.amount, textValue(step.unit, step.label, 'activity'))}`).join(' · ');
    return `${vector} against the frozen #${gap.targetRank || 10} score vector`;
}

function passGapLabel(record) {
    const guarantee = guaranteedPassGapLabel(record);
    if (guarantee) return guarantee;
    const conservative = conservativePassGapLabel(record);
    return conservative ? `conservative static-vector path: ${conservative} · not a live minimum` : '';
}

function derivePassport(address, data) {
    const lanes = [];
    let alias = '';
    categoriesFor(data).forEach((category) => {
        const ranking = normalizedRanking(data, category);
        const row = ranking.find((entry) => entry.address.toLowerCase() === address.toLowerCase());
        if (!row) return;
        alias ||= leaderName(row) === shortAddress(address) ? '' : leaderName(row);
        lanes.push({
            category,
            rank: row.rank,
            score: row.score,
            scoreLabel: scoreLabel(row),
            qualifies: row.rank <= 10,
            nextStep: row.rank <= 10 ? `Holding #${row.rank}` : `${row.rank - 10} places from the top 10`,
            personalBest: row.personalBest || row.rank
        });
    });
    const qualifying = lanes.filter((lane) => lane.qualifies).length;
    return {
        address,
        alias,
        lanes,
        badges: [],
        nearMisses: lanes.filter((lane) => !lane.qualifies && lane.rank <= 20),
        streaks: [],
        personalBests: lanes.map((lane) => ({ category: lane.category, rank: lane.personalBest })),
        unicorn: { qualifyingLanes: qualifying, requiredLanes: 3 },
        derived: true
    };
}

async function loadPassportProfile(address) {
    const inline = inlinePassport(address);
    if (inline) return { profile: { address, ...inline }, note: '' };
    const shard = await loadPassportShard(address);
    const profile = findProfile(shard, address);
    if (profile) return { profile: { address, ...profile }, note: '' };
    const data = chamberState.summary || (!chamberState.manifest ? chamberState.legacy : null);
    const derived = derivePassport(address, data || {});
    const localMatch = profileLanes(derived).length > 0;
    const note = localMatch
        ? 'This address was not indexed into a Passport record, so the visible portion was reconstructed from the loaded rankings.'
        : 'No Passport record or loaded ranking was found for this address in the selected season.';
    return { profile: derived, note };
}

function passportUnicornProgress(profile, lanes = profileLanes(profile)) {
    const frozenQualifying = profile?.unicorn?.qualifyingLanes;
    const compactQualifying = profile?.unicornProgress?.qualifyingLanes;
    const genericQualifying = profile?.qualifyingLanes;
    const inferred = lanes.filter((lane) => {
        const rank = numberValue(lane?.rank, lane?.currentRank);
        return lane?.qualifies || (rank !== null && rank <= 100);
    }).length;
    const qualifying = numberValue(
        profile?.unicorn?.breadth,
        Array.isArray(frozenQualifying) ? frozenQualifying.length : frozenQualifying,
        profile?.unicornProgress?.breadth,
        Array.isArray(compactQualifying) ? compactQualifying.length : compactQualifying,
        Array.isArray(genericQualifying) ? genericQualifying.length : genericQualifying,
        inferred
    ) || 0;
    const lanesNeeded = numberValue(profile?.unicorn?.lanesNeeded, profile?.unicornProgress?.lanesNeeded);
    const required = numberValue(
        profile?.unicorn?.requiredLanes,
        profile?.unicornProgress?.requiredLanes,
        profile?.unicornRequired,
        lanesNeeded !== null ? qualifying + lanesNeeded : null,
        3
    ) || 3;
    const explicitPercent = numberValue(
        profile?.unicorn?.badgeProgress?.percent,
        profile?.unicorn?.progressPercent,
        profile?.unicornProgress?.badgeProgress?.percent,
        profile?.unicornProgress?.progressPercent
    );
    return {
        qualifying,
        required,
        percent: Math.min(100, Math.round(explicitPercent ?? ((qualifying / Math.max(1, required)) * 100)))
    };
}

function profileNearMisses(profile) {
    if (profile?.nearMisses || profile?.near_misses) return normalizeNamedRecords(profile.nearMisses || profile.near_misses, 'Near miss');
    const transaction = profile?.format === 'transaction-only-v1' ? profile?.transaction : null;
    const rank = numberValue(transaction?.rank);
    if (!transaction?.topTenGap || rank === null || rank < 11 || rank > 25) return [];
    return [{
        category: 'transaction',
        title: 'Transaction Top 10',
        rank,
        passGap: normalizePassGap(transaction.topTenGap)
    }];
}

function badgeRecords(profile) {
    const source = profile?.badges || profile?.achievements || [];
    let badges = [];
    if (Array.isArray(source)) {
        badges = source.map((badge) => typeof badge === 'string' ? { title: badge, earned: true } : badge);
    } else if (source && typeof source === 'object') {
        badges = Object.entries(source).map(([title, badge]) => typeof badge === 'boolean'
            ? { title, earned: badge }
            : { ...badge, title: textValue(badge?.title, title) });
    }
    const shares = Number(readShareLedger()[String(profile?.address || '').toLowerCase()]?.count || 0);
    if (shares > 0) badges.push({ title: `Social Proof · ${shares}`, icon: '↗', earned: true, detail: 'Rank shares opened locally' });
    const lanes = profileLanes(profile);
    const { qualifying, required } = passportUnicornProgress(profile, lanes);
    if (!badges.some((badge) => String(badge?.title || '').toLowerCase().includes('unicorn'))) {
        badges.push({ title: 'Season Unicorn', icon: '✺', earned: qualifying >= required });
    }
    if (!badges.length) badges.push({ title: 'Passport opened', icon: '◇', earned: true });
    return badges;
}

function progressPercent(lane) {
    const badge = lane?.badgeProgress || lane?.passportMilestone || lane?.milestoneProgress || {};
    const raw = numberValue(badge?.percent, badge?.progressPercent, lane?.progressPercent, lane?.progressPct);
    if (raw !== null) return Math.max(0, Math.min(100, raw));
    const fraction = numberValue(badge?.fraction, badge?.progressFraction, lane?.progressFraction);
    if (fraction !== null) return Math.max(0, Math.min(100, fraction * 100));
    return lane?.qualifies ? 100 : 0;
}

function milestoneCopy(lane) {
    const badge = lane?.badgeProgress || lane?.passportMilestone || lane?.milestoneProgress;
    if (!badge || typeof badge !== 'object') return '';
    if (badge.earned || numberValue(badge.percent, badge.progressPercent) >= 100) return textValue(badge.earnedLabel, badge.label ? `${badge.label} milestone earned` : '', 'Frozen lane milestone earned');
    const remaining = numberValue(badge.remaining, badge.amountRemaining);
    const metric = textValue(badge.unit, badge.metricLabel, badge.metric, 'activity');
    return textValue(badge.remainingLabel, badge.nextStep, remaining !== null ? `+${formatMetricAmount(remaining, metric)} to ${textValue(badge.label, 'the frozen lane milestone')}` : '', badge.label);
}

function renderPassportLane(lane) {
    const category = canonicalCategory(lane?.category || lane?.lane || lane?.id);
    const rank = numberValue(lane?.rank, lane?.currentRank);
    const progress = Math.round(progressPercent(lane));
    const stableBadge = lane?.badgeProgress || lane?.passportMilestone || lane?.milestoneProgress;
    const stablePercent = stableBadge && typeof stableBadge === 'object'
        ? numberValue(stableBadge.percent, stableBadge.progressPercent)
        : null;
    const statusLabel = rank
        ? `#${rank}${stablePercent !== null ? ` · ${progress}% badge` : ''}`
        : (stablePercent !== null ? `${progress}% badge` : 'unranked');
    const next = textValue(milestoneCopy(lane), lane?.nextStep, lane?.description, rank ? `Current season rank #${rank}; frozen milestone progress is not available for this lane.` : 'Progress is recorded at the next snapshot.');
    const topTenGap = rank && rank > 10 && lane?.passGap?.topTen
        ? passGapLabel({ passGap: lane.passGap.topTen })
        : '';
    return `
        <div class="maxis-passport-lane">
            <div class="maxis-passport-lane-head"><strong>${CATEGORY_ICONS[category] || '•'} ${escapeHtml(categoryLabel(category))}</strong><span>${escapeHtml(statusLabel)}</span></div>
            ${stablePercent !== null ? `<div class="maxis-progress-track" aria-label="${escapeHtml(categoryLabel(category))} stable badge progress ${progress}%"><span class="maxis-progress-fill" style="--maxis-progress: ${progress}%"></span></div>` : ''}
            <p><strong>${escapeHtml(scoreLabel(lane))}</strong> · ${escapeHtml(next)}</p>
            ${topTenGap ? `<p><strong>Moving Top 10 cutoff</strong> · ${escapeHtml(topTenGap)}</p>` : ''}
        </div>
    `;
}

function renderRecordCards(records, emptyCopy, icon) {
    if (!records.length) return `<div class="maxis-passport-lane"><div class="maxis-passport-lane-head"><strong>${icon} None recorded yet</strong><span>season</span></div><p>${escapeHtml(emptyCopy)}</p></div>`;
    return records.map((record) => {
        const category = canonicalCategory(record?.category || record?.lane);
        const title = textValue(record?.title, record?.label, category ? categoryLabel(category) : '', 'Season record');
        const detail = textValue(record?.detail, record?.description, record?.gapLabel, passGapLabel(record), record?.scoreLabel, record?.streakLabel, record?.rank ? `Best rank #${record.rank}` : '', 'Recorded this season');
        return `<div class="maxis-passport-lane"><div class="maxis-passport-lane-head"><strong>${icon} ${escapeHtml(title)}</strong><span>${escapeHtml(textValue(record?.value, record?.count, record?.rank ? `#${record.rank}` : ''))}</span></div><p>${escapeHtml(detail)}</p></div>`;
    }).join('');
}

function renderPassportCard(profile, note) {
    const lanes = profileLanes(profile);
    const nearMisses = profileNearMisses(profile);
    const streaks = normalizeNamedRecords(profile?.streaks || (profile?.activeWeekStreak ? [{ title: 'Active-week streak', count: profile.activeWeekStreak, detail: `${profile.activeWeekStreak} consecutive completed week${profile.activeWeekStreak === 1 ? '' : 's'} · active in ${asArray(profile.activeWeeks).length} season weeks` }] : []), 'Streak');
    const personalBests = profilePersonalBests(profile);
    const { qualifying, required, percent: unicornPercent } = passportUnicornProgress(profile, lanes);
    const badges = badgeRecords(profile);
    return `
        <article class="maxis-passport-card">
            <header class="maxis-passport-identity">
                <span class="maxis-passport-crest">${escapeHtml(textValue(profile?.crest, '✺'))}</span>
                <span class="maxis-passport-name"><span>Maxi Passport · address-bound</span><strong>${escapeHtml(textValue(profile?.alias, profile?.name, shortAddress(profile?.address)))}</strong><code>${escapeHtml(profile?.address)}</code></span>
                <span class="maxis-passport-unicorn"><strong>${unicornPercent}%</strong><small>${qualifying}/${required} qualifying lanes toward Unicorn</small></span>
            </header>
            <div class="maxis-passport-badges" aria-label="Passport badges">
                ${badges.map((badge) => `<span class="maxis-passport-badge${badge?.earned === false || badge?.locked ? ' is-locked' : ''}" title="${escapeHtml(textValue(badge?.detail, badge?.description))}"><b>${escapeHtml(textValue(badge?.icon, badge?.earned === false ? '○' : '✦'))}</b>${escapeHtml(textValue(badge?.title, badge?.label, 'Badge'))}</span>`).join('')}
            </div>
            <div class="maxis-side-heading" style="padding: 0.72rem 0.85rem 0"><strong>Current lanes</strong><span>${lanes.length} touched</span></div>
            <div class="maxis-passport-lanes">${lanes.length ? lanes.map(renderPassportLane).join('') : renderRecordCards([], 'Touch a ranked lane and the next season snapshot will begin the trail.', '◇')}</div>
            <div class="maxis-side-heading" style="padding: 0 0.85rem"><strong>Near misses</strong><span>moving cut lines</span></div>
            <div class="maxis-passport-lanes">${renderRecordCards(nearMisses, 'No trustworthy near-miss is present in the loaded depth yet.', '↟')}</div>
            <div class="maxis-side-heading" style="padding: 0 0.85rem"><strong>Streaks</strong><span>season ritual</span></div>
            <div class="maxis-passport-lanes">${renderRecordCards(streaks, 'A streak begins after activity is observed across declared checkpoints.', '⌁')}</div>
            <div class="maxis-side-heading" style="padding: 0 0.85rem"><strong>Personal bests</strong><span>your high-water marks</span></div>
            <div class="maxis-passport-lanes">${renderRecordCards(personalBests, 'Personal bests appear after at least two comparable snapshots.', '◆')}</div>
            ${note ? `<div class="maxis-cutline-card" style="margin: 0 0.85rem 0.85rem"><strong>Coverage note</strong>${escapeHtml(note)}</div>` : ''}
        </article>
    `;
}

function renderPassportPanel() {
    const saved = safeLocalStorageGet(MY_TEZOS_ADDRESS_KEY);
    return `
        ${renderRoomIntro('One address · every lane', 'Maxi Passport', 'Badges are stable achievements; rank gaps are moving races. This page never silently links wallets or changes the address saved in My Tezos.')}
        <section class="maxis-passport-shell">
            <form class="maxis-passport-search" data-maxis-passport-form>
                <input class="maxis-passport-input" name="address" aria-label="Tezos address for Maxi Passport" autocomplete="off" spellcheck="false" placeholder="tz1… tz2… tz3… or tz4…" value="${escapeHtml(chamberState.passportInput || chamberState.passportAddress)}">
                <button class="maxis-passport-submit" type="submit">Open Passport</button>
                <button class="maxis-passport-use-saved" type="button" data-maxis-use-saved ${saved ? '' : 'disabled'}>Use My Tezos</button>
            </form>
            <div aria-live="polite">
                ${chamberState.passportLoading ? '<div class="maxis-empty-stage"><div><span class="maxis-empty-stage-mark">✺</span><strong>Stamping the Passport…</strong><p>Reading only the deterministic shard for this address, then checking the loaded season ranks.</p></div></div>' : ''}
                ${!chamberState.passportLoading && chamberState.passportError ? `<div class="maxis-empty-stage"><div><span class="maxis-empty-stage-mark">!</span><strong>Passport not opened</strong><p>${escapeHtml(chamberState.passportError)}</p>${chamberState.passportAddress && !/^KT1/.test(chamberState.passportAddress) ? '<button class="maxis-passport-submit" type="button" data-maxis-passport-retry>Retry this shard</button>' : ''}</div></div>` : ''}
                ${!chamberState.passportLoading && !chamberState.passportError && chamberState.passportProfile ? renderPassportCard(chamberState.passportProfile, chamberState.passportNote) : ''}
                ${!chamberState.passportLoading && !chamberState.passportError && !chamberState.passportProfile ? '<div class="maxis-empty-stage"><div><span class="maxis-empty-stage-mark">✺</span><strong>Bring one wallet into focus</strong><p>Use the explicit address above or read the current My Tezos address. Neither action mutates saved wallet state.</p></div></div>' : ''}
            </div>
        </section>
    `;
}

function archiveLaneCatalog(source) {
    const catalog = new Map();
    const rows = Array.isArray(source)
        ? source.map((lane) => [textValue(lane?.category, lane?.lane, lane?.id), lane])
        : (source && typeof source === 'object' ? Object.entries(source) : []);
    rows.forEach(([category, lane], index) => {
        const rawCategory = textValue(lane?.category, lane?.lane, lane?.id, category);
        if (!rawCategory) return;
        const metadata = {
            title: textValue(lane?.title, lane?.laneTitle, lane?.label),
            order: numberValue(lane?.order, lane?.laneOrder, index)
        };
        catalog.set(rawCategory, metadata);
        catalog.set(canonicalCategory(rawCategory), metadata);
    });
    return catalog;
}

function normalizeChampionRows(source, frozenLaneCatalog = []) {
    const pending = [];
    if (Array.isArray(source)) {
        source.forEach((champion) => {
            if (champion && typeof champion === 'object') pending.push({ champion, category: champion?.category || champion?.lane });
        });
    } else if (source && typeof source === 'object') {
        Object.entries(source).forEach(([category, champion]) => {
            if (Array.isArray(champion)) champion.forEach((entry) => pending.push({ champion: entry, category }));
            else if (champion && typeof champion === 'object') pending.push({ champion, category });
        });
    }
    const catalog = archiveLaneCatalog(frozenLaneCatalog);
    return pending.map(({ champion, category }) => {
        const rawCategory = textValue(champion?.category, champion?.lane, category);
        const metadata = catalog.get(rawCategory) || catalog.get(canonicalCategory(rawCategory)) || {};
        return {
            ...champion,
            category: canonicalCategory(rawCategory),
            frozenLaneTitle: textValue(champion?.title, champion?.laneTitle, champion?.frozenLaneTitle, metadata?.title),
            frozenLaneOrder: numberValue(champion?.laneOrder, champion?.frozenLaneOrder, champion?.order, metadata?.order)
        };
    });
}

function archivedChampionLaneTitle(champion) {
    return textValue(champion?.frozenLaneTitle, champion?.title, champion?.laneTitle, categoryLabel(champion?.category || champion?.lane));
}

function normalizeArchiveHonors(source) {
    const honors = Array.isArray(source)
        ? source
        : (source && typeof source === 'object'
            ? Object.entries(source).map(([title, honor]) => ({
                ...(honor && typeof honor === 'object' ? honor : { detail: honor }),
                title: textValue(honor?.title, title.replace(/([a-z])([A-Z])/g, '$1 $2'))
            }))
            : []);
    return honors.flatMap((honor) => {
        if (String(honor?.status || '').toLowerCase() !== 'ready') return [];
        const recipients = honor?.winner ? [honor.winner] : asArray(honor?.winners || honor?.leader);
        return recipients
            .filter((recipient) => recipient?.address)
            .map((recipient) => ({ honor, recipient }));
    });
}

function archivesFromCurrentState() {
    const manifest = chamberState.manifest || {};
    const inline = manifest.archives || manifest.champions || manifest.hallOfChampions;
    let archives = [];
    if (Array.isArray(inline)) archives = inline;
    else if (inline && typeof inline === 'object') archives = Object.entries(inline).map(([id, archive]) => ({ id, ...(archive || {}) }));
    if (Array.isArray(chamberState.archives)) archives.push(...chamberState.archives);
    const unique = new Map();
    archives.forEach((archive, index) => {
        const id = seasonIdFrom(archive?.season || archive, `archive-${index}`);
        unique.set(id, { ...unique.get(id), ...archive, id });
    });
    return [...unique.values()];
}

async function ensureArchivesLoaded() {
    if (chamberState.archivesLoading || chamberState.archives) return;
    const serial = ++archiveRequestSerial;
    const completed = normalizedSeasons(chamberState.manifest, chamberState.summary).filter((season) => !season.isCurrent && ['final', 'finalized', 'complete', 'archived'].includes(season.status));
    if (!completed.length) {
        chamberState.archives = [];
        return;
    }
    chamberState.archivesLoading = true;
    renderExperience({ preserveScroll: true });
    const rows = await Promise.all(completed.map(async (season) => {
        let summary;
        try {
            summary = await loadSeasonSummary(season.id);
        } catch (error) {
            console.warn('Maxis archive identity receipt rejected', season.id, error);
            return null;
        }
        if (!summary) return null;
        const laneCatalog = summary.laneCatalog || summary.frozenLaneCatalog || summary?.rules?.laneCatalog;
        return {
            id: season.id,
            season,
            champions: summary.champions || summary.finalChampions || summary.winners || summary.leaders,
            ...(laneCatalog ? { laneCatalog } : {}),
            honors: summary.honors || summary.seasonHonors || null,
            finalizedAt: summary.finalizedAt || summary.generatedAt
        };
    }));
    if (serial !== archiveRequestSerial) return;
    chamberState.archives = rows.filter(Boolean);
    chamberState.archivesLoading = false;
    renderExperience({ preserveScroll: true });
}

function renderChampionsPanel() {
    const archives = archivesFromCurrentState();
    if (chamberState.archivesLoading) return `<div class="maxis-empty-stage"><div><span class="maxis-empty-stage-mark">◇</span><strong>Opening the permanent record…</strong><p>Reading finalized season sheets only.</p></div></div>`;
    if (!archives.length) {
        return `
            ${renderRoomIntro('Permanent protocol record', 'Champions outlive the season', 'Boards close at activation and become permanent only after the declared source-settlement rebuild. The current arena must finish before its first archive can exist.')}
            <div class="maxis-empty-stage"><div><span class="maxis-empty-stage-mark">◇</span><strong>The first protocol season is still live</strong><p>No champion is invented early. This hall opens when a season has a final boundary and an immutable result sheet.</p></div></div>
        `;
    }
    return `
        ${renderRoomIntro('Immutable archives', 'Champions', 'Every card is a finalized protocol season. Later scoring-rule changes belong to later seasons; they do not rewrite old winners.')}
        <section class="maxis-champions-shell">
            <div class="maxis-champions-grid">
                ${archives.map((archive) => {
                    const rawSeason = archive.season || archive;
                    const season = normalizeSeason(rawSeason, 0, chamberState.manifest);
                    const allRows = normalizeChampionRows(archive.champions || archive.winners || archive.leaders, archive.laneCatalog || archive.frozenLaneCatalog);
                    const order = new Map(CATEGORY_ORDER.map((category, index) => [category, index]));
                    const rows = allRows
                        .filter((champion) => champion?.address && !['empty', 'unavailable', 'withheld'].includes(String(champion?.status || '').toLowerCase()))
                        .sort((left, right) => {
                            const leftFrozen = numberValue(left?.frozenLaneOrder, left?.laneOrder);
                            const rightFrozen = numberValue(right?.frozenLaneOrder, right?.laneOrder);
                            if (leftFrozen !== null || rightFrozen !== null) return (leftFrozen ?? Number.MAX_SAFE_INTEGER) - (rightFrozen ?? Number.MAX_SAFE_INTEGER);
                            return (order.get(canonicalCategory(left?.category || left?.lane)) ?? 99) - (order.get(canonicalCategory(right?.category || right?.lane)) ?? 99);
                        });
                    const unawardedCount = allRows.length - rows.length;
                    const finalHonors = normalizeArchiveHonors(archive.honors || archive.seasonHonors);
                    return `
                        <article class="maxis-champion-card">
                            <header class="maxis-champion-banner"><span>Season ${escapeHtml(seasonNumberLabel(season))} · final</span><strong>${escapeHtml(season.protocol)}</strong></header>
                            <div class="maxis-champion-list">
                                ${rows.map((champion) => `<div class="maxis-champion-row"><span>${escapeHtml(archivedChampionLaneTitle(champion))}</span><strong title="${escapeHtml(textValue(champion?.address))}">${escapeHtml(leaderName(champion))}</strong></div>`).join('') || '<div class="maxis-champion-row"><span>Final sheet</span><strong>No qualifying crowns</strong></div>'}
                                ${unawardedCount ? `<div class="maxis-champion-row"><span>Unawarded lanes</span><strong>${escapeHtml(String(unawardedCount))} · see final receipts</strong></div>` : ''}
                                ${finalHonors.length ? `<div class="maxis-side-heading"><strong>Season Honors</strong><span>final</span></div>${finalHonors.map(({ honor, recipient }) => `<div class="maxis-champion-row"><span>✦ ${escapeHtml(textValue(honor?.title, honor?.label, 'Season honor').replace(/\b\w/g, (letter) => letter.toUpperCase()))}</span><strong title="${escapeHtml(textValue(recipient?.address))}">${escapeHtml(leaderName(recipient))}${numberValue(recipient?.rank) ? ` · #${escapeHtml(String(recipient.rank))}` : ''}</strong></div>`).join('')}` : ''}
                            </div>
                        </article>
                    `;
                }).join('')}
            </div>
        </section>
    `;
}

function renderMethodology() {
    const summary = chamberState.summary;
    const legacy = chamberState.legacy;
    const coverage = summary?.coverage || legacy?.coverage || {};
    const caveat = textValue(coverage?.caveat, coverage?.note, 'Coverage follows the declared source catalog and the published season rules. Missing data is left missing, not estimated into a crown.');
    const receipts = Object.entries(summary?.sourceReceipts || {}).filter(([key]) => key !== 'activation').slice(0, 9);
    const sources = asArray(summary?.sources);
    const activationUrl = summary?.sourceReceipts?.activation?.tzktBlock?.sourceUrl;
    const rules = summary?.rules || {};
    const rulesUrl = resolveDataUrl(rules?.rulesPath);
    const ruleHashes = [
        ['evaluator', rules?.evaluatorImplementationHash],
        ['rules', rules?.rulesHash],
        ['coverage', rules?.semanticContractCoverageHash || rules?.contractCoverageHash]
    ].filter(([, hash]) => hash);
    return `
        <details class="maxis-methodology">
            <summary>Rules, coverage, and identity</summary>
            <div class="maxis-methodology-body">
                <p>Protocol Season ranks use activation-bounded score sheets. Crown Hall preserves the original lane-specific live, rolling, and all-time windows. A Passport follows one explicit address; wallets are never silently merged.</p>
                <p>Pass gaps publish two different receipts: the primary-metric guarantee is actionable and strictly clears the frozen target; a conservative static-vector path compares only the frozen score vectors and is never a live minimum because other wallets can move.</p>
                <p>${escapeHtml(caveat)}</p>
                ${receipts.length ? `<div class="maxis-methodology-facts">${receipts.map(([key, receipt]) => {
                    const count = numberValue(receipt?.rows, receipt?.operations, receipt?.reportedRows, receipt?.ballots, receipt?.originations);
                    const status = receipt?.complete === true ? 'complete' : textValue(receipt?.availability, 'partial');
                    return `<span><strong>${escapeHtml(status)}</strong>${escapeHtml(key.replace(/([a-z])([A-Z])/g, '$1 $2'))}${count !== null ? ` · ${escapeHtml(formatNumber(count))}` : ''}</span>`;
                }).join('')}</div>` : ''}
                ${ruleHashes.length ? `<div class="maxis-methodology-facts">${ruleHashes.map(([label, hash]) => `<span title="${escapeHtml(hash)}"><strong>${escapeHtml(String(hash).slice(0, 10))}…</strong>${escapeHtml(label)} hash</span>`).join('')}</div>` : ''}
                ${sources.length || activationUrl || rulesUrl ? `<p>${sources.map((source) => source?.url ? `<a class="maxis-rank-action" href="${escapeHtml(source.url)}" target="_blank" rel="noopener">${escapeHtml(textValue(source.name, 'Source'))} ↗</a>` : '').join(' ')} ${activationUrl ? `<a class="maxis-rank-action" href="${escapeHtml(activationUrl)}" target="_blank" rel="noopener">Activation block ↗</a>` : ''} ${rulesUrl ? `<a class="maxis-rank-action" href="${escapeHtml(rulesUrl)}" target="_blank" rel="noopener">Frozen season rules ↗</a>` : ''}</p>` : ''}
                <p class="maxis-methodology-note">Crowns are objective activity metrics, not endorsements. Season honors reward trajectory and breadth without changing the crown score.</p>
            </div>
        </details>
    `;
}

function renderCurrentRoom() {
    if (chamberState.view === 'passport') return renderPassportPanel();
    if (chamberState.view === 'crown') return renderCrownHallPanel();
    if (chamberState.view === 'champions') return renderChampionsPanel();
    return renderSeasonPanel();
}

function renderChamberExperience() {
    const selectedView = chamberState.view;
    const state = freshness(chamberState.summary || chamberState.legacy);
    return `
        <div class="maxis-experience" data-maxis-current-view="${selectedView}">
            ${renderSeasonSelector()}
            ${renderProtocolHero()}
            ${renderRoomTabs()}
            <section class="maxis-room-panel" id="maxis-panel-${selectedView}" role="tabpanel" aria-labelledby="maxis-tab-${selectedView}" tabindex="-1">
                ${renderCurrentRoom()}
            </section>
            ${renderMethodology()}
            <footer class="chamber-footer maxis-footer">
                <span>Sources: TzKT + OBJKT · ${escapeHtml(state.stale ? 'previous valid data' : 'generated season data')}</span>
                <span class="chamber-footer-sep">·</span>
                <span>Protocol boundaries stay explicit</span>
                <span class="chamber-footer-sep">·</span>
                <a class="panel-direct-link" href="/maxis/">Direct: /maxis/</a>
            </footer>
        </div>
    `;
}

function setSelectorOpen(open, { focus = false } = {}) {
    chamberState.selectorOpen = Boolean(open);
    const tray = document.querySelector('#maxis-modal .maxis-season-tray');
    const orb = tray?.querySelector('.maxis-season-orb');
    tray?.classList.toggle('is-open', chamberState.selectorOpen);
    orb?.setAttribute('aria-expanded', chamberState.selectorOpen ? 'true' : 'false');
    if (focus && orb) {
        chamberState.selectorFocusReturn = true;
        orb.focus({ preventScroll: true });
        queueMicrotask(() => { chamberState.selectorFocusReturn = false; });
    }
}

function closeOtherRowMenus() {
    chamberState.rowDetail = null;
}

function renderExperience({ preserveScroll = false, focusSelector = '' } = {}) {
    const overlay = document.getElementById('maxis-modal');
    const body = overlay?.querySelector('.maxis-body');
    const content = overlay?.querySelector('.maxis-content');
    if (!overlay?.classList.contains('active') || !body) return;
    const scrollTop = preserveScroll ? content?.scrollTop || 0 : 0;
    body.innerHTML = renderChamberExperience();
    wireExperience(body);
    content?.scrollTo({ top: scrollTop, behavior: 'auto' });
    if (focusSelector) requestAnimationFrame(() => body.querySelector(focusSelector)?.focus({ preventScroll: true }));
}

async function selectSeason(seasonId) {
    if (!seasonId || seasonId === chamberState.seasonId) {
        setSelectorOpen(false, { focus: true });
        return;
    }
    const serial = ++requestSerial;
    chamberState.seasonId = seasonId;
    chamberState.summary = null;
    chamberState.summaryLoading = true;
    chamberState.passportProfile = null;
    chamberState.passportNote = '';
    closeOtherRowMenus();
    setSelectorOpen(false);
    syncRouteState();
    renderExperience({ preserveScroll: false, focusSelector: '.maxis-season-orb' });
    try {
        chamberState.summary = await loadSeasonSummary(seasonId);
    } catch (error) {
        if (serial !== requestSerial) return;
        chamberState.summaryLoading = false;
        const body = document.querySelector('#maxis-modal .maxis-body');
        if (body) renderError(body, error);
        return;
    }
    if (serial !== requestSerial) return;
    chamberState.summaryLoading = false;
    ensureValidLane(chamberState.view === 'crown' ? chamberState.legacy || {} : chamberState.summary || {});
    renderExperience({ preserveScroll: false, focusSelector: '.maxis-season-orb' });
    updateEntryCard(chamberState.legacy, chamberState.manifest, chamberState.summary);
    if (chamberState.view === 'passport' && chamberState.passportAddress) await openPassport(chamberState.passportAddress, { usesSaved: chamberState.passportUsesSaved });
}

async function selectView(view, { focus = true } = {}) {
    if (!VIEW_KEYS.includes(view)) return;
    const previousLaneRoom = chamberState.view === 'crown' ? 'crown' : 'season';
    if (chamberState.lane) chamberState.laneByView[previousLaneRoom] = chamberState.lane;
    chamberState.view = view;
    const nextLaneRoom = view === 'crown' ? 'crown' : 'season';
    chamberState.lane = chamberState.laneByView[nextLaneRoom] || chamberState.lane;
    closeOtherRowMenus();
    if (view === 'season') ensureValidLane(chamberState.summary || {});
    if (view === 'crown') ensureValidLane(chamberState.legacy || {});
    syncRouteState();
    renderExperience({ preserveScroll: false, focusSelector: focus ? `[data-maxis-view="${view}"]` : '' });
    if (view === 'passport' && !chamberState.passportAddress) {
        const saved = safeLocalStorageGet(MY_TEZOS_ADDRESS_KEY);
        if (saved) await openPassport(saved, { usesSaved: true });
    }
    if (view === 'champions') ensureArchivesLoaded();
}

async function openPassport(rawAddress, { usesSaved = false } = {}) {
    const status = implicitAddressStatus(rawAddress);
    chamberState.passportInput = status.address;
    chamberState.passportAddress = status.address;
    chamberState.passportUsesSaved = usesSaved;
    chamberState.passportProfile = null;
    chamberState.passportNote = '';
    chamberState.passportError = status.error;
    syncRouteState();
    if (status.error) {
        chamberState.passportLoading = false;
        renderExperience({ preserveScroll: true, focusSelector: '.maxis-passport-input' });
        return;
    }
    const serial = ++requestSerial;
    chamberState.passportLoading = true;
    renderExperience({ preserveScroll: true });
    let result;
    try {
        result = await loadPassportProfile(status.address);
    } catch (error) {
        if (serial !== requestSerial) return;
        chamberState.passportLoading = false;
        chamberState.passportError = textValue(error?.message, 'The deterministic Passport shard could not be loaded.');
        chamberState.passportNote = '';
        renderExperience({ preserveScroll: true, focusSelector: '[data-maxis-passport-retry]' });
        return;
    }
    if (serial !== requestSerial) return;
    chamberState.passportProfile = result.profile;
    chamberState.passportNote = result.note;
    chamberState.passportLoading = false;
    chamberState.passportError = '';
    renderExperience({ preserveScroll: true, focusSelector: '.maxis-passport-input' });
}

function wireSeasonSelector(body) {
    const tray = body.querySelector('.maxis-season-tray');
    const orb = tray?.querySelector('.maxis-season-orb');
    if (!tray || !orb) return;
    tray.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'touch') setSelectorOpen(true);
    });
    tray.addEventListener('pointerleave', (event) => {
        if (event.pointerType !== 'touch' && !tray.contains(document.activeElement)) setSelectorOpen(false);
    });
    tray.addEventListener('focusin', () => {
        if (!chamberState.selectorFocusReturn) setSelectorOpen(true);
    });
    tray.addEventListener('focusout', () => {
        setTimeout(() => {
            if (!tray.contains(document.activeElement)) setSelectorOpen(false);
        }, 0);
    });
    orb.addEventListener('pointerdown', (event) => {
        chamberState.selectorWasOpenAtPointerDown = chamberState.selectorOpen;
        chamberState.lastSelectorPointerType = event.pointerType;
    });
    orb.addEventListener('click', (event) => {
        event.stopPropagation();
        if (event.detail === 0) {
            setSelectorOpen(true);
            return;
        }
        const hoverDevice = window.matchMedia?.('(hover: hover)').matches && chamberState.lastSelectorPointerType !== 'touch';
        setSelectorOpen(hoverDevice ? true : !chamberState.selectorWasOpenAtPointerDown);
    });
    tray.addEventListener('keydown', (event) => {
        const options = [...tray.querySelectorAll('[role="menuitemradio"]')];
        if (!options.length) return;
        if (event.target === orb && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            setSelectorOpen(true);
            const target = event.key === 'ArrowUp' || event.key === 'End'
                ? options[options.length - 1]
                : (options.find((option) => option.getAttribute('aria-checked') === 'true') || options[0]);
            target.focus({ preventScroll: true });
            return;
        }
        const index = options.indexOf(event.target);
        if (index < 0 || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = options.length - 1;
        else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % options.length;
        else next = (index - 1 + options.length) % options.length;
        options[next].focus({ preventScroll: true });
    });
}

// Kept as a compatibility hook for generated shells that may still contain the
// former all-lanes jump rail. The protocol-season rail uses delegated lane state.
function wireCategoryJumps(body) {
    body.querySelector('.maxis-category-nav')?.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-maxis-jump]') : null;
        if (!button?.dataset.maxisJump) return;
        chamberState.lane = canonicalCategory(button.dataset.maxisJump);
        chamberState.laneByView[chamberState.view === 'crown' ? 'crown' : 'season'] = chamberState.lane;
        renderExperience({ preserveScroll: true });
    });
}

function wireExperience(body) {
    wireCategoryJumps(body);
    wireSeasonSelector(body);
    if (!body.dataset.maxisClickWired) body.addEventListener('click', (event) => {
        const source = event.target instanceof Element ? event.target : null;
        if (!source) return;
        const seasonButton = source.closest('[data-maxis-season]');
        if (seasonButton) {
            event.preventDefault();
            selectSeason(seasonButton.dataset.maxisSeason);
            return;
        }
        const viewButton = source.closest('.maxis-room-tab[data-maxis-view]');
        if (viewButton) {
            event.preventDefault();
            selectView(viewButton.dataset.maxisView);
            return;
        }
        const laneButton = source.closest('[data-maxis-lane]');
        if (laneButton) {
            chamberState.lane = canonicalCategory(laneButton.dataset.maxisLane);
            chamberState.laneByView[chamberState.view === 'crown' ? 'crown' : 'season'] = chamberState.lane;
            closeOtherRowMenus();
            syncRouteState();
            renderExperience({ preserveScroll: true, focusSelector: `[data-maxis-lane="${chamberState.lane}"]` });
            return;
        }
        const rowButton = source.closest('[data-maxis-row-menu]');
        if (rowButton) {
            const key = rowButton.dataset.maxisRowMenu;
            chamberState.rowDetail = chamberState.rowDetail === key ? null : key;
            renderExperience({ preserveScroll: true, focusSelector: `[data-maxis-row-menu="${CSS.escape(key)}"]` });
            return;
        }
        const share = source.closest('[data-maxis-share]');
        if (share) {
            const data = chamberState.view === 'crown' ? chamberState.legacy : chamberState.summary;
            const category = canonicalCategory(share.dataset.maxisShareLane);
            const entry = normalizedRanking(data || {}, category).find((row) => row.address === share.dataset.maxisShare);
            recordRankShare(entry || { address: share.dataset.maxisShare }, category);
            return;
        }
        if (source.closest('[data-maxis-use-saved]')) {
            event.preventDefault();
            openPassport(safeLocalStorageGet(MY_TEZOS_ADDRESS_KEY), { usesSaved: true });
            return;
        }
        if (source.closest('[data-maxis-passport-retry]')) {
            event.preventDefault();
            shardCache.clear();
            openPassport(chamberState.passportAddress, { usesSaved: chamberState.passportUsesSaved });
        }
    });
    body.dataset.maxisClickWired = '1';
    body.querySelector('[data-maxis-passport-form]')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.address;
        openPassport(input?.value || '', { usesSaved: false });
    });
    body.querySelector('.maxis-room-tabs')?.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
        const index = tabs.indexOf(event.target);
        if (index < 0) return;
        event.preventDefault();
        let next = index;
        if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else next = (index - 1 + tabs.length) % tabs.length;
        selectView(tabs[next].dataset.maxisView);
    });
    body.querySelector('.maxis-lane-rail')?.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const chips = [...event.currentTarget.querySelectorAll('[data-maxis-lane]')];
        const index = chips.indexOf(event.target);
        if (index < 0) return;
        event.preventDefault();
        let next = index;
        if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = chips.length - 1;
        else if (event.key === 'ArrowRight') next = (index + 1) % chips.length;
        else next = (index - 1 + chips.length) % chips.length;
        chips[next].click();
    });
}

function entryRaceRecords(summary) {
    if (!summary) return [];
    const explicit = summary.hotRaces || summary.races;
    if (Array.isArray(explicit)) return explicit.slice(0, 4);
    if (explicit && typeof explicit === 'object') {
        return Object.entries(explicit).map(([category, race]) => ({ category, ...(race || {}) })).slice(0, 4);
    }
    return categoriesFor(summary).map((category) => {
        const ranking = normalizedRanking(summary, category);
        return { category, leader: ranking[0], challenger: ranking[1], cutoff: ranking[9] };
    }).filter((race) => race.leader).slice(0, 4);
}

function renderEntryContents(legacy, manifest, summary) {
    const season = normalizedSeasons(manifest, summary)[0];
    const seasonData = summary || null;
    const legacyData = legacy || {};
    const races = entryRaceRecords(seasonData);
    const fallbackCategories = categoriesFor(legacyData).slice(0, 4);
    const fallbackRaces = fallbackCategories.map((category) => {
        const ranking = normalizedRanking(legacyData, category);
        return { category, leader: ranking[0], challenger: ranking[1] };
    });
    const visibleRaces = (races.length ? races : fallbackRaces).slice(0, window.matchMedia?.('(max-width: 420px)').matches ? 3 : 4);
    const passportRecords = seasonData ? numberValue(seasonData?.passports?.indexedAddresses, seasonData?.coverage?.indexedAddresses) : null;
    const wallets = seasonData ? (passportRecords ?? uniqueRankedWallets(seasonData)) : uniqueRankedWallets(legacyData);
    const currentUnicorn = normalizedRanking(seasonData || legacyData, 'unicorn')[0];
    return `
        <div class="maxis-entry-season-front">
            <div class="maxis-entry-season-copy">
                <span class="maxis-entry-season-label">◉ Season ${escapeHtml(seasonNumberLabel(season))} · ${escapeHtml(season?.isCurrent ? 'live' : season?.status)}</span>
                <div class="maxis-entry-season-title">${escapeHtml(season?.displayLabel || `${season?.protocol || 'Tezos'} Season`)}</div>
                <p>Protocol-bounded races, wallet Passports, and crowns preserved after each season’s settled close.</p>
                <div class="maxis-entry-season-meta">
                    <span><strong>${escapeHtml(seasonEndCopy(season, { compact: true }))}</strong></span>
                    <span><strong>${escapeHtml(String(wallets || '—'))}</strong> ${passportRecords !== null ? 'Passport records' : 'ranked wallets'}</span>
                    <span><strong>${escapeHtml(leaderName(currentUnicorn))}</strong> Unicorn</span>
                </div>
            </div>
            <div class="maxis-entry-races" aria-label="Hot Maxis races">
                ${visibleRaces.map((race) => {
                    const category = canonicalCategory(race?.category || race?.lane || race?.id);
                    const leader = race?.leader || race?.currentLeader || normalizedRanking(seasonData || legacyData, category)[0];
                    const challenger = race?.challenger || race?.nearestChallenger || normalizedRanking(seasonData || legacyData, category)[1];
                    const detail = textValue(race?.gapLabel, race?.gapToLeaderLabel, challenger ? `${leaderName(challenger)} chasing` : '', scoreLabel(leader));
                    return `<div class="maxis-entry-race"><span>${CATEGORY_ICONS[category] || '•'} ${escapeHtml(categoryLabel(category))}</span><strong>${escapeHtml(leaderName(leader))}</strong><small>${escapeHtml(detail)}</small></div>`;
                }).join('') || '<div class="maxis-entry-race"><span>Protocol season</span><strong>Opening the arena…</strong><small>Crown Hall remains available</small></div>'}
            </div>
        </div>
    `;
}

function updateEntryCard(legacy, manifest = null, summary = null) {
    const card = document.getElementById('maxis-entry-card');
    if (!card) return;
    const front = card.querySelector('.maxis-entry-front');
    if (front) front.innerHTML = renderEntryContents(legacy, manifest, summary);
    const state = freshness(summary || legacy);
    const season = normalizedSeasons(manifest, summary)[0];
    card.dataset.updatedLabel = `${season?.protocol || 'Maxis'} · ${state.stale ? 'previous valid' : state.label}`;
    card.classList.toggle('chamber-data-stale', state.stale);
    const backValue = card.querySelector('.card-back .stat-value');
    const backCopy = card.querySelector('.card-back .stat-description');
    if (backValue) backValue.textContent = `Season ${seasonNumberLabel(season)}`;
    if (backCopy) backCopy.textContent = seasonEndCopy(season);
    window.syncChamberEntryFooters?.(card);
}

function ensureEntryCard() {
    const grid = document.getElementById('chambers-grid');
    if (!grid) return null;
    let card = document.getElementById('maxis-entry-card');
    if (!card) {
        card = document.createElement('div');
        card.id = 'maxis-entry-card';
        card.className = 'stat-card chamber-entry-card chamber-entry-wide maxis-entry-card chamber-entry-adoption';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', 'Open Tezos Maxis Chamber');
        card.dataset.updatedLabel = 'Loading Maxis season';
        card.innerHTML = `
            <button class="card-copy-link" type="button" data-copy-hash="#maxis" aria-label="Copy Tezos Maxis direct link" title="Copy Tezos Maxis link">🔗</button>
            <div class="card-inner">
                <div class="card-front maxis-entry-front"><h2 class="stat-label">Tezos Maxis</h2><div class="maxis-entry-loading">Opening the protocol arena…</div></div>
                <div class="card-back" aria-hidden="true"><h2 class="stat-label">Tezos Maxis</h2><div class="stat-value">Protocol seasons</div><p class="stat-description">Every activation opens a new arena.</p></div>
            </div>
        `;
        grid.appendChild(card);
    }
    if (!card.dataset.maxisWired) {
        const open = (event) => {
            if (event?.target?.closest?.('button, a, .card-tooltip')) return;
            openMaxisChamber();
        };
        card.addEventListener('click', open);
        card.addEventListener('keydown', (event) => {
            if (!['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            open(event);
        });
        card.dataset.maxisWired = '1';
    }
    return card;
}

function getFocusable(root) {
    return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.getClientRects().length > 0);
}

function handleKeydown(event) {
    const overlay = document.getElementById('maxis-modal');
    if (!overlay?.classList.contains('active')) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (chamberState.selectorOpen || overlay.querySelector('.maxis-season-tray.is-open')) {
            setSelectorOpen(false, { focus: true });
            return;
        }
        closeMaxisChamber();
        return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getFocusable(overlay);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
    }
}

function handleOutsidePointer(event) {
    if (!chamberState.selectorOpen) return;
    const tray = document.querySelector('#maxis-modal .maxis-season-tray');
    if (tray && !tray.contains(event.target)) setSelectorOpen(false);
}

function renderError(body, error) {
    body.innerHTML = `
        <div class="chamber-error maxis-error">
            <div class="chamber-error-icon">✺</div>
            <h2 id="maxis-title" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">Tezos Maxis</h2>
            <h3>The Maxis records are off-chain</h3>
            <p>${escapeHtml(error?.message || 'Neither the Crown Hall snapshot nor a protocol-season sheet answered.')}</p>
            <button class="chamber-retry-btn" id="maxis-retry" type="button">Retry</button>
        </div>
    `;
    body.querySelector('#maxis-retry')?.addEventListener('click', () => refreshChamber({ force: true }));
}

async function refreshChamber({ force = false } = {}) {
    const overlay = document.getElementById('maxis-modal');
    const body = overlay?.querySelector('.maxis-body');
    if (!overlay?.classList.contains('active') || !body) return;
    body.innerHTML = `
        <div class="chamber-loading" aria-live="polite">
            <h2 id="maxis-title" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">Tezos Maxis</h2>
            <div class="chamber-loading-text">Opening the protocol arena…</div>
            <div class="chamber-loading-bar"><div class="chamber-loading-fill"></div></div>
            <div class="chamber-loading-subtext">Crown Hall first, then the selected season sheet.</div>
        </div>
    `;
    if (force) {
        archiveRequestSerial += 1;
        lastLegacy = null;
        lastManifest = null;
        summaryCache.clear();
        shardCache.clear();
        chamberState.archives = null;
        chamberState.archivesLoading = false;
    }
    const route = readRouteState();
    chamberState.view = route.view;
    chamberState.lane = route.lane || chamberState.lane;
    chamberState.laneByView[route.view === 'crown' ? 'crown' : 'season'] = route.lane || chamberState.laneByView[route.view === 'crown' ? 'crown' : 'season'];
    chamberState.passportAddress = route.address || '';
    chamberState.passportInput = route.address || '';
    chamberState.passportUsesSaved = false;
    chamberState.passportProfile = null;
    chamberState.passportError = '';
    const manifestTask = loadManifest({ force });
    let legacyError = null;
    try {
        chamberState.legacy = await loadLegacy({ force });
        renderExperience();
    } catch (error) {
        legacyError = error;
        console.warn('Maxis Crown Hall refresh failed', error);
    }
    const manifest = await manifestTask;
    chamberState.manifest = manifest;
    const seasons = normalizedSeasons(manifest);
    chamberState.seasonId = route.seasonId && seasons.some((season) => season.id === route.seasonId)
        ? route.seasonId
        : textValue(currentSeasonId(manifest), seasons[0]?.id);
    chamberState.summaryLoading = Boolean(manifest);
    if (manifest || chamberState.legacy) renderExperience({ preserveScroll: true });
    let summaryError = null;
    try {
        chamberState.summary = manifest ? await loadSeasonSummary(chamberState.seasonId, { force }) : null;
    } catch (error) {
        chamberState.summary = null;
        summaryError = error;
    }
    chamberState.summaryLoading = false;
    if (summaryError) {
        renderError(body, summaryError);
        return;
    }
    if (!chamberState.legacy && !chamberState.summary) {
        renderError(body, legacyError || new Error('No valid Maxis data source answered.'));
        return;
    }
    ensureValidLane(chamberState.view === 'crown' ? chamberState.legacy : chamberState.summary || {});
    syncRouteState();
    renderExperience({ preserveScroll: false });
    updateEntryCard(chamberState.legacy, chamberState.manifest, chamberState.summary);
    if (chamberState.view === 'passport') {
        const address = chamberState.passportAddress || safeLocalStorageGet(MY_TEZOS_ADDRESS_KEY);
        if (address) await openPassport(address, { usesSaved: !route.address });
    }
    if (chamberState.view === 'champions') ensureArchivesLoaded();
}

export async function openMaxisChamber() {
    ensureMaxisStyles();
    let overlay = document.getElementById('maxis-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'maxis-modal';
        overlay.className = 'modal-overlay chamber-overlay maxis-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = `
            <div class="modal-content modal-large chamber-content maxis-content" role="dialog" aria-modal="true" aria-label="Tezos Maxis Chamber" aria-labelledby="maxis-title" tabindex="-1">
                <button class="modal-close chamber-close" type="button" aria-label="Close Tezos Maxis Chamber">&times;</button>
                <div class="chamber-body maxis-body"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.chamber-close')?.addEventListener('click', closeMaxisChamber);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeMaxisChamber();
        });
    }
    if (overlay.classList.contains('active')) return;
    focusedBeforeOpen = document.activeElement;
    savedBodyOverflow = document.body.style.overflow;
    savedHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', handleKeydown, true);
    document.addEventListener('pointerdown', handleOutsidePointer, true);
    requestAnimationFrame(() => overlay.querySelector('.chamber-close')?.focus({ preventScroll: true }));
    await refreshChamber({ force: true });
}

export function closeMaxisChamber() {
    document.removeEventListener('keydown', handleKeydown, true);
    document.removeEventListener('pointerdown', handleOutsidePointer, true);
    const overlay = document.getElementById('maxis-modal');
    if (overlay) {
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
    }
    chamberState.selectorOpen = false;
    document.body.style.overflow = savedBodyOverflow || '';
    document.documentElement.style.overflow = savedHtmlOverflow || '';
    if (focusedBeforeOpen && document.contains(focusedBeforeOpen)) {
        const target = focusedBeforeOpen;
        requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }
    focusedBeforeOpen = null;
}

async function progressiveEntryLoad() {
    const manifestTask = loadManifest();
    try {
        const legacy = await loadLegacy();
        updateEntryCard(legacy, null, null);
    } catch (error) {
        console.debug('Tezos Maxis entry Crown Hall unavailable', error);
    }
    const manifest = await manifestTask;
    if (!manifest) return;
    const seasons = normalizedSeasons(manifest);
    const id = textValue(currentSeasonId(manifest), seasons[0]?.id);
    const summary = await loadSeasonSummary(id);
    updateEntryCard(lastLegacy, manifest, summary);
}

function handleMyTezosUpdate(event) {
    if (chamberState.view !== 'passport' || !chamberState.passportUsesSaved) return;
    const address = textValue(event?.detail?.address, safeLocalStorageGet(MY_TEZOS_ADDRESS_KEY));
    if (address && address !== chamberState.passportAddress) {
        openPassport(address, { usesSaved: true });
        return;
    }
    if (!address) {
        chamberState.passportAddress = '';
        chamberState.passportInput = '';
        chamberState.passportProfile = null;
        chamberState.passportNote = '';
        chamberState.passportError = 'My Tezos was cleared. Enter an address explicitly or save another My Tezos address.';
        syncRouteState();
        renderExperience({ preserveScroll: true, focusSelector: '.maxis-passport-input' });
    }
}

export function initMaxisChamber() {
    ensureMaxisStyles();
    ensureEntryCard();
    window.openMaxisChamber = openMaxisChamber;
    if (!initComplete) {
        window.addEventListener('my-baker-updated', handleMyTezosUpdate);
        initComplete = true;
    }
    progressiveEntryLoad().catch((error) => {
        console.debug('Tezos Maxis entry data unavailable', error);
        const card = document.getElementById('maxis-entry-card');
        if (card) {
            card.dataset.updatedLabel = 'Maxis data unavailable';
            card.classList.add('chamber-data-stale');
            window.syncChamberEntryFooters?.(card);
        }
    });
}
