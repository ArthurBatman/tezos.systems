/**
 * My Tezos Memory — reconstructed L1 history plus human-readable activity.
 */

import {
    getAllMyTezosRecords,
    getMyTezosRecord,
    initMyTezosDb,
    commitMyTezosPage,
    pruneMyTezosActivityRecords,
    putMyTezosRecords,
    setMyTezosMeta
} from '../core/my-tezos-db.mjs';
import { myTezosAccountKey } from '../core/my-tezos-models.mjs';
import { quietlySyncHtml } from '../core/quiet-refresh.js';
import { escapeHtml, formatFreshnessStamp } from '../core/utils.js';
import { readSavedMyTezosEntries } from '../core/wallet.js';
import {
    activityDisplay,
    aggregateMyTezosActivities
} from './my-tezos-activity-model.mjs';
import {
    fetchMyTezosActivityPage,
    fetchMyTezosBalanceHistory
} from './my-tezos-tzkt-adapter.mjs';
import { buildReconstructedPortfolioSeries } from './my-tezos-portfolio-model.mjs';

const INITIAL_DAYS = 365;
const INITIAL_PAGE_LIMIT = 3;
const LOAD_EARLIER_PAGE_LIMIT = 5;
const LAST_SEEN_KEY = 'tezos-systems-my-tezos-memory-last-seen-v1';
const STORAGE_NOTICE_ID = 'my-tezos-memory-storage-notice';

let initialized = false;
let activeGeneration = 0;
let syncInFlight = null;
let syncController = null;
let successfulVisibleRender = false;
let currentActivities = [];
let currentSeries = [];
let activityFilter = 'transfers';
let unseenOnly = false;

function includedEntries() {
    return readSavedMyTezosEntries().filter((entry) => entry.included !== false);
}

function panelVisible() {
    return document.visibilityState === 'visible'
        && (
            document.getElementById('my-tezos-panel-portfolio')?.hidden === false
            || document.getElementById('my-tezos-panel-transactions')?.hidden === false
        )
        && document.getElementById('my-tezos-drawer')?.classList.contains('open') === true;
}

function scopeId(address) {
    return `reconstructed:l1:${address}`;
}

function setStorageNotice(message = '') {
    const notice = document.getElementById(STORAGE_NOTICE_ID);
    if (!notice) return;
    notice.textContent = message;
    notice.hidden = !message;
}

function setStatus(message, state = '') {
    const status = document.getElementById('portfolio-memory-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
}

function renderWhileAway(activities, { baselineCreated = false } = {}) {
    const target = document.getElementById('portfolio-while-away');
    if (!target) return;
    const lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY)) || 0;
    if (!lastSeen || baselineCreated) {
        quietlySyncHtml(target, `
            <div class="portfolio-memory-empty">
                <strong>Memory is ready</strong>
                <span>Future on-chain changes will appear here after you return. Historical reconstruction is not marked as unseen.</span>
            </div>
        `);
        return;
    }
    const unseen = activities.filter((activity) => activity.timestamp > lastSeen);
    if (!unseen.length) {
        quietlySyncHtml(target, `
            <div class="portfolio-memory-empty">
                <strong>No new indexed activity</strong>
                <span>Nothing in the reconstructed receipts changed since ${escapeHtml(new Date(lastSeen).toLocaleString())}.</span>
            </div>
        `);
        return;
    }
    const kinds = new Map();
    unseen.forEach((activity) => kinds.set(activity.kind, (kinds.get(activity.kind) || 0) + 1));
    const chips = [...kinds.entries()].slice(0, 4)
        .map(([kind, count]) => `<span>${escapeHtml(kind.replaceAll('-', ' '))} · ${count}</span>`)
        .join('');
    quietlySyncHtml(target, `
        <div class="portfolio-memory-delta">
            <strong>${unseen.length} change${unseen.length === 1 ? '' : 's'} since your last visit</strong>
            <div>${chips}</div>
            <button type="button" class="glass-button" data-memory-show-unseen>Show changes</button>
        </div>
    `);
    target.querySelector('[data-memory-show-unseen]')?.addEventListener('click', () => {
        const nextFilter = unseen.some((activity) => activity.kind.startsWith('nft-')) ? 'nft' : 'transfers';
        setActivityFilter(nextFilter, { onlyUnseen: true });
        window.dispatchEvent(new CustomEvent('my-tezos-view-request', { detail: { view: 'transactions' } }));
        requestAnimationFrame(() => {
            document.getElementById('portfolio-activity-title')?.scrollIntoView({ block: 'nearest' });
        });
    });
}

