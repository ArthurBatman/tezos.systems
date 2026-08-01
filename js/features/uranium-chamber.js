/**
 * Uranium Chamber
 *
 * A receipt-backed xU3O8 and uranium-market surface. Heavy source collection
 * remains generator-side; the browser reads bounded, integrity-checked
 * first-party artifacts and quietly reconciles them without moving the reader.
 */

import { quietlySyncHtml } from '../core/quiet-refresh.js';
import { GENERATED_PROOFBOOK_SCHEDULE_LABEL } from '../core/freshness-contracts.mjs';
import { sha256Text } from '../core/sha256.js';
import { escapeHtml, formatFreshnessStamp } from '../core/utils.js';
import {
    activateChamberDialog,
    deactivateChamberDialog,
    wireChamberLauncher
} from '../ui/chamber-accessibility.js';

const URANIUM_CSS_URL = '/css/uranium-chamber.css?v=539';
const URANIUM_SNAPSHOT_URL = '/data/uranium-snapshot.json';
const URANIUM_ENTRY_SUMMARY_URL = '/data/uranium-entry-summary.json';
const DEFAULT_REFRESH_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_AFTER_MS = 8 * 60 * 60 * 1000;

const TOKEN_CONTRACT = '0x79052Ab3C166D4899a1e0DD033aC3b379AF0B1fD';
const APP_CONTRACT = '0xF02B8aE0D525157797414953103F67D9d4Ee6F0a';

const VIEWS = Object.freeze([
    { id: 'overview', label: 'Core Sample', title: 'Core Sample', detail: 'The token, the physical claim, the current market, and the boundaries between them.' },
    { id: 'markets', label: 'Markets', title: 'Market Reactor', detail: 'Kraken price discovery, attributed venue context, and a non-executable uranium reference kept on separate clocks.' },
    { id: 'onchain', label: 'On-chain', title: 'Etherlink Ledger', detail: 'Indexed addresses, token supply, bounded transfer receipts, and disclosed contract controls.' },
    { id: 'proofbook', label: 'Proofbook', title: 'Proofbook', detail: 'Custody statements, cross-source arithmetic, rights, caveats, freshness, and every public receipt.' }
]);
const VIEW_IDS = new Set(VIEWS.map(({ id }) => id));
const SOURCE_STATUS_LABELS = Object.freeze({
    krakenMarket: 'Kraken market',
    krakenListing: 'Kraken listing',
    coinGecko: 'CoinGecko',
    blockscoutToken: 'Etherlink token',
    blockscoutContracts: 'contract lineage',
    etherlinkRpc: 'Etherlink RPC',
    defiLlama: 'DefiLlama',
    uraniumOracle: 'uranium reference',
    uraniumIssuer: 'issuer terms',
    proofOfReserves: 'custody statement'
});

const RANGES = Object.freeze([
    { id: '7D', label: '7D', days: 7 },
    { id: '30D', label: '30D', days: 30 },
    { id: '90D', label: '90D', days: 90 },
    { id: '1Y', label: '1Y', days: 365 }
]);
const RANGE_BY_ID = new Map(RANGES.map((range) => [range.id, range]));

let currentView = 'overview';
let currentRange = '30D';
let lastSnapshot = null;
let lastEntrySummary = null;
let lastRefreshError = '';
let activeFetch = null;
let activeEntryFetch = null;
let uraniumCssReady = null;
let chamberTimer = null;
let visibilityReady = false;
let refreshDeferred = false;
let entryRefreshDeferred = false;
let savedBodyOverflow = null;
let savedHtmlOverflow = null;

function numeric(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(normalized) ? normalized : null;
}

function stableJsonValue(value) {
    if (Array.isArray(value)) return value.map(stableJsonValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key])]));
}

function formatNumber(value, maximumFractionDigits = 0) {
    const number = numeric(value);
    if (number === null) return 'Unavailable';
    return number.toLocaleString('en-US', { maximumFractionDigits });
}

function formatCompact(value, maximumFractionDigits = 1) {
    const number = numeric(value);
    if (number === null) return 'Unavailable';
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits }).format(number);
}

function formatUsd(value, { compact = false, digits = null } = {}) {
    const number = numeric(value);
    if (number === null) return 'Unavailable';
    if (compact && Math.abs(number) >= 1000) return `$${formatCompact(number, 2)}`;
    const maximumFractionDigits = digits ?? (Math.abs(number) < 1 ? 4 : 2);
    return number.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits
    });
}

