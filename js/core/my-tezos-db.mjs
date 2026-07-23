/**
 * IndexedDB persistence for derived My Tezos data.
 *
 * User-authored address/link configuration stays in localStorage. Large,
 * refetchable histories live here and never fall back to localStorage.
 */

export const MY_TEZOS_DB_NAME = 'tezos-systems-my-tezos';
export const MY_TEZOS_DB_VERSION = 1;
export const MY_TEZOS_DB_STORES = Object.freeze([
    'snapshots',
    'activityByAccount',
    'rewards',
    'holdings',
    'syncState',
    'meta'
]);

const LEGACY_HISTORY_KEY = 'tezos-systems-my-tezos-portfolio-history-v1';
const LEGACY_REWARDS_PREFIX = 'tezos-systems-rewards-v4-';
const LEGACY_MIGRATION_KEY = 'legacy-v1-migrated';

let dbPromise = null;

function storageError(message, cause = null) {
    const error = new Error(message);
    error.name = 'MyTezosStorageUnavailable';
    error.cause = cause;
    return error;
}

function ensureIndex(store, name, keyPath, options = {}) {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}

function upgradeDatabase(db, transaction) {
    const snapshots = db.objectStoreNames.contains('snapshots')
        ? transaction.objectStore('snapshots')
        : db.createObjectStore('snapshots', { keyPath: 'id' });
    ensureIndex(snapshots, 'scopeId', 'scopeId');
    ensureIndex(snapshots, 'scopeTimestamp', ['scopeId', 'timestamp']);
    ensureIndex(snapshots, 'timestamp', 'timestamp');

    const activity = db.objectStoreNames.contains('activityByAccount')
        ? transaction.objectStore('activityByAccount')
        : db.createObjectStore('activityByAccount', { keyPath: 'id' });
    ensureIndex(activity, 'accountKey', 'accountKey');
    ensureIndex(activity, 'accountTimestamp', ['accountKey', 'timestamp']);
    ensureIndex(activity, 'timestamp', 'timestamp');

    const rewards = db.objectStoreNames.contains('rewards')
        ? transaction.objectStore('rewards')
        : db.createObjectStore('rewards', { keyPath: 'id' });
    ensureIndex(rewards, 'accountKey', 'accountKey');
    ensureIndex(rewards, 'accountCycle', ['accountKey', 'cycle']);

    const holdings = db.objectStoreNames.contains('holdings')
        ? transaction.objectStore('holdings')
        : db.createObjectStore('holdings', { keyPath: 'id' });
    ensureIndex(holdings, 'accountKey', 'accountKey');
    ensureIndex(holdings, 'accountLayer', ['accountKey', 'layer']);
    ensureIndex(holdings, 'updatedAt', 'updatedAt');

    if (!db.objectStoreNames.contains('syncState')) db.createObjectStore('syncState', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || storageError('IndexedDB request failed'));
    });
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || storageError('IndexedDB transaction was aborted'));
        transaction.onerror = () => reject(transaction.error || storageError('IndexedDB transaction failed'));
    });
}

export function openMyTezosDb() {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === 'undefined') return Promise.reject(storageError('IndexedDB is unavailable on this device'));
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(MY_TEZOS_DB_NAME, MY_TEZOS_DB_VERSION);
        request.onupgradeneeded = () => upgradeDatabase(request.result, request.transaction);
        request.onsuccess = () => {
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
        request.onerror = () => {
            dbPromise = null;
            reject(storageError('My Tezos history could not be opened', request.error));
        };
        request.onblocked = () => {
            dbPromise = null;
            reject(storageError('My Tezos history upgrade is blocked by another tab'));
        };
    });
    return dbPromise;
}

async function withTransaction(storeNames, mode, action) {
    const db = await openMyTezosDb();
    const transaction = db.transaction(storeNames, mode);
    const result = await action(transaction);
    await transactionDone(transaction);
    return result;
}

export async function putMyTezosRecords(storeName, records) {
    const values = (Array.isArray(records) ? records : [records]).filter(Boolean);
    if (!values.length) return 0;
    return withTransaction([storeName], 'readwrite', async (transaction) => {
        const store = transaction.objectStore(storeName);
        for (const value of values) store.put(value);
        return values.length;
    });
}

export async function commitMyTezosPage(storeName, records, syncState) {
    const values = (Array.isArray(records) ? records : [records]).filter(Boolean);
    if (!syncState?.id) throw new Error('A sync state id is required for a committed page');
    return withTransaction([storeName, 'syncState'], 'readwrite', async (transaction) => {
        const store = transaction.objectStore(storeName);
        values.forEach((value) => store.put(value));
        transaction.objectStore('syncState').put(syncState);
        return values.length;
    });
}

export async function deleteMyTezosRecord(storeName, key) {
    return withTransaction([storeName], 'readwrite', async (transaction) => {
        transaction.objectStore(storeName).delete(key);
        return true;
    });
}

export async function getMyTezosRecord(storeName, key) {
    return withTransaction([storeName], 'readonly', (transaction) => (
        requestResult(transaction.objectStore(storeName).get(key))
    ));
}

export async function getAllMyTezosRecords(storeName, {
    index = '',
    query = null,
    direction = 'next',
    limit = Infinity
} = {}) {
    return withTransaction([storeName], 'readonly', (transaction) => new Promise((resolve, reject) => {
        const store = transaction.objectStore(storeName);
        const source = index ? store.index(index) : store;
        const results = [];
        const request = source.openCursor(query, direction);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor || results.length >= limit) {
                resolve(results);
                return;
            }
            results.push(cursor.value);
            cursor.continue();
        };
        request.onerror = () => reject(request.error || storageError('IndexedDB cursor failed'));
    }));
}