function renderActivity(activities) {
    const target = document.getElementById('portfolio-activity-list');
    const empty = document.getElementById('portfolio-activity-empty');
    if (!target || !empty) return;
    const lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY)) || 0;
    const filtered = activities.filter((activity) => {
        const isNft = activity.kind.startsWith('nft-');
        if (activityFilter === 'nft' ? !isNft : isNft) return false;
        return !unseenOnly || activity.timestamp > lastSeen;
    }).slice(0, 80);
    empty.hidden = filtered.length > 0;
    if (!filtered.length) {
        quietlySyncHtml(target, '');
        empty.textContent = unseenOnly
            ? `No new ${activityFilter === 'nft' ? 'NFT interactions' : 'transfers'} remain in the loaded window.`
            : activityFilter === 'nft'
                ? 'No NFT interactions are classified in the loaded activity window.'
                : 'No transfer or account receipts are loaded yet.';
        return;
    }
    quietlySyncHtml(target, filtered.map((activity) => {
        const display = activityDisplay(activity);
        const direction = activity.direction === 'in' ? '↓' : activity.direction === 'out' ? '↑' : activity.direction === 'self' ? '↔' : '•';
        const interactionType = activity.kind.startsWith('nft-') ? 'nft' : 'transfer';
        return `
            <article class="portfolio-activity-item activity-item-${interactionType}" data-quiet-key="${escapeHtml(activity.id)}" data-activity-id="${escapeHtml(activity.id)}" data-activity-type="${interactionType}">
                <span class="portfolio-activity-direction" data-direction="${escapeHtml(activity.direction)}" aria-hidden="true">${direction}</span>
                <div>
                    <strong>${escapeHtml(display.title)}</strong>
                    <span>${escapeHtml(new Date(activity.timestamp).toLocaleString())}${display.amountText ? ` · ${escapeHtml(display.amountText)}` : ''}</span>
                    <small>${escapeHtml(display.confidence)} · ${escapeHtml(activity.layer === 'l2' ? 'Etherlink L2' : 'Tezos L1')}</small>
                </div>
                ${display.explorerUrl ? `<a href="${escapeHtml(display.explorerUrl)}" target="_blank" rel="noopener" aria-label="Open source receipt">↗</a>` : ''}
            </article>
        `;
    }).join(''));
}