function formatPct(value, { signed = false } = {}) {
    const number = numeric(value);
    if (number === null) return 'Unavailable';
    return `${signed && number > 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function formatDate(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return 'Unavailable';
    return new Date(timestamp).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC'
    });
}

function formatTimestamp(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return 'Unavailable';
    return new Date(timestamp).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
        timeZoneName: 'short'
    });
}

function ageLabel(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return 'freshness unavailable';
    const elapsed = Math.max(0, Date.now() - timestamp);
    if (elapsed < 60 * 1000) return 'under 1m ago';
    if (elapsed < 60 * 60 * 1000) return `${Math.floor(elapsed / (60 * 1000))}m ago`;
    if (elapsed < DAY_MS) return `${Math.floor(elapsed / (60 * 60 * 1000))}h ago`;
    return `${Math.floor(elapsed / DAY_MS)}d ago`;
}

function truncate(value, head = 8, tail = 6) {
    const text = String(value || '');
    return text.length <= head + tail + 1 ? text : `${text.slice(0, head)}…${text.slice(-tail)}`;
}

function safeExternalUrl(value) {
    try {
        const url = new URL(String(value || ''));
        return url.protocol === 'https:' ? url.href : '';
    } catch {
        return '';
    }
}

function firstNumeric(...values) {
    for (const value of values) {
        const number = numeric(value);
        if (number !== null) return number;
    }
    return null;
}

function firstText(...values) {
    return values.find((value) => typeof value === 'string' && value.trim()) || '';
}

function statusClass(status) {
    if (status === 'ok' || status === 'online' || status === 'current') return 'is-good';
    if (status === 'stale' || status === 'partial' || status === 'review') return 'is-warn';
    return 'is-bad';
}

function sourceReceiptFor(snapshot, id) {
    const full = snapshot?.sources?.[id];
    if (full && typeof full === 'object') return full;
    const projected = snapshot?.sourceStatuses?.[id];
    return projected && typeof projected === 'object' ? projected : {};
}

function sourceStatus(snapshot, id) {
    return firstText(sourceReceiptFor(snapshot, id).status, 'unavailable');
}

function sourceInventory(snapshot) {
    const inventory = snapshot?.sources || snapshot?.sourceStatuses || {};
    return Object.entries(inventory).map(([id, receipt]) => ({
        id,
        label: firstText(receipt?.label, SOURCE_STATUS_LABELS[id], id),
        status: firstText(receipt?.status, 'unavailable')
    }));
}

function issuerReceiptLink(value, label = 'Issuer receipt') {
    const url = safeExternalUrl(value);
    return url ? ` <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>` : '';
}

function issuerTermsModel(snapshot) {
    const terms = snapshot?.identity?.terms || {};
    const ownership = terms.ownership || {};
    const custody = terms.custody || {};
    const redemption = terms.redemption || {};
    const fees = terms.fees || {};
    const rights = terms.rights || {};
    const priceDiscovery = terms.priceDiscovery || {};
    const deniedRights = [
        rights.equityRights === false || rights.equity === false ? 'equity' : '',
        rights.governanceRights === false || rights.governance === false ? 'governance' : '',
        rights.votingRights === false || rights.voting === false ? 'voting' : ''
    ].filter(Boolean);
    return {
        ownershipDescription: firstText(
            ownership.issuerDescription,
            ownership.currentSemantics,
            ownership.kind,
            'Current issuer ownership semantics are unavailable in this snapshot.'
        ),
        ownershipReceipt: firstText(ownership.receipts?.at?.(-1), ownership.receipt),
        trustee: firstText(custody.trusteeAccount, 'the disclosed trustee account'),
        storageOperator: firstText(custody.storageOperator, 'the disclosed storage operator'),
        custodyReceipt: firstText(custody.receipt),
        redemptionCondition: firstText(
            redemption.condition,
            redemption.retailPhysicalDelivery === false
                ? 'Issuer terms do not offer ordinary retail physical delivery.'
                : 'Current issuer redemption terms are unavailable in this snapshot.'
        ),
        redemptionReceipt: firstText(redemption.receipt),
        feeCeilingPct: firstNumeric(fees.custodyAndAdministrationMaximumAnnualPct, fees.maximumAnnualPct),
        feeCurrentlyCharged: firstNumeric(fees.currentlyCharged),
        feeStatusNote: firstText(fees.currentStatusNote, 'The currently charged rate is not confirmed by this snapshot.'),
        feeReceipt: firstText(fees.receipt),
        deniedRights,
        profitSharing: rights.profitSharingRights ?? rights.profitSharing ?? null,
        rightsReceipt: firstText(rights.receipt),
        rightsNote: firstText(rights.note),
        formalPeg: priceDiscovery.formalPeg,
        priceReceipt: firstText(priceDiscovery.receipt),
        caveat: firstText(terms.caveat, 'Issuer descriptions are not independent legal conclusions.')
    };
}

function issuerRightsSummary(terms) {
    const denied = terms.deniedRights;
    const deniedText = denied.length
        ? `The issuer whitepaper states that ${denied.length === 1 ? denied[0] : `${denied.slice(0, -1).join(', ')}, and ${denied.at(-1)}`} rights are not provided.`
        : 'This snapshot does not contain an equally direct issuer statement about equity, governance, or voting rights.';
    const profitText = terms.profitSharing === null
        ? 'No profit-sharing right is asserted because this snapshot lacks an equally direct receipt.'
        : terms.profitSharing === false
            ? 'The issuer receipt states that no profit-sharing right is provided.'
            : 'The issuer receipt describes a profit-sharing right; consult the current terms before relying on it.';
    return `${deniedText} ${profitText}`;
}

function directionClass(value) {
    const number = numeric(value);
    if (number === null || Math.abs(number) < .005) return 'is-flat';
    return number > 0 ? 'is-positive' : 'is-negative';
}

function ensureUraniumCss() {
    const existing = document.getElementById('uranium-chamber-css');
    if (existing?.sheet) return Promise.resolve(true);
    if (uraniumCssReady) return uraniumCssReady;
    const link = existing || document.createElement('link');
    if (!existing) {
        link.id = 'uranium-chamber-css';
        link.rel = 'stylesheet';
        link.href = URANIUM_CSS_URL;
    }
    uraniumCssReady = new Promise((resolve) => {
        link.addEventListener('load', () => resolve(true), { once: true });
        link.addEventListener('error', () => resolve(false), { once: true });
    });
    if (!existing) document.head.appendChild(link);
    return uraniumCssReady;
}

async function validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || snapshot.schemaVersion !== 1) {
        throw new Error('Uranium snapshot schemaVersion 1 is required.');
    }
    if (!Number.isFinite(Date.parse(snapshot.generatedAt || ''))
        || !/^[0-9a-f]{64}$/.test(snapshot.contentHash || '')
        || snapshot.identity?.tokenContract?.toLowerCase() !== TOKEN_CONTRACT.toLowerCase()
        || firstText(snapshot.identity?.appContract, snapshot.identity?.companionAppContract).toLowerCase() !== APP_CONTRACT.toLowerCase()
        || !snapshot.market?.coin
        || !snapshot.market?.kraken
        || !snapshot.physical?.proof
        || !snapshot.chain?.token
        || !snapshot.sources) {
        throw new Error('Uranium snapshot is missing required market, physical, chain, or receipt sections.');
    }
    const { contentHash, ...unsigned } = snapshot;
    const actualHash = await sha256Text(JSON.stringify(stableJsonValue(unsigned)));
    if (actualHash.toLowerCase() !== contentHash.toLowerCase()) {
        throw new Error('Uranium snapshot failed its SHA-256 integrity receipt.');
    }
    if (lastEntrySummary?.source?.contentHash
        && lastEntrySummary.source.contentHash.toLowerCase() !== contentHash.toLowerCase()) {
        const projectionTime = Date.parse(lastEntrySummary.source.generatedAt || lastEntrySummary.generatedAt || '');
        const snapshotTime = Date.parse(snapshot.generatedAt || '');
        if (!Number.isFinite(projectionTime) || snapshotTime <= projectionTime) {
            throw new Error('Uranium snapshot is older than the launcher projection receipt.');
        }
        lastEntrySummary = null;
    }
    return snapshot;
}

async function validateEntrySummary(summary) {
    if (!summary || typeof summary !== 'object' || summary.schemaVersion !== 1) {
        throw new Error('Uranium entry summary schemaVersion 1 is required.');
    }
    if (!Number.isFinite(Date.parse(summary.generatedAt || ''))
        || !/^[0-9a-f]{64}$/.test(summary.contentHash || '')
        || summary.source?.path !== 'data/uranium-snapshot.json'
        || !/^[0-9a-f]{64}$/.test(summary.source?.contentHash || '')
        || !/^[0-9a-f]{64}$/.test(summary.source?.fileSha256 || '')
        || summary.identity?.tokenContract?.toLowerCase() !== TOKEN_CONTRACT.toLowerCase()
        || !summary.market?.coin
        || !summary.market?.kraken
        || !summary.physical?.proof
        || !summary.chain?.token) {
        throw new Error('Uranium entry summary is missing its projection receipt or launcher fields.');
    }
    const { contentHash, ...unsigned } = summary;
    const actualHash = await sha256Text(JSON.stringify(stableJsonValue(unsigned)));
    if (actualHash.toLowerCase() !== contentHash.toLowerCase()) {
        throw new Error('Uranium entry summary failed its SHA-256 integrity receipt.');
    }
    return summary;
}

function fetchUraniumSnapshot() {
    if (activeFetch) return activeFetch;
    activeFetch = fetch(URANIUM_SNAPSHOT_URL, { cache: 'no-store', headers: { Accept: 'application/json' } })
        .then((response) => {
            if (!response.ok) throw new Error(`Uranium snapshot HTTP ${response.status}`);
            return response.json();
        })
        .then(validateSnapshot)
        .finally(() => { activeFetch = null; });
    return activeFetch;
}

function fetchUraniumEntrySummary() {
    if (activeEntryFetch) return activeEntryFetch;
    activeEntryFetch = fetch(URANIUM_ENTRY_SUMMARY_URL, { cache: 'no-store', headers: { Accept: 'application/json' } })
        .then((response) => {
            if (!response.ok) throw new Error(`Uranium entry summary HTTP ${response.status}`);
            return response.json();
        })
        .then(validateEntrySummary)
        .finally(() => { activeEntryFetch = null; });
    return activeEntryFetch;
}

function coinModel(snapshot) {
    const coin = snapshot?.market?.coin || {};
    const ticker = snapshot?.market?.kraken?.ticker || {};
    return {
        price: firstNumeric(coin.currentPriceUsd, coin.priceUsd, ticker.lastPriceUsd, ticker.last),
        change24h: firstNumeric(coin.change24hPct, coin.priceChange24hPct, ticker.change24hPct),
        volume24h: firstNumeric(coin.volume24hUsd, coin.totalVolumeUsd, ticker.volume24hUsd),
        marketCap: firstNumeric(coin.marketCapUsd, coin.marketCap),
        updatedAt: firstText(coin.lastUpdated, coin.observedAt, ticker.observedAt, snapshot?.market?.clock?.observedAt)
    };
}

function krakenModel(snapshot) {
    const kraken = snapshot?.market?.kraken || {};
    const ticker = kraken.ticker || {};
    const pair = kraken.pair || {};
    const book = kraken.orderBook || {};
    const receipt = sourceReceiptFor(snapshot, 'krakenMarket');
    const receiptStatus = sourceStatus(snapshot, 'krakenMarket');
    const venueStatus = firstText(pair.status, kraken.status, 'unavailable');
    const bids = Array.isArray(book.bids) ? book.bids : [];
    const asks = Array.isArray(book.asks) ? book.asks : [];
    const bestBid = firstNumeric(ticker.bidUsd, ticker.bid, bids[0]?.priceUsd, bids[0]?.price, bids[0]?.[0]);
    const bestAsk = firstNumeric(ticker.askUsd, ticker.ask, asks[0]?.priceUsd, asks[0]?.price, asks[0]?.[0]);
    const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
    const spreadPct = firstNumeric(ticker.spreadPct, book.spreadPct,
        mid && bestAsk !== null && bestBid !== null ? ((bestAsk - bestBid) / mid) * 100 : null);
    return {
        pair: firstText(pair.displayName, pair.pair, pair.wsname, pair.websocketName, kraken.pairName, 'XU3O8/USD'),
        status: receiptStatus === 'ok' ? venueStatus : receiptStatus,
        venueStatus,
        sourceStatus: receiptStatus,
        sourceCheckedAt: firstText(receipt.checkedAt),
        minimumOrder: firstNumeric(pair.orderMinimum, pair.ordermin, kraken.orderMinimum),
        tickSize: firstNumeric(pair.tickSizeUsd, pair.tickSize, kraken.tickSizeUsd),
        last: firstNumeric(ticker.lastPriceUsd, ticker.lastUsd, ticker.last, ticker.close),
        change24h: firstNumeric(ticker.change24hPct, ticker.priceChange24hPct,
            ticker.openUsd ? ((firstNumeric(ticker.lastUsd, ticker.last) / ticker.openUsd) - 1) * 100 : null),
        volume24h: firstNumeric(ticker.volume24hUsd, ticker.vwapVolumeUsd, ticker.volumeUsd,
            ticker.volume24h && ticker.vwapUsd24h ? ticker.volume24h * ticker.vwapUsd24h : null),
        volume24hTokens: firstNumeric(ticker.volume24hTokens, ticker.volume24h),
        trades24h: firstNumeric(ticker.trades24h, ticker.tradeCount24h),
        bestBid: firstNumeric(book.bestBidUsd, bestBid),
        bestAsk: firstNumeric(book.bestAskUsd, bestAsk),
        spreadPct,
        bids,
        asks,
        observedAt: firstText(book.observedAt, ticker.observedAt, snapshot?.market?.clock?.krakenRetrievedAt, snapshot?.market?.clock?.observedAt),
        firstTradeAt: firstText(kraken.firstTradeAt, kraken.firstTrade?.timestamp),
        firstTrade: kraken.firstTrade || {},
        recentTrades: Array.isArray(kraken.recentTrades) ? kraken.recentTrades : [],
        ohlc: Array.isArray(kraken.ohlc) ? kraken.ohlc : (Array.isArray(kraken.ohlcDaily) ? kraken.ohlcDaily : [])
    };
}

function physicalModel(snapshot) {
    const physical = snapshot?.physical || {};
    const oracle = physical.oracle || {};
    const proof = physical.proof || {};
    const derived = physical.derived || {};
    return {
        oraclePrice: firstNumeric(oracle.priceUsdPerLb, oracle.priceUsdPerLbU3O8, oracle.valueUsdPerLb, oracle.price),
        oracleUpdatedAt: firstText(oracle.updatedAt, oracle.observedAt, physical.clock?.oracleObservedAt, physical.clock?.observedAt),
        statementDate: firstText(proof.statementDate, proof.statementAsOf, proof.asAt, physical.clock?.proofStatementAsOf),
        reserveKg: firstNumeric(proof.endingBalanceKgU, proof.endingBalanceKgUAsU3O8, proof.balanceKgU, proof.reserveKgU3O8),
        reserveLb: firstNumeric(proof.endingBalanceLb, proof.balanceLb, derived.reserveLb, derived.estimatedU3O8Lb),
        statementUrl: safeExternalUrl(firstText(proof.pdfUrl, proof.url)),
        proofPageUrl: safeExternalUrl(firstText(proof.pageUrl, 'https://uranium.io/en/proof-of-reserves')),
        ouncesPerToken: firstNumeric(derived.ouncesPerToken, derived.reserveOuncesPerToken, derived.estimatedU3O8OzPerToken),
        referenceValue: firstNumeric(derived.referenceValueUsd, derived.impliedTokenReferenceUsd, derived.oracleImpliedValuePerTokenUsd),
        basisPct: firstNumeric(derived.marketBasisPct, derived.premiumDiscountPct, derived.tokenPremiumDiscountPct),
        supplyUsed: firstNumeric(derived.tokenSupply, derived.tokenSupplyInput, snapshot?.chain?.token?.totalSupply),
        method: firstText(derived.method, 'Reserve pounds × 16 ÷ token supply')
    };
}

function chainModel(snapshot) {
    const chain = snapshot?.chain || {};
    const token = chain.token || {};
    const counters = chain.counters || {};
    return {
        supply: firstNumeric(token.totalSupply, token.totalSupplyTokens, counters.totalSupply),
        holders: firstNumeric(counters.holders, counters.holderCount, token.holders),
        transfers: firstNumeric(counters.transfers, counters.transferCount, token.transfers),
        observedAt: firstText(chain.clock?.tokenObservedAt, chain.clock?.liveStateObservedAt, chain.clock?.observedAt, token.observedAt, counters.observedAt),
        block: firstNumeric(chain.clock?.blockNumber, token.blockNumber, chain.controls?.liveState?.blockNumber),
        topHolders: Array.isArray(chain.topHolders) ? chain.topHolders : [],
        recentTransfers: Array.isArray(chain.recentTransfers) ? chain.recentTransfers : [],
        controls: {
            ...(chain.controls || {}),
            paused: chain.controls?.liveState?.paused ?? chain.controls?.paused,
            blacklistable: chain.controls?.liveState?.blacklistable ?? chain.controls?.blacklistable,
            kycable: chain.controls?.liveState?.kycable ?? chain.controls?.kycable,
            upgradeable: chain.controls?.token?.capabilities?.upgradeable ?? chain.controls?.upgradeable
        }
    };
}

function protocolModel(snapshot) {
    const protocol = snapshot?.protocol || {};
    return {
        tvl: firstNumeric(protocol.currentTvlUsd, protocol.tvlUsd, protocol.tvl?.currentUsd),
        change24h: firstNumeric(protocol.change24hPct, protocol.tvl?.change24hPct),
        observedAt: firstText(protocol.clock?.latestTvlAt, protocol.clock?.observedAt, protocol.observedAt),
        history: Array.isArray(protocol.history) ? protocol.history : (Array.isArray(protocol.dailyTvlUsd) ? protocol.dailyTvlUsd : [])
    };
}

function normalizeHistory(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => ({
        date: firstText(row?.date, row?.timestamp),
        timestamp: Date.parse(firstText(row?.date, row?.timestamp)),
        value: firstNumeric(row?.value, row?.priceUsd, row?.close, row?.[4])
    })).filter((row) => Number.isFinite(row.timestamp) && row.value !== null).sort((a, b) => a.timestamp - b.timestamp);
}

function historyForRange(rows, rangeId = currentRange) {
    const points = normalizeHistory(rows);
    const days = RANGE_BY_ID.get(rangeId)?.days;
    if (!points.length || !days) return points;
    const cutoff = points.at(-1).timestamp - (days * DAY_MS);
    return points.filter((point) => point.timestamp >= cutoff);
}

function downsample(points, maximum = 240) {
    if (points.length <= maximum) return points;
    const step = (points.length - 1) / (maximum - 1);
    return Array.from({ length: maximum }, (_, index) => points[Math.round(index * step)]);
}

function renderPriceChart(rows, rangeId = currentRange, compact = false) {
    const points = downsample(historyForRange(rows, rangeId), compact ? 90 : 240);
    if (points.length < 2) return `<div class="uranium-chart-empty">No ${escapeHtml(rangeId)} token-price history is available in this snapshot.</div>`;
    const values = points.map(({ value }) => value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, Math.abs(max || 1) * .025);
    const floor = Math.max(0, min - (span * .08));
    const ceiling = max + (span * .08);
    const first = points[0];
    const latest = points.at(-1);
    const width = compact ? 520 : 1000;
    const height = compact ? 84 : 260;
    const left = compact ? 4 : 58;
    const right = compact ? width - 4 : width - 18;
    const top = compact ? 6 : 20;
    const bottom = compact ? height - 7 : height - 42;
    const x = (time) => left + (((time - first.timestamp) / Math.max(1, latest.timestamp - first.timestamp)) * (right - left));
    const y = (value) => bottom - (((value - floor) / Math.max(Number.EPSILON, ceiling - floor)) * (bottom - top));
    const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.timestamp).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
    const change = first.value ? ((latest.value / first.value) - 1) * 100 : null;
    const label = `xU3O8 USD ${rangeId} history from ${formatDate(first.date)} to ${formatDate(latest.date)}. First ${formatUsd(first.value)}, latest ${formatUsd(latest.value)}, high ${formatUsd(max)}, low ${formatUsd(min)}, change ${formatPct(change, { signed: true })}.`;
    return `
        <div class="uranium-chart${compact ? ' is-compact' : ''}" role="img" aria-label="${escapeHtml(label)}">
            ${compact ? '' : `<div class="uranium-chart-summary"><span>${escapeHtml(rangeId)} token price</span><strong class="${directionClass(change)}">${escapeHtml(formatPct(change, { signed: true }))}</strong><small>${escapeHtml(formatUsd(min))} low · ${escapeHtml(formatUsd(max))} high</small></div>`}
            <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <defs><linearGradient id="uranium-chart-fill${compact ? '-compact' : ''}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8dff45" stop-opacity=".35"></stop><stop offset="1" stop-color="#8dff45" stop-opacity="0"></stop></linearGradient></defs>
                ${compact ? '' : [top, top + ((bottom - top) / 3), top + (((bottom - top) / 3) * 2), bottom].map((gridY) => `<line class="uranium-chart-grid" x1="${left}" y1="${gridY}" x2="${right}" y2="${gridY}"></line>`).join('')}
                <path class="uranium-chart-area" d="${path} L${right},${bottom} L${left},${bottom} Z" fill="url(#uranium-chart-fill${compact ? '-compact' : ''})"></path>
                <path class="uranium-chart-line" d="${path}"></path>
                <circle class="uranium-chart-end" cx="${x(latest.timestamp).toFixed(2)}" cy="${y(latest.value).toFixed(2)}" r="${compact ? 3 : 4}"></circle>
                ${compact ? '' : `<text x="${left}" y="${height - 12}">${escapeHtml(formatDate(first.date))}</text><text x="${right}" y="${height - 12}" text-anchor="end">${escapeHtml(formatDate(latest.date))}</text>`}
            </svg>
        </div>
    `;
}

function renderMetric(label, value, note = '', className = '') {
    return `<article class="uranium-metric ${className}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</article>`;
}

