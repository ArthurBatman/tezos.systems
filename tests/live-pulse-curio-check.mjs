import assert from 'node:assert/strict';
import {
    chooseDailyCurio,
    LIVE_PULSE_CURIO_MAX_BASE_SIGNALS,
    LIVE_PULSE_CURIO_SCORE,
    shouldOfferDailyCurio
} from '../js/core/live-pulse-curio.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

function historyRow(dayKey, daysAgo, totalBakers) {
    const timestamp = Date.parse(`${dayKey}T00:00:00Z`) - (daysAgo * DAY_MS);
    return {
        timestamp: new Date(timestamp).toISOString(),
        total_bakers: totalBakers
    };
}

assert.equal(LIVE_PULSE_CURIO_SCORE, 58, 'Curio must remain below real news');
assert.equal(LIVE_PULSE_CURIO_MAX_BASE_SIGNALS, 8, 'Curio must yield to a full signal strip');

const protocol = chooseDailyCurio({
    dayKey: '2026-07-29',
    protocols: [{ date: '2022-07-29', name: 'Jakarta', headline: 'Protocol receipt' }],
    historyRows: [historyRow('2026-07-29', 30, 390)],
    totalBakers: 405,
    uptime: { totalDays: 2_900 },
    upgradeCount: 21
});
assert.equal(protocol?.source, 'protocol', 'A protocol anniversary must win over rotating curios');
assert.match(protocol?.text || '', /4 years since Jakarta activated/);

const monthInput = {
    dayKey: '2026-07-28',
    protocols: [],
    historyRows: [
        historyRow('2026-07-28', 27, 380),
        historyRow('2026-07-28', 30, 391),
        historyRow('2026-07-28', 33, 402)
    ],
    totalBakers: 407,
    uptime: { totalDays: 2_900 },
    upgradeCount: 21
};
const month = chooseDailyCurio(monthInput);
assert.equal(month?.source, 'month', 'Even UTC days should deterministically select the month rewind when it exists');
assert.match(month?.text || '', /391 a month ago\. Today: 407\./);
assert.match(month?.detail || '', /address/i, 'Baker history must be described as addresses, not inferred people');
assert.deepEqual(chooseDailyCurio(monthInput), month, 'The same UTC day and evidence must choose the same Curio');

const continuity = chooseDailyCurio({
    ...monthInput,
    dayKey: '2026-07-29',
    historyRows: [historyRow('2026-07-29', 30, 391)]
});
assert.equal(continuity?.source, 'continuity', 'Adjacent UTC days should rotate the standing Curio candidates');
assert.match(continuity?.text || '', /2,900 days old/);
assert.match(continuity?.text || '', /21 adopted protocol upgrades/);
assert.doesNotMatch(
    continuity?.text || '',
    /zero (?:hard )?forks|zero chain splits|100% uptime|uninterrupted uptime/i,
    'The chain-age Curio must not turn continuity into an unreceipted availability claim'
);

const historyOnly = chooseDailyCurio({
    ...monthInput,
    dayKey: '2026-07-29',
    uptime: null
});
assert.equal(historyOnly?.source, 'month', 'One eligible standing candidate should be used regardless of rotation');

assert.equal(shouldOfferDailyCurio({
    baseSignalCount: 7,
    storedDay: '',
    activeDay: '',
    today: '2026-07-29'
}), true);
assert.equal(shouldOfferDailyCurio({
    baseSignalCount: 8,
    storedDay: '',
    activeDay: '',
    today: '2026-07-29'
}), false, 'Eight stronger base signals must suppress the Curio');
assert.equal(shouldOfferDailyCurio({
    baseSignalCount: 3,
    storedDay: '2026-07-29',
    activeDay: '',
    today: '2026-07-29'
}), false, 'A stored UTC-day receipt must prevent another Curio after reload');
assert.equal(shouldOfferDailyCurio({
    baseSignalCount: 3,
    storedDay: '2026-07-29',
    activeDay: '2026-07-29',
    today: '2026-07-29'
}), true, 'The already-rendered daily Curio must survive quiet reconciliation');

console.log('ok - Live Pulse daily Curio selection, scarcity, and truthfulness contracts');
