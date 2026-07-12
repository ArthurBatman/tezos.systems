/**
 * Compare Page — SEO-optimized standalone comparison pages
 * /compare/tezos-vs-{chain}.html
 * 
 * Fetches live Tezos data, renders side-by-side comparison,
 * auto-generates narrative, shareable OG cards.
 */

import '../core/tzkt-throttle.js';
import { CHAIN_COMPARISON, API_URLS } from '../core/config.js';
import { escapeHtml } from '../core/utils.js';
import { fetchWithDeadline, getTzktTotalStaked } from '../core/api.js';
import { CANONICAL_UPGRADE_COUNT, countProtocolUpgrades } from '../core/protocol-count.js';

const LB_EMA_DISABLE_THRESHOLD = 1_000_000_000;
const LB_MINUTES_PER_YEAR = 365.25 * 24 * 60;

async function fetchUpgradeCount() {
    try {
        const resp = await fetchWithDeadline(API_URLS.tzkt + '/protocols', { cache: 'no-store' });
        if (!resp.ok) throw new Error(`Protocol history HTTP ${resp.status}`);
        const protocols = await resp.json();
        return countProtocolUpgrades(protocols);
    } catch { return CANONICAL_UPGRADE_COUNT; }
}

async function fetchRequired(url, type = 'json') {
  const response = await fetchWithDeadline(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Comparison source HTTP ${response.status}`);
  return type === 'text' ? response.text() : response.json();
}

function parseMutez(value) {
  var parsed = parseInt(String(value ?? '').replace(/"/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateLbIssuance(constants, supplyMutez, lbDisabled, lbStateKnown) {
  if (!lbStateKnown) return null;
  if (lbDisabled) return 0;
  if (!constants || !supplyMutez) return null;
  var subsidyMutez = parseMutez(constants.liquidity_baking_subsidy);
  var supply = supplyMutez / 1e6;
  if (!subsidyMutez || !supply) return null;
  return (((subsidyMutez / 1e6) * LB_MINUTES_PER_YEAR) / supply) * 100;
}

const METRICS = [
  { key: 'blockTime',       label: 'Block Time',        icon: '⏱️', lower: true },
  { key: 'finality',        label: 'Finality',          icon: '✅', lower: true },
  { key: 'stakingPct',      label: 'Staking %',         icon: '🥩', context: true },
  { key: 'annualIssuance',  label: 'Annual Issuance',   icon: '🖨️', context: true },
  { key: 'validators',      label: 'Stake Concentration', icon: '🏛️', context: true },
  { key: 'selfAmendments',  label: 'Governance Upgrade Record', icon: '🔄', context: true },
  { key: 'hardForks',       label: 'Upgrade Path',      icon: '🍴', context: true },
  { key: 'energyPerTx',     label: 'Energy / Tx',       icon: '⚡', context: true },
  { key: 'avgTxFee',        label: 'Avg Tx Fee',        icon: '💰', context: true },
  { key: 'slashing',        label: 'Slashing',          icon: '⚔️', context: true },
];

const PEER_REFERENCES = {
  ethereum: [
    ['Ethereum PoS and finality', 'https://ethereum.org/developers/docs/consensus-mechanisms/pos/']
  ],
  solana: [
    ['Solana whitepaper', 'https://solana.com/solana-whitepaper.pdf'],
    ['energy methodology', 'https://solana.com/news/solana-energy-use-report-december-2023']
  ],
  cardano: [
    ['Cardano governance', 'https://docs.cardano.org/about-cardano/governance-overview'],
    ['eras and phases', 'https://docs.cardano.org/about-cardano/evolution/eras-and-phases']
  ],
  algorand: [
    ['Algorand finality', 'https://developer.algorand.org/solutions/avm-evm-instant-finality/'],
    ['sustainability', 'https://algorand.co/technology/sustainability'],
    ['May 2026 supply report', 'https://algorand.co/blog/may-2026-algo-insights-report'],
    ['staking rewards FAQ', 'https://algorand.co/staking-rewards-faq']
  ]
};

function peerReferenceHtml(chainKey) {
  return (PEER_REFERENCES[chainKey] || [])
    .map(function(reference) {
      return '<a href="' + reference[1] + '" target="_blank" rel="noopener">' + escapeHtml(reference[0]) + '</a>';
    })
    .join(' · ');
}

async function fetchLiveTezosData() {
  try {
    const [stats, issuanceText, constants, lbBlocks] = await Promise.all([
      fetchRequired(API_URLS.tzkt + '/statistics/current'),
      fetchRequired(API_URLS.octez + '/chains/main/blocks/head/context/issuance/current_yearly_rate', 'text'),
      fetchRequired(API_URLS.octez + '/chains/main/blocks/head/context/constants'),
      fetchRequired(API_URLS.tzkt + '/blocks?sort.desc=level&limit=1&select=level,lbToggleEma'),
    ]);
    const supplyMutez = Number(stats.totalSupply || 0);
    const stakedMutez = getTzktTotalStaked(stats);
    const protocolIssuance = parseFloat(String(issuanceText).replace(/"/g, ''));
    const latestLbBlock = Array.isArray(lbBlocks) ? lbBlocks[0] : null;
    const lbEma = Number(latestLbBlock?.lbToggleEma);
    const lbStateKnown = Number.isFinite(lbEma);
    const lbDisabled = lbStateKnown && lbEma >= LB_EMA_DISABLE_THRESHOLD;
    const lbIssuance = calculateLbIssuance(constants, supplyMutez, lbDisabled, lbStateKnown);
    const totalIssuance = Number.isFinite(protocolIssuance) && Number.isFinite(lbIssuance)
      ? protocolIssuance + lbIssuance
      : NaN;
    const stakePct = stakedMutez && supplyMutez ? ((stakedMutez / supplyMutez) * 100).toFixed(1) : null;
    return {
      stakingPct: stakePct ? '~' + stakePct + '%' : 'Unavailable',
      annualIssuance: Number.isFinite(totalIssuance) ? '~' + totalIssuance.toFixed(2) + '%' : 'Unavailable',
      annualIssuanceNote: !lbStateKnown
        ? 'LB state unavailable; combined rate withheld'
        : lbDisabled
          ? 'Adaptive + LB 0% (disabled)'
          : 'Adaptive + active LB',
      blockTime: '~6s',
      finality: '~12s',
      selfAmendments: await fetchUpgradeCount(),
      slashing: 'Adaptive',
      slashingNote: 'Scales with offense severity',
    };
  } catch(e) {
    return {
      stakingPct: 'Unavailable',
      annualIssuance: 'Unavailable',
      annualIssuanceNote: 'Live Tezos sources unavailable; combined rate withheld'
    };
  }
}

function parseNumeric(val) {
  if (typeof val === 'number') return val;
  if (!val) return NaN;
  var cleaned = String(val).replace(/[~<>%,s]/g, '').trim();
  return parseFloat(cleaned) || NaN;
}

function getWinner(tezVal, otherVal, metric) {
  if (metric.context) return 'context';
  var t = parseNumeric(tezVal);
  var o = parseNumeric(otherVal);
  if (isNaN(t) || isNaN(o)) return 'tie';
  if (metric.lower)  return t < o ? 'tezos' : t > o ? 'other' : 'tie';
  if (metric.higher) return t > o ? 'tezos' : t < o ? 'other' : 'tie';
  return 'tie';
}

function generateNarrative(chain, tezos) {
  var lines = [];

  lines.push('Tezos and ' + chain.name + ' are both proof-of-stake blockchains, but they take fundamentally different approaches to upgradability, governance, and decentralization.');
  lines.push('No composite score is assigned. Thresholds, entity grouping, and operational risk differ by chain, so contextual rows such as stake concentration and slashing should be read with their notes rather than ranked as a single winner.');

  lines.push('Tezos has completed ' + tezos.selfAmendments + ' on-chain protocol upgrades. No persistent upgrade-driven community split is recorded in the tracked history. Tenderbake targets deterministic finality after two levels when quorum and network assumptions hold.');

  if (chain.name === 'Ethereum') {
    lines.push('Ethereum dominates in TVL and ecosystem size, while protocol upgrades land through socially coordinated client releases and hard forks. Validator-key counts should not be mistaken for independently controlled staking entities.');
  } else if (chain.name === 'Solana') {
    lines.push('Solana offers faster raw block times and has a published network-incident history. Its operator-coordinated upgrade model differs from Tezos\'s protocol-level, on-chain amendment process.');
  } else if (chain.name === 'Cardano') {
    lines.push('Cardano introduced Voltaire-era on-chain governance after Tezos. Tezos has the longer production record of protocol proposals, ballots, activations, and failed governance windows captured on-chain.');
  } else if (chain.name === 'Algorand') {
    lines.push('Algorand and Tezos use different deterministic-finality designs. Tezos makes binding self-amendment a protocol mechanism, while Algorand upgrades remain more Foundation-coordinated.');
  }

  return lines;
}

export function initComparePage(chainKey) {
  var chain = CHAIN_COMPARISON[chainKey];
  if (!chain) { document.getElementById('compare-content').innerHTML = '<p>Chain not found.</p>'; return; }

  var tezos = CHAIN_COMPARISON.tezosStatic;
  var container = document.getElementById('compare-content');

  fetchLiveTezosData().then(function(live) {
    // Merge live data
    var tez = Object.assign({}, tezos, live, { name: 'Tezos', symbol: 'XTZ' });

    var rows = METRICS.map(function(m) {
      var tVal = tez[m.key] !== undefined ? tez[m.key] : '—';
      var oVal = chain[m.key] !== undefined ? chain[m.key] : '—';
      var tNote = tez[m.key + 'Note'] || '';
      var oNote = chain[m.key + 'Note'] || '';
      var winner = getWinner(tVal, oVal, m);

      return '<div class="cp-row">' +
        '<div class="cp-metric">' + m.icon + ' ' + m.label + '</div>' +
        '<div class="cp-val ' + (winner === 'tezos' ? 'cp-winner' : '') + '">' +
          '<span class="cp-val-main">' + tVal + '</span>' +
          (tNote ? '<span class="cp-val-note">' + tNote + '</span>' : '') +
        '</div>' +
        '<div class="cp-val ' + (winner === 'other' ? 'cp-winner' : '') + '">' +
          '<span class="cp-val-main">' + oVal + '</span>' +
          (oNote ? '<span class="cp-val-note">' + oNote + '</span>' : '') +
        '</div>' +
      '</div>';
    });

    var narrative = generateNarrative(chain, tez);

    container.innerHTML =
      '<div class="cp-table">' +
        '<div class="cp-header">' +
          '<div class="cp-metric">Metric</div>' +
          '<div class="cp-val"><img src="/favicon-48.png" alt="Tezos" width="20" height="20"> Tezos</div>' +
          '<div class="cp-val">' + escapeHtml(chain.name) + '</div>' +
        '</div>' +
        rows.join('') +
      '</div>' +
      '<div class="cp-narrative">' + narrative.map(function(p) { return '<p>' + p + '</p>'; }).join('') + '</div>' +
      '<div class="cp-cta">' +
        '<a href="/" class="cp-cta-btn">Explore the full dashboard →</a>' +
        '<a href="/#calculator" class="cp-cta-btn cp-cta-secondary">Calculate staking rewards →</a>' +
      '</div>' +
      '<div class="cp-footer">' +
        '<p>Live Tezos values update from <a href="https://api.tzkt.io" target="_blank" rel="noopener">TzKT</a> and Octez RPC. Current-cycle address-level concentration is calculated in <a href="/health/">Network Health</a>. Peer values are a static snapshot last verified ' + CHAIN_COMPARISON.lastUpdated + '; they are not all live.</p>' +
        '<p>Peer methodology references: ' + peerReferenceHtml(chainKey) + '</p>' +
      '</div>';
  });
}
