/**
 * Exact L1 total-XTZ history for My Tezos.
 *
 * Immutable points are cached per address in IndexedDB. The required daily
 * year is filled first, followed by weekly lifetime points.
 */

import { API_URLS } from '../core/config.js';
import {
    getAllMyTezosRecords,
    getMyTezosRecord,
    putMyTezosRecords
} from '../core/my-tezos-db.mjs';
import { createSourceReceipt } from '../core/my-tezos-models.mjs';
import {
    initMyTezosRequestBrokerVisibility,
    myTezosRequestBroker
} from '../core/my-tezos-request-broker.mjs';
import {
    MY_TEZOS_BALANCE_HISTORY_SCHEDULE_VERSION,
    MY_TEZOS_HISTORY_DAY_MS,
    MY_TEZOS_HISTORY_YEAR_DAYS,
    buildExactBalanceHistoryView,
    buildHistoricalBalanceSchedule,
    historicalBalanceSource,
    resolveHistoricalScheduleTimestamps
} from './my-tezos-balance-history-model.mjs';
import { fetchMyTezosAccounts } from './my-tezos-tzkt-adapter.mjs';

const BLOCK_BATCH_SIZE = 100;
const ARCHIVE_BATCH_SIZE = 24;
const STEPPED_PAGE_SIZE = 10_000;
const archiveVerification = new Map();

export function exactBalanceHistoryScopeId(address) {
    return `historical-total:l1:${address}`;
}

export function exactBalanceHistoryStateId(address) {
    return `exact-balance-history:l1:${address}`;
}

function tzktRequest(url, { signal, priority = 'background', retries = 3 } = {}) {
    initMyTezosRequestBrokerVisibility();
    return myTezosRequestBroker.request(url, {
        provider: 'tzkt',
        priority,
        signal,
        retries,
        cache: 'no-store',
        responseType: 'json'
    });
}

function archiveRequest(url, { signal, priority = 'background', retries = 3 } = {}) {
    initMyTezosRequestBrokerVisibility();
    return myTezosRequestBroker.request(url, {
        provider: 'octezArchive',
        priority,
        signal,
        retries,
        cache: 'no-store',
        responseType: 'json'
    });
}

function chunks(values, size) {
    const result = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}

function archiveProviders() {
    return [
        { name: 'Octez mainnet archive', baseUrl: API_URLS.octezArchive },
        { name: 'TzKT mainnet archive RPC', baseUrl: API_URLS.tzktArchive }
    ];
}

function historyModeIsArchive(payload) {
    const mode = typeof payload === 'string' ? payload : payload?.history_mode;
    return String(mode || '').toLowerCase() === 'archive';
}

export async function fetchArchiveFullBalance(address, level, {
    signal,
    priority = 'background',
    request = archiveRequest,
    providers = archiveProviders(),
    verificationCache = archiveVerification
} = {}) {
    const failures = [];
    for (const [index, provider] of providers.entries()) {
        const baseUrl = String(provider.baseUrl || '').replace(/\/$/, '');
        if (!baseUrl) continue;
        const historyModeUrl = `${baseUrl}/config/history_mode`;
        const balanceUrl = `${baseUrl}/chains/main/blocks/${level}/context/contracts/${encodeURIComponent(address)}/full_balance`;
        try {
            let verified = verificationCache.get(baseUrl);
            if (!verified) {
                const mode = await request(historyModeUrl, { signal, priority, retries: 2 });
                if (!historyModeIsArchive(mode)) {
                    throw new Error(`${provider.name} is not serving archive history.`);
                }
                verified = { historyModeUrl, verifiedAt: new Date().toISOString() };
                verificationCache.set(baseUrl, verified);
            }
            const payload = await request(balanceUrl, { signal, priority, retries: 3 });
            const totalMutez = Number(payload);
            if (!Number.isFinite(totalMutez) || totalMutez < 0) {
                throw new Error(`${provider.name} returned an invalid full balance.`);
            }
            return {
                totalMutez,
                source: index === 0 ? 'octez-archive' : 'tzkt-rpc-archive',
                providerIndex: index,
                receipt: {
                    ...createSourceReceipt({
                        provider: provider.name,
                        sourceUrl: balanceUrl,
                        blockLevel: level,
                        coverage: { state: 'complete', pages: 1, items: 1 },
                        confidence: 'exact'
                    }),
                    historyModeUrl,
                    archiveVerifiedAt: verified.verifiedAt
                }
            };
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            failures.push(`${provider.name}: ${error?.message || 'unavailable'}`);
        }
    }
    throw new Error(`No verified archive provider returned level ${level} · ${failures.join(' · ')}`);
}

