/**
 * My Tezos Tezos X — explicitly linked, device-local Etherlink accounts.
 */

import {
    LINKED_ETHERLINK_ACCOUNTS_KEY,
    fetchEtherlinkAccountDetails,
    fetchEtherlinkAccountOverview,
    fetchEtherlinkNativeBalances
} from '../core/etherlink-client.mjs';
import {
    getAllMyTezosRecords,
    getMyTezosMeta,
    initMyTezosDb,
    putMyTezosRecords,
    replaceMyTezosAccountRecords,
    setMyTezosMeta
} from '../core/my-tezos-db.mjs';
import { myTezosAccountKey, normalizeLinkedL2Accounts } from '../core/my-tezos-models.mjs';
import { quietlySyncHtml } from '../core/quiet-refresh.js';
import { escapeHtml, formatFreshnessStamp } from '../core/utils.js';
import {
    MY_TEZOS_ADDRESS_KEY,
    readSavedMyTezosEntries,
    shortAddress
} from '../core/wallet.js';
import {
    aggregateEtherlinkAccounts,
    upsertLinkedEtherlinkAccount
} from './my-tezos-tezosx-model.mjs';

let initialized = false;
let refreshInFlight = null;
let generation = 0;
let selectedAddress = '';
let accountRows = [];
let currentDetails = null;
let refreshController = null;

function readLinkedAccounts() {
    try {
        return normalizeLinkedL2Accounts(JSON.parse(localStorage.getItem(LINKED_ETHERLINK_ACCOUNTS_KEY) || '[]'));
    } catch {
        return [];
    }
}

function writeLinkedAccounts(entries, source = 'tezos-x') {
    const normalized = normalizeLinkedL2Accounts(entries);
    localStorage.setItem(LINKED_ETHERLINK_ACCOUNTS_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent('my-tezos-linked-l2-changed', {
        detail: { entries: normalized, source }
    }));
    return normalized;
}

function isVisible() {
    return document.visibilityState === 'visible'
        && document.getElementById('my-tezos-panel-tezos-x')?.hidden === false
        && document.getElementById('my-tezos-drawer')?.classList.contains('open') === true;
}

