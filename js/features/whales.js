/**
 * Whale Tracker - shared large-operation data and legacy dashboard rail.
 *
 * Operation identity is the TzKT operation id. The operation-group hash is
 * retained separately so Whale Watch can deliberately join multi-hop legs
 * into one trace without accidentally dropping them from the live tape.
 */

import { debugLog, escapeHtml } from '../core/utils.js';
import { quietlySyncHtml } from '../core/quiet-refresh.js';
import { THRESHOLDS, API_URLS } from '../core/config.js';

const ADDRESS_LABEL_OBSERVED_AT = '2026-07-22';
const CURATED_ADDRESS_LABELS = {
    'tz1burnburnburnburnburnburnburjAYjjX': { name: 'Burn Address', type: 'burn', icon: '🔥' }
};

export const ADDRESS_LABELS = Object.freeze(Object.fromEntries(
    Object.entries(CURATED_ADDRESS_LABELS).map(([address, label]) => [address, Object.freeze({
        ...label,
        sourceLabel: 'TzKT account page',
        sourceUrl: `https://tzkt.io/${address}`,
        observedAt: ADDRESS_LABEL_OBSERVED_AT
    })])
));

const CONFIG = Object.freeze({
    minAmount: THRESHOLDS.whaleMinAmount,
    legacyMaxItems: 25,
    chamberLimitPerKind: 60,
    pollInterval: 20_000,
    apiBase: API_URLS.tzkt
});
const HOT_SIGNAL_WHALE_THRESHOLD_XTZ = 100000;
const STORAGE_KEY = 'tezos-systems-whale-enabled';

export const transactions = [];
let lastTimestamp = null;
let lastGoodAt = null;
let lastError = '';
let pollTimer = null;
let isVisible = true;
let isEnabled = false;
let initialLoadPromise = null;
const domainCache = new Map();