function renderClock(label, value, source = '') {
    return `<span class="uranium-clock"><b>${escapeHtml(label)}</b> ${escapeHtml(formatTimestamp(value))}${source ? ` · ${escapeHtml(source)}` : ''}</span>`;
}

function heroPicture(className = '') {
    return `
        <figure class="uranium-core-stage ${className}">
            <picture>
                <source srcset="/assets/uranium/uranium-core-640.webp 640w, /assets/uranium/uranium-core.webp 1280w" sizes="(max-width: 700px) 92vw, 46vw" type="image/webp">
                <img src="/assets/uranium/uranium-core.webp" width="1280" height="853" loading="lazy" decoding="async" alt="Cute cartoon uranium-rock mascot glowing with vivid emerald-green energy.">
            </picture>
            <figcaption>Stylized uranium mascot · physical U3O8 is yellowcake concentrate, not a glowing rock.</figcaption>
        </figure>
    `;
}

function renderOverview(snapshot) {
    const coin = coinModel(snapshot);
    const physical = physicalModel(snapshot);
    const chain = chainModel(snapshot);
    const protocol = protocolModel(snapshot);
    const terms = issuerTermsModel(snapshot);
    return `
        <section class="uranium-hero-panel">
            <div class="uranium-hero-copy">
                <div class="uranium-kicker">xU3O8 · Etherlink · physical-asset token</div>
                <h3>Uranium, with every layer exposed.</h3>
                <p>Uranium.io describes xU3O8 this way: ${escapeHtml(terms.ownershipDescription)} The token market, indicative uranium reference, custody statement, and Etherlink ledger are related—but none substitutes for the others.</p>
                <div class="uranium-hero-price">
                    <span>Token market</span>
                    <strong>${escapeHtml(formatUsd(coin.price))}</strong>
                    <em class="${directionClass(coin.change24h)}">${escapeHtml(formatPct(coin.change24h, { signed: true }))} · 24h</em>
                    <small>${escapeHtml(formatFreshnessStamp(coin.updatedAt, { source: 'CoinGecko' }))}</small>
                </div>
                <div class="uranium-contract-strip"><span>xU3O8</span><code title="${TOKEN_CONTRACT}">${escapeHtml(truncate(TOKEN_CONTRACT, 12, 8))}</code><button type="button" data-uranium-copy="${TOKEN_CONTRACT}" aria-label="Copy xU3O8 contract address">Copy</button></div>
            </div>
            ${heroPicture('is-room')}
        </section>
        <section class="uranium-metric-grid">
            ${renderMetric('Indicative uranium', formatUsd(physical.oraclePrice, { digits: 2 }), 'USD/lb · non-executable')}
            ${renderMetric('Derived representation', physical.ouncesPerToken === null ? 'Unavailable' : `${formatNumber(physical.ouncesPerToken, 4)} oz`, `per token · statement ${formatDate(physical.statementDate)}`)}
            ${renderMetric('Indexed supply', chain.supply === null ? 'Unavailable' : `${formatCompact(chain.supply, 3)} xU3O8`, 'Etherlink observation')}
            ${renderMetric('Uranium.io TVL', formatUsd(protocol.tvl, { compact: true }), 'DefiLlama protocol context')}
        </section>
        <section class="uranium-grid uranium-overview-grid">
            <article class="uranium-panel uranium-basis-panel">
                <div class="uranium-panel-head"><div><span class="uranium-eyebrow">Cross-source arithmetic</span><h4>Market versus reference</h4></div><span class="uranium-status is-neutral">Not a peg</span></div>
                <div class="uranium-basis-orbit"><strong>${escapeHtml(formatPct(physical.basisPct, { signed: true }))}</strong><span>premium / discount</span></div>
                <p>The indicative token reference is the uranium oracle in USD/lb multiplied by the dated derived ounces represented per token, divided by 16. It is not executable and does not establish an arbitrage or redemption path.</p>
                <div class="uranium-equation"><span>${escapeHtml(formatUsd(physical.oraclePrice))}/lb</span><i>×</i><span>${escapeHtml(formatNumber(physical.ouncesPerToken, 4))} oz</span><i>÷</i><span>16</span><i>=</i><strong>${escapeHtml(formatUsd(physical.referenceValue))}</strong></div>
            </article>
            <article class="uranium-panel uranium-proof-flash">
                <div class="uranium-panel-head"><div><span class="uranium-eyebrow">Physical receipt</span><h4>Cameco balance statement</h4></div><span class="uranium-status is-good">Dated statement</span></div>
                <strong class="uranium-proof-amount">${escapeHtml(formatNumber(physical.reserveKg, 3))} <small>kgU as U3O8</small></strong>
                <p>Ending contract balance as at ${escapeHtml(formatDate(physical.statementDate))}. This issuer-published custodian statement is a point-in-time document, not a continuous independent audit.</p>
                <div class="uranium-link-row"><a href="${escapeHtml(physical.statementUrl || physical.proofPageUrl)}" target="_blank" rel="noopener noreferrer">Open the statement ↗</a><button type="button" data-uranium-view="proofbook">Read the proofbook</button></div>
            </article>
            <article class="uranium-panel uranium-boundary-panel">
                <span class="uranium-eyebrow">What the token is</span>
                <h4>Issuer-described terms, not uranium in your wallet.</h4>
                <ul class="uranium-fact-list">
                    <li><strong>Ownership</strong><span>Issuer description: ${escapeHtml(terms.ownershipDescription)}${issuerReceiptLink(terms.ownershipReceipt)}</span></li>
                    <li><strong>Custody</strong><span>Issuer documents name ${escapeHtml(terms.trustee)} as the trustee account and ${escapeHtml(terms.storageOperator)} as the storage operator.${issuerReceiptLink(terms.custodyReceipt)}</span></li>
                    <li><strong>Redemption</strong><span>Issuer terms: ${escapeHtml(terms.redemptionCondition)}${issuerReceiptLink(terms.redemptionReceipt)}</span></li>
                    <li><strong>Rights</strong><span>${escapeHtml(issuerRightsSummary(terms))}${issuerReceiptLink(terms.rightsReceipt, 'Issuer whitepaper')}</span></li>
                </ul>
                <p class="uranium-footnote">${escapeHtml(terms.caveat)}</p>
            </article>
            <article class="uranium-panel uranium-ledger-panel">
                <span class="uranium-eyebrow">Three clocks, kept honest</span>
                <h4>Price discovery is not proof of reserves.</h4>
                <div class="uranium-clock-stack">
                    ${renderClock('Token market', coin.updatedAt, 'CoinGecko / venues')}
                    ${renderClock('Uranium reference', physical.oracleUpdatedAt, 'Uranium.io oracle')}
                    ${renderClock('Etherlink ledger', chain.observedAt, chain.block === null ? '' : `block ${formatNumber(chain.block)}`)}
                    ${renderClock('Custody document', physical.statementDate, 'Cameco statement')}
                </div>
            </article>
        </section>
    `;
}