function setStatus(message, state = '') {
    const status = document.getElementById('tezosx-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
}

function setManagementStatus(message, state = '') {
    const status = document.getElementById('tezosx-management-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
}

function linkName(entry) {
    return entry.label || shortAddress(entry.address);
}

function renderLinkedAccounts() {
    const target = document.getElementById('tezosx-account-list');
    const selector = document.getElementById('tezosx-account-scope');
    if (!target || !selector) return;
    const entries = readLinkedAccounts();
    if (!selectedAddress || !entries.some((entry) => entry.address === selectedAddress)) {
        selectedAddress = entries.find((entry) => entry.included !== false)?.address || entries[0]?.address || '';
    }
    quietlySyncHtml(selector, entries.map((entry) => (
        `<option value="${escapeHtml(entry.address)}">${escapeHtml(linkName(entry))}</option>`
    )).join(''));
    selector.value = selectedAddress;
    selector.disabled = entries.length === 0;
    if (!entries.length) {
        quietlySyncHtml(target, `
            <div class="tezosx-empty">
                <strong>No linked Etherlink accounts</strong>
                <span>Add a public 0x address manually. The link is local to this browser and is not an ownership proof.</span>
            </div>
        `);
        return;
    }
    const savedL1Entries = readSavedMyTezosEntries();
    const savedL1 = new Map(savedL1Entries.map((entry) => [entry.address, entry]));
    quietlySyncHtml(target, entries.map((entry) => {
        const linked = entry.linkedL1Addresses
            .filter((address) => savedL1.has(address))
            .map((address) => savedL1.get(address)?.label || shortAddress(address));
        const removedLinks = entry.linkedL1Addresses.filter((address) => !savedL1.has(address)).length;
        return `
            <article class="tezosx-account-row${entry.address === selectedAddress ? ' active' : ''}${entry.included === false ? ' excluded' : ''}">
                <label class="portfolio-include-control" title="Include in Tezos X totals">
                    <input type="checkbox" data-tezosx-include="${escapeHtml(entry.address)}" ${entry.included === false ? '' : 'checked'} aria-label="Include ${escapeHtml(linkName(entry))} in Tezos X totals">
                    <span aria-hidden="true"></span>
                </label>
                <div class="tezosx-account-identity">
                    <button type="button" data-tezosx-select="${escapeHtml(entry.address)}" aria-pressed="${entry.address === selectedAddress}">
                        <strong>${escapeHtml(linkName(entry))}</strong>
                        <code>${escapeHtml(shortAddress(entry.address))}</code>
                    </button>
                    <span class="tezosx-account-links">${linked.length ? `Linked with ${escapeHtml(linked.join(', '))}` : 'Unlinked from saved L1 accounts'}${removedLinks ? ` · ${removedLinks} removed L1 link${removedLinks === 1 ? '' : 's'} retained` : ''} · this device only</span>
                    <details>
                        <summary>Edit L1 associations</summary>
                        <div class="tezosx-l1-associations">
                            ${savedL1Entries.length ? savedL1Entries.map((l1) => `
                                <label>
                                    <input type="checkbox" data-tezosx-l1-link="${escapeHtml(entry.address)}" value="${escapeHtml(l1.address)}" ${entry.linkedL1Addresses.includes(l1.address) ? 'checked' : ''}>
                                    <span>${escapeHtml(l1.label || shortAddress(l1.address))}</span>
                                </label>
                            `).join('') : '<span>No saved L1 accounts are available. This L2 account remains intact.</span>'}
                        </div>
                    </details>
                </div>
                <div class="tezosx-account-actions">
                    <button type="button" data-tezosx-remove="${escapeHtml(entry.address)}" aria-label="Remove ${escapeHtml(linkName(entry))}">Remove</button>
                </div>
            </article>
        `;
    }).join(''));
    target.querySelectorAll('[data-tezosx-include]').forEach((input) => {
        input.addEventListener('change', () => {
            const address = input.dataset.tezosxInclude;
            writeLinkedAccounts(readLinkedAccounts().map((entry) => (
                entry.address === address ? { ...entry, included: input.checked } : entry
            )), 'tezos-x-inclusion');
            refreshTezosX({ force: true }).catch(() => {});
        });
    });
    target.querySelectorAll('[data-tezosx-select]').forEach((button) => {
        button.addEventListener('click', () => {
            selectedAddress = button.dataset.tezosxSelect;
            renderLinkedAccounts();
            refreshTezosX({ force: true }).catch(() => {});
        });
    });
    target.querySelectorAll('[data-tezosx-l1-link]').forEach((input) => {
        input.addEventListener('change', () => {
            const l2Address = input.dataset.tezosxL1Link;
            writeLinkedAccounts(readLinkedAccounts().map((entry) => {
                if (entry.address !== l2Address) return entry;
                const linkedAddresses = new Set(entry.linkedL1Addresses);
                if (input.checked) linkedAddresses.add(input.value);
                else linkedAddresses.delete(input.value);
                return { ...entry, linkedL1Addresses: [...linkedAddresses] };
            }), 'tezos-x-l1-association');
            renderLinkedAccounts();
        });
    });
    target.querySelectorAll('[data-tezosx-remove]').forEach((button) => {
        button.addEventListener('click', () => {
            const address = button.dataset.tezosxRemove;
            writeLinkedAccounts(readLinkedAccounts().filter((entry) => entry.address !== address), 'tezos-x-remove');
            if (selectedAddress === address) selectedAddress = '';
            renderLinkedAccounts();
            refreshTezosX({ force: true }).catch(() => {});
        });
    });
}

function renderSummary() {
    const included = new Set(readLinkedAccounts().filter((entry) => entry.included !== false).map((entry) => entry.address));
    const rows = accountRows.filter((row) => included.has(row.address));
    const aggregate = aggregateEtherlinkAccounts(rows);
    const values = {
        native: `${aggregate.nativeXtz.toLocaleString('en-US', { maximumFractionDigits: 6 })} ꜩ`,
        erc20: aggregate.erc20Assets,
        nfts: aggregate.nftAssets,
        transactions: aggregate.transactions
    };
    Object.entries(values).forEach(([key, value]) => {
        const element = document.querySelector(`[data-tezosx-total="${key}"] strong`);
        if (element) element.textContent = String(value);
    });
    const coverage = document.getElementById('tezosx-coverage');
    if (coverage) {
        const nativeLoaded = rows.filter((row) => row.nativeAvailable !== false).length;
        const assetLoaded = rows.filter((row) => row.detailsLoaded).length;
        coverage.textContent = `${rows.length}/${included.size} included L2 accounts loaded · ${nativeLoaded}/${included.size} native RPC balances · ${assetLoaded}/${included.size} saved asset pages; select an account to complete its detail`;
    }
}

function renderDetails() {
    const target = document.getElementById('tezosx-details');
    if (!target) return;
    const loadMore = document.getElementById('tezosx-load-more');
    if (loadMore) {
        loadMore.hidden = !currentDetails?.nextPageParams;
        loadMore.disabled = Boolean(refreshInFlight);
    }
    if (!selectedAddress) {
        quietlySyncHtml(target, '<div class="tezosx-empty"><strong>Link an Etherlink account</strong><span>Account activity stays separate from Tezos L1 and is labeled L2 throughout.</span></div>');
        return;
    }
    const row = accountRows.find((item) => item.address === selectedAddress) || {};
    const details = currentDetails?.address === selectedAddress ? currentDetails : null;
    const tokens = details?.tokens || [];
    const nfts = details?.nfts || [];
    const transactions = details?.transactions || [];
    quietlySyncHtml(target, `
        <section class="tezosx-detail-section">
            <div class="portfolio-section-heading">
                <div>
                    <h4>${escapeHtml(readLinkedAccounts().find((entry) => entry.address === selectedAddress)?.label || shortAddress(selectedAddress))}</h4>
                    <p>Etherlink L2 · chain 42793 · <a href="https://explorer.etherlink.com/address/${escapeHtml(selectedAddress)}" target="_blank" rel="noopener">Blockscout receipt ↗</a></p>
                </div>
                <strong>${Number(row.nativeXtz || 0).toLocaleString('en-US', { maximumFractionDigits: 6 })} ꜩ</strong>
            </div>
            <div class="tezosx-assets-grid">
                <article><span>ERC-20 balances</span><strong>${tokens.length}</strong><small>No fiat valuation</small></article>
                <article><span>NFT holdings</span><strong>${nfts.length}</strong><small>Current indexed holdings</small></article>
                <article><span>Transactions</span><strong>${Number(row.transactions || 0).toLocaleString()}</strong><small>${row.lastActivity ? `Last ${escapeHtml(new Date(row.lastActivity).toLocaleString())}` : 'Last activity unavailable'}</small></article>
            </div>
        </section>
        <section class="tezosx-detail-section">
            <h4>ERC-20 assets</h4>
            <div class="tezosx-token-list">
                ${tokens.length ? tokens.map((token) => `
                    <article><strong>${escapeHtml(token.symbol)}</strong><span>${Number(token.balance).toLocaleString('en-US', { maximumFractionDigits: 8 })}</span><small>${escapeHtml(token.name)}</small></article>
                `).join('') : '<span>No ERC-20 balances returned for the selected account.</span>'}
            </div>
        </section>
        <section class="tezosx-detail-section">
            <h4>Recent transactions and transfers</h4>
            <div class="tezosx-transaction-list">
                ${transactions.length ? transactions.map((tx) => `
                    <a href="https://explorer.etherlink.com/tx/${escapeHtml(tx.operationHash)}" target="_blank" rel="noopener">
                        <span data-status="${escapeHtml(tx.status)}">${tx.status === 'ok' ? '✓' : tx.status === 'error' ? '!' : '•'}</span>
                        <div><strong>${escapeHtml(tx.summary || 'Contract call')}</strong><small>${escapeHtml(new Date(tx.timestamp).toLocaleString())} · ${escapeHtml(tx.status)} · fee ${(Number(tx.fee || 0) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 8 })} ꜩ</small></div>
                        <span>↗</span>
                    </a>
                `).join('') : '<span>No recent transactions returned for the selected account.</span>'}
            </div>
        </section>
        <section class="tezosx-detail-section">
            <h4>NFT holdings</h4>
            <div class="tezosx-nft-list">
                ${nfts.length ? nfts.slice(0, 24).map((nft) => `<article><strong>${escapeHtml(nft.name)}</strong><span>${escapeHtml(nft.collection?.name || 'Etherlink NFT')}</span><small>#${escapeHtml(nft.tokenId)}</small></article>`).join('') : '<span>No NFT holdings returned for the selected account.</span>'}
            </div>
        </section>
    `);
}

async function readCachedTezosX(address) {
    if (!address) return null;
    const accountKey = myTezosAccountKey('l2', address);
    const [activities, holdings] = await Promise.all([
        getAllMyTezosRecords('activityByAccount', {
            index: 'accountKey',
            query: IDBKeyRange.only(accountKey),
            direction: 'prev',
            limit: 100
        }),
        getAllMyTezosRecords('holdings', {
            index: 'accountKey',
            query: IDBKeyRange.only(accountKey),
            limit: 2_000
        })
    ]);
    return {
        address,
        transactions: activities.filter((activity) => activity.layer === 'l2'),
        tokens: [],
        nfts: holdings.filter((holding) => holding.layer === 'l2')
    };
}

function mergeById(existing, incoming) {
    const byId = new Map();
    for (const item of [...(existing || []), ...(incoming || [])]) {
        byId.set(item.id || item.operationHash || JSON.stringify(item), item);
    }
    return [...byId.values()];
}

async function refreshTezosX({ force = false, loadMore = false } = {}) {
    if (!isVisible()) return null;
    if (refreshInFlight && !force) return refreshInFlight;
    if (refreshInFlight && force) refreshController?.abort();
    const entries = readLinkedAccounts();
    const included = entries.filter((entry) => entry.included !== false);
    const requestGeneration = ++generation;
    renderLinkedAccounts();
    if (!included.length) {
        accountRows = [];
        currentDetails = null;
        renderSummary();
        renderDetails();
        setStatus(entries.length ? 'No linked accounts are included.' : 'Link an Etherlink account to begin.', 'empty');
        return null;
    }
    if (!selectedAddress) selectedAddress = included[0].address;
    setStatus('Reading Etherlink RPC and Blockscout…', 'loading');
    const controller = new AbortController();
    refreshController = controller;
    const pending = (async () => {
        try {
            if (!loadMore) {
                const cachedSummaries = new Map((await Promise.all(included.map(async (entry) => (
                    [entry.address, await getMyTezosMeta(`tezosx-summary:${entry.address}`)]
                ))).catch(() => [])).filter(([, value]) => value));
                const nativeRows = await fetchEtherlinkNativeBalances(included.map((entry) => entry.address), {
                    signal: controller.signal
                });
                if (requestGeneration !== generation || !isVisible()) return null;
                accountRows = nativeRows.map((row) => ({
                    erc20Assets: 0,
                    nftAssets: 0,
                    transactions: 0,
                    ...cachedSummaries.get(row.address),
                    ...row
                }));
                renderSummary();
            }

            let overviewError = null;
            const overview = loadMore ? null : await fetchEtherlinkAccountOverview(selectedAddress, {
                signal: controller.signal
            }).catch((error) => {
                overviewError = error;
                return null;
            });
            if (requestGeneration !== generation || !isVisible()) return null;
            const selectedRow = accountRows.find((row) => row.address === selectedAddress);
            if (selectedRow && overview) Object.assign(selectedRow, overview, {
                nativeXtz: selectedRow.nativeXtz ?? overview?.nativeXtz,
                nativeAvailable: selectedRow.nativeXtz != null || overview?.nativeXtz != null
            });
            renderSummary();
            renderDetails();

            const details = await fetchEtherlinkAccountDetails(selectedAddress, {
                signal: controller.signal,
                transactionCursor: loadMore ? currentDetails?.nextPageParams : null
            });
            if (requestGeneration !== generation || !isVisible()) return null;
            const storedNfts = mergeById(loadMore ? currentDetails?.nfts : [], details.nfts).map((holding) => ({
                ...holding,
                sourceReceipt: details.receipt
            }));
            currentDetails = {
                address: selectedAddress,
                ...details,
                transactions: mergeById(loadMore ? currentDetails?.transactions : [], details.transactions),
                tokens: details.tokens.length ? details.tokens : currentDetails?.tokens || [],
                nfts: storedNfts
            };
            if (selectedRow) {
                selectedRow.erc20Assets = currentDetails.tokens.length;
                selectedRow.nftAssets = currentDetails.nfts.length;
                selectedRow.detailsLoaded = true;
            }
            await Promise.all([
                putMyTezosRecords('activityByAccount', currentDetails.transactions),
                details.receipt.coverage.state === 'complete'
                    ? replaceMyTezosAccountRecords('holdings', myTezosAccountKey('l2', selectedAddress), storedNfts)
                    : putMyTezosRecords('holdings', storedNfts),
                putMyTezosRecords('syncState', {
                    id: `blockscout:${myTezosAccountKey('l2', selectedAddress)}:account`,
                    adapter: 'blockscout',
                    accountKey: myTezosAccountKey('l2', selectedAddress),
                    stream: 'account',
                    cursor: details.nextPageParams,
                    complete: details.nextPageParams == null,
                    updatedAt: Date.now(),
                    error: null,
                    receipt: details.receipt
                }),
                setMyTezosMeta(`tezosx-summary:${selectedAddress}`, {
                    erc20Assets: currentDetails.tokens.length,
                    nftAssets: currentDetails.nfts.length,
                    transactions: Number(selectedRow?.transactions) || 0,
                    lastActivity: selectedRow?.lastActivity || null,
                    detailsLoaded: true,
                    updatedAt: Date.now()
                })
            ]).catch(() => {});
            renderSummary();
            renderDetails();
            const partial = Boolean(overviewError) || details.receipt.coverage.state !== 'complete';
            setStatus(
                `${loadMore ? 'Earlier L2 activity loaded' : partial ? 'Partial selected-account read' : 'Complete selected-account read'}${overviewError ? ' · Blockscout address summary unavailable' : ''} · ${formatFreshnessStamp(new Date(), { source: 'Etherlink' })}`,
                partial ? 'partial' : 'complete'
            );
            return { overview, details };
        } catch (error) {
            renderSummary();
            renderDetails();
            setStatus(`${error.message || 'Etherlink data unavailable'} · showing saved device-local state`, 'error');
            return null;
        } finally {
            if (refreshInFlight === pending) {
                refreshInFlight = null;
                refreshController = null;
            }
        }
    })();
    refreshInFlight = pending;
    return pending;
}

function wireTezosXControls() {
    const form = document.getElementById('tezosx-add-form');
    form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const addressInput = document.getElementById('tezosx-add-address');
        const labelInput = document.getElementById('tezosx-add-label');
        const activeL1Address = localStorage.getItem(MY_TEZOS_ADDRESS_KEY) || '';
        if (!activeL1Address || !readSavedMyTezosEntries().some((entry) => entry.address === activeL1Address)) {
            setManagementStatus('Save and select a Tezos L1 address before linking an Etherlink account.', 'error');
            return;
        }
        try {
            const result = upsertLinkedEtherlinkAccount(readLinkedAccounts(), {
                address: addressInput?.value,
                label: labelInput?.value
            }, { activeL1Address });
            writeLinkedAccounts(result.entries, 'tezos-x-add');
            selectedAddress = result.entries.find((entry) => entry.address === String(addressInput?.value || '').trim().toLowerCase())?.address || selectedAddress;
            if (addressInput) addressInput.value = '';
            if (labelInput) labelInput.value = '';
            setManagementStatus(
                result.existed ? 'That Etherlink account is already linked on this device; its L1 association was updated.' : 'Etherlink account linked on this device.',
                'success'
            );
            renderLinkedAccounts();
            refreshTezosX({ force: true }).catch(() => {});
        } catch (error) {
            setManagementStatus(error.message || 'Could not link that Etherlink account.', 'error');
        }
    });
    document.getElementById('tezosx-account-scope')?.addEventListener('change', (event) => {
        selectedAddress = event.currentTarget.value || '';
        renderLinkedAccounts();
        refreshTezosX({ force: true }).catch(() => {});
    });
    document.getElementById('tezosx-refresh')?.addEventListener('click', () => {
        refreshTezosX({ force: true }).catch(() => {});
    });
    document.getElementById('tezosx-load-more')?.addEventListener('click', () => {
        refreshTezosX({ loadMore: true }).catch(() => {});
    });
}

export async function activateMyTezosTezosX({ force = false } = {}) {
    if (!initialized) {
        initialized = true;
        wireTezosXControls();
        window.addEventListener('my-tezos-linked-l2-changed', () => {
            generation += 1;
            renderLinkedAccounts();
            if (isVisible()) refreshTezosX({ force: true }).catch(() => {});
        });
        window.addEventListener('my-tezos-portfolio-changed', renderLinkedAccounts);
    }
    renderLinkedAccounts();
    try {
        await initMyTezosDb();
        currentDetails = await readCachedTezosX(selectedAddress);
        renderDetails();
    } catch {}
    if (force || readLinkedAccounts().length) return refreshTezosX({ force });
    renderSummary();
    renderDetails();
    return null;
}

export function destroyMyTezosTezosXForTests() {
    generation += 1;
    refreshController?.abort();
    refreshController = null;
    refreshInFlight = null;
    initialized = false;
    accountRows = [];
    currentDetails = null;
}
