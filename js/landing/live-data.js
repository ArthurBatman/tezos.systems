/**
 * Live data injection for SEO landing pages
 * Lightweight — only fetches what the page needs
 */
import '../core/tzkt-throttle.js';
import { fetchCurrentVotingPeriod, fetchWithRetry } from '../core/api.js';
import { escapeHtml } from '../core/utils.js';
import { countProtocolUpgrades } from '../core/protocol-count.js';

const TZKT = 'https://api.tzkt.io/v1';
const OCTEZ = 'https://eu.rpc.tez.capital';
const LB_EMA_DISABLE_THRESHOLD = 1_000_000_000;
const LB_MINUTES_PER_YEAR = 365.25 * 24 * 60;
const PROTOCOL_HASH_NAMES = {
    PsUshuai: 'Ushuaia',
    PtTALLiN: 'Tallinn',
    PtSeouLo: 'Seoul',
    PsRiotum: 'Rio',
    PsQuebec: 'Quebec',
    PsParisC: 'Paris C',
    PtParisB: 'Paris'
};

async function fetchJson(url) {
    return fetchWithRetry(url, { cache: 'no-store', memoryCache: false }, 2);
}

async function fetchText(url) {
    return fetchWithRetry(url, {
        cache: 'no-store',
        memoryCache: false,
        responseType: 'text'
    }, 2);
}

function parseMutez(value) {
    const parsed = parseInt(String(value ?? '').replace(/"/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getTzktTotalStaked(stats = {}) {
    const total = Number(stats.totalOwnStaked || 0) + Number(stats.totalExternalStaked || 0);
    return total > 0 ? total : Number(stats.totalFrozen || 0);
}

async function fetchLiquidityBakingSubsidyState() {
    try {
        const blocks = await fetchJson(`${TZKT}/blocks?sort.desc=level&limit=1&select=level,lbToggleEma`);
        const latest = Array.isArray(blocks) ? blocks[0] : null;
        const rawEma = latest?.lbToggleEma;
        const ema = Number(rawEma);
        const known = rawEma !== null && rawEma !== undefined && rawEma !== '' && Number.isFinite(ema);
        return {
            disabled: known && ema >= LB_EMA_DISABLE_THRESHOLD,
            known,
            ema: known ? ema : null
        };
    } catch (e) {
        console.warn('Liquidity Baking subsidy state unavailable:', e);
        return { disabled: false, known: false, ema: null };
    }
}

async function fetchProtocolConstants() {
    try {
        return await fetchJson(`${OCTEZ}/chains/main/blocks/head/context/constants`);
    } catch (e) {
        console.warn('Protocol constants unavailable:', e);
        return null;
    }
}

function calculateLbIssuanceRate(constants, supplyMutez, lbDisabled, lbStateKnown) {
    if (!lbStateKnown) return null;
    if (lbDisabled) return 0;
    if (!constants || !supplyMutez) return null;
    const lbSubsidyPerMinute = parseMutez(constants.liquidity_baking_subsidy);
    const supply = supplyMutez / 1e6;
    if (!lbSubsidyPerMinute || !supply) return null;
    const lbXTZPerYear = (lbSubsidyPerMinute / 1e6) * LB_MINUTES_PER_YEAR;
    return (lbXTZPerYear / supply) * 100;
}

/**
 * Inject text into elements by data-live attribute
 * <span data-live="staking-apy">~9%</span> → replaced with real value
 */
function inject(key, value) {
    document.querySelectorAll(`[data-live="${key}"]`).forEach(el => {
        el.textContent = value;
        el.classList.add('live-loaded');
    });
}

function checkedAtLabel() {
    return new Date().toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
    });
}

function protocolAlias(protocol) {
    const hashPrefix = protocol?.hash ? String(protocol.hash).slice(0, 8) : '';
    return protocol?.extras?.alias
        || protocol?.metadata?.alias
        || protocol?.alias
        || PROTOCOL_HASH_NAMES[hashPrefix]
        || 'Unknown';
}

/**
 * Fetch and inject staking data
 */