function renderRangeControl() {
    return `<div class="uranium-range" role="group" aria-label="Token price range">${RANGES.map((range) => `<button type="button" data-uranium-range="${range.id}" aria-pressed="${range.id === currentRange}">${range.label}</button>`).join('')}</div>`;
}

function renderBookSide(rows, side) {
    const normalized = rows.slice(0, 8).map((row) => ({
        price: firstNumeric(row?.priceUsd, row?.price, row?.[0]),
        amount: firstNumeric(row?.amountTokens, row?.volume, row?.amount, row?.[1])
    }));
    return `
        <div class="uranium-book-side is-${side}">
            <h5>${side === 'bid' ? 'Bids' : 'Asks'}</h5>
            <div class="uranium-book-labels"><span>Price</span><span>xU3O8</span></div>
            ${normalized.length ? normalized.map((row, index) => `<div class="uranium-book-row" style="--depth:${Math.max(12, 100 - (index * 10))}%"><span>${escapeHtml(formatUsd(row.price, { digits: 3 }))}</span><span>${escapeHtml(formatNumber(row.amount, 3))}</span></div>`).join('') : '<p class="uranium-empty-copy">No bounded book rows.</p>'}
        </div>
    `;
}

function renderTrades(rows) {
    const normalized = rows.slice(0, 14);
    return `
        <div class="uranium-table-wrap"><table class="uranium-table">
            <caption class="sr-only">Most recent bounded Kraken xU3O8 trades</caption>
            <thead><tr><th>Time</th><th>Side</th><th class="is-number">Price</th><th class="is-number">xU3O8</th></tr></thead>
            <tbody>${normalized.length ? normalized.map((trade) => {
                const side = firstText(trade?.side, trade?.type, '—');
                return `<tr><td>${escapeHtml(formatTimestamp(firstText(trade?.timestamp, trade?.observedAt, trade?.time)))}</td><td><span class="uranium-trade-side is-${side.toLowerCase() === 'buy' || side.toLowerCase() === 'b' ? 'buy' : 'sell'}">${escapeHtml(side)}</span></td><td class="is-number">${escapeHtml(formatUsd(firstNumeric(trade?.priceUsd, trade?.price), { digits: 3 }))}</td><td class="is-number">${escapeHtml(formatNumber(firstNumeric(trade?.amountTokens, trade?.volume, trade?.amount), 4))}</td></tr>`;
            }).join('') : '<tr><td colspan="4">No recent trades in this bounded receipt.</td></tr>'}</tbody>
        </table></div>
    `;
}

