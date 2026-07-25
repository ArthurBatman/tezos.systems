/**
 * Pure schedule, source-routing, and exact aggregation rules for My Tezos.
 */

export const MY_TEZOS_BALANCE_HISTORY_SCHEDULE_VERSION = 'exact-total-xtz-v1';
export const PARIS_ACTIVATION_LEVEL = 5_726_209;
export const MY_TEZOS_HISTORY_DAY_MS = 24 * 60 * 60 * 1000;
export const MY_TEZOS_HISTORY_YEAR_DAYS = 365;

const CADENCE_SECONDS = Object.freeze({
    daily: 24 * 60 * 60,
    weekly: 7 * 24 * 60 * 60
});

function finiteLevel(value, fallback = null) {
    const level = Math.trunc(Number(value));
    return Number.isFinite(level) && level >= 1 ? level : fallback;
}

function normalizedProtocols(protocols) {
    const rows = (Array.isArray(protocols) ? protocols : [])
        .map((protocol) => ({
            name: String(protocol?.name || protocol?.alias || 'Unknown protocol'),
            block: finiteLevel(protocol?.block ?? protocol?.firstLevel),
            blockTime: Math.max(1, Number(protocol?.blockTime) || 60)
        }))
        .filter((protocol) => protocol.block != null)
        .sort((left, right) => left.block - right.block);
    if (!rows.length || rows[0].block > 1) {
        rows.unshift({ name: 'Genesis', block: 1, blockTime: 60 });
    }
    return rows.filter((protocol, index) => (
        index === 0 || protocol.block !== rows[index - 1].block
    ));
}

export function protocolAtHistoricalLevel(protocols, level) {
    const normalized = normalizedProtocols(protocols);
    let selected = normalized[0];
    for (const protocol of normalized) {
        if (protocol.block > level) break;
        selected = protocol;
    }
    return selected;
}

/**
 * Build common immutable sample levels for all included addresses.
 *
 * Regular samples remain aligned to the TzKT `step` contract. Each protocol
 * boundary is also an explicit anchor, so sampling resumes under the new block
 * cadence without carrying the prior protocol's estimate forward.
 */
export function buildHistoricalBalanceSchedule({
    protocols = [],
    accountCreationLevels = [],
    oneYearLevel,
    finalizedLevel
} = {}) {
    const head = finiteLevel(finalizedLevel);
    if (head == null) throw new Error('A finalized Tezos level is required.');
    const creationLevels = accountCreationLevels
        .map((level) => finiteLevel(level))
        .filter((level) => level != null && level <= head);
    const earliestCreation = Math.min(...(creationLevels.length ? creationLevels : [head]));
    const yearBoundary = Math.min(head, Math.max(1, finiteLevel(oneYearLevel, earliestCreation)));
    // A recently-created account still needs a complete one-year chart. Levels
    // before creation are exact zero, so retain the one-year boundary even when
    // every included account was created more recently.
    const earliest = Math.min(earliestCreation, yearBoundary);
    const catalog = normalizedProtocols(protocols);
    const byLevel = new Map();

    const add = (level, {
        anchor = '',
        cadence = level >= yearBoundary ? 'daily' : 'weekly',
        protocol = protocolAtHistoricalLevel(catalog, level),
        sampleStep = null
    } = {}) => {
        const normalizedLevel = finiteLevel(level);
        if (normalizedLevel == null || normalizedLevel < earliest || normalizedLevel > head) return;
        const existing = byLevel.get(normalizedLevel) || {
            level: normalizedLevel,
            cadence,
            protocol: protocol.name,
            blockTime: protocol.blockTime,
            sampleStep: null,
            anchors: []
        };
        existing.cadence = normalizedLevel >= yearBoundary ? 'daily' : 'weekly';
        existing.protocol = protocol.name;
        existing.blockTime = protocol.blockTime;
        if (sampleStep != null) existing.sampleStep = sampleStep;
        if (anchor && !existing.anchors.includes(anchor)) existing.anchors.push(anchor);
        byLevel.set(normalizedLevel, existing);
    };

    const zones = [
        { cadence: 'weekly', start: earliest, end: yearBoundary - 1 },
        { cadence: 'daily', start: yearBoundary, end: head }
    ];

    catalog.forEach((protocol, index) => {
        const nextBlock = catalog[index + 1]?.block || (head + 1);
        const segmentStart = Math.max(earliest, protocol.block);
        const segmentEnd = Math.min(head, nextBlock - 1);
        if (segmentStart > segmentEnd) return;
        if (protocol.block >= earliest) {
            add(protocol.block, { anchor: 'protocol-boundary', protocol });
        }
        zones.forEach((zone) => {
            const start = Math.max(segmentStart, zone.start);
            const end = Math.min(segmentEnd, zone.end);
            if (start > end) return;
            const sampleStep = Math.max(1, Math.round(CADENCE_SECONDS[zone.cadence] / protocol.blockTime));
            const first = Math.ceil(start / sampleStep) * sampleStep;
            for (let level = first; level <= end; level += sampleStep) {
                add(level, { cadence: zone.cadence, protocol, sampleStep });
            }
        });
    });

    creationLevels.forEach((level) => add(level, { anchor: 'account-creation' }));
    add(yearBoundary, { anchor: 'one-year-boundary' });
    add(head, { anchor: 'latest-finalized' });

    return [...byLevel.values()]
        .sort((left, right) => left.level - right.level)
        .map((point) => ({
            ...point,
            anchors: point.anchors.sort()
        }));
}

