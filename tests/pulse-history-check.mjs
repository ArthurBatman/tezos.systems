import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    describePulseSeries,
    pulseSeriesContextLine
} from '../js/core/pulse-history-analysis.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const base = Date.UTC(2026, 6, 28, 12);
const pulseHistorySource = readFileSync(new URL('../js/core/pulse-history.mjs', import.meta.url), 'utf8');

function rowsFor(values, column = 'value') {
    return values.map((value, index) => ({
        timestamp: new Date(base - ((values.length - index) * DAY_MS)).toISOString(),
        [column]: value
    }));
}

assert.match(
    pulseHistorySource,
    /const CACHE_TTL_MS = 30 \* 60 \* 1000;/,
    'pulse history should use the agreed 30-minute shared cache'
);

{
    const rows = rowsFor([80, 82, 84, 86, 88, 90, 92, 94], 'tx_volume_24h');
    const descriptor = describePulseSeries(rows, 'tx_volume_24h', 110, {
        currentAt: base,
        mode: 'flow'
    });
    assert.equal(descriptor.strictHigh, true, 'a strict current high should be recognized');
    assert.match(
        pulseSeriesContextLine(descriptor),
        /^Highest in \d+ days\.$/,
        'a flow high should produce a bounded coverage claim'
    );
}

{
    const rows = rowsFor([100, 100, 101, 101, 102, 102, 103, 103], 'total_bakers');
    const descriptor = describePulseSeries(rows, 'total_bakers', 104, {
        currentAt: base,
        mode: 'stock'
    });
    assert.equal(
        pulseSeriesContextLine(descriptor, { minimumChange: 1, format: value => String(Math.round(Math.abs(value))) }),
        'Up 4 over 7 days.',
        'stock metrics should describe change instead of emitting a trivial record-high claim'
    );
}

{
    const rows = rowsFor([40, 40.1, 40.2, 40.3, 40.4, 40.5, 40.6, 40.7], 'tz4_percentage');
    const descriptor = describePulseSeries(rows, 'tz4_percentage', 42, {
        currentAt: base,
        mode: 'ratio'
    });
    const line = pulseSeriesContextLine(descriptor, { pointThreshold: 0.5 });
    assert(
        /^Highest in \d+ days\.$/.test(line) || /points above the 7-day average/.test(line),
        `ratio context should use points or a strict-window claim, saw ${line}`
    );
}

{
    const rows = rowsFor([10, 11, 12], 'contract_calls_24h');
    const descriptor = describePulseSeries(rows, 'contract_calls_24h', 30, {
        currentAt: base,
        mode: 'flow'
    });
    assert.equal(
        pulseSeriesContextLine(descriptor),
        '',
        'history claims must stay silent without seven baseline days'
    );
}

{
    const tied = rowsFor([20, 25, 30, 30, 30, 30, 30, 30], 'volume_24h_usd');
    const descriptor = describePulseSeries(tied, 'volume_24h_usd', 30, {
        currentAt: base,
        mode: 'flow'
    });
    assert.equal(descriptor.strictHigh, false, 'a tied value must not be called a new high');
}

{
    const gapped = rowsFor([20, 21, 22, 23, 24, 25, 26, 27], 'volume_24h_usd')
        .filter((_, index) => index !== 4);
    const descriptor = describePulseSeries(gapped, 'volume_24h_usd', 50, {
        currentAt: base,
        mode: 'flow'
    });
    assert.equal(descriptor.complete7d, false, 'a missing UTC day should break complete-window coverage');
    assert.equal(
        pulseSeriesContextLine(descriptor),
        '',
        'gapped history must not produce a complete 7-day comparison'
    );
}

console.log('ok - pulse history context semantics');