function renderVenues(rows) {
    const normalized = Array.isArray(rows) ? rows.slice(0, 20) : [];
    return `
        <div class="uranium-table-wrap"><table class="uranium-table">
            <caption class="sr-only">Attributed xU3O8 venue directory</caption>
            <thead><tr><th>Venue</th><th>Pair</th><th class="is-number">Last</th><th class="is-number">24h volume</th><th>Receipt</th></tr></thead>
            <tbody>${normalized.length ? normalized.map((venue) => {
                const url = safeExternalUrl(firstText(venue?.tradeUrl, venue?.url));
                return `<tr><td>${escapeHtml(firstText(venue?.market, venue?.name, 'Unknown'))}</td><td>${escapeHtml(`${firstText(venue?.base, 'xU3O8')}/${firstText(venue?.target, venue?.quote, '—')}`)}</td><td class="is-number">${escapeHtml(formatUsd(firstNumeric(venue?.lastPriceUsd, venue?.convertedLastUsd, venue?.lastUsd, venue?.last), { digits: 4 }))}</td><td class="is-number">${escapeHtml(formatUsd(firstNumeric(venue?.volume24hUsd, venue?.convertedVolumeUsd, venue?.volumeUsd), { compact: true }))}</td><td>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Source ↗</a>` : '<span class="uranium-muted">Attributed feed</span>'}</td></tr>`;
            }).join('') : '<tr><td colspan="5">No attributed venue rows are available.</td></tr>'}</tbody>
        </table></div>
    `;
}

function renderMarkets(snapshot) {
    const coin = coinModel(snapshot);
    const kraken = krakenModel(snapshot);
    const physical = physicalModel(snapshot);
    const history = snapshot.market?.priceHistoryUsd || [];
    return `
        <section class="uranium-market-lead">
            <div class="uranium-market-lockup"><span class="uranium-eyebrow">Kraken listing · public USD book</span><h3>${escapeHtml(kraken.pair)}</h3><p>Kraken says trading went live July 30, 2026. Its public tape adds a direct dollar book, OHLC, spread, depth, and trade receipts; it does not add reserve or redemption proof.</p></div>
            <div class="uranium-live-quote"><span class="uranium-status ${statusClass(kraken.status)}">${escapeHtml(kraken.status)}</span><strong>${escapeHtml(formatUsd(kraken.last ?? coin.price, { digits: 3 }))}</strong><small>${escapeHtml(kraken.sourceStatus === 'ok' ? formatTimestamp(kraken.observedAt) : `Last good ${formatTimestamp(kraken.observedAt)} · checked ${formatTimestamp(kraken.sourceCheckedAt)}`)}</small></div>
        </section>
        <section class="uranium-metric-grid is-market">
            ${renderMetric('Best bid', formatUsd(kraken.bestBid, { digits: 3 }), 'Kraken public book')}
            ${renderMetric('Best ask', formatUsd(kraken.bestAsk, { digits: 3 }), 'Kraken public book')}
            ${renderMetric('Spread', formatPct(kraken.spreadPct), 'Observed, not guaranteed')}
            ${renderMetric('Kraken 24h volume', kraken.volume24h !== null ? formatUsd(kraken.volume24h, { compact: true }) : `${formatCompact(kraken.volume24hTokens, 2)} xU3O8`, kraken.trades24h === null ? 'Public ticker' : `${formatNumber(kraken.trades24h)} trades`)}
            ${renderMetric('Global 24h volume', formatUsd(coin.volume24h, { compact: true }), 'CoinGecko attributed aggregate')}
            ${renderMetric('Market cap', formatUsd(coin.marketCap, { compact: true }), 'Token market, not reserve value')}
        </section>
        <section class="uranium-panel uranium-price-panel">
            <div class="uranium-panel-head"><div><span class="uranium-eyebrow">Token price · attributed daily history</span><h4>xU3O8 / USD</h4></div>${renderRangeControl()}</div>
            ${renderPriceChart(history)}
        </section>
        <section class="uranium-grid uranium-market-grid">
            <article class="uranium-panel">
                <div class="uranium-panel-head"><div><span class="uranium-eyebrow">Kraken depth</span><h4>Public order book</h4></div><span class="uranium-status is-neutral">Bounded top levels</span></div>
                <div class="uranium-order-book">${renderBookSide(kraken.bids, 'bid')}${renderBookSide(kraken.asks, 'ask')}</div>
                <p class="uranium-footnote">A visible book is not a liquidity promise. Slippage and fill quality can change before an order executes.</p>
            </article>
            <article class="uranium-panel">
                <div class="uranium-panel-head"><div><span class="uranium-eyebrow">Physical reference</span><h4>${escapeHtml(formatUsd(physical.oraclePrice))} / lb</h4></div><span class="uranium-status is-warn">Indicative</span></div>
                <p>Uranium.io publishes a proprietary fair-value estimate between official industry prints. It updates separately from token venues and is explicitly non-executable.</p>
                <div class="uranium-basis-readout"><span>Derived token reference</span><strong>${escapeHtml(formatUsd(physical.referenceValue))}</strong><small>${escapeHtml(formatNumber(physical.ouncesPerToken, 4))} oz/token · ${escapeHtml(formatTimestamp(physical.oracleUpdatedAt))}</small></div>
                <div class="uranium-basis-readout"><span>Token market basis</span><strong class="${directionClass(physical.basisPct)}">${escapeHtml(formatPct(physical.basisPct, { signed: true }))}</strong><small>premium / discount · not a peg</small></div>
            </article>
        </section>
        <section class="uranium-panel">
            <div class="uranium-panel-head"><div><span class="uranium-eyebrow">Kraken tape</span><h4>Recent public trades</h4></div><span class="uranium-status is-neutral">First observed ${escapeHtml(formatTimestamp(kraken.firstTradeAt))}</span></div>
            ${renderTrades(kraken.recentTrades)}
        </section>
        <section class="uranium-panel">
            <div class="uranium-panel-head"><div><span class="uranium-eyebrow">Attributed venue directory</span><h4>Where the token is quoted</h4></div><span class="uranium-status is-neutral">No cross-venue ownership inference</span></div>
            ${renderVenues(snapshot.market?.venues)}
        </section>
    `;
}

function holderShare(holder, totalSupply) {
    const explicit = firstNumeric(holder?.sharePct, holder?.percentage);
    if (explicit !== null) return explicit;
    const balance = firstNumeric(holder?.balanceTokens, holder?.balance, holder?.value);
    return balance !== null && totalSupply ? (balance / totalSupply) * 100 : null;
}

function renderHolders(rows, supply) {
    const normalized = rows.slice(0, 16);
    return `
        <div class="uranium-table-wrap"><table class="uranium-table">
            <caption class="sr-only">Top indexed xU3O8 token addresses</caption>
            <thead><tr><th>Indexed address</th><th class="is-number">Balance</th><th class="is-number">Supply share</th></tr></thead>
            <tbody>${normalized.length ? normalized.map((holder) => {
                const address = firstText(holder?.address, holder?.hash, holder?.holder);
                const url = safeExternalUrl(firstText(holder?.explorerUrl, address ? `https://explorer.etherlink.com/address/${address}` : ''));
                return `<tr><td>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><code>${escapeHtml(truncate(address))}</code> ↗</a>` : `<code>${escapeHtml(truncate(address))}</code>`}</td><td class="is-number">${escapeHtml(formatNumber(firstNumeric(holder?.balanceTokens, holder?.balance, holder?.value), 4))}</td><td class="is-number">${escapeHtml(formatPct(holderShare(holder, supply)))}</td></tr>`;
            }).join('') : '<tr><td colspan="3">No bounded holder rows.</td></tr>'}</tbody>
        </table></div>
    `;
}

function renderTransfers(rows) {
    const normalized = rows.slice(0, 18);
    return `
        <div class="uranium-table-wrap"><table class="uranium-table">
            <caption class="sr-only">Most recent bounded xU3O8 transfers indexed by Etherlink Blockscout</caption>
            <thead><tr><th>Time</th><th>From → to</th><th class="is-number">Amount</th><th>Receipt</th></tr></thead>
            <tbody>${normalized.length ? normalized.map((transfer) => {
                const from = firstText(transfer?.from?.address, transfer?.from, transfer?.fromAddress);
                const to = firstText(transfer?.to?.address, transfer?.to, transfer?.toAddress);
                const hash = firstText(transfer?.transactionHash, transfer?.txHash, transfer?.hash);
                const url = safeExternalUrl(firstText(transfer?.explorerUrl, hash ? `https://explorer.etherlink.com/tx/${hash}` : ''));
                return `<tr><td>${escapeHtml(formatTimestamp(firstText(transfer?.timestamp, transfer?.observedAt, transfer?.blockTimestamp)))}</td><td><code>${escapeHtml(truncate(from, 6, 4))}</code> <span aria-label="to">→</span> <code>${escapeHtml(truncate(to, 6, 4))}</code></td><td class="is-number">${escapeHtml(formatNumber(firstNumeric(transfer?.amountTokens, transfer?.value, transfer?.amount), 4))}</td><td>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(truncate(hash, 7, 5))} ↗</a>` : '—'}</td></tr>`;
            }).join('') : '<tr><td colspan="4">No bounded transfer rows.</td></tr>'}</tbody>
        </table></div>
    `;
}

function controlValue(controls, key, fallback = null) {
    if (key in controls) return controls[key];
    return fallback;
}

function renderControl(label, value, note) {
    const enabled = value === true;
    const unavailable = value === null || value === undefined;
    return `<article class="uranium-control"><span class="uranium-status ${unavailable ? 'is-neutral' : enabled ? 'is-warn' : 'is-good'}">${unavailable ? 'Unverified' : enabled ? 'Enabled' : 'Disabled'}</span><h5>${escapeHtml(label)}</h5><p>${escapeHtml(note)}</p></article>`;
}

