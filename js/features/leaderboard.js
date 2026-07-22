/**
 * Baker Leaderboard — sortable ranking of all active Tezos bakers
 * Shows stake, delegators, tz4 status, capacity usage
 */

import { API_URLS } from '../core/config.js';
import { escapeHtml, formatMutez } from '../core/utils.js';
import { isValidAddress } from './my-baker.js';
import { pulseFresh } from '../effects/data-magic.js';
import { quietlySyncHtml } from '../core/quiet-refresh.js';

const TZKT = API_URLS.tzkt;
const TOGGLE_KEY = 'tezos-systems-leaderboard-visible';
const SORT_KEY = 'tezos-systems-leaderboard-sort';
const CACHE_KEY = 'tezos-systems-leaderboard-cache-v5';
const LEGACY_CACHE_KEYS = [1, 2, 3, 4].map((version) => `tezos-systems-leaderboard-cache-v${version}`);
const FIT_KEY = 'tezos-systems-baker-fit';
const LEADERBOARD_CSS_URL = '/css/leaderboard.css?v=464';
const GOVERNANCE_CAREERS_URL = '/data/maxis-careers.json?surface=leaderboard';
const GOVERNANCE_VOTES_URL = '/data/governance-votes.json?surface=leaderboard';
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const DEFAULT_DELEGATION_LIMIT = 9;
const MY_BAKER_KEY = 'tezos-systems-my-baker-address';
const OG_LAST_YEAR = 2018;
const VETERAN_LAST_YEAR = 2021;

let bakersData = [];
let currentSort = { col: 'stake', dir: 'desc' };
let delegationLimit = DEFAULT_DELEGATION_LIMIT;
let delegationLimitSource = 'fallback';
let delegationLimitPromise = null;
let showOpenOvensOnly = false;
let leaderboardDataQuality = { status: 'unavailable', observedAt: null };
let governanceSignals = emptyGovernanceSignals();
const previousStakeSnapshot = new Map();

function ensureLeaderboardStyles() {
    if (document.getElementById('leaderboard-css')) return;
    const link = document.createElement('link');
    link.id = 'leaderboard-css';
    link.rel = 'stylesheet';
    link.href = LEADERBOARD_CSS_URL;
    document.head.appendChild(link);
}

const FIT_QUESTIONS = [
    {
        key: 'amount',
        label: 'Delegation size',
        options: [
            { value: 'small', label: '<1K', detail: 'starter amount' },
            { value: 'medium', label: '1K-50K', detail: 'typical delegator' },
            { value: 'large', label: '50K+', detail: 'capacity matters' }
        ]
    },
    {
        key: 'priority',
        label: 'Priority',
        options: [
            { value: 'community', label: 'Community', detail: 'delegator and staker adoption' },
            { value: 'capacity', label: 'Capacity', detail: 'more delegation room' }
        ]
    },
    {
        key: 'style',
        label: 'Baker style',
        options: [
            { value: 'balanced', label: 'Balanced', detail: 'steady all-rounder' },
            { value: 'modern', label: 'tz4 ready', detail: 'BLS consensus keys' },
            { value: 'veteran', label: 'Veteran', detail: 'first activity by end of 2021' }
        ]
    }
];

function loadFitPrefs() {
    try {
        const saved = JSON.parse(localStorage.getItem(FIT_KEY) || 'null');
        const priority = ['community', 'capacity'].includes(saved?.priority)
            ? saved.priority
            : 'community';
        return {
            amount: saved?.amount || 'medium',
            priority,
            style: saved?.style || 'balanced'
        };
    } catch {
        return { amount: 'medium', priority: 'community', style: 'balanced' };
    }
}

function saveFitPrefs(prefs) {
    try { localStorage.setItem(FIT_KEY, JSON.stringify(prefs)); } catch {}
}

let fitPrefs = loadFitPrefs();

async function fetchDelegationLimit() {
    if (delegationLimitPromise) return delegationLimitPromise;
    delegationLimitPromise = fetch(`${API_URLS.octez}/chains/main/blocks/head/context/constants`, { cache: 'no-store' })
        .then((resp) => resp.ok ? resp.json() : Promise.reject(new Error('Protocol constants unavailable')))
        .then((constants) => {
            const limit = Number(constants?.limit_of_delegation_over_baking);
            if (Number.isFinite(limit) && limit > 0) {
                delegationLimit = limit;
                delegationLimitSource = 'live';
            }
            return delegationLimit;
        })
        .catch(() => delegationLimit);
    return delegationLimitPromise;
}

/**
 * Fetch all active bakers from TzKT
 */