function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegativeAmount(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function whaleOperationType(operation) {
    const type = String(operation?.type || operation?.kind || '').toLowerCase();
    if (type === 'staking') return String(operation?.action || 'staking').toLowerCase();
    return type;
}

function isAppliedOperation(operation) {
    return String(operation?.status || '').toLowerCase() === 'applied';
}

/** Actual tez moved/processed by an applied transaction, stake, or unstake. */
export function whaleOperationAmount(operation) {
    if (!isAppliedOperation(operation)) return null;
    if (!['transaction', 'stake', 'unstake'].includes(whaleOperationType(operation))) return null;
    return nonNegativeAmount(operation?.movedAmountMutez ?? operation?.amount);
}

/** TzKT delegation `amount` is sender balance context, not transferred tez. */
export function whaleDelegationBalance(operation) {
    if (!isAppliedOperation(operation) || whaleOperationType(operation) !== 'delegation') return null;
    return nonNegativeAmount(operation?.delegatedBalanceMutez ?? operation?.amount);
}

/** Threshold basis: true moved amount, or explicitly labeled delegation balance. */
export function whaleOperationThresholdAmount(operation) {
    return whaleOperationAmount(operation) ?? whaleDelegationBalance(operation);
}

export function whaleOperationAmountPresentation(operation) {
    const type = whaleOperationType(operation);
    const moved = whaleOperationAmount(operation);
    if (moved !== null) {
        if (type === 'stake') return { value: moved, label: 'Actually staked', semantics: 'moved' };
        if (type === 'unstake') return { value: moved, label: 'Actually unstaked', semantics: 'moved' };
        return { value: moved, label: 'Transferred amount', semantics: 'moved' };
    }
    const delegatedBalance = whaleDelegationBalance(operation);
    if (delegatedBalance !== null) {
        return { value: delegatedBalance, label: 'Sender balance at delegation', semantics: 'delegated-balance' };
    }
    return { value: null, label: 'No truthful moved amount', semantics: 'unavailable' };
}

export function whaleOperationId(operation) {
    const id = operation?.id;
    if (id !== null && id !== undefined && id !== '') return String(id);
    const hash = operation?.hash || operation?.operationGroupHash || 'unhashed';
    const counter = operation?.counter ?? operation?.nonce ?? operation?.type ?? 'operation';
    return `${hash}:${counter}`;
}

export function whaleOperationGroupHash(operation) {
    return String(operation?.hash || operation?.operationGroupHash || '');
}

function normalizeOperation(operation, explicitType = '') {
    const type = explicitType || operation?.type || 'transaction';
    const typedOperation = { ...operation, type };
    const amount = whaleOperationAmount(typedOperation);
    const delegatedBalanceMutez = whaleDelegationBalance(typedOperation);
    const target = type === 'delegation'
        ? (operation?.target || operation?.newDelegate || null)
        : (operation?.target || null);
    return {
        ...operation,
        type,
        amount,
        movedAmountMutez: amount,
        delegatedBalanceMutez,
        target,
        operationId: whaleOperationId(operation),
        groupHash: whaleOperationGroupHash(operation)
    };
}

export function formatWhaleAmount(mutez, maximumFractionDigits = 1) {
    const xtz = number(mutez) / 1e6;
    if (xtz >= 1_000_000) return `${(xtz / 1_000_000).toFixed(2)}M`;
    if (xtz >= 1_000) return `${(xtz / 1_000).toFixed(maximumFractionDigits)}K`;
    return xtz.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function dispatchHotWhaleSignal(tx) {
    if (typeof window === 'undefined') return;
    const presentation = whaleOperationAmountPresentation(tx);
    const amountXtz = Number(presentation.value || 0) / 1e6;
    if (!Number.isFinite(amountXtz) || amountXtz < HOT_SIGNAL_WHALE_THRESHOLD_XTZ) return;
    const type = whaleOperationType(tx);
    const title = type === 'delegation'
        ? 'Large-balance delegation change'
        : type === 'stake'
            ? 'Large stake'
            : type === 'unstake'
                ? 'Large unstake'
                : 'Large transfer';
    const text = type === 'delegation'
        ? `An account with ${Math.round(amountXtz).toLocaleString('en-US')} ꜩ sender balance changed delegation; no tez transfer occurred.`
        : `${Math.round(amountXtz).toLocaleString('en-US')} ꜩ ${type === 'stake' ? 'actually staked' : type === 'unstake' ? 'actually unstaked' : 'transferred'} in one applied operation.`;
    window.dispatchEvent(new CustomEvent('hot-signal', {
        detail: {
            category: 'whales',
            id: `whale-${String(tx?.id || tx?.hash || Date.now()).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
            kind: 'event',
            visual: 'whale',
            spectacle: amountXtz >= 1_000_000 ? 'peacock' : 'headliner',
            score: amountXtz >= 1_000_000 ? 132 : 120,
            title,
            icon: '🐋',
            text,
            detail: presentation.label,
            valueXtz: amountXtz,
            tone: 'capital-hot',
            createdAt: tx?.timestamp ? new Date(tx.timestamp).getTime() : Date.now(),
            ttlMs: 90_000,
            route: '#whales'
        }
    }));
}

async function resolveDomain(address) {
    if (!address) return null;
    if (domainCache.has(address)) return domainCache.get(address);
    try {
        const response = await fetch('https://api.tezos.domains/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: 'query GetReverseDomain($address: String!) { reverseRecord(address: $address) { domain { name } } }',
                variables: { address }
            })
        });
        if (!response.ok) return null;
        const data = await response.json();
        const name = data?.data?.reverseRecord?.domain?.name || null;
        domainCache.set(address, name);
        return name;
    } catch {
        return null;
    }
}

async function batchResolveDomains(addresses) {
    const unresolved = [...new Set(addresses)].filter((address) => address && !domainCache.has(address));
    for (let index = 0; index < unresolved.length; index += 10) {
        await Promise.all(unresolved.slice(index, index + 10).map(resolveDomain));
    }
}

export function getWhaleAddressLabel(address, alias = null) {
    if (alias) return { name: alias, type: alias.endsWith('.tez') ? 'domain' : 'labeled', icon: alias.endsWith('.tez') ? '🌐' : '📛' };
    if (ADDRESS_LABELS[address]) return ADDRESS_LABELS[address];
    if (domainCache.get(address)) return { name: domainCache.get(address), type: 'domain', icon: '🌐' };
    const value = String(address || 'Unknown');
    return {
        name: value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value,
        type: 'unknown',
        icon: '👤'
    };
}

function timeAgo(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

export function getWhaleOperationContext(tx) {
    const target = ADDRESS_LABELS[tx?.target?.address];
    if (tx?.type === 'stake') return { label: 'Staking', class: 'stake', emoji: '🔒' };
    if (tx?.type === 'unstake') return { label: 'Unstaking', class: 'unstake', emoji: '🔓' };
    if (tx?.type === 'delegation') {
        return tx.target
            ? { label: 'Delegation', class: 'delegate', emoji: '🤝' }
            : { label: 'Undelegation', class: 'undelegate', emoji: '🚪' };
    }
    if (target?.type === 'burn') return { label: 'Token burn', class: 'burn', emoji: '🔥' };
    return { label: 'Transfer', class: 'whale', emoji: '🐬' };
}

async function fetchTransactions({ since = '', limit = CONFIG.chamberLimitPerKind } = {}) {
    const params = new URLSearchParams({
        'amount.ge': String(CONFIG.minAmount),
        'sort.desc': 'id',
        limit: String(limit),
        status: 'applied'
    });
    // Include the last observed block timestamp so operations indexed later in
    // that same block cannot fall through a strict greater-than cursor.
    if (since) params.set('timestamp.ge', since);
    const response = await fetch(`${CONFIG.apiBase}/operations/transactions?${params}`);
    if (!response.ok) throw new Error(`TzKT transfers unavailable (${response.status})`);
    return (await response.json()).map((operation) => normalizeOperation(operation, 'transaction'));
}

async function fetchDelegations({ since = '', limit = CONFIG.chamberLimitPerKind } = {}) {
    const params = new URLSearchParams({ 'sort.desc': 'id', limit: String(limit), status: 'applied' });
    if (since) params.set('timestamp.ge', since);
    const response = await fetch(`${CONFIG.apiBase}/operations/delegations?${params}`);
    if (!response.ok) throw new Error(`TzKT delegations unavailable (${response.status})`);
    return (await response.json())
        .filter((operation) => (whaleDelegationBalance(operation) ?? -1) >= CONFIG.minAmount)
        .map((operation) => normalizeOperation(operation, 'delegation'));
}

async function fetchStaking({ since = '', limit = CONFIG.chamberLimitPerKind } = {}) {
    const params = new URLSearchParams({ 'sort.desc': 'id', limit: String(limit), status: 'applied' });
    if (since) params.set('timestamp.ge', since);
    const [stakeResponse, unstakeResponse] = await Promise.all([
        fetch(`${CONFIG.apiBase}/operations/staking?${params}&action=stake`),
        fetch(`${CONFIG.apiBase}/operations/staking?${params}&action=unstake`)
    ]);
    if (!stakeResponse.ok) throw new Error(`TzKT stake operations unavailable (${stakeResponse.status})`);
    if (!unstakeResponse.ok) throw new Error(`TzKT unstake operations unavailable (${unstakeResponse.status})`);
    const [stakes, unstakes] = await Promise.all([stakeResponse.json(), unstakeResponse.json()]);
    return [
        ...stakes.map((operation) => normalizeOperation(operation, 'stake')),
        ...unstakes.map((operation) => normalizeOperation(operation, 'unstake'))
    ].filter((operation) => (whaleOperationAmount(operation) ?? -1) >= CONFIG.minAmount);
}

/** Fetch a bounded, receipt-level observation window. It is not a volume total. */
export async function fetchWhaleTransactions(options = {}) {
    const query = typeof options === 'string' ? { since: options } : options;
    const [transfers, delegations, staking] = await Promise.all([
        fetchTransactions(query),
        fetchDelegations(query),
        fetchStaking(query)
    ]);
    const byId = new Map();
    [...transfers, ...delegations, ...staking].forEach((operation) => {
        byId.set(whaleOperationId(operation), operation);
    });
    return [...byId.values()]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp) || number(b.id) - number(a.id));
}

export function groupWhaleOperations(operations) {
    const groups = new Map();
    operations.forEach((operation) => {
        const hash = whaleOperationGroupHash(operation);
        const key = hash ? `group:${hash}` : `operation:${whaleOperationId(operation)}`;
        if (!groups.has(key)) groups.set(key, { key, hash, operations: [] });
        groups.get(key).operations.push(operation);
    });
    return [...groups.values()].map((story) => {
        story.operations.sort((a, b) => number(a.id) - number(b.id));
        story.observedLegsAmount = story.operations.reduce((total, operation) => total + (whaleOperationAmount(operation) ?? 0), 0);
        story.timestamp = story.operations.reduce((latest, operation) => (
            new Date(operation.timestamp) > new Date(latest || 0) ? operation.timestamp : latest
        ), '');
        story.participants = [...new Set(story.operations.flatMap((operation) => [
            operation.sender?.address,
            operation.target?.address,
            operation.baker?.address
        ]).filter(Boolean))];
        return story;
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export function getWhaleSnapshot() {
    return {
        operations: [...transactions],
        stories: groupWhaleOperations(transactions),
        updatedAt: lastGoodAt,
        error: lastError,
        minimumAmount: CONFIG.minAmount,
        bounded: true,
        coverage: {
            mode: 'all-or-nothing',
            complete: Boolean(lastGoodAt) && !lastError,
            lanes: ['transactions', 'delegations', 'stake', 'unstake']
        }
    };
}

function mergeTransactions(fresh, { announce = true } = {}) {
    const existing = new Set(transactions.map(whaleOperationId));
    const added = fresh.filter((operation) => !existing.has(whaleOperationId(operation)));
    transactions.splice(0, transactions.length, ...[...added, ...transactions]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp) || number(b.id) - number(a.id))
        .slice(0, CONFIG.chamberLimitPerKind * 3));
    if (fresh[0]?.timestamp) lastTimestamp = fresh[0].timestamp;
    lastGoodAt = new Date().toISOString();
    lastError = '';
    if (announce && typeof window !== 'undefined') {
        added.forEach((operation) => {
            window.dispatchEvent(new CustomEvent('whale-alert', { detail: operation }));
            dispatchHotWhaleSignal(operation);
        });
    }
    window.dispatchEvent?.(new CustomEvent('whale-data-updated', { detail: getWhaleSnapshot() }));
    return added;
}

export async function refreshWhaleData({ initial = false, limit = CONFIG.chamberLimitPerKind } = {}) {
    if (document.visibilityState !== 'visible') return getWhaleSnapshot();
    try {
        const fresh = await fetchWhaleTransactions({ since: initial ? '' : lastTimestamp || '', limit });
        mergeTransactions(fresh, { announce: !initial });
        return getWhaleSnapshot();
    } catch (error) {
        lastError = error?.message || String(error);
        window.dispatchEvent?.(new CustomEvent('whale-data-error', { detail: { error: lastError, snapshot: getWhaleSnapshot() } }));
        throw error;
    }
}

function flowMarkup(tx) {
    const sender = getWhaleAddressLabel(tx.sender?.address, tx.sender?.alias);
    if (tx.type === 'delegation') {
        const target = tx.target ? getWhaleAddressLabel(tx.target.address, tx.target.alias) : { name: 'None', icon: '' };
        return `<span class="whale-tx-addr" title="${escapeHtml(tx.sender?.address || '')}">${escapeHtml(sender.icon)} ${escapeHtml(sender.name)}</span><span class="whale-tx-arrow">→</span><span class="whale-tx-addr" title="${escapeHtml(tx.target?.address || '')}">${escapeHtml(target.icon)} ${escapeHtml(target.name)}</span>`;
    }
    if (tx.type === 'stake' || tx.type === 'unstake') {
        const baker = tx.baker ? getWhaleAddressLabel(tx.baker.address, tx.baker.alias) : null;
        return `<span class="whale-tx-addr" title="${escapeHtml(tx.sender?.address || '')}">${escapeHtml(sender.icon)} ${escapeHtml(sender.name)}</span>${baker ? `<span class="whale-tx-arrow">↔</span><span class="whale-tx-addr" title="${escapeHtml(tx.baker.address)}">${escapeHtml(baker.icon)} ${escapeHtml(baker.name)}</span>` : ''}`;
    }
    const target = getWhaleAddressLabel(tx.target?.address, tx.target?.alias);
    return `<span class="whale-tx-addr" title="${escapeHtml(tx.sender?.address || '')}">${escapeHtml(sender.icon)} ${escapeHtml(sender.name)}</span><span class="whale-tx-arrow">→</span><span class="whale-tx-addr" title="${escapeHtml(tx.target?.address || '')}">${escapeHtml(target.icon)} ${escapeHtml(target.name)}</span>`;
}

function transactionMarkup(tx) {
    const context = getWhaleOperationContext(tx);
    const id = whaleOperationId(tx);
    const amount = whaleOperationAmountPresentation(tx);
    const value = amount.value === null ? '—' : `${escapeHtml(formatWhaleAmount(amount.value))} <span class="xtz">ꜩ</span>`;
    return `
        <div class="whale-tx whale-tx-${escapeHtml(context.class)}" data-quiet-key="whale-operation-${escapeHtml(id)}" data-operation-id="${escapeHtml(id)}" data-hash="${escapeHtml(whaleOperationGroupHash(tx))}" role="link" tabindex="0" aria-label="View ${escapeHtml(context.label)} receipt on TzKT">
            <div class="whale-tx-header"><span class="whale-tx-context">${escapeHtml(context.emoji)} ${escapeHtml(context.label)}</span><span class="whale-tx-time">${escapeHtml(timeAgo(tx.timestamp))}</span></div>
            <div class="whale-tx-amount">${value}<small>${escapeHtml(amount.label)}</small></div>
            <div class="whale-tx-flow">${flowMarkup(tx)}</div>
        </div>`;
}

function wireLegacyFeed(container) {
    if (!container || container.dataset.whaleFeedWired === '1') return;
    container.dataset.whaleFeedWired = '1';
    const openReceipt = (target) => {
        const item = target.closest?.('.whale-tx[data-operation-id]');
        if (!item || !container.contains(item)) return;
        const operation = transactions.find((candidate) => whaleOperationId(candidate) === item.dataset.operationId);
        const receipt = operation?.hash || operation?.operationGroupHash;
        if (receipt) window.open(`https://tzkt.io/${encodeURIComponent(receipt)}`, '_blank', 'noopener');
    };
    container.addEventListener('click', (event) => openReceipt(event.target));
    container.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (!event.target.closest?.('.whale-tx')) return;
        event.preventDefault();
        openReceipt(event.target);
    });
}

function renderLegacyFeed({ loading = false } = {}) {
    const container = document.getElementById('whale-feed');
    if (!container) return;
    wireLegacyFeed(container);
    if (loading && !transactions.length) {
        quietlySyncHtml(container, '<div class="whale-loading">Scanning for large operations...</div>');
        return;
    }
    if (!transactions.length) {
        const note = lastError ? `Last refresh failed: ${lastError}` : 'No qualifying operations in the bounded live window.';
        quietlySyncHtml(container, `<div id="whale-empty" class="whale-empty"><span class="whale-empty-icon">🐬</span><span>The deep is quiet.</span><span class="whale-empty-sub">${escapeHtml(note)}</span></div>`);
        return;
    }
    quietlySyncHtml(container, transactions.slice(0, CONFIG.legacyMaxItems).map(transactionMarkup).join(''));
}

async function resolveVisibleNames() {
    const addresses = transactions.flatMap((tx) => [
        !tx.sender?.alias && tx.sender?.address,
        !tx.target?.alias && tx.target?.address,
        !tx.baker?.alias && tx.baker?.address
    ]).filter(Boolean);
    if (!addresses.length) return;
    await batchResolveDomains(addresses);
    renderLegacyFeed();
}

async function loadInitialTransactions() {
    if (initialLoadPromise) return initialLoadPromise;
    renderLegacyFeed({ loading: true });
    initialLoadPromise = refreshWhaleData({ initial: true })
        .then(() => {
            renderLegacyFeed();
            resolveVisibleNames();
            return getWhaleSnapshot();
        })
        .catch((error) => {
            console.warn('Whale tracker fetch error:', error);
            renderLegacyFeed();
            return getWhaleSnapshot();
        })
        .finally(() => { initialLoadPromise = null; });
    return initialLoadPromise;
}

async function pollForUpdates() {
    if (!isVisible || document.visibilityState !== 'visible') return getWhaleSnapshot();
    try {
        const snapshot = await refreshWhaleData();
        renderLegacyFeed();
        return snapshot;
    } catch (error) {
        console.warn('Whale tracker refresh failed; keeping last-good operations:', error);
        renderLegacyFeed();
        return getWhaleSnapshot();
    }
}

function startPolling() {
    if (pollTimer) return;
    pollTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible') pollForUpdates();
    }, CONFIG.pollInterval);
}

function stopPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
}

