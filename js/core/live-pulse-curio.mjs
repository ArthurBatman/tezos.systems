const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LOOKBACK_DAYS = 30;
const MONTH_LOOKBACK_TOLERANCE_DAYS = 2;

export const LIVE_PULSE_CURIO_SCORE = 58;
export const LIVE_PULSE_CURIO_MAX_BASE_SIGNALS = 8;

function finiteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function dayStart(dayKey) {
    const timestamp = Date.parse(`${dayKey}T00:00:00Z`);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function formatCount(value) {
    return Math.round(value).toLocaleString('en-US');
}

function protocolAnniversaryCandidate(dayKey, protocols = []) {
    const monthDay = String(dayKey || '').slice(5);
    const protocol = (Array.isArray(protocols) ? protocols : [])
        .find(item => String(item?.date || '').slice(5) === monthDay);
    if (!protocol) return null;

    const activationYear = Number(String(protocol.date).slice(0, 4));
    const currentYear = new Date(`${dayKey}T00:00:00Z`).getUTCFullYear();
    const age = Number.isFinite(activationYear) ? currentYear - activationYear : 0;
    const ageText = age > 0 ? `${age} year${age === 1 ? '' : 's'} since ` : '';
    return {
        source: 'protocol',
        id: `curio-protocol-${dayKey}`,
        icon: '✦',
        title: 'Protocol lore day',
        detail: String(protocol.headline || 'Self-amendment history'),
        text: `${ageText}${protocol.name} activated. Explore its proposal, ballots, activation, and debate record.`,
        route: '/anthology/'
    };
}

function monthAgoCandidate(dayKey, historyRows = [], totalBakers) {
    const currentBakers = finiteNumber(totalBakers);
    const start = dayStart(dayKey);
    if (currentBakers == null || start == null) return null;

    const target = start - (MONTH_LOOKBACK_DAYS * DAY_MS);
    const tolerance = MONTH_LOOKBACK_TOLERANCE_DAYS * DAY_MS;
    let match = null;
    let matchDistance = Number.POSITIVE_INFINITY;
    for (const row of Array.isArray(historyRows) ? historyRows : []) {
        const timestamp = Date.parse(row?.timestamp || '');
        const bakerCount = finiteNumber(row?.total_bakers);
        if (!Number.isFinite(timestamp) || bakerCount == null) continue;
        const distance = Math.abs(timestamp - target);
        if (distance <= tolerance && distance < matchDistance) {
            match = { bakerCount };
            matchDistance = distance;
        }
    }
    if (!match) return null;

    return {
        source: 'month',
        id: `curio-month-${dayKey}`,
        icon: '↶',
        title: 'Thirty-day rewind',
        detail: 'Active baker-address count',
        text: `Active baker addresses numbered ${formatCount(match.bakerCount)} a month ago. Today: ${formatCount(currentBakers)}.`,
        route: '/history/'
    };
}

function mainnetAgeCandidate(dayKey, uptime, upgradeCount) {
    const totalDays = finiteNumber(uptime?.totalDays);
    const upgrades = finiteNumber(upgradeCount);
    if (totalDays == null || upgrades == null) return null;
    return {
        source: 'continuity',
        id: `curio-continuity-${dayKey}`,
        icon: '∞',
        title: 'Mainnet age',
        detail: 'Chain-age marker',
        text: `Tezos mainnet is ${formatCount(totalDays)} days old. Its on-chain amendment record spans ${formatCount(upgrades)} adopted protocol upgrades.`,
        route: '/anthology/'
    };
}

export function chooseDailyCurio({
    dayKey,
    protocols = [],
    historyRows = [],
    totalBakers = null,
    uptime = null,
    upgradeCount = null
} = {}) {
    if (dayStart(dayKey) == null) return null;

    const protocolCandidate = protocolAnniversaryCandidate(dayKey, protocols);
    if (protocolCandidate) return protocolCandidate;

    const rotatingCandidates = [
        monthAgoCandidate(dayKey, historyRows, totalBakers),
        mainnetAgeCandidate(dayKey, uptime, upgradeCount)
    ].filter(Boolean);
    if (!rotatingCandidates.length) return null;

    const rotation = Math.abs(Math.floor(dayStart(dayKey) / DAY_MS)) % rotatingCandidates.length;
    return rotatingCandidates[rotation];
}

export function shouldOfferDailyCurio({
    baseSignalCount = 0,
    storedDay = '',
    activeDay = '',
    today = ''
} = {}) {
    if (!today || Math.max(0, Number(baseSignalCount) || 0) >= LIVE_PULSE_CURIO_MAX_BASE_SIGNALS) {
        return false;
    }
    if (activeDay === today) return true;
    return storedDay !== today;
}