async function loadProtocolCatalog(signal) {
    const url = new URL('../../data/protocol-data.json', import.meta.url);
    const response = await fetch(url, { cache: 'no-store', signal });
    if (!response.ok) throw new Error(`Protocol catalog unavailable: ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.protocols)) throw new Error('Protocol catalog is invalid.');
    return payload.protocols;
}

async function fetchFinalizedBlock(signal) {
    const query = new URLSearchParams({
        'sort.desc': 'level',
        offset: '2',
        limit: '1',
        select: 'level,timestamp,protocol'
    });
    const url = `${API_URLS.tzkt}/blocks?${query}`;
    const payload = await tzktRequest(url, { signal, priority: 'visible' });
    const block = Array.isArray(payload) ? payload[0] : null;
    if (!Number.isFinite(Number(block?.level)) || !Date.parse(block?.timestamp || '')) {
        throw new Error('TzKT did not return a finalized block.');
    }
    return block;
}

async function fetchLevelAtTimestamp(timestamp, signal) {
    const iso = new Date(timestamp).toISOString();
    const url = `${API_URLS.tzkt}/blocks/${encodeURIComponent(iso)}/level`;
    const payload = await tzktRequest(url, { signal, priority: 'visible' });
    const level = Number(payload);
    if (!Number.isFinite(level)) throw new Error('TzKT did not resolve the one-year boundary.');
    return level;
}

async function resolveScheduleBlocks(schedule, signal) {
    const rows = [];
    for (const batch of chunks(schedule, BLOCK_BATCH_SIZE)) {
        const query = new URLSearchParams({
            'level.in': batch.map((point) => point.level).join(','),
            select: 'level,timestamp,protocol',
            limit: String(batch.length)
        });
        const url = `${API_URLS.tzkt}/blocks?${query}`;
        const payload = await tzktRequest(url, { signal, priority: 'visible' });
        if (!Array.isArray(payload)) throw new Error('TzKT returned invalid block metadata.');
        rows.push(...payload);
    }
    return resolveHistoricalScheduleTimestamps(schedule, rows);
}

async function fetchSteppedHistory(address, step, { signal } = {}) {
    const rows = [];
    let offset = 0;
    let sourceUrl = '';
    for (;;) {
        const query = new URLSearchParams({
            step: String(step),
            'sort.asc': 'level',
            offset: String(offset),
            limit: String(STEPPED_PAGE_SIZE)
        });
        sourceUrl = `${API_URLS.tzkt}/accounts/${encodeURIComponent(address)}/balance_history?${query}`;
        const payload = await tzktRequest(sourceUrl, { signal });
        if (!Array.isArray(payload)) throw new Error('TzKT returned invalid stepped balance history.');
        rows.push(...payload.map((row) => ({
            level: Number(row?.level),
            totalMutez: Number(row?.balance ?? row?.value)
        })).filter((row) => (
            Number.isFinite(row.level) && Number.isFinite(row.totalMutez)
        )));
        if (payload.length < STEPPED_PAGE_SIZE) break;
        offset += payload.length;
    }
    return {
        rows,
        receipt: createSourceReceipt({
            provider: 'TzKT stepped balance history',
            sourceUrl,
            coverage: { state: 'complete', pages: Math.max(1, Math.ceil(rows.length / STEPPED_PAGE_SIZE)), items: rows.length },
            confidence: 'exact'
        })
    };
}

async function fetchTzktPoint(address, sample, { signal } = {}) {
    const url = `${API_URLS.tzkt}/accounts/${encodeURIComponent(address)}/balance_history/${sample.level}`;
    const payload = await tzktRequest(url, { signal });
    const totalMutez = Number(payload);
    if (!Number.isFinite(totalMutez) || totalMutez < 0) {
        throw new Error(`TzKT returned an invalid balance at level ${sample.level}.`);
    }
    return {
        totalMutez,
        source: 'tzkt-balance-history',
        receipt: createSourceReceipt({
            provider: 'TzKT balance history',
            sourceUrl: url,
            blockLevel: sample.level,
            coverage: { state: 'complete', pages: 1, items: 1 },
            confidence: 'exact'
        })
    };
}

function recordFor(address, sample, result) {
    return {
        id: `historical-total:l1:${address}:${sample.level}`,
        scopeId: exactBalanceHistoryScopeId(address),
        address,
        level: sample.level,
        timestamp: sample.timestamp,
        totalMutez: result.totalMutez,
        cadence: sample.cadence,
        protocol: sample.protocol,
        confidence: 'exact',
        sourceType: 'historical-total',
        source: result.source,
        sourceReceipt: result.receipt,
        scheduleVersion: MY_TEZOS_BALANCE_HISTORY_SCHEDULE_VERSION
    };
}

function latestBalanceAtOrBefore(rows, level) {
    let low = 0;
    let high = rows.length - 1;
    let found = null;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (rows[middle].level <= level) {
            found = rows[middle];
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return found;
}

async function rawCachedRecords(entries) {
    const recordsByAddress = {};
    const states = [];
    for (const entry of entries) {
        recordsByAddress[entry.address] = (await getAllMyTezosRecords('snapshots', {
            index: 'scopeId',
            query: IDBKeyRange.only(exactBalanceHistoryScopeId(entry.address)),
            limit: 20_000
        })).filter((record) => record.sourceType === 'historical-total');
        const state = await getMyTezosRecord('syncState', exactBalanceHistoryStateId(entry.address));
        if (state) states.push(state);
    }
    return { recordsByAddress, states };
}

function cachedSchedule(recordsByAddress, states) {
    const scheduled = states
        .map((state) => state.schedule)
        .filter(Array.isArray)
        .sort((left, right) => right.length - left.length)[0];
    if (scheduled?.length) return scheduled;
    const unique = new Map();
    Object.values(recordsByAddress).flat().forEach((record) => {
        if (!unique.has(record.level)) {
            unique.set(record.level, {
                level: record.level,
                timestamp: record.timestamp,
                cadence: record.cadence || 'weekly',
                protocol: record.protocol || 'Unknown protocol',
                blockTime: null,
                sampleStep: null,
                anchors: []
            });
        }
    });
    return [...unique.values()].sort((left, right) => left.level - right.level);
}

export async function readCachedExactBalanceHistory(entries) {
    const { recordsByAddress, states } = await rawCachedRecords(entries);
    const schedule = cachedSchedule(recordsByAddress, states);
    const accounts = entries.map((entry) => (
        states.find((state) => state.address === entry.address)?.account
        || { address: entry.address, firstActivity: 1, stakingOpsCount: null }
    ));
    const sourceStatus = states
        .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0]?.sourceStatus
        || { stage: 'cached', tzkt: { points: 0, errors: 0 }, archive: { points: 0, errors: 0 } };
    return buildExactBalanceHistoryView({
        entries,
        accounts,
        schedule,
        recordsByAddress,
        sourceStatus: { ...sourceStatus, stage: 'cached' }
    });
}

function missingSamples(samples, records) {
    const existing = new Set(records.map((record) => Number(record.level)));
    return samples.filter((sample) => !existing.has(sample.level));
}

async function persistRecords(address, records, recordsByAddress) {
    if (!records.length) return;
    await putMyTezosRecords('snapshots', records);
    const byLevel = new Map((recordsByAddress[address] || []).map((record) => [record.level, record]));
    records.forEach((record) => byLevel.set(record.level, record));
    recordsByAddress[address] = [...byLevel.values()].sort((left, right) => left.level - right.level);
}

async function saveCoverageStates(entries, accounts, schedule, view, sourceStatus, error = null) {
    const accountByAddress = new Map(accounts.map((account) => [account.address, account]));
    const now = Date.now();
    await putMyTezosRecords('syncState', entries.map((entry) => {
        const coverage = view.coverageByAddress[entry.address];
        return {
            id: exactBalanceHistoryStateId(entry.address),
            adapter: 'exact-l1-total',
            stream: 'balance-history',
            address: entry.address,
            account: accountByAddress.get(entry.address),
            scheduleVersion: MY_TEZOS_BALANCE_HISTORY_SCHEDULE_VERSION,
            schedule,
            dailyCoverage: {
                completed: coverage?.dailyCompleted || 0,
                target: coverage?.dailyTarget || 0
            },
            lifetimeCoverage: {
                completed: coverage?.lifetimeCompleted || 0,
                target: coverage?.lifetimeTarget || 0
            },
            gaps: coverage?.missing || [],
            retry: {
                lastAttemptAt: now,
                lastError: error ? String(error.message || error) : null,
                pending: coverage?.missing?.length || 0
            },
            sourceStatus,
            updatedAt: now,
            complete: coverage?.complete === true
        };
    }));
}

async function backfillAddressPhase({
    entry,
    account,
    samples,
    recordsByAddress,
    signal,
    sourceStatus,
    progress
}) {
    const address = entry.address;
    const creationLevel = Number(account?.firstActivity) || 1;
    const missing = missingSamples(samples, recordsByAddress[address] || []);
    const zeros = missing
        .filter((sample) => sample.level < creationLevel)
        .map((sample) => recordFor(address, sample, {
            totalMutez: 0,
            source: 'pre-creation-zero',
            receipt: createSourceReceipt({
                provider: 'Tezos account lifecycle',
                sourceUrl: '',
                blockLevel: sample.level,
                coverage: { state: 'complete', pages: 0, items: 1 },
                confidence: 'exact'
            })
        }));
    await persistRecords(address, zeros, recordsByAddress);
    if (zeros.length) await progress();

    const requestable = missing.filter((sample) => sample.level >= creationLevel);
    const tzktSamples = requestable.filter((sample) => historicalBalanceSource(account, sample.level) === 'tzkt');
    const archiveSamples = requestable.filter((sample) => historicalBalanceSource(account, sample.level) === 'archive');
    const steppedGroups = new Map();
    const pointSamples = [];
    tzktSamples.forEach((sample) => {
        if (!sample.sampleStep) {
            pointSamples.push(sample);
            return;
        }
        const group = steppedGroups.get(sample.sampleStep) || [];
        group.push(sample);
        steppedGroups.set(sample.sampleStep, group);
    });

    for (const [step, group] of steppedGroups) {
        if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
        try {
            const history = await fetchSteppedHistory(address, step, { signal });
            const resolved = [];
            const unresolved = [];
            group.forEach((sample) => {
                const row = latestBalanceAtOrBefore(history.rows, sample.level);
                if (!row) {
                    unresolved.push(sample);
                    return;
                }
                resolved.push(recordFor(address, sample, {
                    totalMutez: row.totalMutez,
                    source: 'tzkt-stepped-balance-history',
                    receipt: { ...history.receipt, blockLevel: sample.level }
                }));
            });
            await persistRecords(address, resolved, recordsByAddress);
            sourceStatus.tzkt.points += resolved.length;
            pointSamples.push(...unresolved);
            await progress();
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            sourceStatus.tzkt.errors += group.length;
            sourceStatus.errors.push(error.message || String(error));
            pointSamples.push(...group);
        }
    }

    for (const batch of chunks(pointSamples, ARCHIVE_BATCH_SIZE)) {
        const results = await Promise.allSettled(batch.map((sample) => (
            fetchTzktPoint(address, sample, { signal })
        )));
        if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
        const records = [];
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                records.push(recordFor(address, batch[index], result.value));
                sourceStatus.tzkt.points += 1;
            } else {
                sourceStatus.tzkt.errors += 1;
                sourceStatus.errors.push(result.reason?.message || String(result.reason));
            }
        });
        await persistRecords(address, records, recordsByAddress);
        await progress();
    }

    for (const batch of chunks(archiveSamples, ARCHIVE_BATCH_SIZE)) {
        const results = await Promise.allSettled(batch.map((sample) => (
            fetchArchiveFullBalance(address, sample.level, { signal })
        )));
        if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
        const records = [];
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                records.push(recordFor(address, batch[index], result.value));
                sourceStatus.archive.points += 1;
                if (result.value.providerIndex === 0) sourceStatus.archive.primary += 1;
                else sourceStatus.archive.fallback += 1;
            } else {
                sourceStatus.archive.errors += 1;
                sourceStatus.errors.push(result.reason?.message || String(result.reason));
            }
        });
        await persistRecords(address, records, recordsByAddress);
        await progress();
    }
}

export async function syncExactBalanceHistory(entries, {
    signal,
    onProgress = null
} = {}) {
    if (!entries.length) {
        return buildExactBalanceHistoryView({ entries, accounts: [], schedule: [], recordsByAddress: {} });
    }
    const [accountResult, protocols, finalized] = await Promise.all([
        fetchMyTezosAccounts(entries, { signal, priority: 'visible' }),
        loadProtocolCatalog(signal),
        fetchFinalizedBlock(signal)
    ]);
    const accounts = accountResult.rows;
    const finalizedTimestamp = Date.parse(finalized.timestamp);
    const oneYearLevel = await fetchLevelAtTimestamp(
        finalizedTimestamp - MY_TEZOS_HISTORY_YEAR_DAYS * MY_TEZOS_HISTORY_DAY_MS,
        signal
    );
    const levelSchedule = buildHistoricalBalanceSchedule({
        protocols,
        accountCreationLevels: accounts.map((account) => account.firstActivity),
        oneYearLevel,
        finalizedLevel: finalized.level
    });
    const schedule = await resolveScheduleBlocks(levelSchedule, signal);
    const { recordsByAddress } = await rawCachedRecords(entries);
    const sourceStatus = {
        stage: 'daily',
        finalizedLevel: Number(finalized.level),
        tzkt: { points: 0, errors: 0 },
        archive: { points: 0, primary: 0, fallback: 0, errors: 0 },
        errors: []
    };

    let view = buildExactBalanceHistoryView({
        entries,
        accounts,
        schedule,
        recordsByAddress,
        sourceStatus
    });
    let progressChain = Promise.resolve();
    const progress = (stage = sourceStatus.stage) => {
        progressChain = progressChain.then(async () => {
            sourceStatus.stage = stage;
            view = buildExactBalanceHistoryView({
                entries,
                accounts,
                schedule,
                recordsByAddress,
                sourceStatus
            });
            await saveCoverageStates(entries, accounts, schedule, view, sourceStatus);
            await onProgress?.(view);
        });
        return progressChain;
    };

    await progress('daily');
    for (const phase of [
        { name: 'daily', samples: schedule.filter((sample) => sample.cadence === 'daily') },
        { name: 'lifetime', samples: schedule.filter((sample) => sample.cadence === 'weekly') }
    ]) {
        sourceStatus.stage = phase.name;
        const results = await Promise.allSettled(entries.map((entry) => backfillAddressPhase({
            entry,
            account: accounts.find((account) => account.address === entry.address),
            samples: phase.samples,
            recordsByAddress,
            signal,
            sourceStatus,
            progress: () => progress(phase.name)
        })));
        if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
        results.filter((result) => result.status === 'rejected').forEach((result) => {
            sourceStatus.errors.push(result.reason?.message || String(result.reason));
        });
        await progress(phase.name);
    }

    sourceStatus.stage = view.aggregateCoverage.complete ? 'complete' : 'partial';
    await progress(sourceStatus.stage);
    return view;
}

export function resetExactBalanceHistoryProvidersForTests() {
    archiveVerification.clear();
}