async function fetchBakers() {
    let cachedFunded = [];
    let cachedAt = null;
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cached && Array.isArray(cached.data)) {
            cachedFunded = cached.data.filter((baker) => Number(baker.bakingPower || 0) > 0);
            cachedAt = Number(cached.ts) || null;
        }
        if (cachedFunded.length && cachedAt && Date.now() - cachedAt < CACHE_TTL) {
            leaderboardDataQuality = { status: 'cached', observedAt: new Date(cachedAt).toISOString() };
            return cachedFunded;
        }
    } catch { /* ignore */ }

    const limit = 500;
    let offset = 0;
    let all = [];

    // Fetch active delegates, then keep the same funded-baker set used for
    // All Bakers Attest activation: positive current baking power.
    try {
        while (true) {
            const resp = await fetch(
                `${TZKT}/delegates?active=true&select=address,alias,stakingBalance,bakingPower,consensusAddress,externalStakedBalance,externalDelegatedBalance,numDelegators,stakersCount,stakedBalance,balance,software,firstActivity,firstActivityTime&sort.desc=id&limit=${limit}&offset=${offset}`
            );
            if (!resp.ok) throw new Error(`Baker directory HTTP ${resp.status}`);
            const batch = await resp.json();
            if (!Array.isArray(batch)) throw new Error('Unexpected baker directory payload');
            all = all.concat(batch);
            if (batch.length < limit) break;
            offset += limit;
        }

        const fundedBakers = all.filter((baker) => Number(baker.bakingPower || 0) > 0);
        if (!fundedBakers.length) throw new Error('Baker directory returned no funded active bakers');

        const observedAt = Date.now();
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: observedAt, data: fundedBakers }));
        } catch { /* quota */ }

        leaderboardDataQuality = { status: 'live', observedAt: new Date(observedAt).toISOString() };
        return fundedBakers;
    } catch (error) {
        if (cachedFunded.length) {
            leaderboardDataQuality = {
                status: 'stale',
                observedAt: cachedAt ? new Date(cachedAt).toISOString() : null,
                error: error.message
            };
            return cachedFunded;
        }
        leaderboardDataQuality = { status: 'unavailable', observedAt: null, error: error.message };
        throw error;
    }
}

function emptyGovernanceSignals() {
    return {
        careerByAddress: new Map(),
        acceptedByAddress: new Map(),
        careerReady: false,
        proposalsReady: false,
        careerGeneratedAt: null,
        proposalsGeneratedAt: null
    };
}