function renderChain(snapshot) {
    const chain = chainModel(snapshot);
    const controls = chain.controls;
    return `
        <section class="uranium-chain-head">
            <div><span class="uranium-eyebrow">Etherlink mainnet · chain ID 42793</span><h3>xU3O8 ledger state</h3><p>Blockscout indexes addresses, balances, and transfers. An address is not necessarily a person: contracts, venue omnibus wallets, and custody structures can pool many users.</p></div>
            <div class="uranium-contract-card"><span>Verified token contract</span><code>${TOKEN_CONTRACT}</code><div><button type="button" data-uranium-copy="${TOKEN_CONTRACT}">Copy address</button><a href="https://explorer.etherlink.com/address/${TOKEN_CONTRACT}" target="_blank" rel="noopener noreferrer">Explorer ↗</a></div></div>
        </section>
        <section class="uranium-metric-grid">
            ${renderMetric('Total supply', chain.supply === null ? 'Unavailable' : `${formatNumber(chain.supply, 4)} xU3O8`, 'Observed token state')}
            ${renderMetric('Indexed holders', formatNumber(chain.holders), 'Addresses, not investors')}
            ${renderMetric('Indexed transfers', formatNumber(chain.transfers), 'Blockscout counter')}
            ${chain.block === null
        ? renderMetric('State observed', formatTimestamp(chain.observedAt), 'Etherlink / Blockscout clock')
        : renderMetric('Observed block', formatNumber(chain.block), formatTimestamp(chain.observedAt))}
        </section>
        <section class="uranium-control-grid">
            ${renderControl('Paused', controlValue(controls, 'paused'), 'Whether ordinary transfers are currently paused.')}
            ${renderControl('Blacklistable', controlValue(controls, 'blacklistable', controlValue(controls, 'isBlacklistable')), 'The verified implementation exposes an address-control path.')}
            ${renderControl('KYC gate', controlValue(controls, 'kycable', controlValue(controls, 'isKYCable')), 'Whether the current token state reports a KYC transfer gate.')}
            ${renderControl('Upgradeable', controlValue(controls, 'upgradeable'), 'The proxy and implementation can change through authorized control.')}
        </section>
        <section class="uranium-grid uranium-chain-grid">
            <article class="uranium-panel"><div class="uranium-panel-head"><div><span class="uranium-eyebrow">Bounded distribution</span><h4>Top indexed addresses</h4></div><span class="uranium-status is-neutral">Address ≠ owner</span></div>${renderHolders(chain.topHolders, chain.supply)}</article>
            <article class="uranium-panel"><div class="uranium-panel-head"><div><span class="uranium-eyebrow">Bounded activity</span><h4>Recent token transfers</h4></div><span class="uranium-status is-neutral">Applied receipts</span></div>${renderTransfers(chain.recentTransfers)}</article>
        </section>
        <article class="uranium-panel uranium-app-boundary">
            <div><span class="uranium-eyebrow">Do not cross the wires</span><h4>Token contract and Uranium.io app contract are different.</h4></div>
            <div class="uranium-address-compare"><span><b>xU3O8 token</b><code>${TOKEN_CONTRACT}</code></span><span><b>Uranium.io app</b><code>${APP_CONTRACT}</code></span></div>
            <p>Token transfers describe xU3O8 movement. Calls to the Uranium.io application describe interactions with that reviewed app contract. Neither is silently relabeled as a sale or a unique investor.</p>
        </article>
    `;
}

function sourceClockFor(snapshot, id, source) {
    const coverage = source?.coverage || {};
    const observed = {
        krakenMarket: snapshot?.market?.kraken?.ticker?.observedAt,
        coinGecko: snapshot?.market?.coin?.lastUpdated,
        blockscoutToken: snapshot?.chain?.clock?.tokenObservedAt,
        blockscoutContracts: snapshot?.chain?.clock?.contractsObservedAt,
        etherlinkRpc: snapshot?.chain?.clock?.liveStateObservedAt,
        defiLlama: firstText(snapshot?.protocol?.clock?.latestTvlAt, snapshot?.protocol?.clock?.observedAt),
        uraniumOracle: firstText(snapshot?.physical?.oracle?.observedAt, snapshot?.physical?.clock?.oracleObservedAt)
    }[id];
    if (id === 'krakenListing') {
        return {
            label: 'Announced live',
            value: firstText(snapshot?.identity?.krakenListing?.announcedLiveDate, coverage.announcedLiveDate),
            dateOnly: true,
            checkedAt: source?.checkedAt
        };
    }
    if (id === 'uraniumIssuer') {
        return {
            label: 'Reviewed',
            value: firstText(source?.reviewedAt, coverage.reviewedOn, source?.retrievedAt),
            dateOnly: true,
            checkedAt: source?.checkedAt
        };
    }
    if (id === 'proofOfReserves') {
        return {
            label: 'Statement as at',
            value: firstText(snapshot?.physical?.proof?.statementAsOf, snapshot?.physical?.proof?.statementDate),
            dateOnly: true,
            checkedAt: firstText(snapshot?.physical?.proof?.retrievedAt, source?.checkedAt)
        };
    }
    return {
        label: 'Observed',
        value: firstText(observed, source?.retrievedAt),
        dateOnly: false,
        checkedAt: source?.checkedAt
    };
}

function renderSourceClock(clock) {
    const primary = clock.dateOnly ? formatDate(clock.value) : formatTimestamp(clock.value);
    const primaryTime = Date.parse(clock.value || '');
    const checkedTime = Date.parse(clock.checkedAt || '');
    const showChecked = Number.isFinite(checkedTime)
        && (!Number.isFinite(primaryTime) || Math.abs(checkedTime - primaryTime) > 60 * 1000);
    return `<span class="uranium-source-clock"><b>${escapeHtml(clock.label)}</b><span>${escapeHtml(primary)}</span>${showChecked ? `<small>Checked ${escapeHtml(formatTimestamp(clock.checkedAt))}</small>` : ''}</span>`;
}

