/**
 * Shared Etherlink governance contract lineage and track classification.
 *
 * Keep this module browser-safe: the live L2 Chamber and the generated Maxis
 * career artifact both consume the same contract taxonomy.
 */

export const ETHERLINK_GOVERNANCE_CONTRACT_CREATOR = 'tz1VGpuq8GkCwf4x6MupTz6QAcJLivQcaAsb';

// Mainnet addresses published by the Etherlink governance documentation. Do
// not infer the current set from one creator account: the sequencer contract
// moved to a different, corrected deployment in Etherlink 6.4.
export const ETHERLINK_GOVERNANCE_CURRENT_CONTRACTS = Object.freeze({
    fast: 'KT19oUVQPnVLuUBYXrBVd46WJnNAMpqkKSwo',
    slow: 'KT1AXRU3wLc87WNhLhVGrgqDGubLACUMUgPb',
    sequencer: 'KT1KiVz8ZpHo3HpE1GCP5HLgywPDRwVUkCFh'
});

// Reviewed production lineage. The official governance service supplies the
// canonical period bounds within these contracts; raw code-hash matches are
// not enough because retired contracts can still receive transactions.
export const ETHERLINK_GOVERNANCE_PRODUCTION_CONTRACTS = Object.freeze([
    Object.freeze({ address: 'KT1N5MHQW5fkqXkW9GPjRYfn5KwbuYrvsY1g', track: 'fast', current: false }),
    Object.freeze({ address: 'KT1GRAN26ni19mgd6xpL6tsH52LNnhKSQzP2', track: 'fast', current: false }),
    Object.freeze({ address: 'KT1DxndcFitAbxLdJCN3C1pPivqbC3RJxD1R', track: 'fast', current: false }),
    Object.freeze({ address: ETHERLINK_GOVERNANCE_CURRENT_CONTRACTS.fast, track: 'fast', current: true }),
    Object.freeze({ address: 'KT1H5pCmFuhAwRExzNNrPQFKpunJx1yEVa6J', track: 'slow', current: false }),
    Object.freeze({ address: 'KT1FPG4NApqTJjwvmhWvqA14m5PJxu9qgpBK', track: 'slow', current: false }),
    Object.freeze({ address: 'KT1XdSAYGXrUDE1U5GNqUKKscLWrMhzyjNeh', track: 'slow', current: false }),
    Object.freeze({ address: 'KT1VZVNCNnhUp7s15d9RsdycP7C1iwYhAQ8r', track: 'slow', current: false }),
    Object.freeze({ address: ETHERLINK_GOVERNANCE_CURRENT_CONTRACTS.slow, track: 'slow', current: true }),
    Object.freeze({ address: 'KT1WckZ2uiLfHCfQyNp1mtqeRcC1X6Jg2Qzf', track: 'sequencer', current: false }),
    Object.freeze({ address: ETHERLINK_GOVERNANCE_CURRENT_CONTRACTS.sequencer, track: 'sequencer', current: true })
]);

export const ETHERLINK_GOVERNANCE_HISTORY_CODE_HASHES = Object.freeze([
    1029816579,
    2062495254,
    -322739163,
    368151125
]);

export const ETHERLINK_GOVERNANCE_HISTORY_CODE_HASH_TRACKS = new Map([
    ['1029816579', ['fast']],
    ['2062495254', ['fast', 'slow']],
    ['-322739163', ['fast', 'slow']],
    ['368151125', ['sequencer']]
]);

export const ETHERLINK_GOVERNANCE_TRACKS = Object.freeze([
    Object.freeze({
        key: 'fast',
        label: 'FAST',
        description: 'Kernel hotfix and fast-track Tezos X governance.',
        quorumLabel: '15% promotion quorum'
    }),
    Object.freeze({
        key: 'slow',
        label: 'SLOW',
        description: 'Longer-window kernel governance for standard upgrades.',
        quorumLabel: '5% promotion quorum'
    }),
    Object.freeze({
        key: 'sequencer',
        label: 'SEQUENCER',
        description: 'Sequencer pool and public-key governance.',
        quorumLabel: '8% promotion quorum'
    })
]);

function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function classifyEtherlinkGovernanceTrack(config = {}) {
    const proposalQuorum = number(config.proposal_quorum);
    const promotionQuorum = number(config.promotion_quorum);
    const supermajority = number(config.promotion_supermajority);
    if (!proposalQuorum || !promotionQuorum || !supermajority) return '';
    if (proposalQuorum === 5 && promotionQuorum === 15) return 'fast';
    if (promotionQuorum === 5) return 'slow';
    if (promotionQuorum === 8) return 'sequencer';
    return '';
}
