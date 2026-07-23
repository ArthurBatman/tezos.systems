/**
 * My Tezos Collection — summary-first Objkt holdings for included L1 accounts.
 */

import {
    getAllMyTezosRecords,
    getMyTezosMeta,
    initMyTezosDb,
    putMyTezosRecords,
    replaceMyTezosAccountRecords,
    setMyTezosMeta
} from '../core/my-tezos-db.mjs';
import { createActivity, myTezosAccountKey } from '../core/my-tezos-models.mjs';
import {
    MY_TEZOS_COLLECTION_PAGE_SIZE,
    fetchObjktCollectionPage
} from '../core/objkt-client.mjs';
import { quietlySyncHtml } from '../core/quiet-refresh.js';
import { escapeHtml, formatFreshnessStamp } from '../core/utils.js';
import { readSavedMyTezosEntries, shortAddress } from '../core/wallet.js';
import { collectionSummary } from './my-tezos-collection-model.mjs';

let initialized = false;
let refreshInFlight = null;
let generation = 0;
let selectedScope = 'all';
let collectionMode = 'collected';
let showSpam = false;
let nextOffset = 0;
let complete = true;
let currentRecords = [];
let currentProfiles = [];
let refreshController = null;
let collectionSyncId = '';

function includedEntries() {
    return readSavedMyTezosEntries().filter((entry) => entry.included !== false);
}

function selectedEntries() {
    const entries = includedEntries();
    if (selectedScope === 'all') return entries;
    return entries.filter((entry) => entry.address === selectedScope);
}

function isVisible() {
    return document.visibilityState === 'visible'
        && document.getElementById('my-tezos-panel-collection')?.hidden === false
        && document.getElementById('my-tezos-drawer')?.classList.contains('open') === true;
}

function resolveMedia(uri) {
    const value = String(uri || '');
    if (value.startsWith('ipfs://')) return `https://dweb.link/ipfs/${value.slice(7)}`;
    return value;
}