function renderSources(snapshot) {
    const rows = Object.entries(snapshot?.sources || {}).map(([id, source]) => {
        const normalized = source && typeof source === 'object' ? source : {};
        const url = safeExternalUrl(firstText(normalized.url, normalized.sourceUrl));
        const label = firstText(normalized.label, normalized.name, id.replaceAll('-', ' '));
        const status = firstText(normalized.status, 'unavailable');
        const clock = sourceClockFor(snapshot, id, normalized);
        return `<tr><td>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>` : escapeHtml(label)}</td><td><span class="uranium-status ${statusClass(status)}">${escapeHtml(status)}</span></td><td>${renderSourceClock(clock)}</td><td>${escapeHtml(firstText(normalized.note, normalized.credit, 'Public receipt'))}</td></tr>`;
    });
    return `<div class="uranium-table-wrap"><table class="uranium-table"><caption class="sr-only">Uranium Chamber source and freshness ledger</caption><thead><tr><th>Source</th><th>Status</th><th>Evidence clock</th><th>Coverage</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="4">No source receipts available.</td></tr>'}</tbody></table></div>`;
}

function renderUnavailable(rows) {
    const normalized = Array.isArray(rows) ? rows : [];
    if (!normalized.length) return '';
    return `<div class="uranium-gap-grid">${normalized.map((item) => `<article class="uranium-gap"><span>Unavailable by design</span><h5>${escapeHtml(firstText(item?.label, item?.id, 'Coverage gap'))}</h5><p>${escapeHtml(firstText(item?.reason, item?.note, 'No reproducible public receipt is available.'))}</p></article>`).join('')}</div>`;
}

function renderProof(snapshot) {
    const physical = physicalModel(snapshot);
    const chain = chainModel(snapshot);
    const terms = issuerTermsModel(snapshot);
    const feeCeiling = terms.feeCeilingPct === null
        ? 'The issuer fee ceiling is unavailable in this snapshot.'
        : `Issuer documentation permits custody and administration fees of up to ${formatNumber(terms.feeCeilingPct, 2)}% annually, potentially implemented through token issuance.`;
    const currentFee = terms.feeCurrentlyCharged === null
        ? terms.feeStatusNote
        : `The snapshot reports a currently charged rate of ${formatNumber(terms.feeCurrentlyCharged, 2)}%.`;
    const pegCopy = terms.formalPeg === false
        ? 'Issuer documentation says there is no formal peg. Venues perform their own price discovery.'
        : 'This snapshot does not contain an equally direct current formal-peg statement.';
    return `
        <section class="uranium-proof-hero">
            <div><span class="uranium-eyebrow">Custody statement · point-in-time receipt</span><h3>${escapeHtml(formatNumber(physical.reserveKg, 3))} kgU as U3O8</h3><p>Cameco contract ending balance as at ${escapeHtml(formatDate(physical.statementDate))}. The issuer links the statement publicly; this Chamber preserves its document date and does not relabel it as live reserves.</p></div>
            <div class="uranium-proof-actions"><a href="${escapeHtml(physical.statementUrl || physical.proofPageUrl)}" target="_blank" rel="noopener noreferrer">Open PDF statement ↗</a><a href="${escapeHtml(physical.proofPageUrl)}" target="_blank" rel="noopener noreferrer">Issuer proof page ↗</a></div>
        </section>
        <section class="uranium-reconciliation" aria-label="Reserve-to-token reconciliation">
            <div><span>Statement balance</span><strong>${escapeHtml(formatNumber(physical.reserveLb, 3))} lb</strong><small>${escapeHtml(formatDate(physical.statementDate))}</small></div><i>×</i>
            <div><span>Avoirdupois ounces</span><strong>16</strong><small>per pound</small></div><i>÷</i>
            <div><span>Observed supply</span><strong>${escapeHtml(formatNumber(physical.supplyUsed ?? chain.supply, 4))}</strong><small>xU3O8</small></div><i>=</i>
            <div class="is-result"><span>Derived representation</span><strong>${escapeHtml(formatNumber(physical.ouncesPerToken, 6))} oz</strong><small>per token · dated arithmetic</small></div>
        </section>
        <p class="uranium-proof-warning">This reconciliation joins a dated custody document to a later on-chain supply observation. It is transparent arithmetic, not an independent audit, continuous attestation, legal opinion, or redemption guarantee. Future custody or administration-fee minting can change the amount represented by each token.</p>
        <section class="uranium-grid uranium-rights-grid">
            <article class="uranium-panel"><span class="uranium-eyebrow">Custody chain</span><h4>${escapeHtml(terms.trustee)} + ${escapeHtml(terms.storageOperator)}</h4><p>Issuer documents name ${escapeHtml(terms.trustee)} as the trustee account and ${escapeHtml(terms.storageOperator)} as the storage operator reflected by the contract statement.${issuerReceiptLink(terms.custodyReceipt)}</p></article>
            <article class="uranium-panel"><span class="uranium-eyebrow">Physical redemption</span><h4>Issuer-restricted, not ordinary retail delivery</h4><p>${escapeHtml(terms.redemptionCondition)}${issuerReceiptLink(terms.redemptionReceipt)}</p></article>
            <article class="uranium-panel"><span class="uranium-eyebrow">Fees and dilution</span><h4>Read the denominator</h4><p>${escapeHtml(feeCeiling)} ${escapeHtml(currentFee)}${issuerReceiptLink(terms.feeReceipt)}</p></article>
            <article class="uranium-panel"><span class="uranium-eyebrow">Market structure</span><h4>No assumed peg</h4><p>${escapeHtml(pegCopy)} A token can trade above or below the indicative uranium reference; neither quote is proof of executable physical value.${issuerReceiptLink(terms.priceReceipt)}</p></article>
        </section>
        <p class="uranium-footnote">${escapeHtml(terms.caveat)} ${escapeHtml(issuerRightsSummary(terms))}${issuerReceiptLink(terms.rightsReceipt, 'Issuer whitepaper')}</p>
        <section class="uranium-panel"><div class="uranium-panel-head"><div><span class="uranium-eyebrow">Source ledger</span><h4>Receipts and independent clocks</h4></div><span class="uranium-status is-neutral">Generated ${escapeHtml(ageLabel(snapshot.generatedAt))}</span></div>${renderSources(snapshot)}</section>
        ${renderUnavailable(snapshot.unavailable)}
        <nav class="uranium-pathways" aria-label="Continue through related Tezos Chambers">
            <a href="/capital/">Capital Chamber<small>Place xU3O8 inside the wider Tezos capital system</small></a>
            <a href="/ecosystem/">Ecosystem Activity<small>Inspect reviewed app activity without ownership inference</small></a>
            <a href="/stake/">Staking Chamber<small>Compare explicit Tezos staking flows</small></a>
            <a href="/whales/">Whale Watch<small>Follow receipt-backed large movements</small></a>
        </nav>
    `;
}

function renderView(snapshot) {
    if (currentView === 'markets') return renderMarkets(snapshot);
    if (currentView === 'onchain') return renderChain(snapshot);
    if (currentView === 'proofbook') return renderProof(snapshot);
    return renderOverview(snapshot);
}

function freshnessPresentation(snapshot) {
    const generated = Date.parse(snapshot.generatedAt || '');
    const stale = !Number.isFinite(generated) || Date.now() - generated > STALE_AFTER_MS;
    const degraded = sourceInventory(snapshot).filter(({ status }) => status !== 'ok');
    const degradedLabel = degraded.length === 1
        ? `${degraded[0].label} ${degraded[0].status}`
        : degraded.length > 1 ? `${degraded.length} sources degraded` : '';
    const baseLabel = lastRefreshError
        ? `Last good ${ageLabel(snapshot.generatedAt)} · refresh failed · ${GENERATED_PROOFBOOK_SCHEDULE_LABEL}`
        : `Generated ${ageLabel(snapshot.generatedAt)} · ${GENERATED_PROOFBOOK_SCHEDULE_LABEL}`;
    return {
        label: degradedLabel ? `${baseLabel} · ${degradedLabel}` : baseLabel,
        stale: stale || Boolean(lastRefreshError) || degraded.length > 0
    };
}

function renderChamber(snapshot) {
    const view = VIEWS.find(({ id }) => id === currentView) || VIEWS[0];
    const freshness = freshnessPresentation(snapshot);
    return `
        <header class="uranium-header" data-quiet-key="uranium-header">
            <div class="uranium-system-strip"><strong>Tezos Systems</strong><span aria-hidden="true">/</span><span>commodity market intelligence</span></div>
            <div class="uranium-title-row"><h2 id="uranium-title">Uranium Chamber</h2><span class="uranium-badge">xU3O8</span><span class="uranium-freshness${freshness.stale ? ' is-stale' : ''}" id="uranium-freshness" aria-live="polite">${escapeHtml(freshness.label)}</span></div>
            <p class="uranium-intro">A source-bounded view of xU3O8, physical U3O8 custody receipts, Uranium.io, Kraken price discovery, and Etherlink state—with each claim kept on its natural clock.</p>
            <div class="uranium-tabs" role="tablist" aria-label="Uranium Chamber views">${VIEWS.map((item) => `<button class="uranium-tab" id="uranium-tab-${item.id}" type="button" role="tab" aria-selected="${item.id === currentView}" aria-controls="uranium-view-panel" tabindex="${item.id === currentView ? '0' : '-1'}" data-uranium-view="${item.id}">${escapeHtml(item.label)}</button>`).join('')}</div>
        </header>
        <section class="uranium-view-shell" id="uranium-view-panel" role="tabpanel" aria-labelledby="uranium-tab-${view.id}" data-quiet-key="uranium-view-panel">
            <div class="uranium-view-head"><div><h3>${escapeHtml(view.title)}</h3><p>${escapeHtml(view.detail)}</p></div></div>
            <div class="uranium-view-content" id="uranium-view-content" data-quiet-key="uranium-view-content">${renderView(snapshot)}</div>
        </section>
        <p class="uranium-disclaimer">Information only · public-source observations · not investment, custody, legal, or trading advice.</p>
    `;
}

function renderLoading(body) {
    body.innerHTML = '<div class="uranium-loading"><div class="uranium-loader-core" aria-hidden="true"></div><div><strong>Charging the Uranium Chamber…</strong><span>Verifying the generated first-party proofbook.</span></div></div>';
}

function renderError(body, error) {
    body.innerHTML = `<div class="uranium-error"><div><strong>Uranium snapshot unavailable</strong><span>${escapeHtml(error?.message || error || 'The generated snapshot could not be loaded.')}</span><button class="chamber-action" type="button" data-uranium-retry>Retry</button></div></div>`;
}

function renderBody(snapshot, { quiet = false } = {}) {
    const body = document.getElementById('uranium-chamber-body');
    if (!body || !snapshot) return;
    const markup = renderChamber(snapshot);
    if (quiet && body.dataset.uraniumRendered === '1') quietlySyncHtml(body, markup);
    else body.innerHTML = markup;
    body.dataset.uraniumRendered = '1';
}

function entryMarkup(snapshot) {
    const coin = coinModel(snapshot);
    const kraken = krakenModel(snapshot);
    const physical = physicalModel(snapshot);
    const chain = chainModel(snapshot);
    return `
        <div class="uranium-entry-copy">
            <div class="uranium-entry-title-line"><h2 class="stat-label" id="uranium-entry-title">Uranium</h2><span class="uranium-entry-chip">xU3O8</span><span class="uranium-entry-live ${statusClass(kraken.status)}">Kraken ${escapeHtml(kraken.status)}</span></div>
            <div class="stat-value uranium-entry-value">${escapeHtml(formatUsd(kraken.last ?? coin.price, { digits: 3 }))}</div>
            <div class="uranium-entry-delta ${directionClass(coin.change24h)}">${escapeHtml(formatPct(coin.change24h, { signed: true }))} <span>24h</span></div>
            <div class="stat-description">Physical uranium meets Etherlink price discovery</div>
            <div class="uranium-entry-freshness">${escapeHtml(formatFreshnessStamp(coin.updatedAt || snapshot.generatedAt, { source: 'token market' }))}</div>
        </div>
        <div class="uranium-entry-art">${heroPicture('is-entry')}</div>
        <div class="uranium-entry-kpis">
            <span><small>Uranium oracle</small><strong>${escapeHtml(formatUsd(physical.oraclePrice))}/lb</strong></span>
            <span><small>Dated representation</small><strong>${escapeHtml(formatNumber(physical.ouncesPerToken, 3))} oz/token</strong></span>
            <span><small>Indexed holders</small><strong>${escapeHtml(formatNumber(chain.holders))}</strong></span>
        </div>
        <div class="uranium-entry-chart">${renderPriceChart(snapshot.market?.priceHistoryUsd, '30D', true)}</div>
    `;
}

function wireEntry(card) {
    if (!card) return;
    wireChamberLauncher(card, { open: openUraniumChamber, label: 'Open Uranium Chamber', titleSelector: '#uranium-entry-title, .stat-label' });
}

function updateEntry(snapshot, { quiet = false } = {}) {
    const front = document.getElementById('uranium-entry-front');
    if (!front || !snapshot) return;
    const markup = entryMarkup(snapshot);
    if (quiet && front.dataset.uraniumRendered === '1') quietlySyncHtml(front, markup);
    else front.innerHTML = markup;
    front.dataset.uraniumRendered = '1';
    const card = document.getElementById('uranium-entry-card');
    delete card?.dataset.updatedLabel;
    window.syncChamberEntryFooters?.(card);
    wireEntry(card);
}

function markRefreshFailure() {
    const freshness = document.getElementById('uranium-freshness');
    if (freshness && lastSnapshot) {
        freshness.textContent = `Last good ${ageLabel(lastSnapshot.generatedAt)} · refresh failed · ${GENERATED_PROOFBOOK_SCHEDULE_LABEL}`;
        freshness.classList.add('is-stale');
    }
    const card = document.getElementById('uranium-entry-card');
    if (card && (lastSnapshot || lastEntrySummary)) {
        const source = lastSnapshot || lastEntrySummary;
        card.dataset.updatedLabel = `Last good ${ageLabel(source.generatedAt)} · refresh failed · ${GENERATED_PROOFBOOK_SCHEDULE_LABEL}`;
        window.syncChamberEntryFooters?.(card);
    }
}

function isUraniumRoute() {
    return window.location.pathname.replace(/\/+$/, '') === '/uranium';
}

function routeView() {
    if (!isUraniumRoute()) return '';
    const value = new URL(window.location.href).searchParams.get('view') || '';
    return VIEW_IDS.has(value) ? value : '';
}

function updateRouteView() {
    if (!isUraniumRoute()) return;
    const url = new URL(window.location.href);
    url.searchParams.set('view', currentView);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

async function copyText(button, value) {
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
        const original = button.textContent;
        button.textContent = 'Copied';
        window.setTimeout(() => { if (button.isConnected) button.textContent = original; }, 1400);
    } catch {
        button.textContent = 'Copy failed';
    }
}

function bindBodyEvents(body) {
    if (!body || body.dataset.uraniumEventsWired === '1') return;
    body.dataset.uraniumEventsWired = '1';
    body.addEventListener('click', (event) => {
        const viewButton = event.target.closest('[data-uranium-view]');
        if (viewButton && VIEW_IDS.has(viewButton.dataset.uraniumView)) {
            currentView = viewButton.dataset.uraniumView;
            updateRouteView();
            renderBody(lastSnapshot);
            return;
        }
        const rangeButton = event.target.closest('[data-uranium-range]');
        if (rangeButton && RANGE_BY_ID.has(rangeButton.dataset.uraniumRange)) {
            currentRange = rangeButton.dataset.uraniumRange;
            renderBody(lastSnapshot);
            return;
        }
        const copyButton = event.target.closest('[data-uranium-copy]');
        if (copyButton) {
            copyText(copyButton, copyButton.dataset.uraniumCopy);
            return;
        }
        if (event.target.closest('[data-uranium-retry]')) refreshUraniumChamber({ quiet: false });
    });
    body.addEventListener('keydown', (event) => {
        const activeTab = event.target.closest('[role="tab"][data-uranium-view]');
        if (!activeTab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = VIEWS.findIndex(({ id }) => id === activeTab.dataset.uraniumView);
        let next = index;
        if (event.key === 'ArrowLeft') next = (index - 1 + VIEWS.length) % VIEWS.length;
        if (event.key === 'ArrowRight') next = (index + 1) % VIEWS.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = VIEWS.length - 1;
        currentView = VIEWS[next].id;
        updateRouteView();
        renderBody(lastSnapshot);
        document.getElementById(`uranium-tab-${currentView}`)?.focus({ preventScroll: true });
    });
}

function ensureOverlay() {
    let overlay = document.getElementById('uranium-modal');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'uranium-modal';
    overlay.className = 'modal-overlay chamber-overlay uranium-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
        <div class="modal-content modal-large chamber-content uranium-content" role="dialog" aria-modal="true" aria-labelledby="uranium-title">
            <button class="modal-close chamber-close" type="button" aria-label="Close Uranium Chamber">&times;</button>
            <div class="uranium-body" id="uranium-chamber-body"></div>
        </div>
    `;
    overlay.querySelector('.chamber-close').addEventListener('click', closeUraniumChamber);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeUraniumChamber(); });
    bindBodyEvents(overlay.querySelector('.uranium-body'));
    document.body.appendChild(overlay);
    return overlay;
}

function lockPageScroll() {
    if (savedBodyOverflow !== null) return;
    savedBodyOverflow = document.body.style.overflow;
    savedHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
}

function unlockPageScroll() {
    if (savedBodyOverflow === null) return;
    document.body.style.overflow = savedBodyOverflow;
    document.documentElement.style.overflow = savedHtmlOverflow || '';
    savedBodyOverflow = null;
    savedHtmlOverflow = null;
}

function refreshInterval() {
    const override = numeric(window.__URANIUM_CHAMBER_REFRESH_MS__);
    return override !== null && override >= 1000 ? override : DEFAULT_REFRESH_MS;
}

function stopRefreshTimer() {
    if (chamberTimer) window.clearInterval(chamberTimer);
    chamberTimer = null;
}

function startRefreshTimer() {
    stopRefreshTimer();
    chamberTimer = window.setInterval(() => {
        if (document.visibilityState !== 'visible') {
            refreshDeferred = true;
            return;
        }
        refreshUraniumChamber({ quiet: true });
    }, refreshInterval());
}

function bindVisibilityRefresh() {
    if (visibilityReady) return;
    visibilityReady = true;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (entryRefreshDeferred) {
            entryRefreshDeferred = false;
            refreshUraniumEntry({ quiet: false });
        }
        const overlayOpen = document.getElementById('uranium-modal')?.classList.contains('active');
        if (!refreshDeferred && !overlayOpen) return;
        refreshDeferred = false;
        refreshUraniumChamber({ quiet: true });
    });
}

async function refreshUraniumEntry({ quiet = true } = {}) {
    if (document.visibilityState !== 'visible') {
        entryRefreshDeferred = true;
        return lastSnapshot || lastEntrySummary;
    }
    try {
        const summary = await fetchUraniumEntrySummary();
        lastEntrySummary = summary;
        entryRefreshDeferred = false;
        if (lastSnapshot) return lastSnapshot;
        updateEntry(summary, { quiet });
        return summary;
    } catch (error) {
        console.warn('Uranium Chamber entry summary failed; loading the complete snapshot:', error);
        return refreshUraniumChamber({ quiet });
    }
}

async function refreshUraniumChamber({ quiet = true } = {}) {
    if (document.visibilityState !== 'visible') {
        refreshDeferred = true;
        return lastSnapshot;
    }
    try {
        const snapshot = await fetchUraniumSnapshot();
        lastSnapshot = snapshot;
        lastRefreshError = '';
        refreshDeferred = false;
        updateEntry(snapshot, { quiet });
        if (document.getElementById('uranium-modal')?.classList.contains('active')) renderBody(snapshot, { quiet });
        return snapshot;
    } catch (error) {
        console.warn('Uranium Chamber snapshot refresh failed:', error);
        lastRefreshError = error?.message || String(error);
        markRefreshFailure();
        const body = document.getElementById('uranium-chamber-body');
        if (!lastSnapshot && body && document.getElementById('uranium-modal')?.classList.contains('active')) renderError(body, error);
        return lastSnapshot;
    }
}

function ensureEntryCard() {
    const existing = document.getElementById('uranium-entry-card');
    if (existing) return existing;
    const grid = document.getElementById('chambers-grid');
    if (!grid) return null;
    const card = document.createElement('article');
    card.id = 'uranium-entry-card';
    card.className = 'stat-card chamber-entry-card chamber-entry-wide chamber-entry-live uranium-entry-card';
    card.dataset.chamberEntrySize = 'wide';
    card.innerHTML = `
        <button class="card-copy-link" type="button" data-copy-hash="#uranium" aria-label="Copy Uranium Chamber direct link" title="Copy Uranium Chamber link">&#128279;</button>
        <div class="card-inner"><div class="card-front chamber-entry-front uranium-entry-front" id="uranium-entry-front">
            <div class="uranium-entry-copy"><div class="uranium-entry-title-line"><h2 class="stat-label" id="uranium-entry-title">Uranium</h2><span class="uranium-entry-chip">xU3O8</span></div><div class="stat-value uranium-entry-value">Loading core</div><div class="stat-description">Physical uranium meets Etherlink price discovery</div></div>
            <div class="uranium-entry-art">${heroPicture('is-entry')}</div>
            <div class="uranium-entry-kpis"><span><small>Proofbook</small><strong>Verifying</strong></span></div>
        </div></div>
    `;
    grid.appendChild(card);
    return card;
}

export async function openUraniumChamber() {
    await ensureUraniumCss();
    const route = routeView();
    if (route) currentView = route;
    const overlay = ensureOverlay();
    const body = overlay.querySelector('.uranium-body');
    overlay.classList.add('active');
    lockPageScroll();
    if (lastSnapshot) renderBody(lastSnapshot);
    else renderLoading(body);
    body.scrollTop = 0;
    activateChamberDialog(overlay, {
        close: closeUraniumChamber,
        dialogSelector: '.uranium-content',
        titleId: 'uranium-title',
        label: 'Uranium Chamber',
        initialFocusSelector: '.chamber-close'
    });
    await refreshUraniumChamber({ quiet: false });
    if (overlay.classList.contains('active')) startRefreshTimer();
}

export function closeUraniumChamber() {
    stopRefreshTimer();
    const overlay = document.getElementById('uranium-modal');
    overlay?.classList.remove('active');
    deactivateChamberDialog(overlay);
    unlockPageScroll();
}

export function initUraniumChamber() {
    ensureUraniumCss();
    bindVisibilityRefresh();
    const card = ensureEntryCard();
    wireEntry(card);
    if (lastSnapshot) updateEntry(lastSnapshot);
    else if (lastEntrySummary) updateEntry(lastEntrySummary);
    else if (document.visibilityState === 'visible') refreshUraniumEntry({ quiet: false });
    else entryRefreshDeferred = true;
}