function setActivityFilter(filter, { onlyUnseen = false } = {}) {
    activityFilter = filter === 'nft' ? 'nft' : 'transfers';
    unseenOnly = onlyUnseen;
    document.querySelectorAll('[data-activity-filter]').forEach((button) => {
        const active = button.dataset.activityFilter === activityFilter;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    renderActivity(currentActivities);
}

function renderMemory(entries, snapshots, activities, { status = 'cached', baselineCreated = false } = {}) {
    currentSeries = buildReconstructedPortfolioSeries(entries, snapshots);
    currentActivities = aggregateMyTezosActivities(activities, entries.map((entry) => entry.address));
    renderWhileAway(currentActivities, { baselineCreated });
    renderActivity(currentActivities);
    window.dispatchEvent(new CustomEvent('my-tezos-memory-ready', {
        detail: {
            compositionAddresses: entries.map((entry) => entry.address),
            reconstructed: currentSeries,
            activities: currentActivities,
            status
        }
    }));
}

async function readCachedMemory(entries) {
    const snapshots = [];
    const activities = [];
    for (const entry of entries) {
        const accountSnapshots = await getAllMyTezosRecords('snapshots', {
            index: 'scopeId',
            query: IDBKeyRange.only(scopeId(entry.address)),
            limit: 10_000
        });
        snapshots.push(...accountSnapshots);
        const accountActivities = await getAllMyTezosRecords('activityByAccount', {
            index: 'accountKey',
            query: IDBKeyRange.only(myTezosAccountKey('l1', entry.address)),
            direction: 'prev',
            limit: 50_000
        });
        activities.push(...accountActivities);
    }
    return { snapshots, activities };
}

async function persistBalanceHistory(address, result) {
    const records = result.rows.slice(-10_000).map((point) => ({
        id: `reconstructed:l1:${address}:${point.timestamp}`,
        scopeId: scopeId(address),
        address,
        timestamp: point.timestamp,
        level: point.level,
        sourceType: 'reconstructed',
        liquid: point.liquid,
        confidence: 'exact',
        limitation: 'Historical account balance can exclude staked tez for non-bakers.',
        sourceReceipt: result.receipt
    }));
    await putMyTezosRecords('snapshots', records);
    return records;
}

async function syncActivity(entries, ownedAddresses, { loadEarlier = false, signal } = {}) {
    const addressKey = entries.map((entry) => entry.address).sort().join(',');
    const stateId = `tzkt:activity:${addressKey}`;
    const state = await getMyTezosRecord('syncState', stateId);
    if (loadEarlier && state?.complete) return [];
    let lastId = loadEarlier ? Number(state?.cursor) || null : null;
    let resumeCursor = Number(state?.cursor) || null;
    const cutoff = Date.now() - INITIAL_DAYS * 24 * 60 * 60 * 1000;
    const limit = loadEarlier ? LOAD_EARLIER_PAGE_LIMIT : INITIAL_PAGE_LIMIT;
    const collected = [];
    let complete = false;
    for (let page = 0; page < limit; page += 1) {
        const result = await fetchMyTezosActivityPage(entries.map((entry) => entry.address), {
            ownedAddresses,
            lastId,
            from: loadEarlier ? '' : new Date(cutoff).toISOString(),
            signal
        });
        collected.push(...result.rows);
        complete = result.complete || result.rows.some((row) => row.timestamp <= cutoff);
        lastId = result.nextCursor;
        if (loadEarlier || !resumeCursor) resumeCursor = result.nextCursor;
        await commitMyTezosPage('activityByAccount', result.rows, {
            id: stateId,
            adapter: 'tzkt',
            accountKey: `aggregate:l1:${addressKey}`,
            stream: 'activity',
            cursor: loadEarlier && result.complete ? null : resumeCursor,
            watermark: result.rows[0]?.timestamp || state?.watermark || null,
            complete: loadEarlier ? result.complete : false,
            windowComplete: !loadEarlier && complete,
            updatedAt: Date.now(),
            error: null
        });
        if (complete || result.nextCursor == null) break;
    }
    await Promise.all(entries.map((entry) => (
        pruneMyTezosActivityRecords(myTezosAccountKey('l1', entry.address))
    )));
    return collected;
}

async function syncMemory({ loadEarlier = false, force = false } = {}) {
    if (!panelVisible()) return null;
    if (syncInFlight && !force) return syncInFlight;
    if (syncInFlight && force) syncController?.abort();
    const entries = includedEntries();
    const generation = ++activeGeneration;
    if (!entries.length) {
        renderMemory([], [], [], { status: 'empty' });
        setStatus('Include an L1 address to reconstruct Memory.', 'empty');
        return null;
    }
    setStatus(loadEarlier ? 'Loading earlier TzKT receipts…' : 'Reconstructing history in the background…', 'loading');
    const controller = new AbortController();
    syncController = controller;
    const ownedAddresses = entries.map((entry) => entry.address);

    const pending = (async () => {
        let successCount = 0;
        const balanceResults = loadEarlier ? [] : await Promise.allSettled(entries.map(async (entry) => {
            const result = await fetchMyTezosBalanceHistory(entry.address, { signal: controller.signal });
            const records = await persistBalanceHistory(entry.address, result);
            successCount += 1;
            return records;
        }));
        const activityResults = await Promise.allSettled([syncActivity(entries, ownedAddresses, {
            loadEarlier,
            signal: controller.signal
        }).then((records) => {
            successCount += 1;
            return records;
        })]);
        if (generation !== activeGeneration || !panelVisible()) return null;
        const cached = await readCachedMemory(entries);
        let baselineCreated = false;
        if (successCount > 0 && !Number(localStorage.getItem(LAST_SEEN_KEY))) {
            localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
            baselineCreated = true;
        }
        renderMemory(entries, cached.snapshots, cached.activities, {
            status: successCount === (loadEarlier ? 1 : entries.length + 1) ? 'complete' : 'partial',
            baselineCreated
        });
        successfulVisibleRender = successCount > 0;
        const failures = [...balanceResults, ...activityResults].filter((result) => result.status === 'rejected').length;
        setStatus(
            failures
                ? `Memory updated with partial source coverage · ${failures} request${failures === 1 ? '' : 's'} unavailable`
                : `${loadEarlier ? 'Earlier receipts loaded' : 'Memory current'} · ${formatFreshnessStamp(new Date(), { source: 'TzKT' })}`,
            failures ? 'partial' : 'complete'
        );
        await setMyTezosMeta('memory-last-success', {
            timestamp: Date.now(),
            addresses: ownedAddresses,
            partial: failures > 0
        });
        return { entries, ...cached, failures };
    })().catch((error) => {
        if (generation === activeGeneration) {
            setStatus(`${error.message || 'Memory refresh failed'} · showing saved receipts`, 'error');
        }
        return null;
    }).finally(() => {
        if (syncInFlight === pending) {
            syncInFlight = null;
            syncController = null;
        }
    });
    syncInFlight = pending;
    return pending;
}

function scheduleSync({ force = false } = {}) {
    const run = () => syncMemory({ force }).catch(() => {});
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1200 });
    else setTimeout(run, 250);
}