export async function loadStakingData() {
    try {
        const [rateText, frozenStakeText, supplyText, stats, constants, lbState] = await Promise.all([
            fetchText(`${OCTEZ}/chains/main/blocks/head/context/issuance/current_yearly_rate`),
            fetchText(`${OCTEZ}/chains/main/blocks/head/context/total_frozen_stake`),
            fetchText(`${OCTEZ}/chains/main/blocks/head/context/total_supply`),
            fetchJson(`${TZKT}/statistics/current`),
            fetchProtocolConstants(),
            fetchLiquidityBakingSubsidyState()
        ]);

        const parsedProtocolIssuance = parseFloat(rateText.replace(/"/g, ''));
        const protocolIssuance = Number.isFinite(parsedProtocolIssuance) && parsedProtocolIssuance > 0
            ? parsedProtocolIssuance
            : null;
        const supplyMutez = Number(stats.totalSupply || 0) || parseMutez(supplyText) || 0;
        const stakedMutez = getTzktTotalStaked(stats) || parseMutez(frozenStakeText) || 0;
        const readNonNegativeStat = (key) => {
            const raw = stats?.[key];
            if (raw === null || raw === undefined || raw === '') return null;
            const parsed = Number(raw);
            return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
        };
        const ownStakedMutez = readNonNegativeStat('totalOwnStaked');
        const externalStakedMutez = readNonNegativeStat('totalExternalStaked');
        const totalFrozenMutez = readNonNegativeStat('totalFrozen');
        const ownDelegatedMutez = readNonNegativeStat('totalOwnDelegated');
        const externalDelegatedMutez = readNonNegativeStat('totalExternalDelegated');
        const hasStakedFields = (ownStakedMutez !== null && externalStakedMutez !== null)
            || totalFrozenMutez !== null;
        const hasDelegatedFields = ownDelegatedMutez !== null && externalDelegatedMutez !== null;
        const hasTzktStakingInputs = stats
            && typeof stats === 'object'
            && hasStakedFields
            && hasDelegatedFields;
        if (!protocolIssuance || supplyMutez <= 0 || stakedMutez <= 0 || !hasTzktStakingInputs) {
            throw new Error('Live staking estimate inputs are incomplete');
        }
        const delegationPowerDivisor = Number(constants?.edge_of_staking_over_delegation);
        if (!Number.isFinite(delegationPowerDivisor) || delegationPowerDivisor <= 0) {
            throw new Error('Live staking/delegation weight is unavailable');
        }
        const lbIssuance = calculateLbIssuanceRate(constants, supplyMutez, lbState.disabled, lbState.known);
        const totalIssuance = Number.isFinite(lbIssuance) ? protocolIssuance + lbIssuance : null;
        const supply = supplyMutez / 1e6;
        const staked = stakedMutez / 1e6;
        const delegatedMutez = hasDelegatedFields
            ? ownDelegatedMutez + externalDelegatedMutez
            : NaN;
        const delegated = delegatedMutez / 1e6;
        const stakingRatio = supply > 0 ? (staked / supply * 100) : 0;
        const effective = supply > 0 ? (staked / supply) + (delegated / supply) / delegationPowerDivisor : 0;
        const stakeAPY = effective > 0 ? (protocolIssuance / 100) / effective * 100 : 0;
        const delegateAPY = stakeAPY / delegationPowerDivisor;
        if (!Number.isFinite(supply) || supply <= 0
            || !Number.isFinite(staked) || staked <= 0
            || !Number.isFinite(delegated) || delegated < 0
            || !Number.isFinite(effective) || effective <= 0
            || !Number.isFinite(stakeAPY) || stakeAPY <= 0
            || !Number.isFinite(delegateAPY) || delegateAPY <= 0) {
            throw new Error('Live staking estimate values are invalid');
        }
        const lbBreakdown = lbState.disabled
            ? '0.00% LB (disabled)'
            : Number.isFinite(lbIssuance) ? `${lbIssuance.toFixed(2)}% LB` : 'LB state unavailable';

        inject('staking-apy', `~${stakeAPY.toFixed(1)}%`);
        inject('delegate-apy', `~${delegateAPY.toFixed(1)}%`);
        inject('staking-ratio', `${stakingRatio.toFixed(1)}%`);
        inject('issuance-rate', Number.isFinite(totalIssuance) ? `${totalIssuance.toFixed(2)}%` : 'Unavailable');
        inject('issuance-breakdown', `${protocolIssuance.toFixed(2)}% protocol · ${lbBreakdown}`);
        inject('total-supply', `${(supply / 1e9).toFixed(2)}B`);
        inject('total-staked', `${(staked / 1e9).toFixed(2)}B`);
        inject('total-delegated', `${(delegated / 1e9).toFixed(2)}B`);
    } catch (e) {
        console.warn('Live staking data unavailable:', e);
    }
}

/**
 * Fetch and inject governance data
 */
export async function loadGovernanceData() {
    try {
        const [voting, protocols, headMeta] = await Promise.all([
            fetchCurrentVotingPeriod(),
            fetchJson(`${TZKT}/protocols?sort.desc=firstLevel&limit=30`),
            fetchJson('https://eu.rpc.tez.capital/chains/main/blocks/head/metadata')
        ]);
        const head = { cycle: headMeta?.level_info?.cycle, level: headMeta?.level_info?.level };

        // Current period
        const periodNames = {
            proposal: 'Proposal',
            exploration: 'Exploration Vote',
            cooldown: 'Cooldown',
            promotion: 'Promotion Vote',
            adoption: 'Adoption'
        };
        inject('voting-period', periodNames[voting.kind] || voting.kind);
        inject('voting-period-detail', head.level
            ? `Cycle ${head.cycle ?? '?'} · level ${head.level.toLocaleString()}`
            : 'Live TzKT governance period');

        // Time remaining
        if (voting.endTime) {
            const remaining = new Date(voting.endTime) - new Date();
            if (remaining > 0) {
                const days = Math.floor(remaining / 86400000);
                const hours = Math.floor((remaining % 86400000) / 3600000);
                inject('voting-time-left', days > 0 ? `${days}d ${hours}h` : `${hours}h`);
                inject('voting-time-detail', 'Until the current period closes');
            } else {
                inject('voting-time-left', 'Transitioning');
                inject('voting-time-detail', 'TzKT is indexing the next governance period');
            }
        } else {
            inject('voting-time-left', 'See Chamber');
            inject('voting-time-detail', 'Current period has no closing timestamp yet');
        }
        inject('governance-freshness', `Source: TzKT + Octez RPC · checked ${checkedAtLabel()}`);

        // Protocol count
        const activeProtocols = protocols.filter(p => p.firstLevel > 0);
        inject('protocol-count', countProtocolUpgrades(activeProtocols).toString());

        // Current protocol
        const current = activeProtocols[0];
        if (current) {
            inject('current-protocol', protocolAlias(current));
        }

        // Days live
        const mainnetLaunch = new Date('2018-09-17T00:00:00Z');
        const daysLive = Math.floor((new Date() - mainnetLaunch) / 86400000);
        inject('days-live', daysLive.toLocaleString());

    } catch (e) {
        console.warn('Live governance data unavailable:', e);
        inject('voting-period', 'Open Chamber');
        inject('voting-period-detail', 'Live governance status is retrying');
        inject('voting-time-left', 'Still syncing');
        inject('voting-time-detail', 'Open the Chamber for live status while this clock retries');
        inject('governance-freshness', 'Source: TzKT + Octez RPC · live data retrying in browser.');
    }
}

/**
 * Fetch and inject baker/consensus data
 */
export async function loadBakerData() {
    try {
        const bakers = await fetchJson(`${TZKT}/delegates?active=true&select=address,alias,stakingBalance,bakingPower,numDelegators,stakersCount&limit=10000`);
        if (!Array.isArray(bakers)) {
            throw new Error('Unexpected active baker response');
        }
        const fundedBakers = bakers.filter((b) => Number(b.bakingPower || 0) > 0);
        if (!fundedBakers.length) {
            throw new Error('Active baker response contained no funded bakers');
        }
        const topBakers = fundedBakers
            .sort((a, b) => Number(b.bakingPower || 0) - Number(a.bakingPower || 0))
            .slice(0, 10);
        const totalBakers = fundedBakers.length;

        inject('total-bakers', totalBakers.toString());

        // Render top 10 into a table if container exists
        const container = document.getElementById('top-bakers-list');
        if (container && topBakers.length) {
            const fmtXTZ = (mutez) => {
                const xtz = (mutez || 0) / 1e6;
                if (xtz >= 1e6) return (xtz / 1e6).toFixed(2) + 'M';
                if (xtz >= 1e3) return (xtz / 1e3).toFixed(1) + 'K';
                return xtz.toFixed(0);
            };
            let html = '<table class="landing-table"><thead><tr><th>#</th><th>Baker</th><th>Baking Power</th><th>Delegators</th></tr></thead><tbody>';
            topBakers.forEach((b, i) => {
                const name = b.alias || (b.address.slice(0, 10) + '…');
                const address = b.address || '';
                html += `<tr><td>${i + 1}</td><td><a href="/#baker=${encodeURIComponent(address)}">${escapeHtml(name)}</a></td><td>${fmtXTZ(b.bakingPower)} ꜩ</td><td>${b.numDelegators || 0}</td></tr>`;
            });
            html += '</tbody></table>';
            html += `<p class="landing-cta"><a href="/#leaderboard">View all ${totalBakers} bakers →</a></p>`;
            container.innerHTML = html;
        }
    } catch (e) {
        console.warn('Live baker data unavailable:', e);
    }
}