export async function replaceMyTezosAccountRecords(storeName, accountKey, records) {
    const values = (Array.isArray(records) ? records : []).filter(Boolean);
    return withTransaction([storeName], 'readwrite', (transaction) => new Promise((resolve, reject) => {
        const store = transaction.objectStore(storeName);
        const index = store.index('accountKey');
        const request = index.openKeyCursor(IDBKeyRange.only(accountKey));
        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
                store.delete(cursor.primaryKey);
                cursor.continue();
                return;
            }
            values.forEach((value) => store.put(value));
            resolve(values.length);
        };
        request.onerror = () => reject(request.error || storageError('IndexedDB account replacement failed'));
    }));
}

export async function pruneMyTezosActivityRecords(accountKey, max = 50_000) {
    const records = await getAllMyTezosRecords('activityByAccount', {
        index: 'accountKey',
        query: IDBKeyRange.only(accountKey),
        limit: Math.max(max + 5_000, max)
    });
    if (records.length <= max) return 0;
    const confidenceRank = { unknown: 0, estimated: 1, classified: 2, joined: 3, exact: 4 };
    const deletions = records
        .sort((left, right) => (
            (confidenceRank[left.confidence] ?? 0) - (confidenceRank[right.confidence] ?? 0)
            || Number(left.timestamp || 0) - Number(right.timestamp || 0)
        ))
        .slice(0, records.length - max);
    await withTransaction(['activityByAccount'], 'readwrite', async (transaction) => {
        const store = transaction.objectStore('activityByAccount');
        deletions.forEach((record) => store.delete(record.id));
    });
    return deletions.length;
}

export async function getMyTezosMeta(key) {
    const record = await getMyTezosRecord('meta', key);
    return record?.value ?? null;
}

export async function setMyTezosMeta(key, value) {
    await putMyTezosRecords('meta', { key, value, updatedAt: Date.now() });
    return value;
}

function compactLegacyReward(address, row, role) {
    const cycle = Number(row?.cycle);
    if (!Number.isFinite(cycle)) return null;
    return {
        id: `reward:l1:${address}:${role}:${cycle}`,
        accountKey: `l1:${address}`,
        address,
        role,
        cycle,
        earned: Number(row?._earnedRewards ?? row?.rewards) || 0,
        future: Number(row?._futureRewards) || 0,
        missed: Number(row?._missedRewards) || 0,
        confidence: role === 'delegator-estimate' ? 'estimated' : 'exact',
        source: 'legacy-localstorage',
        updatedAt: Date.now()
    };
}

export async function migrateLegacyMyTezosStorage() {
    if (typeof localStorage === 'undefined') return { migrated: false, reason: 'no-localstorage' };
    if (await getMyTezosMeta(LEGACY_MIGRATION_KEY)) return { migrated: false, reason: 'already-migrated' };

    const snapshots = [];
    const rewards = [];
    const rewardKeys = [];
    try {
        const history = JSON.parse(localStorage.getItem(LEGACY_HISTORY_KEY) || 'null');
        for (const [composition, points] of Object.entries(history?.series || {})) {
            for (const point of Array.isArray(points) ? points : []) {
                const timestamp = Number(point?.timestamp);
                if (!Number.isFinite(timestamp)) continue;
                snapshots.push({
                    id: `observed:${composition}:${timestamp}`,
                    scopeId: composition,
                    timestamp,
                    sourceType: 'observed',
                    total: Number(point.total) || 0,
                    spendable: Number(point.spendable) || 0,
                    staked: Number(point.staked) || 0,
                    unstaking: Number(point.unstaking) || 0,
                    confidence: 'exact'
                });
            }
        }
    } catch {}

    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(LEGACY_REWARDS_PREFIX)) continue;
        const address = key.slice(LEGACY_REWARDS_PREFIX.length);
        try {
            const parsed = JSON.parse(localStorage.getItem(key) || 'null');
            const role = parsed?.data?.currentRole || 'unknown';
            for (const row of parsed?.data?.rows || []) {
                const compact = compactLegacyReward(address, row, role);
                if (compact) rewards.push(compact);
            }
            rewardKeys.push(key);
        } catch {
            rewardKeys.push(key);
        }
    }

    await withTransaction(['snapshots', 'rewards', 'meta'], 'readwrite', async (transaction) => {
        const snapshotStore = transaction.objectStore('snapshots');
        const rewardStore = transaction.objectStore('rewards');
        snapshots.forEach((record) => snapshotStore.put(record));
        rewards.forEach((record) => rewardStore.put(record));
        transaction.objectStore('meta').put({
            key: LEGACY_MIGRATION_KEY,
            value: {
                migratedAt: new Date().toISOString(),
                snapshots: snapshots.length,
                rewards: rewards.length
            },
            updatedAt: Date.now()
        });
    });

    for (const key of rewardKeys) {
        try { localStorage.removeItem(key); } catch {}
    }
    return { migrated: true, snapshots: snapshots.length, rewards: rewards.length };
}

export async function initMyTezosDb() {
    await openMyTezosDb();
    return migrateLegacyMyTezosStorage();
}

export function resetMyTezosDbHandleForTests() {
    dbPromise = null;
}