function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') {
        isVisible = false;
        stopPolling();
        return;
    }
    isVisible = true;
    if (isEnabled) {
        pollForUpdates();
        startPolling();
    }
}

function setLauncherToggleState(button, on) {
    const helper = window.tezosSystemsLauncher?.setToggleState;
    if (helper) return helper(button, on);
    button?.classList.toggle('active', on);
    button?.setAttribute('aria-pressed', String(on));
    const pill = button?.querySelector('.feature-status');
    if (pill) pill.textContent = button?.dataset[on ? 'statusOn' : 'statusOff'] || (on ? 'Showing' : 'Hidden');
}

function updateWhaleVisibility() {
    const section = document.getElementById('whale-section');
    const toggleButton = document.getElementById('whale-toggle');
    section?.classList.toggle('visible', isEnabled);
    if (toggleButton) {
        setLauncherToggleState(toggleButton, isEnabled);
        toggleButton.title = `Large Tez Transfers: ${isEnabled ? 'Showing' : 'Hidden'}`;
    }
    if (isEnabled) startPolling();
    else stopPolling();
}

export function toggleWhaleTracker() {
    isEnabled = !isEnabled;
    localStorage.setItem(STORAGE_KEY, String(isEnabled));
    updateWhaleVisibility();
    if (isEnabled) {
        const container = document.getElementById('optional-sections');
        const section = document.getElementById('whale-section');
        if (container && section?.parentElement === container) container.prepend(section);
        if (!transactions.length) loadInitialTransactions();
        else renderLegacyFeed();
    }
    return isEnabled;
}