function setStatus(message, state = '') {
    const status = document.getElementById('collection-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
}

function renderScopeOptions() {
    const select = document.getElementById('collection-wallet-scope');
    if (!select) return;
    const entries = includedEntries();
    if (selectedScope !== 'all' && !entries.some((entry) => entry.address === selectedScope)) selectedScope = 'all';
    quietlySyncHtml(select, [
        `<option value="all">All included wallets (${entries.length})</option>`,
        ...entries.map((entry) => `<option value="${escapeHtml(entry.address)}">${escapeHtml(entry.label || shortAddress(entry.address))}</option>`)
    ].join(''));
    select.value = selectedScope;
}

function renderProfiles() {
    const target = document.getElementById('collection-profiles');
    if (!target) return;
    const profiles = currentProfiles.filter((profile) => selectedScope === 'all' || profile.address === selectedScope);
    if (!profiles.length) {
        quietlySyncHtml(target, '<span>Objkt collector and creator profiles appear when the selected addresses have public profile data.</span>');
        return;
    }
    quietlySyncHtml(target, profiles.map((profile) => `
        <article>
            <strong>${escapeHtml(profile.alias || shortAddress(profile.address))}</strong>
            <span>${escapeHtml(profile.description || 'Collector / creator profile')}</span>
            <small>${profile.collectedLoaded} collected loaded · ${profile.createdLoaded} created loaded</small>
        </article>
    `).join(''));
}

function renderCollection() {
    renderScopeOptions();
    const relevant = currentRecords.filter((record) => (
        (selectedScope === 'all' || record.ownerAddress === selectedScope)
        && (showSpam || !record.spam)
    ));
    const summary = collectionSummary(relevant);
    const summaryTarget = document.getElementById('collection-summary');
    if (summaryTarget) {
        const values = {
            assets: summary.assets,
            editions: summary.editions,
            collections: summary.collections,
            artists: summary.artists,
            created: summary.createdAssets
        };
        Object.entries(values).forEach(([key, value]) => {
            const cell = summaryTarget.querySelector(`[data-collection-total="${key}"] strong`);
            if (cell) cell.textContent = String(value);
        });
    }
    const spamButton = document.getElementById('collection-spam-toggle');
    if (spamButton) {
        const hiddenSpam = currentRecords.filter((record) => record.spam).length;
        spamButton.textContent = showSpam ? 'Hide flagged' : `Flagged ${hiddenSpam}`;
        spamButton.setAttribute('aria-pressed', String(showSpam));
        spamButton.hidden = hiddenSpam === 0;
    }
    renderProfiles();

    const grid = document.getElementById('collection-grid');
    const empty = document.getElementById('collection-empty');
    if (!grid || !empty) return;
    const assets = summary.holdings.filter((record) => record.kind === collectionMode && (showSpam || !record.spam));
    empty.hidden = assets.length > 0;
    if (!assets.length) {
        quietlySyncHtml(grid, '');
        empty.textContent = includedEntries().length
            ? collectionMode === 'created'
                ? 'No created assets are available in the loaded Objkt coverage.'
                : 'No collected assets are available in the loaded Objkt coverage.'
            : 'Include an L1 address in Portfolio to load its collection.';
    } else {
        quietlySyncHtml(grid, assets.map((asset) => {
            const image = resolveMedia(asset.thumbnail);
            const ownerCount = asset.ownerAddresses?.length || 1;
            const ownerCopy = ownerCount > 1 ? `${ownerCount} included wallets` : shortAddress(asset.ownerAddresses?.[0] || asset.ownerAddress);
            return `
                <article class="collection-asset-card${asset.spam ? ' flagged' : ''}" data-collection-asset="${escapeHtml(`${asset.contract}:${asset.tokenId}`)}">
                    <div class="collection-asset-media">
                        ${image
                            ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
                            : '<span aria-hidden="true">◫</span>'}
                    </div>
                    <div>
                        <strong>${escapeHtml(asset.name)}</strong>
                        <span>${escapeHtml(asset.collection?.name || 'Unknown collection')}</span>
                        <small>${Number(asset.quantity).toLocaleString()} edition${Number(asset.quantity) === 1 ? '' : 's'} · ${escapeHtml(ownerCopy)}</small>
                        ${asset.activeAskMutez > 0 ? `<small>Active ask reference · ${(asset.activeAskMutez / 1e6).toLocaleString()} ꜩ · not a portfolio value</small>` : ''}
                        ${asset.spam ? '<small>Flagged metadata · hidden by default</small>' : ''}
                    </div>
                    <a href="https://objkt.com/tokens/${encodeURIComponent(asset.contract)}/${encodeURIComponent(asset.tokenId)}" target="_blank" rel="noopener" aria-label="Open asset on Objkt">↗</a>
                </article>
            `;
        }).join(''));
        grid.querySelectorAll('img').forEach((image) => {
            image.addEventListener('error', () => {
                image.replaceWith(Object.assign(document.createElement('span'), {
                    textContent: 'Image unavailable',
                    className: 'collection-image-fallback'
                }));
            }, { once: true });
        });
    }
    const loadMore = document.getElementById('collection-load-more');
    if (loadMore) {
        loadMore.hidden = complete;
        loadMore.disabled = Boolean(refreshInFlight);
    }
}

async function readCachedRecords(entries) {
    const records = [];
    for (const entry of entries) {
        records.push(...await getAllMyTezosRecords('holdings', {
            index: 'accountKey',
            query: IDBKeyRange.only(myTezosAccountKey('l1', entry.address)),
            limit: 20_000
        }));
    }
    return records.filter((record) => record.layer === 'l1');
}

async function persistCollectionPage(entries, result, offset) {
    const syncId = collectionSyncId || `objkt:${Date.now()}`;
    const holdings = result.holdings.map((holding) => ({
        ...holding,
        syncId,
        sourceReceipt: result.receipt
    }));
    if (offset === 0 && result.complete) {
        for (const entry of entries) {
            await replaceMyTezosAccountRecords(
                'holdings',
                myTezosAccountKey('l1', entry.address),
                holdings.filter((holding) => holding.ownerAddress === entry.address)
            );
        }
    } else {
        await putMyTezosRecords('holdings', holdings);
        if (result.complete) {
            for (const entry of entries) {
                const accountKey = myTezosAccountKey('l1', entry.address);
                const records = await getAllMyTezosRecords('holdings', {
                    index: 'accountKey',
                    query: IDBKeyRange.only(accountKey),
                    limit: 20_000
                });
                await replaceMyTezosAccountRecords(
                    'holdings',
                    accountKey,
                    records.filter((holding) => holding.syncId === syncId)
                );
            }
        }
    }
    const existingProfiles = (await getMyTezosMeta('collection-profiles')) || [];
    const profilesByAddress = new Map(existingProfiles.map((profile) => [profile.address, profile]));
    result.profiles.forEach((profile) => profilesByAddress.set(profile.address, profile));
    await setMyTezosMeta('collection-profiles', [...profilesByAddress.values()]);
    const holdingActivities = holdings
        .filter((holding) => holding.kind === 'collected' && holding.lastChangedAt)
        .map((holding) => createActivity({
            id: `objkt-holding:${holding.ownerAddress}:${holding.contract}:${holding.tokenId}:${holding.lastChangedAt}`,
            accountKey: myTezosAccountKey('l1', holding.ownerAddress),
            layer: 'l1',
            kind: 'nft-unknown',
            direction: 'neutral',
            timestamp: holding.lastChangedAt,
            groupKey: `objkt:${holding.contract}:${holding.tokenId}:${holding.lastChangedAt}`,
            status: 'indexed',
            asset: {
                type: 'nft',
                symbol: holding.name,
                contract: holding.contract,
                tokenId: holding.tokenId,
                decimals: 0
            },
            confidence: 'unknown',
            summary: `NFT holding changed · ${holding.name}`,
            sourceReceipts: result.receipt ? [result.receipt] : []
        }));
    await putMyTezosRecords('activityByAccount', holdingActivities);
    await putMyTezosRecords('syncState', {
        id: `objkt:collection:${entries.map((entry) => entry.address).sort().join(',')}`,
        adapter: 'objkt',
        accountKey: 'aggregate:l1',
        stream: 'collection',
        cursor: result.nextOffset,
        complete: result.complete,
        updatedAt: Date.now(),
        error: null,
        receipt: result.receipt,
        syncId
    });
}

async function refreshCollection({ loadMore = false, force = false } = {}) {
    if (!isVisible()) return null;
    if (refreshInFlight && !force) return refreshInFlight;
    if (refreshInFlight && force) refreshController?.abort();
    const entries = selectedEntries();
    const requestGeneration = ++generation;
    if (!entries.length) {
        currentRecords = [];
        currentProfiles = [];
        renderCollection();
        setStatus('No included L1 addresses.', 'empty');
        return null;
    }
    const offset = loadMore ? nextOffset : 0;
    if (offset === 0) collectionSyncId = `objkt:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    setStatus(loadMore ? 'Loading another Objkt page…' : 'Reading Objkt summary and first holdings page…', 'loading');
    const controller = new AbortController();
    refreshController = controller;
    const pending = (async () => {
        try {
            const result = await fetchObjktCollectionPage(entries.map((entry) => entry.address), {
                offset,
                limit: MY_TEZOS_COLLECTION_PAGE_SIZE,
                signal: controller.signal
            });
            if (requestGeneration !== generation || !isVisible()) return null;
            let saved = true;
            try {
                await persistCollectionPage(entries, result, offset);
                currentRecords = await readCachedRecords(selectedEntries());
                currentProfiles = (await getMyTezosMeta('collection-profiles')) || [];
            } catch {
                saved = false;
                const incomingIds = new Set(result.holdings.map((holding) => holding.id));
                currentRecords = offset === 0
                    ? result.holdings
                    : [...currentRecords.filter((holding) => !incomingIds.has(holding.id)), ...result.holdings];
                currentProfiles = result.profiles;
            }
            nextOffset = result.nextOffset || 0;
            complete = result.complete;
            renderCollection();
            setStatus(
                `${result.complete ? 'Complete loaded coverage' : 'Partial loaded coverage'} · ${result.holdings.length} rows this page · ${saved ? 'saved on this device' : 'temporary view; storage unavailable'} · ${formatFreshnessStamp(new Date(), { source: 'Objkt' })}`,
                saved ? (result.complete ? 'complete' : 'partial') : 'error'
            );
            return result;
        } catch (error) {
            renderCollection();
            setStatus(`${error.message || 'Objkt unavailable'} · showing last saved holdings`, 'error');
            return null;
        } finally {
            if (refreshInFlight === pending) {
                refreshInFlight = null;
                refreshController = null;
            }
            const loadButton = document.getElementById('collection-load-more');
            if (loadButton) loadButton.disabled = false;
        }
    })();
    refreshInFlight = pending;
    return pending;
}

function wireCollectionControls() {
    document.getElementById('collection-wallet-scope')?.addEventListener('change', (event) => {
        selectedScope = event.currentTarget.value || 'all';
        nextOffset = 0;
        complete = true;
        activateMyTezosCollection({ force: true }).catch(() => {});
    });
    document.querySelectorAll('[data-collection-mode]').forEach((button) => {
        button.addEventListener('click', () => {
            collectionMode = button.dataset.collectionMode === 'created' ? 'created' : 'collected';
            document.querySelectorAll('[data-collection-mode]').forEach((candidate) => {
                const active = candidate === button;
                candidate.classList.toggle('active', active);
                candidate.setAttribute('aria-pressed', String(active));
            });
            renderCollection();
        });
    });
    document.getElementById('collection-spam-toggle')?.addEventListener('click', () => {
        showSpam = !showSpam;
        renderCollection();
    });
    document.getElementById('collection-load-more')?.addEventListener('click', (event) => {
        event.currentTarget.disabled = true;
        refreshCollection({ loadMore: true }).catch(() => {});
    });
    document.getElementById('collection-activity-link')?.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('my-tezos-view-request', { detail: { view: 'portfolio' } }));
        window.dispatchEvent(new CustomEvent('my-tezos-activity-filter', { detail: { filter: 'nft' } }));
    });
}

export async function activateMyTezosCollection({ force = false } = {}) {
    if (!initialized) {
        initialized = true;
        wireCollectionControls();
        window.addEventListener('my-tezos-portfolio-changed', () => {
            generation += 1;
            renderScopeOptions();
            if (isVisible()) activateMyTezosCollection({ force: true }).catch(() => {});
        });
    }
    renderScopeOptions();
    try {
        await initMyTezosDb();
        currentRecords = await readCachedRecords(selectedEntries());
        currentProfiles = (await getMyTezosMeta('collection-profiles')) || [];
        renderCollection();
        if (force || !currentRecords.length) return refreshCollection({ force });
        setStatus('Saved holdings shown · checking Objkt quietly…', 'cached');
        setTimeout(() => refreshCollection().catch(() => {}), 150);
    } catch (error) {
        setStatus('Collection cannot be saved on this device; loading a temporary view.', 'error');
        return refreshCollection();
    }
    return null;
}

export function destroyMyTezosCollectionForTests() {
    generation += 1;
    refreshController?.abort();
    refreshController = null;
    refreshInFlight = null;
    initialized = false;
    currentRecords = [];
    currentProfiles = [];
}