export async function activateMyTezosMemory({ force = false } = {}) {
    const entries = includedEntries();
    try {
        await initMyTezosDb();
        setStorageNotice('');
        const cached = await readCachedMemory(entries);
        renderMemory(entries, cached.snapshots, cached.activities, { status: 'cached' });
        scheduleSync({ force });
    } catch (error) {
        setStorageNotice('History cannot be saved on this device. Current data remains available for this visit.');
        setStatus(error.message || 'Memory storage unavailable', 'error');
    }
}

export function initMyTezosMemory() {
    if (initialized) return;
    initialized = true;
    document.getElementById('portfolio-load-earlier')?.addEventListener('click', () => {
        syncMemory({ loadEarlier: true }).catch(() => {});
    });
    document.querySelectorAll('[data-activity-filter]').forEach((button) => {
        button.addEventListener('click', () => {
            setActivityFilter(button.dataset.activityFilter || 'transfers');
        });
    });
    window.addEventListener('my-tezos-activity-filter', (event) => {
        const filter = event.detail?.filter || 'transfers';
        setActivityFilter(filter, { onlyUnseen: filter === 'unseen' });
    });
    window.addEventListener('my-tezos-drawer-closed', () => {
        if (!successfulVisibleRender) return;
        localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
        successfulVisibleRender = false;
    });
    window.addEventListener('my-tezos-portfolio-changed', () => {
        activeGeneration += 1;
        if (panelVisible()) activateMyTezosMemory({ force: true }).catch(() => {});
    });
    document.addEventListener('visibilitychange', () => {
        if (panelVisible()) scheduleSync();
    });
}

export function destroyMyTezosMemoryForTests() {
    activeGeneration += 1;
    syncController?.abort();
    syncController = null;
    syncInFlight = null;
    successfulVisibleRender = false;
    currentActivities = [];
    currentSeries = [];
    activityFilter = 'transfers';
    unseenOnly = false;
    initialized = false;
}
