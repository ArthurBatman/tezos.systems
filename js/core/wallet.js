/**
 * Octez.Connect wallet bridge for Tezos.Systems.
 *
 * The site is intentionally framework-free, so the SDK is loaded lazily from
 * its browser bundle only when a wallet action needs it.
 */

import {
    MAX_SAVED_MY_TEZOS_ADDRESSES,
    MY_TEZOS_PORTFOLIO_NETWORK,
    cleanSavedMyTezosLabel,
    normalizeSavedMyTezosEntries
} from './my-tezos-entries.mjs';

export {
    MAX_SAVED_MY_TEZOS_ADDRESSES,
    MY_TEZOS_PORTFOLIO_NETWORK,
    normalizeSavedMyTezosEntries
} from './my-tezos-entries.mjs';

export const OCTEZ_CONNECT_VERSION = '4.8.5';
export const OCTEZ_CONNECT_SRC = `https://esm.sh/@tezos-x/octez.connect-sdk@${OCTEZ_CONNECT_VERSION}?bundle`;

export const MY_TEZOS_ADDRESS_KEY = 'tezos-systems-my-baker-address';
export const WALLET_ADDRESS_KEY = 'tezos-systems-octez-wallet-address';
export const SAVED_ADDRESSES_KEY = 'tezos-systems-saved-addresses';
export const BAKING_BENJAMINS_DELEGATE_ADDRESS = 'tz1S5WxdZR5f9NzsPXhr7L9L1vrEb5spZFur';

let _sdkPromise = null;
let _clientPromise = null;
let _eventsBound = false;
let _activeAccount = null;

const WALLET_DISCONNECT_TIMEOUT_MS = 2500;
const WALLET_CLEAR_TIMEOUT_MS = 1000;
const WALLET_SDK_TIMEOUT_MS = 15000;
const WALLET_CONNECT_TIMEOUT_MS = 45000;
const WALLET_ACCOUNT_TIMEOUT_MS = 5000;

export function isTezosAccountAddress(address) {
    return /^(tz[1-4])[a-zA-Z0-9]{33}$/.test(String(address || '').trim());
}

export function isTezosAddress(address) {
    return /^(tz[1-4]|KT1)[a-zA-Z0-9]{33}$/.test(String(address || '').trim());
}

export function shortAddress(address) {
    const value = String(address || '').trim();
    if (value.length < 12) return value;
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function getStoredWalletAddress() {
    try {
        const address = localStorage.getItem(WALLET_ADDRESS_KEY) || '';
        return isTezosAccountAddress(address) ? address : '';
    } catch {
        return '';
    }
}

function emitWalletUpdate(account, status = 'ready') {
    const address = account?.address || '';
    window.dispatchEvent(new CustomEvent('tezos-wallet-updated', {
        detail: {
            account: account || null,
            address,
            connected: Boolean(address),
            status
        }
    }));
}

function rememberAccount(account, status = 'ready') {
    _activeAccount = account || null;
    try {
        if (account?.address && isTezosAccountAddress(account.address)) {
            localStorage.setItem(WALLET_ADDRESS_KEY, account.address);
        } else {
            localStorage.removeItem(WALLET_ADDRESS_KEY);
        }
    } catch {}
    emitWalletUpdate(_activeAccount, status);
    return _activeAccount;
}

function emitPortfolioUpdate(entries, source = 'wallet') {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('my-tezos-portfolio-changed', {
        detail: { entries, source }
    }));
}

export function readSavedMyTezosEntries() {
    try {
        const parsed = JSON.parse(localStorage.getItem(SAVED_ADDRESSES_KEY) || '[]');
        const normalized = normalizeSavedMyTezosEntries(parsed);
        if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
            localStorage.setItem(SAVED_ADDRESSES_KEY, JSON.stringify(normalized));
        }
        return normalized;
    } catch {
        return [];
    }
}

export function writeSavedMyTezosEntries(entries, { source = 'wallet', notify = true } = {}) {
    const normalized = normalizeSavedMyTezosEntries(entries);
    try {
        localStorage.setItem(SAVED_ADDRESSES_KEY, JSON.stringify(normalized));
    } catch {}
    if (notify) emitPortfolioUpdate(normalized, source);
    return normalized;
}

