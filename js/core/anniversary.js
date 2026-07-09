import { MAINNET_LAUNCH } from './config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function ordinal(value) {
    const number = Math.abs(Math.trunc(Number(value) || 0));
    const mod100 = number % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
    switch (number % 10) {
        case 1: return `${number}st`;
        case 2: return `${number}nd`;
        case 3: return `${number}rd`;
        default: return `${number}th`;
    }
}

function validTime(value) {
    return Number.isFinite(value) ? value : Date.now();
}

export function getTezosUptimeAnniversary(now = Date.now(), launchIso = MAINNET_LAUNCH) {
    const nowMs = validTime(typeof now === 'number' ? now : new Date(now).getTime());
    const launch = new Date(launchIso);
    const launchMs = launch.getTime();
    if (!Number.isFinite(launchMs)) {
        return {
            isAnniversary: false,
            years: 0,
            ordinalYears: '0th',
            totalDays: 0,
            startsAt: 0,
            endsAt: 0,
            claimText: '100% uptime',
            originText: 'since 2018',
            message: '',
            hotText: '',
            detail: ''
        };
    }

    const current = new Date(nowMs);
    const currentYear = current.getUTCFullYear();
    const launchYear = launch.getUTCFullYear();
    const years = currentYear - launchYear;
    const startsAt = Date.UTC(currentYear, launch.getUTCMonth(), launch.getUTCDate());
    const endsAt = startsAt + DAY_MS;
    const isAnniversary = years > 0 && nowMs >= startsAt && nowMs < endsAt;
    const totalDays = Math.max(0, Math.floor((nowMs - launchMs) / DAY_MS));
    const ordinalYears = ordinal(years);
    const formattedDays = totalDays.toLocaleString('en-US');
    const yearLabel = years === 1 ? 'year' : 'years';

    return {
        isAnniversary,
        years,
        ordinalYears,
        totalDays,
        startsAt,
        endsAt,
        dayKey: new Date(startsAt).toISOString().slice(0, 10),
        monthDay: new Date(startsAt).toISOString().slice(5, 10),
        claimText: `${years} ${yearLabel} of uptime`,
        originText: `happy ${ordinalYears}, Tezos`,
        message: `Happy ${ordinalYears} anniversary, Tezos. ${formattedDays} days live with 100% uptime.`,
        hotText: `Tezos turns ${years} today: ${formattedDays} days live with 100% uptime, zero outages, and zero hard forks.`,
        detail: `${formattedDays} days live`
    };
}
