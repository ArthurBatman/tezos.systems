import {
    MAX_SAVED_MY_TEZOS_ADDRESSES,
    MY_TEZOS_PORTFOLIO_NETWORK
} from '../core/my-tezos-entries.mjs';

export const MY_TEZOS_PORTFOLIO_SCHEMA = 'tezos-systems-portfolio/v1';
export const MY_TEZOS_PORTFOLIO_HISTORY_SCHEMA = 1;
export { MY_TEZOS_PORTFOLIO_NETWORK };
export const MY_TEZOS_PORTFOLIO_MAX_ENTRIES = MAX_SAVED_MY_TEZOS_ADDRESSES;
export const MY_TEZOS_PORTFOLIO_HISTORY_HOURLY_DAYS = 30;
export const MY_TEZOS_PORTFOLIO_HISTORY_RETENTION_DAYS = 365;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ADDRESS_RE = /^(?:tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/;

function finiteNonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function portfolioRowFromAccount(entry, account) {
    const spendable = finiteNonNegative(account?.balance);
    const staked = finiteNonNegative(account?.stakedBalance);
    const unstaking = finiteNonNegative(account?.unstakedBalance);
    return {
        network: MY_TEZOS_PORTFOLIO_NETWORK,
        address: entry.address,
        label: entry.label || null,
        included: entry.included !== false,
        alias: account?.alias || null,
        baker: account?.type === 'delegate'
            ? { address: entry.address, alias: account?.alias || 'Self (Baker)', self: true }
            : account?.delegate
                ? {
                    address: account.delegate.address || '',
                    alias: account.delegate.alias || null,
                    self: false
                }
                : null,
        spendable,
        staked,
        unstaking,
        total: spendable + staked + unstaking
    };
}

export function calculatePortfolioTotals(rows) {
    return (Array.isArray(rows) ? rows : []).reduce((totals, row) => {
        if (row?.included === false) return totals;
        totals.spendable += finiteNonNegative(row?.spendable);
        totals.staked += finiteNonNegative(row?.staked);
        totals.unstaking += finiteNonNegative(row?.unstaking);
        totals.total += finiteNonNegative(row?.total);
        return totals;
    }, { total: 0, spendable: 0, staked: 0, unstaking: 0 });
}

export function portfolioCompositionKey(entries) {
    const canonical = (Array.isArray(entries) ? entries : [])
        .filter((entry) => entry?.included !== false && entry?.network === MY_TEZOS_PORTFOLIO_NETWORK && ADDRESS_RE.test(String(entry?.address || '')))
        .map((entry) => `${entry.network}:${entry.address}`)
        .sort();
    let hash = 0x811c9dc5;
    for (const char of canonical.join('|')) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `v1-${canonical.length}-${hash.toString(16).padStart(8, '0')}`;
}

function validSnapshot(point) {
    return point
        && Number.isFinite(Number(point.timestamp))
        && Number(point.timestamp) > 0
        && ['total', 'spendable', 'staked', 'unstaking'].every((key) => (
            Number.isFinite(Number(point[key])) && Number(point[key]) >= 0
        ));
}

export function compactPortfolioHistory(points, { now = Date.now() } = {}) {
    const oldest = now - (MY_TEZOS_PORTFOLIO_HISTORY_RETENTION_DAYS * DAY_MS);
    const hourlyCutoff = now - (MY_TEZOS_PORTFOLIO_HISTORY_HOURLY_DAYS * DAY_MS);
    const hourly = new Map();
    const daily = new Map();

    for (const raw of Array.isArray(points) ? points : []) {
        if (!validSnapshot(raw)) continue;
        const point = {
            timestamp: Number(raw.timestamp),
            total: Number(raw.total),
            spendable: Number(raw.spendable),
            staked: Number(raw.staked),
            unstaking: Number(raw.unstaking)
        };
        if (point.timestamp < oldest || point.timestamp > now + HOUR_MS) continue;
        if (point.timestamp >= hourlyCutoff) {
            const bucket = Math.floor(point.timestamp / HOUR_MS);
            const existing = hourly.get(bucket);
            if (!existing || existing.timestamp < point.timestamp) hourly.set(bucket, point);
        } else {
            const date = new Date(point.timestamp);
            const bucket = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
            const existing = daily.get(bucket);
            if (!existing || existing.timestamp < point.timestamp) daily.set(bucket, point);
        }
    }

    return [...daily.values(), ...hourly.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function appendPortfolioSnapshot(store, composition, snapshot, { now = Date.now() } = {}) {
    const safeStore = store && store.schema === MY_TEZOS_PORTFOLIO_HISTORY_SCHEMA && store.series && typeof store.series === 'object'
        ? store
        : { schema: MY_TEZOS_PORTFOLIO_HISTORY_SCHEMA, series: {} };
    const series = { ...safeStore.series };
    const current = Array.isArray(series[composition]) ? series[composition] : [];
    series[composition] = compactPortfolioHistory([...current, snapshot], { now });

    const keys = Object.keys(series).sort((a, b) => {
        const aLast = series[a]?.at(-1)?.timestamp || 0;
        const bLast = series[b]?.at(-1)?.timestamp || 0;
        return bLast - aLast;
    });
    for (const stale of keys.slice(5)) delete series[stale];
    return { schema: MY_TEZOS_PORTFOLIO_HISTORY_SCHEMA, series };
}

function importLabel(value) {
    const label = typeof value === 'string' ? value.trim() : '';
    return label ? label.slice(0, 80) : null;
}

export function parsePortfolioImport(payload) {
    if (!payload || typeof payload !== 'object' || payload.schema !== MY_TEZOS_PORTFOLIO_SCHEMA) {
        throw new Error('This is not a Tezos Systems portfolio v1 file.');
    }
    if (!Array.isArray(payload.entries)) {
        throw new Error('The portfolio file has no address list.');
    }
    const entries = [];
    const seen = new Set();
    let skipped = 0;
    for (const raw of payload.entries) {
        const network = raw?.network || MY_TEZOS_PORTFOLIO_NETWORK;
        const address = String(raw?.address || '').trim();
        const key = `${network}:${address}`;
        if (network !== MY_TEZOS_PORTFOLIO_NETWORK || !ADDRESS_RE.test(address) || seen.has(key)) {
            skipped += 1;
            continue;
        }
        seen.add(key);
        if (entries.length >= MY_TEZOS_PORTFOLIO_MAX_ENTRIES) {
            skipped += 1;
            continue;
        }
        entries.push({
            network,
            address,
            label: importLabel(raw?.label),
            included: raw?.included !== false,
            addedAt: Number.isFinite(Number(raw?.addedAt)) && Number(raw.addedAt) > 0
                ? Number(raw.addedAt)
                : Date.now()
        });
    }
    if (!entries.length) throw new Error('The portfolio file contains no valid Tezos L1 addresses.');
    return { entries, skipped };
}

export function mergePortfolioEntries(current, incoming, max = MY_TEZOS_PORTFOLIO_MAX_ENTRIES) {
    const merged = [];
    const seen = new Set();
    for (const entry of [...(Array.isArray(incoming) ? incoming : []), ...(Array.isArray(current) ? current : [])]) {
        const key = `${entry?.network}:${entry?.address}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(entry);
        if (merged.length >= max) break;
    }
    return merged;
}
