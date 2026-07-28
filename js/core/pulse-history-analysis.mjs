const DAY_MS = 24 * 60 * 60 * 1000;

function finiteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function rowTimestamp(row) {
    const timestamp = Date.parse(row?.timestamp || '');
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function utcDay(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
}

function ordinal(value) {
    const number = Math.abs(Math.round(value));
    const mod100 = number % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
    const mod10 = number % 10;
    if (mod10 === 1) return `${number}st`;
    if (mod10 === 2) return `${number}nd`;
    if (mod10 === 3) return `${number}rd`;
    return `${number}th`;
}

function dailyPoints(rows, column, current, currentAt = Date.now()) {
    const byDay = new Map();
    (Array.isArray(rows) ? rows : [])
        .filter(row => row && typeof row === 'object')
        .sort((a, b) => (rowTimestamp(a) || 0) - (rowTimestamp(b) || 0))
        .forEach(row => {
            const timestamp = rowTimestamp(row);
            const value = finiteNumber(row?.[column]);
            if (!timestamp || value === null) return;
            byDay.set(utcDay(timestamp), { day: utcDay(timestamp), timestamp, value });
        });
    const currentValue = finiteNumber(current);
    if (currentValue !== null) {
        byDay.set(utcDay(currentAt), {
            day: utcDay(currentAt),
            timestamp: currentAt,
            value: currentValue
        });
    }
    return [...byDay.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function consecutiveStreak(points) {
    if (points.length < 3) return { days: 0, direction: 'flat' };
    const direction = points.at(-1).value > points.at(-2).value
        ? 'up'
        : points.at(-1).value < points.at(-2).value
            ? 'down'
            : 'flat';
    if (direction === 'flat') return { days: 0, direction };

    let days = 1;
    for (let index = points.length - 1; index > 0; index -= 1) {
        const current = points[index];
        const previous = points[index - 1];
        const gapDays = Math.round((current.timestamp - previous.timestamp) / DAY_MS);
        const matches = direction === 'up'
            ? current.value > previous.value
            : current.value < previous.value;
        if (gapDays !== 1 || !matches) break;
        days += 1;
    }
    return { days, direction };
}

function hasCompleteDailyWindow(points, days = 7) {
    const window = points.slice(-(days + 1));
    if (window.length !== days + 1) return false;
    return window.every((point, index) => {
        if (index === 0) return true;
        return Math.round((point.timestamp - window[index - 1].timestamp) / DAY_MS) === 1;
    });
}

export function describePulseSeries(rows, column, current, options = {}) {
    const currentAt = finiteNumber(options.currentAt) || Date.now();
    const mode = ['flow', 'ratio', 'stock', 'monotonic'].includes(options.mode)
        ? options.mode
        : 'flow';
    const points = dailyPoints(rows, column, current, currentAt);
    const latest = points.at(-1) || null;
    const previous = points.slice(0, -1);
    const baseline7 = previous.slice(-7);
    const baseline30 = previous.slice(-30);
    const avg7d = baseline7.length
        ? baseline7.reduce((sum, point) => sum + point.value, 0) / baseline7.length
        : null;
    const avg30d = baseline30.length
        ? baseline30.reduce((sum, point) => sum + point.value, 0) / baseline30.length
        : null;
    const pctVsAvg7d = latest && avg7d !== null && Math.abs(avg7d) > 0
        ? ((latest.value - avg7d) / Math.abs(avg7d)) * 100
        : null;
    const point7d = baseline7[0] || null;
    const change7d = latest && point7d ? latest.value - point7d.value : null;
    const pctChange7d = change7d !== null && point7d && Math.abs(point7d.value) > 0
        ? (change7d / Math.abs(point7d.value)) * 100
        : null;
    const streak = consecutiveStreak(points);
    const complete7d = hasCompleteDailyWindow(points, 7);
    const strictHigh = latest && complete7d
        && latest.value > Math.max(...baseline30.map(point => point.value));
    const strictLow = latest && complete7d
        && latest.value < Math.min(...baseline30.map(point => point.value));
    const coverageDays = points.length >= 2
        ? Math.max(1, Math.round((points.at(-1).timestamp - points[0].timestamp) / DAY_MS))
        : 0;

    return {
        mode,
        samples: points.length,
        baselineSamples: previous.length,
        complete7d,
        coverageDays,
        latest: latest?.value ?? null,
        avg7d,
        avg30d,
        pctVsAvg7d,
        change7d,
        pctChange7d,
        strictHigh,
        strictLow,
        streakDays: streak.days,
        direction: streak.direction
    };
}

export function pulseSeriesContextLine(descriptor, options = {}) {
    if (!descriptor || descriptor.latest === null || descriptor.baselineSamples < 7 || descriptor.complete7d !== true) return '';
    const mode = descriptor.mode;
    const format = typeof options.format === 'function'
        ? options.format
        : value => Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 1 });
    const minimumChange = finiteNumber(options.minimumChange) ?? 0;
    const relativeThreshold = finiteNumber(options.relativeThreshold) ?? 12;
    const pointThreshold = finiteNumber(options.pointThreshold) ?? 0.5;

    if (mode === 'monotonic') {
        if (descriptor.change7d !== null && descriptor.change7d >= minimumChange && descriptor.change7d > 0) {
            return `Added ${format(descriptor.change7d)} over 7 days.`;
        }
        return '';
    }
    if (mode === 'stock') {
        if (descriptor.change7d === null || Math.abs(descriptor.change7d) < minimumChange) return '';
        return `${descriptor.change7d > 0 ? 'Up' : 'Down'} ${format(descriptor.change7d)} over 7 days.`;
    }

    const windowDays = Math.max(7, Math.min(30, descriptor.coverageDays));
    if (descriptor.strictHigh) return `Highest in ${windowDays} days.`;
    if (descriptor.strictLow) return `Lowest in ${windowDays} days.`;
    if (descriptor.streakDays >= 3) {
        return `${ordinal(descriptor.streakDays)} straight day ${descriptor.direction === 'up' ? 'rising' : 'falling'}.`;
    }
    if (mode === 'ratio' && descriptor.avg7d !== null) {
        const pointDelta = descriptor.latest - descriptor.avg7d;
        if (Math.abs(pointDelta) >= pointThreshold) {
            return `${Math.abs(pointDelta).toFixed(1)} points ${pointDelta > 0 ? 'above' : 'below'} the 7-day average.`;
        }
        return '';
    }
    if (descriptor.pctVsAvg7d !== null && Math.abs(descriptor.pctVsAvg7d) >= relativeThreshold) {
        return `${Math.round(Math.abs(descriptor.pctVsAvg7d))}% ${descriptor.pctVsAvg7d > 0 ? 'above' : 'below'} the 7-day average.`;
    }
    return '';
}