export function resolveHistoricalScheduleTimestamps(schedule, blockRows) {
    const rows = blockRows instanceof Map ? [...blockRows.values()] : blockRows;
    const byLevel = new Map((Array.isArray(rows) ? rows : []).map((row) => [
        finiteLevel(row?.level),
        row
    ]));
    return schedule.map((point) => {
        const block = byLevel.get(point.level);
        const timestamp = Date.parse(block?.timestamp || '');
        if (!Number.isFinite(timestamp)) {
            throw new Error(`TzKT did not resolve historical level ${point.level}.`);
        }
        return {
            ...point,
            timestamp,
            protocol: point.protocol || String(block?.protocol || 'Unknown protocol')
        };
    });
}

export function historicalBalanceSource(account, level) {
    const address = String(account?.address || '');
    if (Number(level) < PARIS_ACTIVATION_LEVEL) return 'tzkt';
    if (account?.type === 'delegate' || account?.type === 'contract' || address.startsWith('KT1')) {
        return 'tzkt';
    }
    const rawStakingOpsCount = account?.stakingOpsCount;
    const stakingOpsCount = Number(rawStakingOpsCount);
    if (
        address.startsWith('tz')
        && rawStakingOpsCount != null
        && rawStakingOpsCount !== ''
        && Number.isFinite(stakingOpsCount)
        && stakingOpsCount === 0
    ) {
        return 'tzkt';
    }
    return 'archive';
}

function pointMap(records) {
    return new Map((Array.isArray(records) ? records : [])
        .filter((record) => (
            record?.confidence === 'exact'
            && finiteLevel(record?.level) != null
            && Number.isFinite(Number(record?.totalMutez))
        ))
        .map((record) => [Number(record.level), record]));
}

function addressSeries(address, account, schedule, records) {
    const creation = finiteLevel(account?.firstActivity, 1);
    const byLevel = pointMap(records);
    const series = [];
    const missing = [];
    for (const sample of schedule) {
        if (sample.level < creation) {
            series.push({
                address,
                ...sample,
                totalMutez: 0,
                confidence: 'exact',
                source: 'pre-creation-zero',
                sourceReceipt: null
            });
            continue;
        }
        const record = byLevel.get(sample.level);
        if (!record) {
            missing.push(sample.level);
            continue;
        }
        series.push({
            ...sample,
            ...record,
            address,
            timestamp: sample.timestamp,
            cadence: sample.cadence,
            protocol: sample.protocol,
            confidence: 'exact'
        });
    }
    const dailyTargets = schedule.filter((sample) => sample.cadence === 'daily');
    const completedLevels = new Set(series.map((point) => point.level));
    const dailyCompleted = dailyTargets.filter((sample) => completedLevels.has(sample.level)).length;
    return {
        series,
        coverage: {
            address,
            completed: series.length,
            target: schedule.length,
            dailyCompleted,
            dailyTarget: dailyTargets.length,
            lifetimeCompleted: series.length,
            lifetimeTarget: schedule.length,
            missing,
            earliestTimestamp: series[0]?.timestamp || null,
            latestLevel: series.at(-1)?.level || null,
            complete: schedule.length > 0 && series.length === schedule.length
        }
    };
}

/**
 * Aggregate only levels with an exact balance for every already-created
 * address. Not-yet-created addresses contribute an exact zero.
 */
export function buildExactBalanceHistoryView({
    entries = [],
    accounts = [],
    schedule = [],
    recordsByAddress = {},
    sourceStatus = {}
} = {}) {
    const accountByAddress = new Map(accounts.map((account) => [account.address, account]));
    const seriesByAddress = {};
    const coverageByAddress = {};
    const pointMaps = new Map();

    entries.forEach((entry) => {
        const account = accountByAddress.get(entry.address) || {
            address: entry.address,
            firstActivity: 1,
            stakingOpsCount: null
        };
        const built = addressSeries(
            entry.address,
            account,
            schedule,
            recordsByAddress[entry.address] || []
        );
        seriesByAddress[entry.address] = built.series;
        coverageByAddress[entry.address] = built.coverage;
        pointMaps.set(entry.address, new Map(built.series.map((point) => [point.level, point])));
    });

    const aggregate = [];
    for (const sample of schedule) {
        const points = [];
        let complete = true;
        for (const entry of entries) {
            const point = pointMaps.get(entry.address)?.get(sample.level);
            if (!point) {
                complete = false;
                break;
            }
            points.push(point);
        }
        if (!complete) continue;
        const sources = [...new Set(points.map((point) => point.source).filter(Boolean))];
        aggregate.push({
            ...sample,
            totalMutez: points.reduce((sum, point) => sum + Number(point.totalMutez), 0),
            confidence: 'exact',
            source: sources.length === 1 ? sources[0] : 'mixed-exact-sources',
            sources,
            includedAddresses: entries.length
        });
    }

    const dailyTarget = schedule.filter((sample) => sample.cadence === 'daily').length;
    const dailyCompleted = aggregate.filter((point) => point.cadence === 'daily').length;
    return {
        scheduleVersion: MY_TEZOS_BALANCE_HISTORY_SCHEDULE_VERSION,
        compositionAddresses: entries.map((entry) => entry.address),
        seriesByAddress,
        aggregate,
        coverageByAddress,
        aggregateCoverage: {
            completed: aggregate.length,
            target: schedule.length,
            dailyCompleted,
            dailyTarget,
            lifetimeCompleted: aggregate.length,
            lifetimeTarget: schedule.length,
            earliestTimestamp: aggregate[0]?.timestamp || null,
            latestLevel: aggregate.at(-1)?.level || null,
            complete: schedule.length > 0 && aggregate.length === schedule.length,
            missing: schedule
                .filter((sample) => !aggregate.some((point) => point.level === sample.level))
                .map((sample) => sample.level)
        },
        sourceStatus
    };
}