export function upsertSavedMyTezosEntry(address, {
    label = null,
    included = true,
    source = 'wallet'
} = {}) {
    const value = String(address || '').trim();
    if (!isTezosAddress(value)) {
        throw new Error('Saved My Tezos address must be a tz1/tz2/tz3/tz4 or KT1 address');
    }
    const current = readSavedMyTezosEntries();
    const existing = current.find((item) => item.address === value);
    const entry = {
        network: MY_TEZOS_PORTFOLIO_NETWORK,
        address: value,
        label: cleanSavedMyTezosLabel(label) || existing?.label || null,
        included: existing ? existing.included !== false : included !== false,
        addedAt: existing?.addedAt || Date.now()
    };
    return writeSavedMyTezosEntries([
        entry,
        ...current.filter((item) => item.address !== value)
    ], { source });
}

export function rememberMyTezosAddress(address, { label = null, source = 'wallet' } = {}) {
    const value = String(address || '').trim();
    if (!isTezosAddress(value)) {
        throw new Error('My Tezos address must be a tz1/tz2/tz3/tz4 or KT1 address');
    }
    let previousAddress = '';
    try {
        previousAddress = localStorage.getItem(MY_TEZOS_ADDRESS_KEY) || '';
        localStorage.setItem(MY_TEZOS_ADDRESS_KEY, value);
    } catch {}

    upsertSavedMyTezosEntry(value, { label, source });

    const drawerInput = document.getElementById('drawer-address-input');
    const mainInput = document.getElementById('my-baker-input');
    if (drawerInput) drawerInput.value = value;
    if (mainInput) mainInput.value = value;

    const emptyState = document.getElementById('drawer-empty-state');
    const connectedState = document.getElementById('drawer-connected');
    if (emptyState) emptyState.style.display = 'none';
    if (connectedState) connectedState.style.display = '';

    window.dispatchEvent(new CustomEvent('my-baker-updated', {
        detail: { address: value, source, previousAddress }
    }));
    return value;
}

function withWalletTimeout(action, timeoutMs, label) {
    let timeoutId = null;
    return Promise.race([
        Promise.resolve().then(action),
        new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
        })
    ]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}

