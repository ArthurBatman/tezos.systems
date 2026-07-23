import { API_URLS } from '../core/config.js';
import {
    findMyTezosContractRule,
    loadMyTezosContractRegistry
} from '../core/my-tezos-contract-registry.mjs';
import { createSourceReceipt } from '../core/my-tezos-models.mjs';
import {
    initMyTezosRequestBrokerVisibility,
    myTezosRequestBroker
} from '../core/my-tezos-request-broker.mjs';
import { normalizeTzktAccountOperation } from './my-tezos-activity-model.mjs';

const DAILY_LEVEL_STEP = 14_400;
const ACTIVITY_PAGE_SIZE = 100;
const ACTIVITY_TYPES = [
    'transaction',
    'delegation',
    'staking',
    'token_transfer',
    'origination'
].join(',');

function requestJson(url, options = {}) {
    initMyTezosRequestBrokerVisibility();
    return myTezosRequestBroker.request(url, {
        provider: 'tzkt',
        priority: options.priority || 'background',
        signal: options.signal,
        retries: options.retries ?? 3,
        cache: 'no-store',
        responseType: 'json'
    });
}

export async function fetchMyTezosAccounts(entries, { signal, priority = 'interactive' } = {}) {
    const addresses = entries.map((entry) => entry.address);
    const query = new URLSearchParams({
        'address.in': addresses.join(','),
        select: 'address,alias,type,delegate,balance,stakedBalance,unstakedBalance',
        limit: String(addresses.length)
    });
    const url = `${API_URLS.tzkt}/accounts?${query}`;
    const rows = await requestJson(url, { signal, priority });
    if (!Array.isArray(rows)) throw new Error('TzKT returned an invalid account response.');
    const byAddress = new Map(rows.map((row) => [row.address, row]));
    const missing = entries.filter((entry) => !byAddress.has(entry.address));
    if (missing.length) throw new Error(`Portfolio coverage incomplete · ${rows.length}/${entries.length} accounts loaded`);
    return {
        rows: entries.map((entry) => byAddress.get(entry.address)),
        receipt: createSourceReceipt({
            provider: 'TzKT',
            sourceUrl: url,
            coverage: { state: 'complete', pages: 1, items: rows.length },
            confidence: 'exact'
        })
    };
}

export async function fetchMyTezosBalanceHistory(address, {
    signal,
    days = 365,
    priority = 'background'
} = {}) {
    const query = new URLSearchParams({
        step: String(DAILY_LEVEL_STEP),
        'sort.desc': 'level',
        limit: String(Math.min(400, Math.max(2, days + 2)))
    });
    const url = `${API_URLS.tzkt}/accounts/${encodeURIComponent(address)}/balance_history?${query}`;
    const payload = await requestJson(url, { signal, priority });
    const rows = (Array.isArray(payload) ? payload : [])
        .map((row) => ({
            address,
            timestamp: Date.parse(row?.timestamp || '') || Number(row?.timestamp) || 0,
            level: Number(row?.level) || null,
            liquid: Number(row?.balance ?? row?.value) || 0
        }))
        .filter((row) => row.timestamp > 0)
        .sort((left, right) => left.timestamp - right.timestamp);
    return {
        rows,
        receipt: createSourceReceipt({
            provider: 'TzKT',
            sourceUrl: url,
            coverage: {
                state: 'partial',
                from: rows[0]?.timestamp ? new Date(rows[0].timestamp).toISOString() : null,
                to: rows.at(-1)?.timestamp ? new Date(rows.at(-1).timestamp).toISOString() : null,
                pages: 1,
                items: rows.length
            },
            confidence: 'exact',
            warnings: ['Historical account balance can exclude staked tez for non-bakers.']
        })
    };
}

function activityParticipants(operation) {
    return [
        operation?.sender?.address,
        operation?.target?.address,
        operation?.from?.address,
        operation?.to?.address,
        operation?.baker?.address
    ].filter(Boolean).map(String);
}

export async function fetchMyTezosActivityPage(addresses, {
    ownedAddresses = [],
    lastId = null,
    from = '',
    signal,
    priority = 'background'
} = {}) {
    const unique = Array.from(new Set(
        (Array.isArray(addresses) ? addresses : [addresses]).map(String).filter(Boolean)
    )).slice(0, 10);
    if (!unique.length) return {
        rows: [],
        rawCount: 0,
        nextCursor: null,
        complete: true,
        receipt: createSourceReceipt({
            provider: 'TzKT',
            sourceUrl: '',
            coverage: { state: 'complete', pages: 0, items: 0 },
            confidence: 'exact'
        })
    };
    const query = new URLSearchParams({
        addresses: unique.join(','),
        roles: 'sender,target,initiator,mention',
        types: ACTIVITY_TYPES,
        limit: String(ACTIVITY_PAGE_SIZE),
        sort: '1'
    });
    if (Number.isFinite(Number(lastId)) && Number(lastId) > 0) query.set('lastId', String(lastId));
    if (from) query.set('timestamp.ge', from);
    const url = `${API_URLS.tzkt}/accounts/activity?${query}`;
    const payload = await requestJson(url, { signal, priority });
    if (!Array.isArray(payload)) throw new Error('TzKT returned an invalid activity response.');
    const fetchedAt = new Date().toISOString();
    const registry = await loadMyTezosContractRegistry();
    const owned = new Set(ownedAddresses);
    const rows = payload.flatMap((operation) => {
        const participants = activityParticipants(operation);
        return unique
            .filter((address) => participants.includes(address) || (
                operation?.type === 'delegation' && operation?.sender?.address === address
            ))
            .map((address) => normalizeTzktAccountOperation(operation, {
                address,
                ownedAddresses: [...owned],
                fetchedAt,
                sourceUrl: url,
                contractRule: findMyTezosContractRule(
                    registry,
                    'l1',
                    operation?.target?.address
                )
            }))
            .filter(Boolean);
    });
    const nextCursor = Number(payload.at(-1)?.id) || null;
    return {
        rows,
        rawCount: payload.length,
        nextCursor,
        complete: payload.length < ACTIVITY_PAGE_SIZE,
        receipt: createSourceReceipt({
            provider: 'TzKT',
            sourceUrl: url,
            fetchedAt,
            cursor: nextCursor == null ? null : String(nextCursor),
            coverage: { state: payload.length < ACTIVITY_PAGE_SIZE ? 'complete' : 'partial', pages: 1, items: payload.length },
            confidence: 'exact'
        })
    };
}