/** Compatibility exports keep existing lazy imports on whales.js working. */
export async function openWhaleChamber(view = '') {
    const chamber = await import('./whale-chamber.js');
    return chamber.openWhaleChamber(view);
}

export async function closeWhaleChamber() {
    const chamber = await import('./whale-chamber.js');
    return chamber.closeWhaleChamber();
}

export async function initWhaleChamber() {
    const chamber = await import('./whale-chamber.js');
    return chamber.initWhaleChamber();
}

export async function initWhaleTracker({ legacyUi = true } = {}) {
    if (!legacyUi) {
        debugLog('Initializing Whale Watch without the legacy inline rail...');
        await initWhaleChamber();
        window.whaleTracker = {
            get transactions() { return transactions; },
            refresh: pollForUpdates,
            toggle: toggleWhaleTracker,
            get snapshot() { return getWhaleSnapshot(); }
        };
        return;
    }
    const section = document.getElementById('whale-section');
    if (!section) {
        debugLog('Whale section not found, skipping initialization');
        return;
    }
    debugLog('Initializing Whale Tracker...');
    isEnabled = localStorage.getItem(STORAGE_KEY) === 'true';
    const toggleButton = document.getElementById('whale-toggle');
    if (toggleButton && toggleButton.dataset.whaleToggleWired !== '1') {
        toggleButton.dataset.whaleToggleWired = '1';
        toggleButton.addEventListener('click', toggleWhaleTracker);
    }
    updateWhaleVisibility();
    if (isEnabled) window.setTimeout(loadInitialTransactions, 3000);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.whaleTracker = {
        get transactions() { return transactions; },
        refresh: pollForUpdates,
        toggle: toggleWhaleTracker,
        get snapshot() { return getWhaleSnapshot(); }
    };
    initWhaleChamber().catch((error) => console.warn('Whale Watch Chamber initialization failed:', error));
}