function walletTimeoutOverride(name, fallback) {
    const value = Number(window[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isIgnorableDisconnectError(error) {
    return /No transport available|Not connected|Disconnect timed out/i.test(String(error?.message || error));
}

async function clearActiveAccountQuietly(client) {
    if (!client?.clearActiveAccount) return;
    try {
        await withWalletTimeout(
            () => client.clearActiveAccount(),
            WALLET_CLEAR_TIMEOUT_MS,
            'Clear active account'
        );
    } catch (error) {
        console.warn('[wallet] Octez.Connect account clear failed:', error?.message || error);
    }
}

function findLoadedSdk(candidate = null) {
    if (candidate?.getDAppClientInstance) return candidate;
    if (candidate?.default?.getDAppClientInstance) return candidate.default;
    if (window.beacon?.getDAppClientInstance) return window.beacon;
    return null;
}

export async function loadOctezConnect() {
    const globalSdk = findLoadedSdk();
    if (globalSdk) return globalSdk;
    if (!_sdkPromise) {
        _sdkPromise = import(OCTEZ_CONNECT_SRC).then((module) => {
            const sdk = findLoadedSdk(module);
            if (!sdk) {
                throw new Error('Octez.Connect SDK did not expose getDAppClientInstance');
            }
            return sdk;
        }).catch((error) => {
            _sdkPromise = null;
            throw new Error(`Octez.Connect SDK failed to load: ${error?.message || error}`);
        });
    }
    return _sdkPromise;
}

function buildClientOptions(beacon) {
    const regions = beacon.Regions || {};
    const matrixNodes = {};
    if (regions.EUROPE_WEST) {
        matrixNodes[regions.EUROPE_WEST] = [
            'beacon-node-3.octez.io',
            'beacon-node-1.octez.io',
            'beacon-node-2.octez.io',
            'beacon-node-1.hope.papers.tech',
            'beacon-node-1.hope-2.papers.tech',
            'beacon-node-1.hope-3.papers.tech',
            'beacon-node-1.hope-4.papers.tech',
            'beacon-node-1.hope-5.papers.tech'
        ];
    }
    if (regions.NORTH_AMERICA_EAST) matrixNodes[regions.NORTH_AMERICA_EAST] = [];

    return {
        name: 'Tezos.Systems',
        appUrl: window.location.origin,
        network: { type: beacon.NetworkType?.MAINNET || 'mainnet' },
        featuredWallets: ['kukai', 'airgap', 'umami', 'temple', 'metamask'],
        enableMetrics: false,
        ...(Object.keys(matrixNodes).length ? { matrixNodes } : {})
    };
}

async function bindWalletEvents(client, beacon) {
    if (_eventsBound || !client?.subscribeToEvent) return;
    _eventsBound = true;

    const activeEvent = beacon.BeaconEvent?.ACTIVE_ACCOUNT_SET || 'ACTIVE_ACCOUNT_SET';
    const abortEvent = beacon.BeaconEvent?.PAIR_ABORTED || 'PAIR_ABORTED';
    try {
        await client.subscribeToEvent(activeEvent, (account) => rememberAccount(account, 'ready'));
        await client.subscribeToEvent(abortEvent, () => emitWalletUpdate(_activeAccount, 'aborted'));
    } catch (error) {
        console.warn('[wallet] could not bind Octez.Connect events:', error?.message || error);
    }
}

export async function getDAppClient() {
    if (!_clientPromise) {
        _clientPromise = withWalletTimeout(
            () => loadOctezConnect().then(async (beacon) => {
                const client = beacon.getDAppClientInstance(buildClientOptions(beacon));
                await bindWalletEvents(client, beacon);
                return client;
            }),
            walletTimeoutOverride('__TEZOS_WALLET_SDK_TIMEOUT_MS__', WALLET_SDK_TIMEOUT_MS),
            'Octez.Connect SDK load'
        ).catch((error) => {
            _clientPromise = null;
            if (/timed out/i.test(String(error?.message || error))) _sdkPromise = null;
            throw error;
        });
    }
    return _clientPromise;
}

export function preloadOctezConnect() {
    return getDAppClient().catch((error) => {
        console.warn('[wallet] Octez.Connect preload failed:', error?.message || error);
        return null;
    });
}

export async function getWalletAccount({ quiet = false } = {}) {
    try {
        const client = await getDAppClient();
        const account = await client.getActiveAccount();
        return rememberAccount(account, account?.address ? 'ready' : 'empty');
    } catch (error) {
        if (!quiet) throw error;
        return null;
    }
}

export function syncWalletToMyTezos(address) {
    const value = String(address || '').trim();
    if (!isTezosAccountAddress(value)) {
        throw new Error('Connected wallet did not provide a tz1/tz2/tz3/tz4 account address');
    }
    return rememberMyTezosAddress(value, { source: 'octez-connect' });
}

export async function connectOctezWallet({ syncMyTezos = false } = {}) {
    const client = await getDAppClient();
    const permissions = await withWalletTimeout(
        () => client.requestPermissions(),
        walletTimeoutOverride('__TEZOS_WALLET_CONNECT_TIMEOUT_MS__', WALLET_CONNECT_TIMEOUT_MS),
        'Wallet connection'
    );
    let account = null;
    try {
        account = await withWalletTimeout(
            () => client.getActiveAccount(),
            WALLET_ACCOUNT_TIMEOUT_MS,
            'Wallet account lookup'
        );
    } catch (error) {
        console.warn('[wallet] Octez.Connect account lookup failed:', error?.message || error);
    }
    const active = rememberAccount(account || permissions, 'connected');
    if (syncMyTezos && active?.address) syncWalletToMyTezos(active.address);
    return active;
}

export async function disconnectOctezWallet() {
    const client = await getDAppClient();
    try {
        if (client.disconnect) {
            await withWalletTimeout(
                () => client.disconnect(),
                WALLET_DISCONNECT_TIMEOUT_MS,
                'Disconnect'
            );
        } else if (client.clearActiveAccount) {
            await withWalletTimeout(
                () => client.clearActiveAccount(),
                WALLET_CLEAR_TIMEOUT_MS,
                'Clear active account'
            );
        }
    } catch (error) {
        if (!isIgnorableDisconnectError(error)) {
            throw error;
        }
    }
    await clearActiveAccountQuietly(client);
    return rememberAccount(null, 'disconnected');
}

export async function requestWalletOperation(operationDetails) {
    const beacon = await loadOctezConnect();
    const client = await getDAppClient();
    let account = await client.getActiveAccount();
    if (!account?.address) {
        account = await connectOctezWallet({ syncMyTezos: true });
    } else {
        rememberAccount(account, 'ready');
    }

    const transactionKind = beacon.TezosOperationType?.TRANSACTION || 'transaction';
    const normalized = operationDetails.map((detail) => ({
        ...detail,
        kind: detail.kind || transactionKind
    }));
    return client.requestOperation({ operationDetails: normalized });
}

export async function requestConnectedWalletDelegation(delegateAddress = BAKING_BENJAMINS_DELEGATE_ADDRESS) {
    const delegate = String(delegateAddress || '').trim();
    if (!isTezosAccountAddress(delegate)) {
        throw new Error('Delegation target must be a valid Tezos account address');
    }

    const beacon = await loadOctezConnect();
    const client = await getDAppClient();
    const account = await client.getActiveAccount();
    if (!account?.address) {
        throw new Error('Connect your wallet in My Tezos first');
    }
    if (account.network?.type && account.network.type !== (beacon.NetworkType?.MAINNET || 'mainnet')) {
        throw new Error('Switch the connected wallet to Tezos Mainnet first');
    }
    rememberAccount(account, 'ready');

    const delegationKind = beacon.TezosOperationType?.DELEGATION || 'delegation';
    const result = await client.requestOperation({
        operationDetails: [{
            kind: delegationKind,
            delegate
        }]
    });
    return { account, result };
}

function footerDelegationErrorMessage(error) {
    const message = String(error?.message || error || '');
    if (/Connect your wallet/i.test(message)) return 'Connect a wallet in My Tezos first.';
    if (/Mainnet/i.test(message)) return 'Switch your wallet to Tezos Mainnet first.';
    if (/abort|cancel|declin|reject|denied/i.test(message)) return 'Delegation was not submitted.';
    return 'Delegation could not be submitted. Please try again.';
}

export function initFooterDelegation(root = document) {
    const supports = [];
    if (root?.matches?.('.footer-baker-support')) supports.push(root);
    supports.push(...(root?.querySelectorAll?.('.footer-baker-support') || []));

    supports.forEach((support) => {
        if (support.querySelector('[data-footer-delegate]')) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'footer-delegate-button';
        button.dataset.footerDelegate = 'true';
        button.textContent = 'Delegate with wallet';
        button.title = 'Uses your existing Octez.Connect or Beacon session. Your wallet will ask you to approve the delegation.';

        const status = document.createElement('span');
        status.className = 'footer-delegate-status';
        status.dataset.footerDelegateStatus = 'true';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        button.addEventListener('pointerenter', preloadOctezConnect, { once: true });
        button.addEventListener('focus', preloadOctezConnect, { once: true });
        button.addEventListener('click', async () => {
            if (button.disabled) return;
            button.disabled = true;
            button.textContent = 'Open wallet…';
            status.textContent = '';
            status.dataset.tone = '';
            try {
                const { result } = await requestConnectedWalletDelegation();
                const operationHash = result?.operationHash || result?.transactionHash || '';
                button.textContent = 'Submitted';
                status.textContent = operationHash
                    ? `Submitted · ${shortAddress(operationHash)}`
                    : 'Delegation submitted.';
                status.dataset.tone = 'success';
            } catch (error) {
                button.textContent = 'Delegate with wallet';
                status.textContent = footerDelegationErrorMessage(error);
                status.dataset.tone = 'error';
            } finally {
                button.disabled = false;
            }
        });

        support.append(' ', button, status);
    });
}