async function fetchJsonArtifact(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Artifact HTTP ${response.status}`);
    return response.json();
}

function governanceCareerIndex(artifact) {
    if (artifact?.kind !== 'maxis-governance-careers'
        || artifact?.coverage?.status !== 'complete'
        || artifact?.coverage?.absenceMeansZero !== true
        || !artifact?.records
        || typeof artifact.records !== 'object') {
        throw new Error('Governance career artifact is incomplete');
    }

    const byAddress = new Map();
    for (const [address, record] of Object.entries(artifact.records)) {
        if (record?.address === address) byAddress.set(address, record);
    }
    return byAddress;
}

function acceptedProposalIndex(artifact) {
    if (!Array.isArray(artifact?.epochs)
        || Number(artifact.epochCount) !== artifact.epochs.length) {
        throw new Error('Governance proposal artifact is incomplete');
    }

    const byAddress = new Map();
    const seenHashes = new Set();
    for (const epoch of artifact.epochs) {
        for (const proposal of epoch?.proposals || []) {
            const hash = String(proposal?.hash || '').trim();
            const address = String(proposal?.initiator?.address || '').trim();
            if (proposal?.status !== 'accepted' || !hash || !address || seenHashes.has(hash)) continue;
            seenHashes.add(hash);
            const rows = byAddress.get(address) || [];
            rows.push({
                hash,
                name: String(proposal?.extras?.alias || '').trim() || `${hash.slice(0, 8)}…`,
                epoch: Number.isFinite(Number(proposal?.epoch)) ? Number(proposal.epoch) : null
            });
            byAddress.set(address, rows);
        }
    }
    return byAddress;
}

async function fetchGovernanceSignals() {
    const [careerResult, proposalsResult] = await Promise.allSettled([
        fetchJsonArtifact(GOVERNANCE_CAREERS_URL),
        fetchJsonArtifact(GOVERNANCE_VOTES_URL)
    ]);
    const next = emptyGovernanceSignals();

    if (careerResult.status === 'fulfilled') {
        try {
            next.careerByAddress = governanceCareerIndex(careerResult.value);
            next.careerReady = true;
            next.careerGeneratedAt = careerResult.value.generatedAt || null;
        } catch { /* keep governance streak badges unavailable */ }
    }
    if (proposalsResult.status === 'fulfilled') {
        try {
            next.acceptedByAddress = acceptedProposalIndex(proposalsResult.value);
            next.proposalsReady = true;
            next.proposalsGeneratedAt = proposalsResult.value.generatedAt || null;
        } catch { /* keep accepted-proposal badges unavailable */ }
    }

    governanceSignals = next;
    return next;
}

/**
 * Determine if baker has tz4 consensus key
 */
function isTz4(addr, consensusAddress) {
    return (consensusAddress || addr || '').startsWith('tz4');
}

function normalizedAddress(value) {
    return String(value || '').trim().toLowerCase();
}

function savedBakerAddress() {
    try { return normalizedAddress(localStorage.getItem(MY_BAKER_KEY)); }
    catch { return ''; }
}

function sinceYear(baker) {
    const time = Date.parse(baker.firstActivityTime || '');
    if (Number.isFinite(time)) return new Date(time).getUTCFullYear();
    return null;
}

function isOpenDelegationRoom(baker, freeCapacity) {
    const capacity = Number(freeCapacity);
    return Number.isFinite(capacity)
        && capacity >= 50000
        && Number(baker.delegationUsage || 0) < 80;
}

function earnedBadgesFor(baker) {
    const badges = [];
    const firstYear = sinceYear(baker);
    if (Number.isFinite(firstYear) && firstYear <= OG_LAST_YEAR) {
        badges.push({
            label: `✦ OG · ${firstYear}`,
            tone: 'og',
            title: `OG baker: first on-chain activity recorded by TzKT in ${firstYear}, during the launch era.`
        });
    } else if (Number.isFinite(firstYear) && firstYear <= VETERAN_LAST_YEAR) {
        badges.push({
            label: `Veteran · ${firstYear}`,
            tone: 'veteran',
            title: `Veteran baker: first on-chain activity recorded by TzKT in ${firstYear}; the cutoff is December 31, ${VETERAN_LAST_YEAR}.`
        });
    }

    const accepted = governanceSignals.acceptedByAddress.get(baker.address) || [];
    if (accepted.length) {
        const names = accepted.map((proposal) => proposal.name);
        const visibleNames = names.slice(0, 4).join(', ');
        const remaining = names.length > 4 ? `, plus ${names.length - 4} more` : '';
        badges.push({
            label: `🏛 Accepted · ${accepted.length}`,
            tone: 'accepted',
            title: `${accepted.length} distinct protocol proposal${accepted.length === 1 ? '' : 's'} initiated by this baker reached TzKT status accepted: ${visibleNames}${remaining}.`
        });
    }

    const career = governanceSignals.careerByAddress.get(baker.address);
    const currentStreak = Number(career?.currentBallotPeriodStreak || 0);
    if (currentStreak > 0) {
        const longest = Number(career?.longestBallotPeriodStreak || currentStreak);
        const ballots = Number(career?.lifetimeBallots || 0);
        badges.push({
            label: `🗳 Streak · ${currentStreak}`,
            tone: 'voting',
            title: `${currentStreak} consecutive completed Exploration/Promotion period${currentStreak === 1 ? '' : 's'} with an applied ballot through the latest completed ballot period. Career high: ${longest}; applied ballots: ${ballots}.`
        });
    }

    const previousStake = previousStakeSnapshot.get(baker.address);
    if (Number.isFinite(previousStake) && Number(baker.stakingBalance || 0) > previousStake) {
        badges.push({
            label: '↗ Rising',
            tone: 'rising',
            title: 'Staking balance increased since the previous leaderboard refresh.'
        });
    }

    return badges;
}

/**
 * Compute derived fields for sorting
 */
function enrichBaker(b, activeDelegationLimit = delegationLimit) {
    const stake = (b.stakingBalance || 0) / 1e6;
    const ownStake = (b.stakedBalance || 0) / 1e6;
    const extStaked = (b.externalStakedBalance || 0) / 1e6;
    const extDelegated = (b.externalDelegatedBalance || 0) / 1e6;
    const delegators = b.numDelegators || 0;
    const stakers = b.stakersCount || 0;
    const limit = Number.isFinite(Number(activeDelegationLimit)) && Number(activeDelegationLimit) > 0
        ? Number(activeDelegationLimit)
        : DEFAULT_DELEGATION_LIMIT;
    const maxDelegation = ownStake * limit;
    const delegationUsage = maxDelegation > 0 ? (extDelegated / maxDelegation) * 100 : 0;
    const freeDelegationCapacity = Math.max(0, maxDelegation - extDelegated);
    const base = {
        ...b,
        stake,
        ownStake,
        extStaked,
        extDelegated,
        freeDelegationCapacity,
        delegators,
        stakers,
        tz4: isTz4(b.address, b.consensusAddress),
        delegationLimit: limit,
        delegationUsage: Math.min(delegationUsage, 100),
        name: b.alias || (b.address.slice(0, 8) + '…'),
        sinceYear: sinceYear(b)
    };

    return {
        ...base,
        earnedBadges: earnedBadgesFor(base),
        openDelegationRoom: isOpenDelegationRoom(base, freeDelegationCapacity),
    };
}

function rememberStakeSnapshot(bakers) {
    bakers.forEach((baker) => {
        if (baker?.address) previousStakeSnapshot.set(baker.address, Number(baker.stakingBalance || 0));
    });
}

function searchableBakerText(baker) {
    return [
        baker.name,
        baker.alias,
        baker.address,
        baker.consensusAddress
    ].filter(Boolean).join(' ').toLowerCase();
}

function compactSearchText(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scoreBakerMatch(baker, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return 0;
    const compactQuery = compactSearchText(q);
    const name = String(baker.name || baker.alias || '').toLowerCase();
    const text = searchableBakerText(baker);
    const compactName = compactSearchText(name);
    let score = 0;

    if (name === q) score = 120;
    else if (name.startsWith(q)) score = 95;
    else if (name.split(/\s+/).some((part) => part.startsWith(q))) score = 78;
    else if (text.includes(q)) score = 58;
    else if (compactQuery && compactName.includes(compactQuery)) score = 48;
    else if (String(baker.address || '').toLowerCase().includes(q)) score = 36;

    if (!score) return 0;
    const stakeBoost = Math.log10(Math.max(1, Number(baker.stake || 0))) * 2;
    return score + stakeBoost;
}

/**
 * Sort bakers by column
 */
function sortBakers(bakers, col, dir) {
    const mult = dir === 'desc' ? -1 : 1;
    return [...bakers].sort((a, b) => {
        let va, vb;
        switch (col) {
            case 'stake': va = a.stake; vb = b.stake; break;
            case 'delegators': va = a.delegators; vb = b.delegators; break;
            case 'stakers': va = a.stakers; vb = b.stakers; break;
            case 'capacity': va = a.delegationUsage; vb = b.delegationUsage; break;
            case 'tz4': va = a.tz4 ? 1 : 0; vb = b.tz4 ? 1 : 0; break;
            case 'name': return mult * a.name.localeCompare(b.name);
            default: va = a.stake; vb = b.stake;
        }
        return mult * (va - vb);
    });
}

export async function findBakersByName(query, { limit = 5 } = {}) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    if (!bakersData.length) {
        const raw = await fetchBakers();
        bakersData = raw.map(b => enrichBaker(b));
    }

    return bakersData
        .map((baker) => ({ baker, score: scoreBakerMatch(baker, q) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ baker }, index) => ({
            ...baker,
            searchRank: index + 1
        }));
}

function fitCapacityNeed(prefs) {
    if (prefs.amount === 'large') return 250000;
    if (prefs.amount === 'medium') return 50000;
    return 1000;
}

function clampScore(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
}

function scoreBakerFit(baker, prefs = fitPrefs) {
    const free = Number(baker.freeDelegationCapacity || 0);
    const need = fitCapacityNeed(prefs);
    const hasRoom = free >= need && Number(baker.delegationUsage || 0) < 90;
    const capacityRoomScore = clampScore((free / Math.max(1, need)) * 100);
    const capacityUseScore = clampScore(100 - Number(baker.delegationUsage || 0));
    const capacityScore = capacityRoomScore * 0.65 + capacityUseScore * 0.35;
    const community = Number(baker.delegators || 0) + Number(baker.stakers || 0);
    const communityScore = clampScore(Math.log10(community + 1) * 42);
    let score = capacityScore * 0.48 + communityScore * 0.37 + (baker.tz4 ? 15 : 0);
    const reasons = [];

    if (hasRoom) {
        score += prefs.amount === 'large' ? 18 : 10;
        reasons.push(`${Math.floor(free).toLocaleString('en-US')} XTZ room`);
    } else {
        score -= prefs.amount === 'large' ? 60 : 30;
        reasons.push(`${Math.max(0, Math.floor(free)).toLocaleString('en-US')} XTZ room`);
    }

    if (prefs.priority === 'capacity') {
        score += capacityScore * 0.28;
        if (baker.openDelegationRoom) reasons.push('open oven');
    } else {
        score += communityScore * 0.28;
        reasons.push(`${community.toLocaleString('en-US')} delegators + stakers`);
    }

    if (prefs.style === 'modern' && baker.tz4) {
        score += 18;
        reasons.push('tz4/BLS');
    } else if (prefs.style === 'veteran' && Number.isFinite(baker.sinceYear) && baker.sinceYear <= VETERAN_LAST_YEAR) {
        score += 18;
        reasons.push(`since ${baker.sinceYear}`);
    } else if (prefs.style === 'balanced') {
        score += (capacityScore + communityScore) * 0.05;
        reasons.push(`${(baker.delegationUsage || 0).toFixed(0)}% used`);
    }

    return {
        baker,
        score,
        reasons: reasons.slice(0, 3),
        hasRoom
    };
}

function fitFinderHtml(ranked) {
    const candidates = ranked
        .map((baker) => scoreBakerFit(baker, fitPrefs))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

    return `
        <section class="baker-fit-finder" aria-label="Delegator baker fit finder">
            <div class="baker-fit-head">
                <div>
                    <span class="feature-kicker">Delegator match</span>
                    <h3>Find bakers that fit your delegation lane</h3>
                    <p class="baker-fit-method">Fit uses live delegation capacity, community, tenure, and tz4—not an uptime or performance grade. Delegation fees and payout policy are off-chain, so they are not ranked here; the on-chain external-staker edge is not a delegation fee.</p>
                </div>
                <a href="/staking/">Staking guide</a>
            </div>
            <div class="baker-fit-questions">
                ${FIT_QUESTIONS.map((question) => `
                    <div class="baker-fit-question">
                        <span>${escapeHtml(question.label)}</span>
                        <div class="baker-fit-options">
                            ${question.options.map((option) => `
                                <button type="button" class="baker-fit-option ${fitPrefs[question.key] === option.value ? 'active' : ''}" data-fit-key="${escapeHtml(question.key)}" data-fit-value="${escapeHtml(option.value)}" aria-pressed="${fitPrefs[question.key] === option.value ? 'true' : 'false'}" title="${escapeHtml(option.detail)}">
                                    ${escapeHtml(option.label)}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="baker-fit-results">
                ${candidates.map((item, index) => `
                    <article class="baker-fit-card ${item.hasRoom ? '' : 'tight'}">
                        <span class="baker-fit-rank">#${index + 1}</span>
                        <strong>${escapeHtml(item.baker.name)}</strong>
                        <small>${escapeHtml(item.reasons.join(' · '))}</small>
                        <button type="button" class="baker-fit-select" data-address="${escapeHtml(item.baker.address)}">Review baker</button>
                    </article>
                `).join('')}
            </div>
        </section>
    `;
}

function openBakerInDrawer(addr) {
    if (!addr) return;
    const input = document.getElementById('my-baker-input');
    const saveBtn = document.getElementById('my-baker-save');
    const drawer = document.getElementById('my-tezos-drawer');
    const scrim = document.getElementById('my-tezos-drawer-scrim');
    const emptyState = document.getElementById('drawer-empty-state');
    const connectedState = document.getElementById('drawer-connected');

    if (input) input.value = addr;
    if (saveBtn) saveBtn.click();

    if (drawer && scrim) {
        drawer.classList.add('open');
        scrim.classList.add('open');
        document.body.style.overflow = 'hidden';
        if (emptyState) emptyState.style.display = 'none';
        if (connectedState) connectedState.style.display = '';
    }
}

function signalBadgeHtml(badge) {
    return `<span class="lb-badge lb-badge-${escapeHtml(badge.tone)}" data-badge="${escapeHtml(badge.tone)}" title="${escapeHtml(badge.title)}" aria-label="${escapeHtml(badge.title)}">${escapeHtml(badge.label)}</span>`;
}

function signalLegendHtml(isOpen) {
    return `
        <details class="leaderboard-signal-legend" ${isOpen ? 'open' : ''}>
            <summary>Signal legend</summary>
            <div class="leaderboard-signal-legend-panel">
                <span><strong>✦ OG</strong> First TzKT activity in the 2018 launch era; shown instead of Veteran.</span>
                <span><strong>Veteran</strong> First TzKT activity on or before December 31, ${VETERAN_LAST_YEAR}.</span>
                <span><strong>🏛 Accepted</strong> Distinct protocol proposals initiated by the baker with final TzKT status <em>accepted</em>.</span>
                <span><strong>🗳 Streak</strong> Consecutive completed Exploration/Promotion periods with an applied ballot, through the latest completed ballot period.</span>
                <span><strong>↗ Rising</strong> Staking balance increased since the previous leaderboard refresh.</span>
                <small>Signals are factual on-chain history markers, not uptime, payout, or performance grades.</small>
            </div>
        </details>
    `;
}

function governanceSignalsSourceLabel() {
    const readyCount = Number(governanceSignals.careerReady) + Number(governanceSignals.proposalsReady);
    if (!readyCount) return 'governance signals unavailable';
    const dates = [governanceSignals.careerGeneratedAt, governanceSignals.proposalsGeneratedAt]
        .map((value) => Date.parse(value || ''))
        .filter(Number.isFinite);
    const asOf = dates.length ? new Date(Math.min(...dates)).toISOString().slice(0, 10) : null;
    const scope = readyCount === 2 ? 'governance receipts' : 'partial governance receipts';
    return `${scope}${asOf ? ` ${asOf} UTC` : ''}`;
}

/**
 * Render the leaderboard table
 */
function render(container, { focusSort = '', quiet = false } = {}) {
    const ranked = sortBakers(bakersData, currentSort.col, currentSort.dir);
    const sorted = showOpenOvensOnly
        ? ranked.filter((baker) => baker.openDelegationRoom)
        : ranked;
    const savedAddress = savedBakerAddress();
    const legendOpen = Boolean(container.querySelector('.leaderboard-signal-legend')?.open);
    
    const arrow = (col) => {
        if (currentSort.col !== col) return '';
        return currentSort.dir === 'desc' ? ' ▾' : ' ▴';
    };

    const headerClass = (col) => currentSort.col === col ? 'lb-th active' : 'lb-th';
    const sortHeader = (col, label, shortLabel = '') => {
        const active = currentSort.col === col;
        const direction = active ? (currentSort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
        const nextDirection = active && currentSort.dir === 'asc' ? 'descending' : 'ascending';
        const visibleLabel = shortLabel
            ? `<span class="full-title">${escapeHtml(label)}</span><span class="short-title">${escapeHtml(shortLabel)}</span>`
            : escapeHtml(label);
        const ariaLabel = active
            ? `${label}, sorted ${direction}. Sort ${nextDirection}`
            : `Sort by ${label}, ${nextDirection}`;
        return `
            <th scope="col" class="${headerClass(col)}" data-col="${col}" aria-sort="${direction}">
                <button type="button" class="lb-sort-btn" data-col="${col}" aria-label="${escapeHtml(ariaLabel)}">
                    <span>${visibleLabel}</span><span class="lb-sort-arrow" aria-hidden="true">${arrow(col)}</span>
                </button>
            </th>`;
    };

    let html = `
        ${fitFinderHtml(ranked)}
        <div class="leaderboard-affordance-row">
            ${signalLegendHtml(legendOpen)}
            <button type="button" id="leaderboard-open-ovens-filter" class="leaderboard-filter-chip ${showOpenOvensOnly ? 'active' : ''}" aria-pressed="${showOpenOvensOnly ? 'true' : 'false'}">
                <span class="lb-open-capacity-dot" aria-hidden="true"></span>
                Show open ovens
            </button>
        </div>
        <div class="leaderboard-table-wrap">
            <table class="leaderboard-table">
                <caption class="leaderboard-table-caption">Active Tezos bakers with tenure, governance, and growth signals. Choose a baker name to open full details and sharing.</caption>
                <thead>
                    <tr>
                        <th scope="col" class="lb-th lb-rank">#</th>
                        ${sortHeader('name', 'Baker')}
                        ${sortHeader('stake', 'Staking Balance', '🍞 Balance')}
                        ${sortHeader('delegators', 'Delegators')}
                        ${sortHeader('stakers', 'Stakers')}
                        ${sortHeader('capacity', 'Capacity')}
                        ${sortHeader('tz4', 'tz4 consensus key')}
                    </tr>
                </thead>
                <tbody>
    `;

    sorted.forEach((b, i) => {
        const capacityClass = b.delegationUsage >= 90 ? 'cap-critical' : b.delegationUsage >= 70 ? 'cap-warning' : '';
        const isMine = savedAddress && normalizedAddress(b.address) === savedAddress;
        const badgeRail = b.earnedBadges?.length
            ? `<span class="lb-badge-rail" aria-label="Baker signals">${b.earnedBadges.map(signalBadgeHtml).join('')}</span>`
            : '';
        const signalAria = b.earnedBadges?.length
            ? `. Signals: ${b.earnedBadges.map((badge) => badge.label).join(', ')}`
            : '';
        const openRoom = b.openDelegationRoom
            ? '<span class="lb-open-capacity-dot" title="Open delegation room" aria-label="Open delegation room"></span>'
            : '';
        const mineMarker = isMine ? '<span class="lb-my-baker-marker" title="Your baker" aria-label="Your baker">🍞</span>' : '';
        html += `
            <tr class="lb-row ${isMine ? 'lb-my-baker' : ''}" data-address="${escapeHtml(b.address)}">
                <td class="lb-rank">${i + 1}</td>
                <td class="lb-name">
                    <button type="button" class="lb-baker-open" data-address="${escapeHtml(b.address)}" title="${escapeHtml(b.address)}" aria-label="Open ${escapeHtml(b.name)} baker details${escapeHtml(signalAria)}">
                        <span class="lb-name-main">${mineMarker}${escapeHtml(b.name)}</span>${badgeRail}
                    </button>
                </td>
                <td class="lb-num">${formatMutez(b.stakingBalance)}</td>
                <td class="lb-num">${b.delegators}</td>
                <td class="lb-num">${b.stakers}</td>
                <td class="lb-num lb-capacity-cell ${capacityClass}">${openRoom}${b.delegationUsage.toFixed(0)}%</td>
                <td class="lb-tz4">${b.tz4 ? '✅' : '—'}</td>
            </tr>
        `;
    });

    html += `</tbody></table></div>`;
    const countLabel = showOpenOvensOnly
        ? `${sorted.length} of ${ranked.length} active bakers with open delegation room`
        : `${sorted.length} active bakers`;
    const sourceLabel = leaderboardDataQuality.status === 'live'
        ? 'live baker data'
        : leaderboardDataQuality.status === 'cached'
            ? 'recent cached baker data'
            : leaderboardDataQuality.status === 'stale'
                ? 'last-known cached baker data'
                : 'baker data unavailable';
    html += `<div class="leaderboard-footer">${countLabel} · ${sourceLabel} · ${governanceSignalsSourceLabel()} · capacity uses ${delegationLimitSource === 'live' ? 'live' : 'fallback'} protocol limit (${delegationLimit}x)</div>`;

    if (quiet) quietlySyncHtml(container, html);
    else container.innerHTML = html;
    focusSavedBakerRow(container);
    if (focusSort) {
        container.querySelector(`.lb-sort-btn[data-col="${CSS.escape(focusSort)}"]`)?.focus({ preventScroll: true });
    }

    const ovensFilter = container.querySelector('#leaderboard-open-ovens-filter');
    if (ovensFilter) ovensFilter.onclick = () => {
        showOpenOvensOnly = !showOpenOvensOnly;
        render(container);
    };

    container.querySelectorAll('.baker-fit-option').forEach((button) => {
        button.onclick = () => {
            const key = button.dataset.fitKey;
            const value = button.dataset.fitValue;
            if (!key || !value) return;
            fitPrefs = { ...fitPrefs, [key]: value };
            saveFitPrefs(fitPrefs);
            render(container);
        };
    });

    container.querySelectorAll('.baker-fit-select').forEach((button) => {
        button.onclick = (event) => {
            event.stopPropagation();
            openBakerInDrawer(button.dataset.address);
        };
    });

    // Native buttons make sorting reachable by click, Enter, and Space. The
    // owning columnheader carries aria-sort, and focus survives the rerender.
    container.querySelectorAll('.lb-sort-btn[data-col]').forEach(button => {
        button.onclick = () => {
            const col = button.dataset.col;
            if (currentSort.col === col) {
                currentSort.dir = currentSort.dir === 'desc' ? 'asc' : 'desc';
            } else {
                currentSort.col = col;
                currentSort.dir = col === 'name' ? 'asc' : 'desc';
            }
            try { localStorage.setItem(SORT_KEY, JSON.stringify(currentSort)); } catch {}
            render(container, { focusSort: col });
        };
    });

    // Baker names are the single explicit row action. Full details retain the
    // existing report-card/share workflow without another button in every row.
    container.querySelectorAll('.lb-baker-open').forEach(button => {
        button.onclick = () => {
            openBakerInDrawer(button.dataset.address);
        };
    });
}

function focusSavedBakerRow(container, { scroll = false } = {}) {
    const row = container.querySelector('.lb-row.lb-my-baker');
    if (!row) return;
    if (scroll || container.dataset.focusMyBaker === '1') {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        container.dataset.focusMyBaker = '0';
    }
    if (container.dataset.myBakerPulsedAddress !== row.dataset.address) {
        container.dataset.myBakerPulsedAddress = row.dataset.address;
        pulseFresh(row);
    }
}

function renderLeaderboardSkeleton() {
    const rows = Array.from({ length: 8 }, (_, index) => `
        <tr class="lb-row lb-row-loading">
            <td class="lb-rank"><span class="leaderboard-row-shimmer rank"></span></td>
            <td><span class="leaderboard-row-shimmer name"></span></td>
            <td><span class="leaderboard-row-shimmer num"></span></td>
            <td><span class="leaderboard-row-shimmer num"></span></td>
            <td><span class="leaderboard-row-shimmer num"></span></td>
            <td><span class="leaderboard-row-shimmer num"></span></td>
            <td><span class="leaderboard-row-shimmer short"></span></td>
        </tr>
    `).join('');

    return `
        <div class="leaderboard-loading-state" role="status" aria-live="polite">
            <div class="leaderboard-loading-copy">
                <strong>Preheating the baker board</strong>
                <span>Ranking funded active bakers by staking balance.</span>
            </div>
            <div class="leaderboard-table-wrap" aria-hidden="true">
                <table class="leaderboard-table">
                    <thead>
                        <tr>
                            <th scope="col" class="lb-th lb-rank">#</th>
                            <th scope="col" class="lb-th">Baker</th>
                            <th scope="col" class="lb-th">Staking Balance</th>
                            <th scope="col" class="lb-th">Delegators</th>
                            <th scope="col" class="lb-th">Stakers</th>
                            <th scope="col" class="lb-th">Capacity</th>
                            <th scope="col" class="lb-th">tz4</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

/**
 * Load and render the leaderboard
 */
async function loadLeaderboard(container, { quiet = false } = {}) {
    if (!quiet) container.innerHTML = renderLeaderboardSkeleton();
    
    try {
        const [raw, limit] = await Promise.all([
            fetchBakers(),
            fetchDelegationLimit(),
            fetchGovernanceSignals()
        ]);
        bakersData = raw.map(b => enrichBaker(b, limit));
        rememberStakeSnapshot(raw);
        render(container, { quiet });
    } catch (err) {
        if (quiet && container.children.length) {
            console.error('Leaderboard background refresh error:', err);
            return;
        }
        container.innerHTML = '<div class="leaderboard-error">The baker board didn\'t load — the oven door may be stuck. Retry?</div>';
        console.error('Leaderboard fetch error:', err);
    }
}

/**
 * Initialize leaderboard section
 */
function setLauncherToggleState(btn, isOn) {
    const helper = window.tezosSystemsLauncher?.setToggleState;
    if (helper) {
        helper(btn, isOn);
        return;
    }
    btn?.classList.toggle('active', isOn);
    btn?.setAttribute('aria-pressed', String(isOn));
    const pill = btn?.querySelector('.feature-status');
    if (pill) pill.textContent = btn?.dataset[isOn ? 'statusOn' : 'statusOff'] || (isOn ? 'Showing' : 'Hidden');
}

export function initLeaderboard() {
    const section = document.getElementById('leaderboard-section');
    if (!section) return;

    const toggleBtn = document.getElementById('leaderboard-toggle');
    const container = document.getElementById('leaderboard-results');
    if (!toggleBtn || !container) return;

    try {
        LEGACY_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch {}

    // Restore sort preference
    try {
        const saved = JSON.parse(localStorage.getItem(SORT_KEY));
        if (saved?.col) currentSort = saved;
    } catch {}

    let loaded = false;

    function updateVis(isVisible) {
        section.classList.toggle('visible', isVisible);
        setLauncherToggleState(toggleBtn, isVisible);
        toggleBtn.title = `Baker Directory: ${isVisible ? 'Showing' : 'Hidden'}`;
        
        // Lazy-load on first open
        if (isVisible && !loaded) {
            ensureLeaderboardStyles();
            loaded = true;
            loadLeaderboard(container);
        }
    }

    toggleBtn.addEventListener('click', () => {
        const isVisible = localStorage.getItem(TOGGLE_KEY) === 'true';
        const newState = !isVisible;
        localStorage.setItem(TOGGLE_KEY, String(newState));
        updateVis(newState);
        if (newState) {
            const optContainer = document.getElementById('optional-sections');
            if (optContainer && section.parentElement === optContainer) {
                optContainer.prepend(section);
            }
        }
    });

    window.addEventListener('my-baker-updated', () => {
        if (!bakersData.length || !section.classList.contains('visible')) return;
        container.dataset.focusMyBaker = '1';
        render(container);
    });

    // Restore visibility
    const isVisible = localStorage.getItem(TOGGLE_KEY) === 'true';
    updateVis(isVisible);
}

/**
 * Refresh leaderboard data (called on main refresh)
 */
export function refreshLeaderboard({ quiet = false } = {}) {
    const container = document.getElementById('leaderboard-results');
    if (!container || !bakersData.length) return;
    // Only refresh if section is visible
    const section = document.getElementById('leaderboard-section');
    if (section?.classList.contains('visible')) {
        return loadLeaderboard(container, { quiet });
    }
}

/**
 * Open My Tezos drawer by address (used for #baker=ADDRESS deep link)
 */
export async function openBakerProfile(address) {
    const openDrawer = () => {
        const drawer = document.getElementById('my-tezos-drawer');
        const scrim = document.getElementById('my-tezos-drawer-scrim');
        const emptyState = document.getElementById('drawer-empty-state');
        const connectedState = document.getElementById('drawer-connected');
        if (drawer && scrim) {
            drawer.classList.add('open');
            scrim.classList.add('open');
            document.body.style.overflow = 'hidden';
            if (emptyState) emptyState.style.display = 'none';
            if (connectedState) connectedState.style.display = '';
        }
    };

    const setAddressInput = (value) => {
        const myBakerInput = document.getElementById('my-baker-input');
        const drawerInput = document.getElementById('drawer-address-input');
        if (myBakerInput) myBakerInput.value = value;
        if (drawerInput) drawerInput.value = value;
    };

    const saveBtn = document.getElementById('my-baker-save') || document.getElementById('drawer-connect-btn');

    // Also ensure leaderboard section is open
    const section = document.getElementById('leaderboard-section');
    const toggleBtn = document.getElementById('leaderboard-toggle');
    if (section && toggleBtn && !section.classList.contains('visible')) {
        localStorage.setItem(TOGGLE_KEY, 'true');
        section.classList.add('visible');
        setLauncherToggleState(toggleBtn, true);
        toggleBtn.title = 'Baker Directory: Showing';
    }
    const leaderboardContainer = document.getElementById('leaderboard-results');
    if (leaderboardContainer) leaderboardContainer.dataset.focusMyBaker = '1';

    const originalAddress = address;

    // Resolve .tez domains to tz addresses (silently; keep drawer open either way)
    if (address.endsWith('.tez')) {
        try {
            const domainResp = await fetch('https://api.tezos.domains/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    query: `query ResolveDomain($name: String!) { domain(name: $name) { address owner } }`,
                    variables: { name: address }
                }),
            });
            const domainData = await domainResp.json();
            const domain = domainData?.data?.domain || {};
            const resolved = [domain.address, domain.owner].find(isValidAddress);
            if (!resolved) throw new Error(`Domain "${address}" not found`);
            address = resolved;
        } catch (err) {
            console.warn('[deep-link] domain resolve failed:', err?.message || err);
            setAddressInput(originalAddress);
            openDrawer();
            return;
        }
    }

    // Validate resolved address
    if (!isValidAddress(address)) {
        console.warn('[deep-link] invalid baker address:', address);
        setAddressInput(originalAddress);
        openDrawer();
        return;
    }

    try {
        const resp = await fetch(`${TZKT}/delegates/${encodeURIComponent(address)}`);
        if (!resp.ok || resp.status === 204) throw new Error('No oven at that address — double-check the tz1?');
        const baker = await resp.json();
        if (!baker || !baker.active) throw new Error('This baker\'s oven has gone cold — not currently active.');

        // CRITICAL: set localStorage BEFORE clicking save and opening drawer.
        // This ensures refreshMyTezos (triggered by my-baker-updated) renders the correct baker.
        localStorage.setItem('tezos-systems-my-baker-address', address);
        setAddressInput(address);

        // Trigger save handler to render baker data + dispatch my-baker-updated
        if (saveBtn) saveBtn.click();

        // Now open drawer — it will show the correct baker immediately
        openDrawer();
    } catch (err) {
        console.warn('[deep-link] baker lookup failed:', err?.message || err);
        localStorage.setItem('tezos-systems-my-baker-address', address || originalAddress);
        setAddressInput(address || originalAddress);
        if (saveBtn) saveBtn.click();
        openDrawer();
    }
}
